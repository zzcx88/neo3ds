namespace Neo3dsConverter;

/// <summary>#400: where built files go. One game goes straight into the output folder; two or
/// more in one run go into a timestamped folder so a 150-game batch does not bury the roms.</summary>
public static class OutputFolder
{
    /// <summary>The folder the window starts on, and where the launcher CIA goes: the user's
    /// Downloads when it exists, otherwise Documents.</summary>
    public static string Default()
    {
        string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        string downloads = Path.Combine(home, "Downloads");
        return Directory.Exists(downloads) ? downloads : Path.Combine(home, "Documents");
    }

    /// <summary>The name of the folder a batch writes into: neo3ds-20261120-095501.</summary>
    public static string BatchName(DateTime when) => "neo3ds-" + when.ToString("yyyyMMdd-HHmmss");

    /// <summary>Creates the batch folder under <paramref name="baseDir"/> and returns it. Called
    /// only when two or more games will be built, so a run that fails early leaves no folder.</summary>
    public static string CreateBatch(string baseDir, DateTime? when = null)
    {
        string dir = Path.Combine(Path.GetFullPath(baseDir), BatchName(when ?? DateTime.Now));
        Directory.CreateDirectory(dir);
        return dir;
    }
}
