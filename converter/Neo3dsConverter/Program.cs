using System.Drawing;
using System.Drawing.Imaging;

namespace Neo3dsConverter;

static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        // Command-line mode for scripted builds:
        //   Neo3dsConverter.exe <game.zip> [out-dir] [--title "..."] [--icon icon.png] [--banner banner.png] [--set romset] [--system aes|mvs] [--region eu|jp|us] [--lang ko|en]
        //   Neo3dsConverter.exe <a.zip> <b.zip> ... [out-dir] [--system aes|mvs] [--region eu|jp|us]
        //   --pack: a .neo3ds game file for the launcher instead of a CIA (same options)
        //   Neo3dsConverter.exe --launcher [out-dir]   (the launcher CIA, neo3ds-launcher.cia)   (one CIA each; --title/--icon/--banner/--set need one zip)
        //   Neo3dsConverter.exe --art-sheet sheet.png   (generated art of every MAME romset, for checking)
        // --lang ko|en anywhere picks the language (remembered; without other arguments it opens the window).
        int li = Array.IndexOf(args, "--lang");
        if (li >= 0 && li + 1 < args.Length)
        {
            Lang.Set(args[li + 1] == "ko", remember: true);
            args = args.Where((_, i) => i != li && i != li + 1).ToArray();
        }
        if (args.Length > 0)
        {
            AttachConsole(-1); // WinExe has no console of its own; reuse the caller's
            try
            {
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

        ApplicationConfiguration.Initialize();
        while (true)
        {
            var form = new MainForm();
            Application.Run(form);
            if (!form.Restart) return 0;
        }
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
            using var sheet = new Bitmap(cols * cellW, (part.Count + cols - 1) / cols * cellH);
            using var g = Graphics.FromImage(sheet);
            g.Clear(Color.FromArgb(40, 40, 40));
            g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.NearestNeighbor;
            g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.Half;
            for (int i = 0; i < part.Count; i++)
            {
                int x = i % cols * cellW, y = i / cols * cellH;
                using var icon = Art.Icon(part[i].Title, null);
                using var banner = Art.Banner(part[i].Title, null);
                g.DrawImage(icon, x + 4, y + 4, 96, 96);
                g.DrawImage(banner, x + 108, y + 4);
            }
            sheet.Save(Path.ChangeExtension(path, null) + $"_{page}.png", ImageFormat.Png);
        }
        Console.WriteLine($"{games.Count} games -> {path}");
    }

    [System.Runtime.InteropServices.DllImport("kernel32.dll")]
    static extern bool AttachConsole(int processId);
}
