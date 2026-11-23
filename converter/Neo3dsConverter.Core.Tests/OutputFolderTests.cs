using Xunit;

namespace Neo3dsConverter.Tests;

/// <summary>
/// #404: a run with two or more results moves them into one neo3ds-batch-YYYYMMDD-HHMMSS folder;
/// one result stays where it was built, and a failed move loses nothing.
/// </summary>
public sealed class OutputFolderTests : IDisposable
{
    static readonly DateTime At = new(2026, 11, 20, 13, 5, 9);
    readonly string dir = Path.Combine(Path.GetTempPath(), "neo3ds-out-" + Guid.NewGuid().ToString("N"));

    public OutputFolderTests() => Directory.CreateDirectory(dir);

    public void Dispose()
    {
        try { Directory.Delete(dir, recursive: true); } catch (IOException) { }
    }

    string Built(string name)
    {
        string path = Path.Combine(dir, name);
        File.WriteAllText(path, name);
        return path;
    }

    [Fact]
    public void TheFolderNameCarriesTheSecond() =>
        Assert.Equal("neo3ds-batch-20261120-130509", OutputFolder.FolderName(At));

    [Fact]
    public void ASecondRunInTheSameSecondGetsASuffix()
    {
        string first = OutputFolder.Create(dir, At);
        string second = OutputFolder.Create(dir, At);
        string third = OutputFolder.Create(dir, At);

        Assert.Equal("neo3ds-batch-20261120-130509", Path.GetFileName(first));
        Assert.Equal("neo3ds-batch-20261120-130509-2", Path.GetFileName(second));
        Assert.Equal("neo3ds-batch-20261120-130509-3", Path.GetFileName(third));
    }

    [Fact]
    public void OneResultStaysWhereItWasBuilt()
    {
        string cia = Built("mslug.cia");

        var result = OutputFolder.Gather(dir, [cia], At);

        Assert.Null(result.Folder);
        Assert.Null(result.Warning);
        Assert.Equal([cia], result.Paths);
        Assert.True(File.Exists(cia));
        Assert.Empty(Directory.GetDirectories(dir));
    }

    [Fact]
    public void NoResultMakesNoFolder()
    {
        var result = OutputFolder.Gather(dir, [], At);

        Assert.Null(result.Folder);
        Assert.Empty(Directory.GetDirectories(dir));
    }

    [Fact]
    public void TwoResultsMoveIntoOneFlatFolder()
    {
        string a = Built("mslug.cia"), b = Built("mslug2.cia");

        var result = OutputFolder.Gather(dir, [a, b], At);

        Assert.Equal(Path.Combine(dir, "neo3ds-batch-20261120-130509"), result.Folder);
        Assert.Null(result.Warning);
        Assert.Equal([Path.Combine(result.Folder!, "mslug.cia"), Path.Combine(result.Folder!, "mslug2.cia")], result.Paths);
        Assert.All(result.Paths, p => Assert.True(File.Exists(p)));
        Assert.False(File.Exists(a));
        Assert.False(File.Exists(b));
        Assert.Empty(Directory.GetDirectories(result.Folder!));
    }

    [Fact]
    public void LauncherFilesGatherTheSameWay()
    {
        string a = Built("kof98.neo3ds"), b = Built("spinmast.neo3ds");

        var result = OutputFolder.Gather(dir, [a, b], At);

        Assert.NotNull(result.Folder);
        Assert.Equal(["kof98.neo3ds", "spinmast.neo3ds"], Directory.GetFiles(result.Folder!).Select(Path.GetFileName).Order());
    }

    [Fact]
    public void AFailedMovePutsEveryFileBackAndLeavesNoFolder()
    {
        string a = Built("mslug.cia");
        string gone = Path.Combine(dir, "mslug2.cia"); // never written, so its move fails

        var result = OutputFolder.Gather(dir, [a, gone], At);

        Assert.Null(result.Folder);
        Assert.NotNull(result.Warning);
        Assert.Contains(dir, result.Warning);
        Assert.Equal([a, gone], result.Paths);
        Assert.True(File.Exists(a));
        Assert.Empty(Directory.GetDirectories(dir));
    }

    [Fact]
    public void TheSameZipTwiceIsKeptOnce()
    {
        string zip = Path.Combine(dir, "mslug.zip");
        string other = Path.Combine(dir, "mslug2.zip");
        File.WriteAllText(zip, "");
        File.WriteAllText(other, "");
        string upper = Path.Combine(dir, "MSLUG.ZIP");
        string again = File.Exists(upper) ? upper : zip;

        Assert.Equal([zip, other], OutputFolder.Distinct([zip, other, again, Path.Combine(dir, ".", "mslug.zip")]));
    }

    [Fact]
    public void DifferentlyCasedNamesAreKeptWhenTheyAreDifferentFiles()
    {
        string lower = Path.Combine(dir, "game.zip");
        string upper = Path.Combine(dir, "GAME.zip");
        File.WriteAllText(lower, "lower");
        if (File.Exists(upper)) return; // This test directory is on a case-insensitive volume.
        File.WriteAllText(upper, "upper");

        Assert.Equal([lower, upper], OutputFolder.Distinct([lower, upper]));
    }

    [Fact]
    public void ZipsPickTheFolderOfTheFirstByName()
    {
        string first = Path.Combine(dir, "b", "aof.zip");
        string second = Path.Combine(dir, "a", "mslug.zip");

        Assert.Equal(Path.Combine(dir, "b"), OutputFolder.ForZips([second, first]));
    }

    [Fact]
    public void TheDefaultIsDownloadsThenDocuments()
    {
        Assert.Equal(Path.Combine(dir, "Documents"), OutputFolder.DefaultDir(dir));
        Directory.CreateDirectory(Path.Combine(dir, "Downloads"));
        Assert.Equal(Path.Combine(dir, "Downloads"), OutputFolder.DefaultDir(dir));
    }
}
