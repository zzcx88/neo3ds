using Xunit;

namespace Neo3dsConverter.Tests;

public sealed class LauncherCommandLineTests : IDisposable
{
    readonly string home = Path.Combine(Path.GetTempPath(), "neo3ds-home-" + Guid.NewGuid().ToString("N"));

    public LauncherCommandLineTests() => Directory.CreateDirectory(home);
    public void Dispose() => Directory.Delete(home, recursive: true);

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void LauncherWithoutDirectoryUsesDefault(bool downloadsExist)
    {
        if (downloadsExist) Directory.CreateDirectory(Path.Combine(home, "Downloads"));
        string? chosen = null;

        int result = CommandLine.Run(["--launcher"], directory => { chosen = directory; return "launcher.cia"; }, () => OutputFolder.DefaultDir(home));

        Assert.Equal(0, result);
        Assert.Equal(Path.Combine(home, downloadsExist ? "Downloads" : "Documents"), chosen);
    }

    [Fact]
    public void LauncherKeepsExplicitDirectory()
    {
        string explicitPath = Path.Combine(home, "custom");
        string? chosen = null;

        int result = CommandLine.Run(["--launcher", explicitPath], directory => { chosen = directory; return "launcher.cia"; }, () => throw new InvalidOperationException());

        Assert.Equal(0, result);
        Assert.Equal(explicitPath, chosen);
    }
}
