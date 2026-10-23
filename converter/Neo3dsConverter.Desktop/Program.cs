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
        while (true)
        {
            var lifetime = new Avalonia.Controls.ApplicationLifetimes.ClassicDesktopStyleApplicationLifetime { Args = args };
            BuildAvaloniaApp().SetupWithLifetime(lifetime);
            lifetime.Start(args);
            if (App.RestartRequested) { App.RestartRequested = false; continue; }
            return 0;
        }
    }

    public static AppBuilder BuildAvaloniaApp()
    {
        var builder = AppBuilder.Configure<App>().UsePlatformDetect();
        if (OperatingSystem.IsLinux())
            builder = builder.ConfigureFonts(m => m.AddFontCollection(new NotoFontCollection()));
        return builder.LogToTrace();
    }
}
