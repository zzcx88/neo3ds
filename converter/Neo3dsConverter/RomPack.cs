using static Neo3dsConverter.Lang;
using System.IO.Compression;
using System.Text;
using ZstdSharp;

namespace Neo3dsConverter;

/// <summary>
/// Writes the files the engine's loader.c expects into romfs/game/.
/// Sprites are converted to gngeo's packed 4bpp tile format and zstd-compressed
/// in fixed-size blocks so the 3DS can keep them all in RAM.
/// </summary>
public static class RomPack
{
    public const int SpriteBlockSize = 4096; // 32 tiles of 128 bytes
    const uint SpriteCodecZstd = 2; // c.idx version = codec (1 was LZ4); see engine loader.c
    const int ZstdLevel = 19;       // slow to compress, same decompression speed; KOF98 64MB -> ~22MB

    public sealed record Stats(int Tiles, long SpriteRaw, long SpritePacked, long TotalBytes);

    public static Stats Write(MameGame game, RomSet rom, string biosZip, string gameDir, Action<string> log)
    {
        Directory.CreateDirectory(gameDir);
        using var bios = new ZipSet(biosZip);

        var regions = BuildRegions(game, rom);
        byte[] Need(string name) => regions.TryGetValue(name, out var r) ? r
            : throw new InvalidDataException($"{game.Name}: " + L($"{name} 영역이 없습니다.", $"no {name} region."));

        // MAME keeps the 68k program big-endian; the engine wants the dump's little-endian words.
        var program = Need("maincpu");
        for (int i = 0; i + 1 < program.Length; i += 2) (program[i], program[i + 1]) = (program[i + 1], program[i]);
        if (game.Cart != "rom") log(L("  암호 해독 중...", "  Decrypting..."));
        var sma = Protection.Apply(game.Cart, regions);
        GameDb.PatchFor(game)?.Invoke(program);
        File.WriteAllBytes(Path.Combine(gameDir, "p.bin"), program);
        File.WriteAllBytes(Path.Combine(gameDir, "s.bin"), Need("fixed"));
        WriteSmaConfig(Path.Combine(gameDir, "sma.bin"), sma);
        // MAME's audiocpu region holds the M1 ROM at 0 and again from 0x10000 (ROM_RELOAD), the second
        // copy overwriting the first above 64KB. The engine wants the ROM itself: take the reloaded copy.
        if (!regions.TryGetValue("m1", out var m1))
        {
            var audio = Need("audiocpu");
            var ops = game.Region("audiocpu")!.Ops;
            var reload = ops.FirstOrDefault(o => o.Kind == "reload");
            int start = reload?.A ?? 0, size = reload?.B ?? ops.First(o => o.Kind == "load").B;
            m1 = audio[start..Math.Min(start + size, audio.Length)];
        }
        File.WriteAllBytes(Path.Combine(gameDir, "m1.bin"), m1);
        File.WriteAllBytes(Path.Combine(gameDir, "v.bin"), Need("ymsnd:adpcma"));
        string vb = Path.Combine(gameDir, "vb.bin");
        if (regions.TryGetValue("ymsnd:adpcmb", out var adpcmb)) File.WriteAllBytes(vb, adpcmb);
        else File.Delete(vb);

        // Dev aid: NEO3DS_MVS_BIOS skips the AES BIOSes, to match MAME's default (euro MVS) when comparing.
        var biosFile = bios.FirstPresent(Environment.GetEnvironmentVariable("NEO3DS_MVS_BIOS") != null
                                         ? GameDb.Bios[2..] : GameDb.Bios);
        File.WriteAllBytes(Path.Combine(gameDir, "bios.bin"), bios.Read(biosFile));
        // An AES console has no system fix ROM; the engine then always uses the cart's S ROM.
        string sfixPath = Path.Combine(gameDir, "sfix.bin");
        if (GameDb.IsAesBios(biosFile)) File.Delete(sfixPath);
        else File.WriteAllBytes(sfixPath, bios.Read(GameDb.BiosFix));
        File.WriteAllBytes(Path.Combine(gameDir, "lo.bin"), bios.Read(GameDb.ZoomTable));

        log(L("  그래픽 변환 + 압축 중...", "  Converting and compressing graphics..."));
        var (tiles, raw, packed) = WriteSprites(Need("sprites"), gameDir);
        long total = Directory.GetFiles(gameDir).Sum(f => new FileInfo(f).Length);
        return new Stats(tiles, raw, packed, total);
    }

    /// <summary>sma.bin for the engine's loader.c: "NSMA", bank select address, the 6 source bits of
    /// the bank number (MAME bitswap order), two random number addresses, 64 bank offsets.</summary>
    static void WriteSmaConfig(string path, SmaConfig? sma)
    {
        if (sma == null) { File.Delete(path); return; }
        using var w = new BinaryWriter(File.Create(path));
        w.Write("NSMA"u8);
        w.Write(sma.BankAddr);
        foreach (int b in sma.Bits) w.Write((byte)b);
        w.Write((short)0);
        w.Write(sma.RngAddr1);
        w.Write(sma.RngAddr2);
        foreach (int o in sma.Offsets) w.Write(o);
    }

    /// <summary>Replays MAME's ROM_LOAD steps into one buffer per region. maincpu ends up big-endian,
    /// as the 68k sees it.</summary>
    static Dictionary<string, byte[]> BuildRegions(MameGame game, RomSet rom)
    {
        var built = new Dictionary<string, byte[]>();
        foreach (var region in game.Regions)
        {
            var buf = new byte[region.Size];
            byte[] data = Array.Empty<byte>();
            string flag = "";
            int pos = 0;
            foreach (var op in region.Ops)
            {
                switch (op.Kind)
                {
                    case "load":
                        data = rom.Read(op.File, op.Crc, game.Name);
                        flag = op.Flag;
                        pos = 0;
                        Place(buf, flag, data, ref pos, op.A, op.B);
                        break;
                    case "cont":
                        Place(buf, flag, data, ref pos, op.A, op.B);
                        break;
                    case "reload":
                        pos = 0;
                        Place(buf, flag, data, ref pos, op.A, op.B);
                        break;
                    case "ignore":
                        pos += op.A;
                        break;
                    case "fill":
                        buf.AsSpan(op.A, Math.Min(op.B, buf.Length - op.A)).Fill((byte)op.C);
                        break;
                    case "copy":
                        built[op.Src].AsSpan(op.A, op.C).CopyTo(buf.AsSpan(op.B));
                        break;
                }
            }
            built[region.Name] = buf;
        }
        return built;
    }

    /// <summary>Copies <paramref name="size"/> bytes of a ROM file into a region, interleaved as the load flag says.</summary>
    static void Place(byte[] buf, string flag, byte[] data, ref int pos, int offset, int size)
    {
        size = Math.Min(size, data.Length - pos);
        switch (flag)
        {
            case "":
                data.AsSpan(pos, size).CopyTo(buf.AsSpan(offset));
                break;
            case "16b":
                for (int i = 0; i < size; i++) buf[offset + 2 * i] = data[pos + i];
                break;
            case "32b":
                for (int i = 0; i < size; i++) buf[offset + 4 * i] = data[pos + i];
                break;
            case "16ws":
                for (int i = 0; i < size; i++) buf[(offset + i) ^ 1] = data[pos + i];
                break;
            case "32ws":
                for (int i = 0; i < size; i++) buf[offset + (i >> 1) * 4 + ((i & 1) ^ 1)] = data[pos + i];
                break;
            default:
                throw new InvalidDataException("unknown load flag " + flag);
        }
        pos += size;
    }

    static (int tiles, long raw, long packed) WriteSprites(byte[] gfx, string gameDir)
    {
        // MAME's sprite region already has each C ROM pair byte-interleaved (odd chip -> even bytes).
        int tiles = gfx.Length / 128;
        var usage = new uint[(tiles + 15) / 16];
        Parallel.For(0, tiles, t =>
        {
            if (ConvertTile(gfx, t))
                Interlocked.Or(ref usage[t >> 4], 1u << ((t & 15) * 2)); // TILE_INVISIBLE = 1
        });

        int blocks = gfx.Length / SpriteBlockSize;
        var packedBlocks = new byte[blocks][];
        using var compressors = new ThreadLocal<Compressor>(() => new Compressor(ZstdLevel), trackAllValues: true);
        Parallel.For(0, blocks, i =>
        {
            packedBlocks[i] = compressors.Value!.Wrap(gfx.AsSpan(i * SpriteBlockSize, SpriteBlockSize)).ToArray();
        });
        foreach (var c in compressors.Values) c.Dispose();

        long packed = 0;
        using (var pak = File.Create(Path.Combine(gameDir, "c.pak")))
            foreach (var b in packedBlocks) { pak.Write(b); packed += b.Length; }

        using (var idx = new BinaryWriter(File.Create(Path.Combine(gameDir, "c.idx"))))
        {
            idx.Write(Encoding.ASCII.GetBytes("NEOC"));
            idx.Write(SpriteCodecZstd);
            idx.Write((uint)tiles);
            idx.Write((uint)SpriteBlockSize);
            idx.Write((uint)blocks);
            uint off = 0;
            idx.Write(off);
            foreach (var b in packedBlocks) { off += (uint)b.Length; idx.Write(off); }
            foreach (var u in usage) idx.Write(u);
        }
        return (tiles, gfx.Length, packed);
    }

    /// <summary>
    /// gngeo roms.c convert_roms_tile: bitplanes -> one nibble per pixel, leftmost pixel
    /// in the high nibble, right 8-pixel half first. Returns true if the tile is fully transparent.
    /// </summary>
    static bool ConvertTile(byte[] g, int tileno)
    {
        int b = tileno << 7;
        Span<byte> swap = stackalloc byte[128];
        g.AsSpan(b, 128).CopyTo(swap);
        uint usedPens = 0;
        int o = b;
        for (int y = 0; y < 16; y++)
        {
            foreach (int half in stackalloc[] { 64, 0 })
            {
                uint dw = 0;
                int r = half + (y << 2);
                for (int x = 0; x < 8; x++)
                {
                    uint pen = (uint)(((swap[r + 3] >> x) & 1) << 3 | ((swap[r + 1] >> x) & 1) << 2 |
                                      ((swap[r + 2] >> x) & 1) << 1 | ((swap[r] >> x) & 1));
                    dw |= pen << ((7 - x) << 2);
                    usedPens |= 1u << (int)pen;
                }
                g[o++] = (byte)dw; g[o++] = (byte)(dw >> 8); g[o++] = (byte)(dw >> 16); g[o++] = (byte)(dw >> 24);
            }
        }
        return (usedPens & ~1u) == 0;
    }

    /// <summary>Looks up BIOS chips in neogeo.zip by CRC, falling back to file name.</summary>
    sealed class ZipSet : IDisposable
    {
        readonly ZipArchive zip;
        readonly string zipName;

        public ZipSet(string path)
        {
            zip = ZipFile.OpenRead(path);
            zipName = Path.GetFileName(path);
        }

        ZipArchiveEntry? Find(RomFile f) =>
            zip.Entries.FirstOrDefault(e => e.Crc32 == f.Crc && e.Length == f.Size) ??
            zip.Entries.FirstOrDefault(e => e.Name.Equals(f.Name, StringComparison.OrdinalIgnoreCase));

        public byte[] Read(RomFile f)
        {
            var e = Find(f) ?? throw new FileNotFoundException(
                L($"{zipName}에 {f.Name} (CRC {f.Crc:x8}) 파일이 없습니다.", $"{zipName} has no {f.Name} (CRC {f.Crc:x8})."));
            var buf = RomSet.ReadEntry(e);
            if (e.Crc32 != f.Crc)
                throw new InvalidDataException(L($"{e.Name}의 CRC가 다릅니다 ({e.Crc32:x8}, 기대값 {f.Crc:x8}). 다른 버전의 롬셋입니다.", $"{e.Name} has CRC {e.Crc32:x8}, expected {f.Crc:x8}: a different romset version."));
            return buf;
        }

        public RomFile FirstPresent(RomFile[] candidates)
        {
            foreach (var f in candidates)
                if (Find(f) != null) return f;
            throw new FileNotFoundException(L("바이오스 파일이 없습니다: ", "No BIOS file: ") + string.Join(", ", candidates.Select(c => c.Name)));
        }

        public void Dispose() => zip.Dispose();
    }
}

/// <summary>
/// The zips a romset's chips can come from: the game's own zip, then its parent's zip in the same
/// folder (MAME "split" sets keep only a clone's changed chips). Chips are found by CRC, so file
/// names may differ; a merged parent zip holds its clones' chips too.
/// </summary>
public sealed class RomSet : IDisposable
{
    readonly List<ZipArchive> zips = new();
    readonly Dictionary<uint, ZipArchiveEntry> byCrc = new();
    readonly Dictionary<string, ZipArchiveEntry> byName = new(StringComparer.OrdinalIgnoreCase);

    public string Description { get; }

    public RomSet(params string[] paths)
    {
        foreach (var path in paths.Where(File.Exists).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var zip = ZipFile.OpenRead(path);
            zips.Add(zip);
            foreach (var e in zip.Entries)
            {
                if (e.Length == 0) continue;
                byCrc.TryAdd(e.Crc32, e);
                byName.TryAdd(e.Name, e);
            }
        }
        Description = string.Join(" + ", paths.Where(File.Exists).Select(Path.GetFileName).Distinct());
    }

    /// <summary>MAME marks undumped chips without a CRC; they load as empty.</summary>
    public bool Has(string name, uint? crc) => crc == null || byCrc.ContainsKey(crc.Value);

    /// <summary>Names of the chips of a game that none of the zips has.</summary>
    public IEnumerable<string> Missing(MameGame g) =>
        g.Regions.SelectMany(r => r.Ops).Where(o => o.Kind == "load" && !Has(o.File, o.Crc)).Select(o => o.File);

    public byte[] Read(string name, uint? crc, string game)
    {
        if (crc == null) return byName.TryGetValue(name, out var n) ? ReadEntry(n) : Array.Empty<byte>();
        if (byCrc.TryGetValue(crc.Value, out var e)) return ReadEntry(e);
        if (byName.TryGetValue(name, out var wrong))
            throw new InvalidDataException(L($"{wrong.Name}의 CRC가 다릅니다 ({wrong.Crc32:x8}, 기대값 {crc:x8}). {game}과(와) 다른 버전의 롬셋입니다.", $"{wrong.Name} has CRC {wrong.Crc32:x8}, expected {crc:x8}: not the {game} romset version."));
        throw new FileNotFoundException(L($"{Description}에 {name} (CRC {crc:x8}) 파일이 없습니다.", $"{Description} has no {name} (CRC {crc:x8})."));
    }

    internal static byte[] ReadEntry(ZipArchiveEntry e)
    {
        using var s = e.Open();
        var buf = new byte[e.Length];
        s.ReadExactly(buf);
        return buf;
    }

    public void Dispose()
    {
        foreach (var z in zips) z.Dispose();
    }
}
