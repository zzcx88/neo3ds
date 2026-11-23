using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;

namespace Neo3dsConverter;

/// <summary>
/// #404: where the converter writes, shared by both windows and the CLI. A run builds into the
/// output folder as before; when it produced two or more files they are then moved into one
/// <c>neo3ds-batch-YYYYMMDD-HHMMSS</c> folder so a ROM folder does not fill with results.
/// </summary>
public static class OutputFolder
{
    public const string Prefix = "neo3ds-batch-";

    /// <summary>The folder before a zip is picked, and for the launcher CIA: ~/Downloads, else ~/Documents.</summary>
    public static string DefaultDir(string? home = null)
    {
        home ??= Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        string downloads = Path.Combine(home, "Downloads");
        return Directory.Exists(downloads) ? downloads : Path.Combine(home, "Documents");
    }

    /// <summary>The folder the output box takes when zips are picked: the folder of the first zip by name.</summary>
    public static string ForZips(IEnumerable<string> zips) =>
        Path.GetDirectoryName(Path.GetFullPath(
            zips.OrderBy(Path.GetFileName, StringComparer.OrdinalIgnoreCase).First()))!;

    /// <summary>Each zip once, in the order given: the same path picked twice converts once.</summary>
    public static string[] Distinct(IEnumerable<string> zips)
    {
        var seen = new HashSet<string>(OperatingSystem.IsWindows() ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal);
        return zips.Select(Path.GetFullPath).Where(path => seen.Add(OperatingSystem.IsMacOS() ? RealPath(path) : path)).ToArray();
    }

    // macOS volumes may independently be case-sensitive or case-insensitive. realpath uses
    // the actual filesystem spelling, unlike a comparison based on the operating system.
    static string RealPath(string path)
    {
        IntPtr resolved = realpath(path, IntPtr.Zero);
        if (resolved == IntPtr.Zero) return path; // Never discard a potentially distinct input on failure.
        try { return Marshal.PtrToStringUTF8(resolved) ?? path; }
        finally { free(resolved); }
    }

    [DllImport("/usr/lib/libSystem.B.dylib", SetLastError = true)]
    static extern IntPtr realpath([MarshalAs(UnmanagedType.LPUTF8Str)] string path, IntPtr resolved);

    [DllImport("/usr/lib/libSystem.B.dylib")]
    static extern void free(IntPtr pointer);

    /// <summary>The batch folder name for a run started at <paramref name="time"/>.</summary>
    public static string FolderName(DateTime time) =>
        Prefix + time.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture);

    /// <summary>A new batch folder under <paramref name="outDir"/>; a second run in the same second gets -2, -3, ...</summary>
    public static string Create(string outDir, DateTime time)
    {
        string name = FolderName(time);
        for (int n = 1; ; n++)
        {
            string path = Path.Combine(outDir, n == 1 ? name : $"{name}-{n}");
            if (Directory.Exists(path) || File.Exists(path)) continue;
            Directory.CreateDirectory(path);
            return path;
        }
    }

    /// <summary>The outcome of <see cref="Gather"/>.</summary>
    /// <param name="Folder">The batch folder, or null when the files stayed where they were built.</param>
    /// <param name="Paths">Where each file is now, in the order given.</param>
    /// <param name="Warning">The message to show when the folder could not be made or filled.</param>
    public sealed record Result(string? Folder, IReadOnlyList<string> Paths, string? Warning);

    /// <summary>
    /// Moves the files a run built into a new batch folder under <paramref name="outDir"/> when
    /// there are two or more of them. One file, or none, stays where it is and no folder is made.
    /// If a move fails, attempts to restore the files. Any failed restoration is reported along
    /// with the last known location of every result.
    /// </summary>
    public static Result Gather(string outDir, IReadOnlyList<string> built, DateTime time) =>
        Gather(outDir, built, time, File.Move);

    internal static Result Gather(string outDir, IReadOnlyList<string> built, DateTime time, Action<string, string> move)
    {
        var files = built.Select(Path.GetFullPath).ToList();
        if (files.Count < 2) return new Result(null, files, null);

        string folder;
        try
        {
            folder = Create(outDir, time);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return new Result(null, files, MoveWarning(files, false));
        }

        var now = new List<string>(files);
        try
        {
            for (int i = 0; i < files.Count; i++)
            {
                string dest = Path.Combine(folder, Path.GetFileName(files[i]));
                move(files[i], dest);
                now[i] = dest;
            }
            return new Result(folder, now, null);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            bool restoreFailed = false;
            for (int i = 0; i < files.Count; i++)
            {
                if (now[i] == files[i]) continue;
                try { move(now[i], files[i]); now[i] = files[i]; }
                catch (Exception back) when (back is IOException or UnauthorizedAccessException) { restoreFailed = true; }
            }
            bool emptied = false;
            try
            {
                if (!Directory.EnumerateFileSystemEntries(folder).Any()) { Directory.Delete(folder); emptied = true; }
            }
            catch (Exception gone) when (gone is IOException or UnauthorizedAccessException) { }
            return new Result(emptied ? null : folder, now, MoveWarning(now, restoreFailed));
        }
    }

    static string MoveWarning(IReadOnlyList<string> paths, bool restoreFailed) =>
        (restoreFailed
            ? Lang.L("결과를 묶음 폴더로 옮기지 못했고 일부 파일의 복구에도 실패했어요. 현재 결과 위치:", "The batch move failed and some files could not be restored. Current result locations:")
            : Lang.L("결과를 묶음 폴더로 옮기지 못했어요. 현재 결과 위치:", "The batch move failed. Current result locations:"))
        + "\n" + string.Join("\n", paths);

    /// <summary>Shows the folder in Explorer, Finder or the Linux file manager. A failure is quiet:
    /// the path is already in the log and the done window.</summary>
    public static void Open(string folder)
    {
        try
        {
            var start = OperatingSystem.IsWindows() ? new ProcessStartInfo("explorer.exe")
                : OperatingSystem.IsMacOS() ? new ProcessStartInfo("open")
                : new ProcessStartInfo("xdg-open");
            start.ArgumentList.Add(folder);
            start.UseShellExecute = false;
            Process.Start(start)?.Dispose();
        }
        catch (Exception e) when (e is System.ComponentModel.Win32Exception or InvalidOperationException or IOException) { }
    }
}
