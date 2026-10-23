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
        BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
        return 0;
    }

    public static AppBuilder BuildAvaloniaApp()
        => AppBuilder.Configure<App>().UsePlatformDetect().LogToTrace();
}
