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

    /// <summary>Runs one command (arguments without --lang); returns the process exit code.</summary>
    public static int Run(string[] args)
    {
        try
        {
            if (args.Any(a => a == "--help" || a == "-h")) { PrintHelp(); return 0; }
            if (args[0] == "--art-sheet") { ArtSheet(args[1]); return 0; }
            if (args[0] == "--launcher")
            {
                var launcher = new CiaBuilder(Console.WriteLine).BuildLauncher(args.Length > 1 ? args[1] : ".");
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
                    case "--title": title = args[++i]; break;
                    case "--set": set = args[++i]; break;
                    case "--icon": icon = Path.GetFullPath(args[++i]); break;
                    case "--banner": banner = Path.GetFullPath(args[++i]); break;
                    case "--pack": pack = true; break;
                    case "--system": startMvs = args[++i].Equals("mvs", StringComparison.OrdinalIgnoreCase); break;
                    case "--region":
                        region = args[++i].ToLowerInvariant() switch
                        {
                            "jp" or "japan" => Region.Japan,
                            "us" or "usa" => Region.Usa,
                            "eu" or "europe" or "asia" => Region.Europe,
                            var r => throw new ArgumentException($"--region {r}: use eu, jp or us"),
                        };
                        break;
                    default: positional.Add(args[i]); break;
                }
            var zips = positional.Where(a => a.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)).ToList();
            var outDir = positional.Except(zips).LastOrDefault();
            if (zips.Count == 0) throw new ArgumentException("no game zip given");
            if (zips.Count > 1 && (title ?? icon ?? banner ?? set) != null)
                throw new ArgumentException("--title, --icon, --banner and --set need a single zip");
            int failed = 0;
            foreach (var zip in zips)
            {
                try
                {
                    var job = CiaJob.FromRomZip(zip, set);
                    if (outDir != null) job.OutputDir = Path.GetFullPath(outDir);
                    if (title != null) job.Title = title;
                    job.IconImage = icon;
                    job.BannerImage = banner;
                    job.StartMvs = startMvs;
                    job.Region = region;
                    var builder = new CiaBuilder(Console.WriteLine);
                    Console.WriteLine($"OK {(pack ? builder.BuildPack(job) : builder.Build(job))}");
                }
                catch (Exception e) when (zips.Count > 1)
                {
                    Console.Error.WriteLine($"FAILED {Path.GetFileName(zip)}: {e.Message}");
                    failed++;
                }
            }
            return failed == 0 ? 0 : 1;
        }
        catch (Exception e)
        {
            Console.Error.WriteLine($"FAILED {e.Message}");
            if (Environment.GetEnvironmentVariable("NEO3DS_DEBUG") != null) Console.Error.WriteLine(e);
            return 1;
        }
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
