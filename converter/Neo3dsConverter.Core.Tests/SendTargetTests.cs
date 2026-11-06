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
        Assert.StartsWith(Lang.L("3DS 대기", "Waiting for the 3DS"), SendText.Status(SendState.Waiting, SendGuide.Launcher));
        Assert.StartsWith(Lang.L("PC 전송 완료", "Sent by the PC"), SendText.Status(SendState.Sent, SendGuide.Launcher));
    }

    /// <summary>#257: a launcher file is served and the launcher's Y screen is the guide.</summary>
    [Fact]
    public void LauncherFileIsAllowedAndGuidedToTheLauncher()
    {
        string pack = Make("kof98.neo3ds");

        var target = SendCandidate.Resolve(pack, []);

        Assert.NotNull(target);
        Assert.True(target.Allowed);
        Assert.Equal(SendKind.Launcher, target.Kind);
        Assert.Equal(SendGuide.Launcher, target.Guide);
        Assert.Equal("kof98.neo3ds", target.DisplayName);
    }

    /// <summary>#257: a path with folders is judged on the file name only.</summary>
    [Fact]
    public void FileNameComesFromTheLastPathSegment()
    {
        string nested = Make(Path.Combine("games", "kof98.neo3ds"));

        var target = SendCandidate.Resolve(nested, []);

        Assert.NotNull(target);
        Assert.True(target.Allowed);
        Assert.Equal("kof98.neo3ds", target.FileName);
        Assert.Equal("kof98.neo3ds", target.DisplayName);
    }

    [Fact]
    public void LauncherExtensionIsCaseInsensitive()
    {
        var target = SendCandidate.Resolve(Make("KOF98.NEO3DS"), []);

        Assert.NotNull(target);
        Assert.True(target.Allowed);
        Assert.Equal(SendKind.Launcher, target.Kind);
    }

    /// <summary>#257: the launcher's own limit is 103 bytes of decoded file name.</summary>
    [Fact]
    public void LauncherNameAtTheLimitIsAllowed()
    {
        string name = new string('a', 103 - ".neo3ds".Length) + ".neo3ds";
        Assert.Equal(103, System.Text.Encoding.UTF8.GetByteCount(name));

        var target = SendCandidate.Resolve(Make(name), []);

        Assert.NotNull(target);
        Assert.True(target.Allowed);
    }

    [Fact]
    public void LauncherNameOverTheLimitIsRefused()
    {
        string name = new string('a', 104 - ".neo3ds".Length) + ".neo3ds";
        Assert.Equal(104, System.Text.Encoding.UTF8.GetByteCount(name));

        var target = SendCandidate.Resolve(Make(name), []);

        Assert.NotNull(target);
        Assert.False(target.Allowed);
        Assert.Equal(SendRefusal.NameTooLong, target.Refusal);
        Assert.Equal(SendGuide.Launcher, target.Guide);
    }

    /// <summary>#257: characters the launcher's SD naming rule rejects, checked before a server starts.</summary>
    [Theory]
    [InlineData("bad*name.neo3ds")]
    [InlineData("bad?name.neo3ds")]
    [InlineData("bad|name.neo3ds")]
    [InlineData("bad\tname.neo3ds")]
    [InlineData("game .neo3ds")]
    [InlineData("game..neo3ds")]
    public void LauncherNameRulesMatchThe3ds(string name)
        => Assert.Equal(SendRefusal.NameUnsafe, SendCandidate.LauncherNameProblem(name));

    /// <summary>#301: a pack with no base name is refused for that reason, not for bad characters.</summary>
    [Fact]
    public void LauncherFileWithoutABaseNameSaysTheNameIsMissing()
    {
        var target = SendCandidate.Resolve(Make(".neo3ds"), []);

        Assert.NotNull(target);
        Assert.False(target.Allowed);
        Assert.Equal(SendRefusal.NoBaseName, target.Refusal);
        Assert.Contains(Lang.L("이름이 없습니다", "no name"), target.Reason);
        Assert.Equal(SendRefusal.NoBaseName, SendCandidate.LauncherNameProblem(".neo3ds"));
    }

    [Fact]
    public void LauncherNameAcceptsTheBoundaryAndRefusesOneByteMore()
    {
        Assert.Equal(SendRefusal.None, SendCandidate.LauncherNameProblem("kof98.neo3ds"));
        Assert.Equal(SendRefusal.None, SendCandidate.LauncherNameProblem(new string('a', 96) + ".neo3ds"));
        Assert.Equal(SendRefusal.NameTooLong, SendCandidate.LauncherNameProblem(new string('a', 97) + ".neo3ds"));
    }

    [Fact]
    public void LauncherNameCountsUtf8Bytes()
    {
        Assert.Equal(SendRefusal.None, SendCandidate.LauncherNameProblem("게임.neo3ds"));
        Assert.Equal(SendRefusal.NameTooLong, SendCandidate.LauncherNameProblem(new string('가', 33) + ".neo3ds"));
    }

    /// <summary>#257: the raw URL path must fit the launcher's 256-byte buffer, not just the decoded name.</summary>
    [Fact]
    public void LauncherNameThatOverflowsTheUrlPathIsRefused()
    {
        string fits = new string('가', 25) + ".neo3ds";
        string overflows = new string('가', 26) + ".neo3ds";
        Assert.True(System.Text.Encoding.UTF8.GetByteCount(overflows) <= 103);

        Assert.Equal(SendRefusal.None, SendCandidate.LauncherNameProblem(fits));
        Assert.Equal(SendRefusal.UrlTooLong, SendCandidate.LauncherNameProblem(overflows));
    }
}
