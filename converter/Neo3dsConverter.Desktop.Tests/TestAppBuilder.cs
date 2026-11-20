using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Themes.Fluent;

[assembly: AvaloniaTestApplication(typeof(Neo3dsConverter.Desktop.Tests.TestAppBuilder))]

namespace Neo3dsConverter.Desktop.Tests;

/// <summary>
/// Headless app that registers the bundled Korean font exactly like the Linux app (#237). Without
/// it, every window test fails to lay out on Linux, where MainWindow selects "fonts:NotoSansKR".
/// The Fluent theme is the app's own theme (App.axaml); without it controls have no template, so a
/// TextBox has no scroll viewer to inspect (#402).
/// </summary>
public static class TestAppBuilder
{
    public static AppBuilder BuildAvaloniaApp()
    {
        var builder = AppBuilder.Configure<Application>().UseHeadless(new AvaloniaHeadlessPlatformOptions());
        if (OperatingSystem.IsLinux())
            builder = builder.ConfigureFonts(m => m.AddFontCollection(new NotoFontCollection()));
        return builder.AfterSetup(_ => Application.Current?.Styles.Add(new FluentTheme()));
    }
}
