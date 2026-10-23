using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Xunit;
namespace Neo3dsConverter.Desktop.Tests;

public class MainWindowTests
{
    [AvaloniaFact]
    public void Window_Creates_WithExpectedControls()
    {
        var window = new MainWindow();
        window.Show();

        Assert.NotNull(window.FindControl<Button>("OpenButton"));
        Assert.NotNull(window.FindControl<Button>("OutDirButton"));
        Assert.NotNull(window.FindControl<Button>("BuildButton"));
        Assert.NotNull(window.FindControl<Button>("PackButton"));
        Assert.NotNull(window.FindControl<Button>("LauncherButton"));
        Assert.NotNull(window.FindControl<TextBox>("TitleBox"));
        Assert.NotNull(window.FindControl<TextBox>("IconBox"));
        Assert.NotNull(window.FindControl<TextBox>("BannerBox"));
        Assert.NotNull(window.FindControl<Button>("IconPickButton"));
        Assert.NotNull(window.FindControl<Button>("IconClearButton"));
        Assert.NotNull(window.FindControl<Button>("BannerPickButton"));
        Assert.NotNull(window.FindControl<Button>("BannerClearButton"));
        Assert.NotNull(window.FindControl<TextBox>("OutDirBox"));
        Assert.NotNull(window.FindControl<TextBox>("LogBox"));
        Assert.NotNull(window.FindControl<TextBlock>("StatusText"));
        Assert.NotNull(window.FindControl<Image>("IconPreview"));
        Assert.NotNull(window.FindControl<Image>("BannerPreview"));

        Assert.False(window.FindControl<Button>("BuildButton")!.IsEnabled);
        Assert.False(window.FindControl<Button>("PackButton")!.IsEnabled);
        Assert.True(window.FindControl<Button>("LauncherButton")!.IsEnabled);
        Assert.NotNull(window.FindControl<TextBox>("OutDirBox")!.Text);

        window.Close();
    }

    [AvaloniaFact]
    public void Window_Starts_InSingleMode_WithArtFieldsEnabled()
    {
        var window = new MainWindow();
        window.Show();

        Assert.True(window.FindControl<TextBox>("TitleBox")!.IsEnabled);
        Assert.True(window.FindControl<Button>("IconPickButton")!.IsEnabled);
        Assert.True(window.FindControl<Button>("BannerPickButton")!.IsEnabled);

        window.Close();
    }
}
