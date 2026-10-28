namespace Neo3dsConverter;

/// <summary>
/// The path to execute for a bundled tool (makerom, bannertool).
///
/// The macOS .app ships its tools executable, but a tool can still arrive without the execute bit
/// (the Linux zip writes tools/&lt;rid&gt;/ at 0644, see #179) or in a folder that cannot be written:
/// <list type="bullet">
/// <item>macOS Gatekeeper App Translocation: a quarantined .app launched from where it was unzipped
/// runs from a read-only copy under /private/var/folders/…/AppTranslocation, so even a no-op chmod
/// fails with EROFS and the conversion stopped at "Read-only file system : '…/bannertool'".</item>
/// <item>Linux: a zip extracted with sudo (files owned by another user, chmod → EPERM) or extracted
/// onto read-only media (a ro mount, a container image).</item>
/// </list>
/// Only tools that are not executable yet are chmodded, and when that fails the tool is copied to a
/// writable folder and the copy is run instead.
/// </summary>
public static class ToolExec
{
    /// <summary>Path to execute for <paramref name="path"/>, staging any copy under
    /// <paramref name="stagingDir"/> (it is created only when a copy is needed).</summary>
    public static string Prepare(string path, string stagingDir) =>
        Prepare(path, stagingDir, p => File.SetUnixFileMode(p, File.GetUnixFileMode(p) | UnixFileMode.UserExecute));

    /// <summary>As above, with the mode change passed in.</summary>
    internal static string Prepare(string path, string stagingDir, Action<string> chmod)
    {
        if (OperatingSystem.IsWindows()) return path; // no execute bit to fix
        if ((File.GetUnixFileMode(path) & UnixFileMode.UserExecute) != 0) return path;

        try
        {
            chmod(path);
            return path;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            // Read-only media or a file we do not own: run a copy from the writable staging folder.
        }

        Directory.CreateDirectory(stagingDir);
        string copy = Path.Combine(stagingDir, Path.GetFileName(path));
        File.Copy(path, copy, true);
        chmod(copy);
        return copy;
    }
}
