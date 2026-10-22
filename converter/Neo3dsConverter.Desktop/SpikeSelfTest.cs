using System.Diagnostics;

namespace Neo3dsConverter.Desktop;

/// <summary>P1a spike only: headless end-to-end (recognize + art + CIA) without a window.</summary>
static class SpikeSelfTest
{
    public static int Run(string[] args)
    {
        if (args.Length < 2)
        {
            Console.Error.WriteLine("usage: neo3ds-converter --spike-self-test <rom.zip> <out-dir>");
            return 2;
        }
        var total = Stopwatch.StartNew();
        try
        {
            string rom = args[0], outDir = args[1];
            Directory.CreateDirectory(outDir);
            var sw = Stopwatch.StartNew();
            var job = CiaJob.FromRomZip(rom);
            Console.WriteLine($"recognize: RomName={job.RomName} Title={job.Title} Problem={job.Problem ?? "-"} ({sw.ElapsedMilliseconds} ms)");
            if (job.Game == null)
            {
                Console.Error.WriteLine("SELFTEST_FAIL: unrecognized rom");
                return 1;
            }
            sw.Restart();
            byte[] icon = Art.Icon(job.Title, null);
            byte[] banner = Art.Banner(job.Title, null);
            File.WriteAllBytes(Path.Combine(outDir, "spike-icon.png"), icon);
            File.WriteAllBytes(Path.Combine(outDir, "spike-banner.png"), banner);
            Console.WriteLine($"art: icon={icon.Length}B banner={banner.Length}B ({sw.ElapsedMilliseconds} ms)");
            sw.Restart();
            job.OutputDir = outDir;
            string cia = new CiaBuilder(Console.WriteLine).Build(job);
            Console.WriteLine($"cia: {cia} ({new FileInfo(cia).Length} bytes, {sw.ElapsedMilliseconds} ms)");
            Console.WriteLine($"total: {total.ElapsedMilliseconds} ms");
            Console.WriteLine("SPIKE_SELFTEST_OK");
            return 0;
        }
        catch (Exception e)
        {
            Console.Error.WriteLine($"SELFTEST_FAIL: {e.GetType().Name}: {e.Message}");
            return 1;
        }
    }
}
