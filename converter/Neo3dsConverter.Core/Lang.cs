using System.Globalization;

namespace Neo3dsConverter;

/// <summary>
/// Korean or English text. Korean when Windows is set to Korean, English otherwise; the choice
/// made in the window (or --lang ko|en) is remembered in %APPDATA%\neo3ds\lang.txt.
/// </summary>
public static class Lang
{
    static readonly string SettingFile =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "neo3ds", "lang.txt");

    public static bool Korean { get; private set; } = Load();

    /// <summary>The text for the current language.</summary>
    public static string L(string ko, string en) => Korean ? ko : en;

    public static void Set(bool korean, bool remember)
    {
        Korean = korean;
        if (!remember) return;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(SettingFile)!);
            File.WriteAllText(SettingFile, korean ? "ko" : "en");
        }
        catch { /* the choice just isn't remembered */ }
    }

    static bool Load()
    {
        try
        {
            if (File.Exists(SettingFile)) return File.ReadAllText(SettingFile).Trim() == "ko";
        }
        catch { /* fall back to the Windows language */ }
        return CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "ko";
    }
}
