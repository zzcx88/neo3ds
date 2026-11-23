using SkiaSharp;

namespace Neo3dsConverter;

/// <summary>
/// Command-line mode for scripted builds, shared by Neo3dsConverter.exe (Windows) and neo3ds-converter (Linux/macOS):
///   &lt;game.zip&gt; [out-dir] [--title "..."] [--icon icon.png] [--banner banner.png] [--set romset] [--system aes|mvs] [--region eu|jp|us] [--lang ko|en]
///   &lt;a.zip&gt; &lt;b.zip&gt; ... [out-dir] [--system aes|mvs] [--region eu|jp|us]   (one CIA each; --title/--icon/--banner/--set need one zip)
///   --pack: a .neo3ds game file for the launcher instead of a CIA (same options)
///   --launcher [out-dir]   (the launcher CIA, neo3ds-launcher.cia)
///   --art-sheet sheet.png   (generated art of every MAME romset, for checking)
///   --help | -h   (this help)
/// </summary>
public static class CommandLine
{
    /// <summary>Applies "--lang ko|en" (remembered) and returns the other arguments.</summary>
    public static string[] TakeLang(string[] args)
    {
        int li = Array.IndexOf(args, "--lang");
        if (li < 0 || li + 1 >= args.Length) return args;
        Lang.Set(args[li + 1] == "ko", remember: true);
        return args.Where((_, i) => i != li && i != li + 1).ToArray();
    }

    static string Build(CiaJob job, bool pack)
    {
        var builder = new CiaBuilder(Console.WriteLine);
        return pack ? builder.BuildPack(job) : builder.Build(job);
    }

    static string BuildLauncher(string directory) => new CiaBuilder(Console.WriteLine).BuildLauncher(directory);

    /// <summary>Runs one command (arguments without --lang); returns the process exit code.</summary>
    public static int Run(string[] args) => Run(args, Build, BuildLauncher, () => OutputFolder.DefaultDir());

    internal static int Run(string[] args, Func<CiaJob, bool, string> build) =>
        Run(args, build, BuildLauncher, () => OutputFolder.DefaultDir());

    internal static int Run(string[] args, Func<string, string> buildLauncher, Func<string> defaultDir) =>
        Run(args, Build, buildLauncher, defaultDir);

    static int Run(string[] args, Func<CiaJob, bool, string> build, Func<string, string> buildLauncher, Func<string> defaultDir)
    {
        try
        {
            if (args.Any(a => a == "--help" || a == "-h")) { PrintHelp(); return 0; }
            if (args[0] == "--art-sheet") { ArtSheet(args[1]); return 0; }
            if (args[0] == "--launcher")
            {
                var launcher = buildLauncher(args.Length > 1 ? args[1] : defaultDir());
                Console.WriteLine($"OK {launcher}");
                return 0;
            }
            bool pack = false;
            var positional = new List<string>();
            string? title = null, icon = null, banner = null, set = null;
            bool? startMvs = null;
            var region = Region.Europe;
            for (int i = 0; i < args.Length; i++)
                switch (args[i])
                {
                    case "--title": title = Value(args, ref i); break;
                    case "--set": set = Value(args, ref i); break;
                    case "--icon": icon = Path.GetFullPath(Value(args, ref i)); break;
                    case "--banner": banner = Path.GetFullPath(Value(args, ref i)); break;
                    case "--pack": pack = true; break;
                    case "--system": startMvs = Value(args, ref i).Equals("mvs", StringComparison.OrdinalIgnoreCase); break;
                    case "--region":
                        region = Value(args, ref i).ToLowerInvariant() switch
                        {
                            "jp" or "japan" => Region.Japan,
                            "us" or "usa" => Region.Usa,
                            "eu" or "europe" or "asia" => Region.Europe,
                            var r => throw new ConverterException(FailureKind.Usage,
                                Lang.L($"--region {r}: eu, jp, us 중 하나를 쓰세요.", $"--region {r}: use eu, jp or us")),
                        };
                        break;
                    default: positional.Add(args[i]); break;
                }
            var zipArgs = positional.Where(a => a.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)).ToList();
            var outDir = positional.Except(zipArgs).LastOrDefault();
            var zips = OutputFolder.Distinct(zipArgs).ToList(); // #404: the same zip twice converts once
            if (zips.Count == 0)
                throw new ConverterException(FailureKind.Usage,
                    Lang.L("게임 zip이 없어요. 게임 zip 경로를 넣어 주세요.", "No game zip was given. Pass the path of a game zip."));
            if (zips.Count > 1 && (title ?? icon ?? banner ?? set) != null)
                throw new ConverterException(FailureKind.Usage,
                    Lang.L("--title, --icon, --banner, --set은 zip 하나일 때만 쓸 수 있어요. 이번 실행은 zip을 여러 개 받았어요.",
                           "--title, --icon, --banner and --set need a single zip, but several were given."));
            int failed = 0;
            var failures = new List<FailureText.BatchFailure>();
            var built = new List<string>();
            string batchDir = outDir != null ? Path.GetFullPath(outDir) : OutputFolder.ForZips(zips);
            var reservedNames = new HashSet<string>(OperatingSystem.IsLinux() ? StringComparer.Ordinal : StringComparer.OrdinalIgnoreCase);
            foreach (var zip in zips)
            {
                CiaJob? job = null;
                bool completed = false;
                try
                {
                    job = CiaJob.FromRomZip(zip, set);
                    if (outDir != null) job.OutputDir = Path.GetFullPath(outDir);
                    if (zips.Count > 1)
                        job.OutputName = OutputFolder.ReserveBatchOutputName(job, job.OutputDir, pack ? ".neo3ds" : ".cia", reservedNames);
                    if (title != null) job.Title = title;
                    job.IconImage = icon;
                    job.BannerImage = banner;
                    job.StartMvs = startMvs;
                    job.Region = region;
                    string file = build(job, pack);
                    completed = true;
                    if (zips.Count == 1) Console.WriteLine($"OK {file}");
                    else built.Add(file);
                }
                // #329: the console shows the same cause+action pair as the windows; the raw
                // exception text stays behind NEO3DS_DEBUG (the CLI has no log window).
                catch (Exception e) when (zips.Count > 1)
                {
                    if (!completed && job?.OutputName != null) reservedNames.Remove(job.OutputName);
                    WriteFailure(e);
                    failures.Add(job != null ? FailureText.BatchFailure.Of(job, e) : new FailureText.BatchFailure(null, FailureText.KindOf(e)));
                    failed++;
                }
            }
            if (zips.Count > 1)
            {
                // #404: two or more results go into one batch folder; OK names where each file is now.
                string baseDir = batchDir;
                var gathered = OutputFolder.Gather(baseDir, built, DateTime.Now);
                foreach (var file in gathered.Paths) Console.WriteLine($"OK {file}");
                if (gathered.Warning != null) Console.Error.WriteLine("WARNING " + gathered.Warning);
                if (gathered.Folder != null) Console.WriteLine($"DIR {gathered.Folder}");
            }
            if (failures.Count > 0) Console.Error.WriteLine(FailureText.Batch(failures, hasLog: false));
            return failed == 0 ? 0 : 1;
        }
        catch (Exception e)
        {
            WriteFailure(e);
            return 1;
        }
    }

    /// <summary>The value after a flag. A flag with nothing after it is a usage error like any
    /// other, not an index crash that reads as "unknown … send a report" (#329).</summary>
    static string Value(string[] args, ref int i)
    {
        if (i + 1 >= args.Length)
            throw new ConverterException(FailureKind.Usage,
                Lang.L($"{args[i]} 뒤에 값을 넣어 주세요.", $"Put a value after {args[i]}."));
        return args[++i];
    }

    /// <summary>The one line a script or a reader sees: 'FAILED' plus the plain cause and action.
    /// A command-line mistake prints its own message (it is the instruction); the raw exception
    /// is diagnostic, so it needs NEO3DS_DEBUG=1 (#329).</summary>
    static void WriteFailure(Exception e)
    {
        Console.Error.WriteLine("FAILED " + (FailureText.KindOf(e) == FailureKind.Usage
            ? e.Message
            : FailureText.Plain(e)));
        if (Environment.GetEnvironmentVariable("NEO3DS_DEBUG") != null)
            Console.Error.WriteLine(FailureText.Raw(e) + Environment.NewLine + e);
    }

    /// <summary>Prints full usage (--help / -h) in the current language.</summary>
    static void PrintHelp()
    {
        string exe = "neo3ds-converter";
        try
        {
            var path = Environment.ProcessPath;
            var name = path != null ? Path.GetFileNameWithoutExtension(path) : null;
            if (!string.IsNullOrEmpty(name) && !name.Equals("dotnet", StringComparison.OrdinalIgnoreCase))
                exe = Path.GetFileName(path)!; // self-contained run: real file name
        }
        catch { /* keep the default */ }
        Console.WriteLine(Lang.L($"""
            사용법:
              {exe} <game.zip> [out-dir] [옵션]   CIA 1개 생성
              {exe} <a.zip> <b.zip>... [옵션]     zip마다 CIA 1개씩 생성
              {exe} --launcher [out-dir]          neo3ds-launcher.cia 생성
              {exe} --art-sheet sheet.png         전 롬셋 아트 덤프 (점검용)
              {exe} --help | -h                  이 도움말 출력

            입력: MAME 네오지오 롬셋 zip(롬셋 이름 그대로). MAME 규격(롬셋 이름·칩 CRC)과 다른 롬셋은 변환되지 않습니다.
            출력: out-dir, 없으면 zip 폴더. zip 여러 개로 2개 이상 만들면 그 아래 neo3ds-batch-YYYYMMDD-HHMMSS 폴더에 모으고 마지막 줄에 DIR <폴더>를 출력합니다.

            옵션:
              --title "..."        타이틀 지정 (zip 1개만)
              --icon icon.png      아이콘 지정 (zip 1개만)
              --banner banner.png  배너 지정 (zip 1개만)
              --set romset         롬셋 강제 지정 (zip 1개만)
              --system aes|mvs     기종 모드
              --region eu|jp|us    리전 (기본값 eu)
              --pack               CIA 대신 런처용 .neo3ds 출력
              --lang ko|en         메시지 언어 (기억됨)
            """, $"""
            Usage:
              {exe} <game.zip> [out-dir] [options]   build one CIA
              {exe} <a.zip> <b.zip>... [options]     build one CIA each
              {exe} --launcher [out-dir]             build neo3ds-launcher.cia
              {exe} --art-sheet sheet.png            dump all romsets' art for checking
              {exe} --help | -h                      show this help

            Input: MAME Neo Geo romset zips (keep the romset names). A romset that does not match MAME's names and chip CRCs will not convert.
            Output: out-dir, else the zip's folder. When several zips build two or more files, they go into a neo3ds-batch-YYYYMMDD-HHMMSS folder there and the last line is DIR <folder>.

            Options:
              --title "..."        custom title (one zip only)
              --icon icon.png      custom icon (one zip only)
              --banner banner.png  custom banner (one zip only)
              --set romset         force romset (one zip only)
              --system aes|mvs     console mode
              --region eu|jp|us    region (default eu)
              --pack               output .neo3ds for launcher instead of CIA
              --lang ko|en         message language (remembered)
            """));
    }

    /// <summary>Every parent romset's generated icon (shown 2x) and banner, 32 games per picture
    /// (sheet.png -> sheet_0.png, sheet_1.png...).</summary>
    static void ArtSheet(string path)
    {
        var games = GameDb.Games.Where(g => g.Parent == null).ToList();
        const int cellW = 96 + 8 + Art.BannerW + 16, cellH = Art.BannerH + 8, cols = 4, perPage = 32;
        for (int page = 0; page * perPage < games.Count; page++)
        {
            var part = games.Skip(page * perPage).Take(perPage).ToList();
            using var sheet = new SKBitmap(cols * cellW, (part.Count + cols - 1) / cols * cellH);
            using var canvas = new SKCanvas(sheet);
            canvas.Clear(new SKColor(40, 40, 40));
            for (int i = 0; i < part.Count; i++)
            {
                int x = i % cols * cellW, y = i / cols * cellH;
                using var icon = SKBitmap.Decode(Art.Icon(part[i].Title, null));
                using var banner = SKBitmap.Decode(Art.Banner(part[i].Title, null));
                using var iconImage = SKImage.FromBitmap(icon);
                using var bannerImage = SKImage.FromBitmap(banner);
                var sampling = new SKSamplingOptions(SKFilterMode.Nearest, SKMipmapMode.None);
                canvas.DrawImage(iconImage, SKRect.Create(x + 4, y + 4, 96, 96), sampling, null);
                canvas.DrawImage(bannerImage, SKRect.Create(x + 108, y + 4, Art.BannerW, Art.BannerH), sampling, null);
            }
            canvas.Flush();
            using var encoded = sheet.Encode(SKEncodedImageFormat.Png, 100);
            using var output = File.Create(Path.ChangeExtension(path, null) + $"_{page}.png");
            encoded.SaveTo(output);
        }
        Console.WriteLine($"{games.Count} games -> {path}");
    }
}
