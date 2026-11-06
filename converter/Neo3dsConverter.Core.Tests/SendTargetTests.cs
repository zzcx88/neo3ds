using Neo3dsConverter;
using Xunit;

namespace Neo3dsConverter.Tests;

/// <summary>
/// #255: what the send dialog may serve. The 3DS refuses a QR it cannot use, so the PC decides the
/// kind, the label and the refusal before a server starts.
/// </summary>
public sealed class SendTargetTests : IDisposable
{
    readonly string root = Path.Combine(Path.GetTempPath(), "neo3ds-send-target", Guid.NewGuid().ToString("N"));

    public SendTargetTests() => Directory.CreateDirectory(root);

    public void Dispose()
    {
        try { Directory.Delete(root, true); } catch { /* best effort */ }
    }

    string Make(string name)
    {
        string path = Path.Combine(root, name);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, [1, 2, 3]);
        return path;
    }

    [Fact]
    public void CiaIsAllowedAndGuidedToFbi()
    {
        string cia = Make("kof98.cia");

        var target = SendCandidate.Resolve(cia, []);

        Assert.NotNull(target);
        Assert.True(target.Allowed);
        Assert.Equal(SendKind.Cia, target.Kind);
        Assert.Equal(SendGuide.Fbi, target.Guide);
        Assert.Equal("kof98.cia", target.DisplayName);
        Assert.Equal(Path.GetFullPath(cia), target.FullPath);
    }

    [Fact]
    public void CiaExtensionIsCaseInsensitive()
    {
        var target = SendCandidate.Resolve(Make("GAME.CIA"), []);

        Assert.NotNull(target);
        Assert.True(target.Allowed);
        Assert.Equal(SendKind.Cia, target.Kind);
    }

    [Fact]
    public void LauncherCiaFromTheSessionIsLabelled()
    {
        string launcher = Make("neo3ds-launcher.cia");

        var target = SendCandidate.Resolve(launcher, [new SessionCia(launcher, Launcher: true)]);

        Assert.NotNull(target);
        Assert.True(target.SessionLauncher);
        Assert.Contains(Lang.L("런처", "Launcher"), target.DisplayName);
        Assert.Contains("neo3ds-launcher.cia", target.DisplayName);
    }

    [Fact]
    public void MissingFileIsRefusedWithAReason()
    {
        var target = SendCandidate.Resolve(Path.Combine(root, "gone.cia"), []);

        Assert.NotNull(target);
        Assert.False(target.Allowed);
        Assert.Equal(SendRefusal.MissingFile, target.Refusal);
        Assert.NotEmpty(target.Reason);
    }

    [Fact]
    public void FolderIsRefusedWithAReason()
    {
        string folder = Path.Combine(root, "games");
        Directory.CreateDirectory(folder);

        var target = SendCandidate.Resolve(folder, []);

        Assert.NotNull(target);
        Assert.False(target.Allowed);
        Assert.Equal(SendRefusal.NotAFile, target.Refusal);
        Assert.NotEmpty(target.Reason);
    }

    [Fact]
    public void OtherExtensionsAreRefusedWithAReason()
    {
        var target = SendCandidate.Resolve(Make("kof98.zip"), []);

        Assert.NotNull(target);
        Assert.False(target.Allowed);
        Assert.Equal(SendRefusal.UnsupportedExtension, target.Refusal);
        Assert.NotEmpty(target.Reason);
    }

    [Fact]
    public void NoSelectionHasNoTarget()
    {
        Assert.Null(SendCandidate.Resolve(null, []));
        Assert.Null(SendCandidate.Resolve("", []));
        Assert.Null(SendCandidate.Resolve("   ", []));
    }

    [Fact]
    public void StatusSeparatesWhatThePcDidFromWhatThe3dsDid()
    {
        Assert.StartsWith(Lang.L("3DS 대기", "Waiting for the 3DS"), SendText.Status(SendState.Waiting, SendGuide.Fbi));
        Assert.StartsWith(Lang.L("보내는 중", "Sending"), SendText.Status(SendState.Sending, SendGuide.Fbi));
        Assert.StartsWith(Lang.L("PC 전송 완료", "Sent by the PC"), SendText.Status(SendState.Sent, SendGuide.Fbi));
    }
}
