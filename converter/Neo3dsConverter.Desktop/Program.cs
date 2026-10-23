using Avalonia;

namespace Neo3dsConverter.Desktop;

/// <summary>Single dispatcher: args -&gt; CLI, no args -&gt; GUI (same pattern as the Windows GUI exe).</summary>
sealed class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        args = CommandLine.TakeLang(args);
        if (args.Length > 0) return CommandLine.Run(args);
        // Avalonia initialises once per process, so the window cannot be re-created for a
        // language switch (#112): MainWindow applies it in place instead.
        BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
        return 0;
    }

    public static AppBuilder BuildAvaloniaApp()
    {
        var builder = AppBuilder.Configure<App>().UsePlatformDetect();
        if (OperatingSystem.IsLinux())
            builder = builder.ConfigureFonts(m => m.AddFontCollection(new NotoFontCollection()));
        return builder.LogToTrace();
    }
}
