using static Neo3dsConverter.Lang;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Neo3dsConverter;

/// <summary>A BIOS / support ROM chip, matched by CRC first, then by name.</summary>
public sealed record RomFile(string Name, uint Crc, int Size);

/// <summary>The BIOS region. Europe (also Asia's code) is MAME's default and was the only one before 1.1.0.</summary>
public enum Region { Europe, Japan, Usa }

/// <summary>One step of MAME's ROM loading for a region (see scripts/gen_gamedb.py).</summary>
public sealed record RomOp(string Kind, string Flag, string File, uint? Crc, int A, int B, int C, string Src);

public sealed record RomRegion(string Name, int Size, RomOp[] Ops);

/// <summary>A romset from MAME's neogeo.cpp: names, region layout and the cart type (machine).</summary>
public sealed record MameGame(string Name, string? Parent, string Year, string Maker, string Desc, string Machine,
                              string Cart, RomRegion[] Regions)
{
    public RomRegion? Region(string name) => Regions.FirstOrDefault(r => r.Name == name);

    /// <summary>"Metal Slug X - Super Vehicle-001 (NGM-2500 ~ NGH-2500)" -> "Metal Slug X - Super Vehicle-001".</summary>
    public string Title
    {
        get
        {
            string t = Desc.Split(" / ")[0];
            t = Regex.Replace(t, @"\s*\([^)]*\)\s*$", "");
            return t.Trim();
        }
    }
}

/// <summary>Every Neo Geo romset MAME knows, from the embedded neogeo_games.json.</summary>
public static class GameDb
{
    public static readonly IReadOnlyList<MameGame> Games = Load();
    static readonly Dictionary<string, MameGame> byName = Games.ToDictionary(g => g.Name, StringComparer.OrdinalIgnoreCase);

    public static MameGame? Find(string name) => byName.GetValueOrDefault(name);

    public static IEnumerable<MameGame> ClonesOf(string name) =>
        Games.Where(g => string.Equals(g.Parent, name, StringComparison.OrdinalIgnoreCase));

    /// <summary>Why the engine can't run this cart yet, or null when it can.</summary>
    public static string? Unsupported(MameGame g)
    {
        if (g.Machine == "irrmaze") return L("트랙볼 전용 게임", "needs a trackball");
        if (Protection.Supported(g.Cart)) return null;
        return g.Cart switch
        {
            "rom_kof98" => L("보호 칩이 달린 MVS판입니다 (가정용 kof98h 롬이 있으면 그걸로 변환됩니다)", "MVS version with a protection chip (the home version kof98h converts if its ROMs are in the zip)"),
            "rom_fatfur2" => L("보호 칩 미지원", "protection chip not supported"),
            "rom_vliner" or "cmc50_jockeygp" => L("도박기판 게임", "gambling board"),
            _ when g.Cart.StartsWith("boot_") => L("해적판(부트렉) 롬셋 미지원", "bootleg romsets are not supported"),
            _ => L("보호 칩 미지원", "protection chip not supported"),
        };
    }

    /// <summary>68k program fixes applied after the program image is built (dump byte order).</summary>
    public static Action<byte[]>? PatchFor(MameGame g) => g.Cart switch
    {
        "rom_mslugx" => Patches.MslugX,
        _ => null,
    };

    static IReadOnlyList<MameGame> Load()
    {
        using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("neogeo_games.json")
                      ?? throw new InvalidOperationException("neogeo_games.json resource missing");
        using var doc = JsonDocument.Parse(s);
        var list = new List<MameGame>();
        foreach (var g in doc.RootElement.EnumerateArray())
        {
            var regions = new List<RomRegion>();
            foreach (var r in g.GetProperty("regions").EnumerateObject())
            {
                var ops = new List<RomOp>();
                foreach (var o in r.Value.GetProperty("ops").EnumerateArray())
                {
                    var a = o.EnumerateArray().ToArray();
                    string kind = a[0].GetString()!;
                    ops.Add(kind switch
                    {
                        "load" => new RomOp(kind, a[1].GetString()!, a[2].GetString()!,
                                            a[3].ValueKind == JsonValueKind.Null ? null : Convert.ToUInt32(a[3].GetString(), 16),
                                            a[4].GetInt32(), a[5].GetInt32(), 0, ""),
                        "cont" or "reload" => new RomOp(kind, "", "", null, a[1].GetInt32(), a[2].GetInt32(), 0, ""),
                        "ignore" => new RomOp(kind, "", "", null, a[1].GetInt32(), 0, 0, ""),
                        "fill" => new RomOp(kind, "", "", null, a[1].GetInt32(), a[2].GetInt32(), a[3].GetInt32(), ""),
                        "copy" => new RomOp(kind, "", "", null, a[2].GetInt32(), a[3].GetInt32(), a[4].GetInt32(), a[1].GetString()!),
                        _ => throw new InvalidDataException("unknown ROM op " + kind),
                    });
                }
                regions.Add(new RomRegion(r.Name, r.Value.GetProperty("size").GetInt32(), ops.ToArray()));
            }
            string? parent = g.GetProperty("parent").ValueKind == JsonValueKind.Null ? null : g.GetProperty("parent").GetString();
            list.Add(new MameGame(g.GetProperty("name").GetString()!, parent, g.GetProperty("year").GetString()!,
                                  g.GetProperty("maker").GetString()!, g.GetProperty("desc").GetString()!,
                                  g.GetProperty("machine").GetString()!, g.GetProperty("cart").GetString()!,
                                  regions.ToArray()));
        }
        return list;
    }

    /// <summary>68k program patches. The program image keeps the dump's byte order:
    /// each 16-bit word is stored little-endian.</summary>
    static class Patches
    {
        const ushort Nop = 0x4e71;

        static ushort Word(byte[] p, int a) => (ushort)(p[a] | p[a + 1] << 8);
        static void Poke(byte[] p, int a, ushort w) { p[a] = (byte)w; p[a + 1] = (byte)(w >> 8); }

        public static void MslugX(byte[] p)
        {
            // andi.w #1,D3 ; bne xxxx  -> drop the branch taken when the protection check fails
            for (int i = 0; i + 8 <= p.Length; i += 2)
                if (Word(p, i) == 0x0243 && Word(p, i + 2) == 0x0001 && Word(p, i + 4) == 0x6600)
                {
                    Poke(p, i + 4, Nop);
                    Poke(p, i + 6, Nop);
                }
            foreach (int a in new[] { 0x3bdc, 0x3bde, 0x3be0, 0x3c0c, 0x3c0e, 0x3c10, 0x3c36, 0x3c38 })
                Poke(p, a, Nop);
        }
    }

    // BIOS: home (AES) first - no coins, soft DIPs or backup RAM, and it boots
    // straight into the game. MVS BIOSes are the fallback. sfix/zoom are shared.
    // Each BIOS carries its region (byte 0x401 of the big-endian ROM: 0 Japan, 1 USA, 2 Europe and
    // Asia), and games pick their language and censorship (Metal Slug's blood) from it.
    static readonly RomFile NeoEpo = new("neo-epo.bin", 0xd27a71f1, 0x20000), NeoPo = new("neo-po.bin", 0x16d0c132, 0x20000);
    static readonly RomFile[] MvsEurope =
    {
        new("sp-s2.sp1", 0x9036d879, 0x20000), new("sp-s.sp1", 0xc7f2fa45, 0x20000),
        new("asia-s3.rom", 0x91b64be3, 0x20000), new("sp-45.sp1", 0x03cc9f6a, 0x20000),
    };
    static readonly RomFile[] MvsJapan =
    {
        new("vs-bios.rom", 0xf0e8f27d, 0x20000), new("sp-j2.sp1", 0xacede59c, 0x20000), new("sp1.jipan.1024", 0x9fb0abe4, 0x20000),
    };
    static readonly RomFile[] MvsUsa = { new("usa_2slt.bin", 0xe72943de, 0x20000), new("sp-e.sp1", 0x2723a5b5, 0x20000) };
    public static readonly RomFile[] Bios = new[] { NeoEpo, NeoPo }.Concat(MvsEurope).Concat(MvsJapan).Concat(MvsUsa).ToArray();
    public static bool IsAesBios(RomFile f) => f == NeoEpo || f == NeoPo;

    /// <summary>Home BIOSes, the region's first (there is no American one: Europe's stands in).</summary>
    public static RomFile[] AesBios(Region r) => r == Region.Japan ? new[] { NeoPo, NeoEpo } : new[] { NeoEpo, NeoPo };
    /// <summary>Arcade BIOSes, the region's first, then the others.</summary>
    public static RomFile[] MvsBios(Region r) => r switch
    {
        Region.Japan => MvsJapan.Concat(MvsEurope).Concat(MvsUsa).ToArray(),
        Region.Usa => MvsUsa.Concat(MvsEurope).Concat(MvsJapan).ToArray(),
        _ => MvsEurope.Concat(MvsJapan).Concat(MvsUsa).ToArray(),
    };
    public static Region RegionOf(RomFile f) =>
        f == NeoPo || MvsJapan.Contains(f) ? Region.Japan : MvsUsa.Contains(f) ? Region.Usa : Region.Europe;
    /// <summary>Carts that misbehave on a home BIOS: the SVC Chaos Plus bootleg flashes its "PLUS"
    /// logo during fights and its CPU opponents act oddly unless it runs as an arcade (MVS) board.</summary>
    public static bool NeedsMvsBios(MameGame g) => g.Cart == "boot_svcplus";
    public static readonly RomFile BiosFix = new("sfix.sfix", 0xc2ea0cfd, 0x20000);
    public static readonly RomFile ZoomTable = new("000-lo.lo", 0x5a86cff2, 0x20000);
}
