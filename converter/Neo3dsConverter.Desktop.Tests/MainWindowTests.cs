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
        Assert.NotNull(window.FindControl<Button>("LangButton"));
        Assert.NotNull(window.FindControl<ComboBox>("SystemBox"));
        Assert.NotNull(window.FindControl<ComboBox>("RegionBox"));
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
        Assert.Equal(0, window.FindControl<ComboBox>("SystemBox")!.SelectedIndex);
        Assert.Equal(0, window.FindControl<ComboBox>("RegionBox")!.SelectedIndex);

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

    [AvaloniaFact]
    public void LangButton_ShowsOppositeLanguage()
    {
        var window = new MainWindow();
        window.Show();

        string expected = Lang.Korean ? "English" : "한국어";
        Assert.Equal(expected, window.FindControl<Button>("LangButton")!.Content);

        window.Close();
    }
}
