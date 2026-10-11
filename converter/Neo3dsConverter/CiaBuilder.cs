using static Neo3dsConverter.Lang;
using System.Diagnostics;
using System.IO.Compression;
using System.Text;

namespace Neo3dsConverter;

/// <summary>What to convert and how the installed title should look.</summary>
public sealed class CiaJob
{
    public required string RomZip { get; init; }
    public string? BiosZip { get; set; }
    /// <summary>The zip's name; it fixes the Title ID, so a rebuilt CIA installs over the old one.</summary>
    public required string RomName { get; init; }
    /// <summary>The MAME romset converted (may be a clone found inside a merged zip), or null if none fits.</summary>
    public MameGame? Game { get; init; }
    /// <summary>Why no romset could be used, when <see cref="Game"/> is null.</summary>
    public string? Problem { get; init; }
    public required string Title { get; set; }
    public string Publisher { get; set; } = "SNK";
    public required string OutputDir { get; set; }
    /// <summary>Optional pictures for the HOME menu; generated from the title when null.</summary>
    public string? IconImage { get; set; }
    public string? BannerImage { get; set; }
    /// <summary>The system the game starts on: null = automatic (home AES, or arcade MVS for the carts
    /// that need it), false = AES, true = MVS. The player can switch it on the 3DS either way.</summary>
    public bool? StartMvs { get; set; }

    /// <param name="set">A romset to use instead of picking one (e.g. a clone inside a merged zip).</param>
    public static CiaJob FromRomZip(string romZip, string? set = null)
    {
        string full = Path.GetFullPath(romZip);
        string dir = Path.GetDirectoryName(full)!;
        string name = Path.GetFileNameWithoutExtension(full).ToLowerInvariant();
        string bios = Path.Combine(dir, "neogeo.zip");
        var (game, problem) = PickGame(name, dir, set);
        return new CiaJob
        {
            RomZip = full,
            BiosZip = File.Exists(bios) ? bios : null,
            RomName = name,
            Game = game,
            Problem = problem,
            Title = game?.Title ?? GameDb.Find(name)?.Title ?? name.ToUpperInvariant(),
            Publisher = game?.Maker ?? "SNK",
            OutputDir = dir,
        };
    }

    /// <summary>Zips a romset's chips may come from: its own, its parent's, and the zip named after the parent.</summary>
    public static string[] ZipsFor(MameGame g, string dir, string zipName)
    {
        var paths = new List<string> { Path.Combine(dir, zipName + ".zip"), Path.Combine(dir, g.Name + ".zip") };
        if (g.Parent != null) paths.Add(Path.Combine(dir, g.Parent + ".zip"));
        return paths.ToArray();
    }

    /// <summary>
    /// The romset named like the zip when the engine supports it and its chips are all there;
    /// otherwise a supported clone whose chips the (merged) zip holds, e.g. kof98.zip -> kof98h.
    /// </summary>
    static (MameGame?, string?) PickGame(string name, string dir, string? set)
    {
        var exact = GameDb.Find(set ?? name);
        if (exact == null) return (null, L($"'{name}'은(는) MAME 네오지오 롬셋 이름이 아닙니다. zip 파일 이름을 바꾸지 마세요.", $"'{name}' is not a MAME Neo Geo romset name. Keep the zip's original file name."));
        string? problem = null;
        foreach (var g in set != null ? new[] { exact } : new[] { exact }.Concat(GameDb.ClonesOf(exact.Name)))
        {
            string? why = GameDb.Unsupported(g);
            if (why != null) { problem ??= $"{exact.Title}: {why}"; continue; }
            using var zips = new RomSet(ZipsFor(g, dir, name));
            var missing = zips.Missing(g).ToList();
            if (missing.Count == 0) return (g, null);
            if (g == exact || problem == null)
                problem = $"{g.Name}: " + L("롬 파일이 빠졌습니다", "ROM files are missing") + $" ({string.Join(", ", missing.Take(4))}{(missing.Count > 4 ? " ..." : "")})";
        }
        return (null, problem);
    }

    /// <summary>
    /// Stable per-game unique id so each game installs as its own title.
    /// Range 0xC0000-0xCFFFF is unused by retail titles and common homebrew.
    /// </summary>
    public uint UniqueId => 0xC0000u | (Crc32(Encoding.ASCII.GetBytes(RomName)) & 0xFFFF);

    public string TitleId => $"00040000{UniqueId << 8:X8}";

    static uint Crc32(byte[] data)
    {
        uint crc = 0xFFFFFFFF;
        foreach (byte b in data)
        {
            crc ^= b;
            for (int i = 0; i < 8; i++) crc = (crc >> 1) ^ (0xEDB88320u & (uint)-(int)(crc & 1));
        }
        return ~crc;
    }
}

/// <summary>Turns a Neo Geo romset into an installable CIA wrapping the neo3ds engine.</summary>
public sealed class CiaBuilder
{
    readonly Action<string> log;
    readonly string toolsDir = Path.Combine(AppContext.BaseDirectory, "tools");

    public CiaBuilder(Action<string> log) => this.log = log;

    public string Build(CiaJob job)
    {
        foreach (var tool in new[] { "makerom.exe", "bannertool.exe", "engine.elf", "neo3ds.rsf" })
            if (!File.Exists(Path.Combine(toolsDir, tool)))
                throw new FileNotFoundException(L($"tools\\{tool} 파일이 없습니다. 변환기 폴더를 통째로 옮겼는지 확인하세요.", $"tools\\{tool} is missing. Keep the converter folder together when moving it."));

        using var _ = ZipFile.OpenRead(job.RomZip); // fail early on a broken zip
        if (job.BiosZip == null)
            throw new FileNotFoundException(L("neogeo.zip(바이오스)을 찾을 수 없습니다. 롬 zip과 같은 폴더에 넣어주세요.", "neogeo.zip (BIOS) not found. Put it in the same folder as the game zip."));

        string work = Path.Combine(Path.GetTempPath(), "neo3ds", $"{job.RomName}-{Environment.ProcessId}");
        if (Directory.Exists(work)) Directory.Delete(work, true);
        Directory.CreateDirectory(work);
        try
        {
            log(L($"[1/4] RomFS 준비 ({job.RomName})", $"[1/4] Preparing RomFS ({job.RomName})"));
            string romfs = PrepareRomFs(job, work);

            log(L("[2/4] 아이콘/배너 생성", "[2/4] Making icon and banner"));
            string icon = Path.Combine(work, "icon.icn");
            string banner = Path.Combine(work, "banner.bnr");
            using (var bmp = Art.Icon(job.Title, job.IconImage)) bmp.Save(Path.Combine(work, "icon.png"));
            using (var bmp = Art.Banner(job.Title, job.BannerImage)) bmp.Save(Path.Combine(work, "banner.png"));
            Art.SaveSilentWav(Path.Combine(work, "banner.wav"));
            Run("bannertool.exe", $"makebanner -i \"{work}\\banner.png\" -a \"{work}\\banner.wav\" -o \"{banner}\"");
            Run("bannertool.exe", $"makesmdh -s \"{Smdh(job.Title, 64)}\" -l \"{Smdh(job.Title + " (neo3ds)", 128)}\" " +
                                  $"-p \"{Smdh(job.Publisher, 64)}\" -i \"{work}\\icon.png\" -o \"{icon}\"");

            log(L($"[3/4] CIA 생성 (Title ID {job.TitleId})", $"[3/4] Building CIA (Title ID {job.TitleId})"));
            job.OutputDir = Path.GetFullPath(job.OutputDir);
            Directory.CreateDirectory(job.OutputDir);
            string cia = Path.Combine(job.OutputDir, job.RomName + ".cia");
            string product = ("NEO3DS-" + job.RomName.ToUpperInvariant());
            if (product.Length > 16) product = product[..16];
            Run("makerom.exe",
                $"-f cia -o \"{cia}\" -target t -exefslogo " +
                $"-rsf \"{toolsDir}\\neo3ds.rsf\" -elf \"{toolsDir}\\engine.elf\" " +
                $"-icon \"{icon}\" -banner \"{banner}\" " +
                $"-DAPP_TITLE=neo3ds -DAPP_PRODUCT_CODE={product} -DAPP_UNIQUE_ID=0x{job.UniqueId:X5} " +
                $"-DAPP_ROMFS=\"{romfs}\"");

            // Dev aid: a CXI boots directly in Azahar without installing.
            if (Environment.GetEnvironmentVariable("NEO3DS_CXI") != null)
                Run("makerom.exe",
                    $"-f cxi -o \"{Path.ChangeExtension(cia, ".cxi")}\" -target t -exefslogo " +
                    $"-rsf \"{toolsDir}\\neo3ds.rsf\" -elf \"{toolsDir}\\engine.elf\" " +
                    $"-icon \"{icon}\" -banner \"{banner}\" " +
                    $"-DAPP_TITLE=neo3ds -DAPP_PRODUCT_CODE={product} -DAPP_UNIQUE_ID=0x{job.UniqueId:X5} " +
                    $"-DAPP_ROMFS=\"{romfs}\"");

            log(L($"[4/4] 완료: {cia} ({new FileInfo(cia).Length / 1048576.0:F1} MB)", $"[4/4] Done: {cia} ({new FileInfo(cia).Length / 1048576.0:F1} MB)"));
            return cia;
        }
        finally
        {
            // Dev aid: NEO3DS_KEEP leaves the prepared romfs in %TEMP%\neo3ds for inspection.
            if (Environment.GetEnvironmentVariable("NEO3DS_KEEP") == null)
                try { Directory.Delete(work, true); } catch { /* temp cleanup is best effort */ }
        }
    }

    string PrepareRomFs(CiaJob job, string work)
    {
        var def = job.Game ?? throw new NotSupportedException(job.Problem ?? L("지원하지 않는 게임입니다.", "This game is not supported."));
        if (def.Name != job.RomName) log(L($"  롬셋: {def.Name} ({def.Desc})", $"  Romset: {def.Name} ({def.Desc})"));

        string romfs = Path.Combine(work, "romfs");
        using var rom = new RomSet(CiaJob.ZipsFor(def, Path.GetDirectoryName(job.RomZip)!, job.RomName));
        var stats = RomPack.Write(def, rom, job.BiosZip!, Path.Combine(romfs, "game"), log, job.StartMvs);
        log(L($"  타일 {stats.Tiles:N0}개, 그래픽 {stats.SpriteRaw / 1048576.0:F1}MB → {stats.SpritePacked / 1048576.0:F1}MB, " +
              $"3DS 메모리 사용 약 {stats.TotalBytes / 1048576.0:F1}MB",
              $"  {stats.Tiles:N0} tiles, graphics {stats.SpriteRaw / 1048576.0:F1}MB → {stats.SpritePacked / 1048576.0:F1}MB, " +
              $"about {stats.TotalBytes / 1048576.0:F1}MB of 3DS memory"));
        // engine: 58MB heap, of which the sprite cache takes 8MB and the emulator itself ~2MB
        if (stats.TotalBytes > 48L << 20)
            log(L("  ⚠ 메모리가 빠듯합니다. Old 3DS에서는 로딩 중 메모리 부족으로 실패할 수 있습니다.", "  ⚠ Memory is tight. On an Old 3DS loading may fail for lack of memory."));
        File.WriteAllText(Path.Combine(romfs, "meta.txt"),
            $"title: {job.Title}\nrom: {job.RomName}\nset: {def.Name}\ntitle id: {job.TitleId}\n" +
            $"converter: {typeof(CiaBuilder).Assembly.GetName().Version}\n");
        return romfs;
    }

    static string Smdh(string s, int max)
    {
        s = s.Replace("\"", "'");
        return s.Length > max ? s[..max] : s;
    }

    void Run(string exe, string args)
    {
        var psi = new ProcessStartInfo(Path.Combine(toolsDir, exe), args)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = toolsDir,
        };
        using var p = Process.Start(psi)!;
        var stdout = p.StandardOutput.ReadToEndAsync();
        string stderr = p.StandardError.ReadToEnd();
        p.WaitForExit();
        string output = (stdout.Result + stderr).Trim();
        if (p.ExitCode != 0)
            throw new Exception(L($"{exe} 실패 (코드 {p.ExitCode}):\n{output}", $"{exe} failed (code {p.ExitCode}):\n{output}"));
    }
}
