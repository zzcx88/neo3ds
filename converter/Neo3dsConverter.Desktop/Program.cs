using System.Diagnostics;
using Avalonia;

namespace Neo3dsConverter.Desktop;

/// <summary>P1a spike dispatcher: args -&gt; CLI, no args -&gt; GUI (same pattern as the Windows GUI exe).</summary>
sealed class Program
{
    internal static long StartTicks;

    [STAThread]
    public static int Main(string[] args)
    {
        StartTicks = Stopwatch.GetTimestamp();
        args = CommandLine.TakeLang(args);
        if (args.Length > 0 && args[0] == "--spike-self-test") return SpikeSelfTest.Run(args[1..]);
        if (args.Length > 0) return CommandLine.Run(args);
        BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
        return 0;
    }

    public static AppBuilder BuildAvaloniaApp()
        => AppBuilder.Configure<App>().UsePlatformDetect().LogToTrace();
}
