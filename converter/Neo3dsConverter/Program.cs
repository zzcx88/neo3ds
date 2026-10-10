using System.Drawing;
using System.Drawing.Imaging;

namespace Neo3dsConverter;

static class Program
{
    [STAThread]
    static int Main(string[] args)
    {
        // Command-line mode for scripted builds:
        //   Neo3dsConverter.exe <game.zip> [out-dir] [--title "..."] [--icon icon.png] [--banner banner.png] [--set romset] [--lang ko|en]
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
                var positional = new List<string>();
                string? title = null, icon = null, banner = null, set = null;
                for (int i = 0; i < args.Length; i++)
                    switch (args[i])
                    {
                        case "--title": title = args[++i]; break;
                        case "--set": set = args[++i]; break;
                        case "--icon": icon = Path.GetFullPath(args[++i]); break;
                        case "--banner": banner = Path.GetFullPath(args[++i]); break;
                        default: positional.Add(args[i]); break;
                    }
                var job = CiaJob.FromRomZip(positional[0], set);
                if (positional.Count > 1) job.OutputDir = Path.GetFullPath(positional[1]);
                if (title != null) job.Title = title;
                job.IconImage = icon;
                job.BannerImage = banner;
                var cia = new CiaBuilder(Console.WriteLine).Build(job);
                Console.WriteLine($"OK {cia}");
                return 0;
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
