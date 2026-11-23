using Xunit;

namespace Neo3dsConverter.Tests;

public sealed class BatchCommandLineTests : IDisposable
{
    readonly string dir = Path.Combine(Path.GetTempPath(), "neo3ds-cli-batch-" + Guid.NewGuid().ToString("N"));

    public BatchCommandLineTests() => Directory.CreateDirectory(dir);

    public void Dispose() => Directory.Delete(dir, recursive: true);

    [Theory]
    [InlineData(false, ".cia")]
    [InlineData(true, ".neo3ds")]
    public void SameNamedInputsProduceTwoDistinctResults(bool pack, string extension)
    {
        string output = Path.Combine(dir, "out");
        Directory.CreateDirectory(output);
        string[] args = [Path.Combine(dir, "one", "mslug.zip"), Path.Combine(dir, "two", "mslug.zip"), output, .. pack ? new[] { "--pack" } : Array.Empty<string>()];

        using var stdout = new StringWriter();
        TextWriter previous = Console.Out;
        int exit;
        try
        {
            Console.SetOut(stdout);
            exit = CommandLine.Run(args, (job, isPack) =>
            {
                Assert.Equal(pack, isPack);
                string result = Path.Combine(job.OutputDir, (job.OutputName ?? job.RomName) + extension);
                File.WriteAllText(result, job.RomZip);
                return result;
            });
        }
        finally { Console.SetOut(previous); }

        Assert.Equal(0, exit);
        string folder = Assert.Single(Directory.GetDirectories(output));
        Assert.Equal(args[0], File.ReadAllText(Path.Combine(folder, "mslug" + extension)));
        Assert.Equal(args[1], File.ReadAllText(Path.Combine(folder, "mslug-2" + extension)));
        Assert.Contains($"OK {Path.Combine(folder, "mslug" + extension)}", stdout.ToString());
        Assert.Contains($"OK {Path.Combine(folder, "mslug-2" + extension)}", stdout.ToString());
        Assert.Contains($"DIR {folder}", stdout.ToString());
    }

    [Fact]
    public void FailedFirstInputDoesNotReserveTheFilename()
    {
        string output = Path.Combine(dir, "out");
        Directory.CreateDirectory(output);
        string first = Path.Combine(dir, "one", "mslug.zip");
        string second = Path.Combine(dir, "two", "mslug.zip");

        int exit = CommandLine.Run([first, second, output, "--pack"], (job, _) =>
        {
            if (job.RomZip == first) throw new IOException("test failure");
            string result = Path.Combine(job.OutputDir, job.OutputName + ".neo3ds");
            File.WriteAllText(result, job.RomZip);
            return result;
        });

        Assert.Equal(1, exit);
        Assert.Equal(second, File.ReadAllText(Path.Combine(output, "mslug.neo3ds")));
    }
}
