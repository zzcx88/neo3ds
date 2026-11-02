using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;

[assembly: AvaloniaTestApplication(typeof(Neo3dsConverter.Desktop.Tests.TestAppBuilder))]

namespace Neo3dsConverter.Desktop.Tests;

/// <summary>
/// Headless app that registers the bundled Korean font exactly like the Linux app (#237). Without
/// it, every window test fails to lay out on Linux, where MainWindow selects "fonts:NotoSansKR".
/// </summary>
public static class TestAppBuilder
{
    public static AppBuilder BuildAvaloniaApp()
    {
        var builder = AppBuilder.Configure<Application>().UseHeadless(new AvaloniaHeadlessPlatformOptions());
        if (OperatingSystem.IsLinux())
            builder = builder.ConfigureFonts(m => m.AddFontCollection(new NotoFontCollection()));
        return builder;
    }
}
