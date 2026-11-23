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

        int exit = CommandLine.Run(args, (job, isPack) =>
        {
            Assert.Equal(pack, isPack);
            string result = Path.Combine(job.OutputDir, (job.OutputName ?? job.RomName) + extension);
            File.WriteAllText(result, job.RomZip);
            return result;
        });

        Assert.Equal(0, exit);
        string folder = Assert.Single(Directory.GetDirectories(output));
        Assert.Equal(args[0], File.ReadAllText(Path.Combine(folder, "mslug" + extension)));
        Assert.Equal(args[1], File.ReadAllText(Path.Combine(folder, "mslug-2" + extension)));
    }
}
