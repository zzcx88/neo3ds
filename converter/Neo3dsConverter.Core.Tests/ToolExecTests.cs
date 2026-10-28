using Xunit;

namespace Neo3dsConverter.Tests;

/// <summary>
/// Tool execution on media that cannot be written: a macOS .app running from Gatekeeper's
/// App Translocation (read-only copy of the bundle) and a Linux extract owned by another user.
/// Nothing here touches a real read-only volume; the failure is injected through the chmod
/// operation, which is what those file systems reject.
/// </summary>
public sealed class ToolExecTests : IDisposable
{
    readonly string root = Path.Combine(Path.GetTempPath(), "neo3ds-tool-tests", Guid.NewGuid().ToString("N"));
    readonly string staging;

    public ToolExecTests()
    {
        Directory.CreateDirectory(root);
        staging = Path.Combine(root, "staging");
    }

    public void Dispose()
    {
        try { Directory.Delete(root, true); } catch { /* best effort */ }
    }

    /// <summary>A tool file with the given execute bit and known contents.</summary>
    string Tool(bool executable)
    {
        string path = Path.Combine(root, "tools", "bannertool");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, new byte[] { 0x7F, (byte)'E', (byte)'L', (byte)'F', 42 });
        File.SetUnixFileMode(path, executable
            ? UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
            : UnixFileMode.UserRead | UnixFileMode.UserWrite);
        return path;
    }

    static bool IsExecutable(string path) =>
        (File.GetUnixFileMode(path) & UnixFileMode.UserExecute) != 0;

    [Fact]
    public void Prepare_RunsTheToolItself_WhenItIsAlreadyExecutable()
    {
        Assert.SkipWhen(OperatingSystem.IsWindows(), "Unix execute bits only");
        string tool = Tool(executable: true);

        // On a read-only volume even a no-op chmod fails, so it must not be attempted at all.
        string path = ToolExec.Prepare(tool, staging,
            _ => throw new UnauthorizedAccessException("Read-only file system"));

        Assert.Equal(tool, path);
        Assert.False(Directory.Exists(staging));
    }

    [Fact]
    public void Prepare_AddsTheExecuteBitInPlace_WhenTheToolFolderIsWritable()
    {
        Assert.SkipWhen(OperatingSystem.IsWindows(), "Unix execute bits only");
        string tool = Tool(executable: false);

        string path = ToolExec.Prepare(tool, staging);

        Assert.Equal(tool, path);
        Assert.True(IsExecutable(tool));
        Assert.False(Directory.Exists(staging));
    }

    [Fact]
    public void Prepare_RunsAStagedCopy_WhenTheToolCannotBeMadeExecutable()
    {
        Assert.SkipWhen(OperatingSystem.IsWindows(), "Unix execute bits only");
        string tool = Tool(executable: false);
        byte[] expected = File.ReadAllBytes(tool);

        // Read-only media: the tool's own volume rejects chmod, the staging folder does not.
        string path = ToolExec.Prepare(tool, staging, p =>
        {
            if (p == tool) throw new IOException($"Read-only file system : '{p}'");
            File.SetUnixFileMode(p, File.GetUnixFileMode(p) | UnixFileMode.UserExecute);
        });

        Assert.NotEqual(tool, path);
        Assert.Equal(staging, Path.GetDirectoryName(path));
        Assert.True(IsExecutable(path));
        Assert.Equal(expected, File.ReadAllBytes(path));
        Assert.False(IsExecutable(tool)); // the original is left untouched
    }

    [Fact]
    public void Prepare_LeavesTheToolAlone_OnWindows()
    {
        Assert.SkipUnless(OperatingSystem.IsWindows(), "Windows has no execute bit");
        string tool = Path.Combine(root, "bannertool.exe");
        File.WriteAllBytes(tool, new byte[] { 1, 2, 3 });

        string path = ToolExec.Prepare(tool, staging, _ => throw new IOException("must not be called"));

        Assert.Equal(tool, path);
    }
}
