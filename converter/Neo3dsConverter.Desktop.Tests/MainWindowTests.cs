using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Interactivity;
using Avalonia.Threading;
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

    /// <summary>#109: the launcher button must not read controls off the UI thread.</summary>
    [AvaloniaFact]
    public void LauncherButton_DoesNotThrowCrossThreadException()
    {
        var window = new MainWindow();
        window.Show();
        string tmp = Path.Combine(Path.GetTempPath(), "neo3ds-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);
        window.FindControl<TextBox>("OutDirBox")!.Text = tmp;

        window.FindControl<Button>("LauncherButton")!.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
        PumpUntil(window, () => window.FindControl<Button>("LauncherButton")!.IsEnabled, 30000);

        string log = window.FindControl<TextBox>("LogBox")!.Text ?? "";
        Assert.DoesNotContain("calling thread", log, StringComparison.OrdinalIgnoreCase);
        window.Close();
        try { Directory.Delete(tmp, recursive: true); } catch { /* best effort */ }
    }

    /// <summary>#110: static labels must follow the language.</summary>
    [AvaloniaFact]
    public void StaticLabels_FollowLanguage()
    {
        bool saved = Lang.Korean;
        try
        {
            Lang.Set(false, remember: false);
            var window = new MainWindow();
            window.Show();

            Assert.Equal("Title", window.FindControl<TextBlock>("LabelTitle")!.Text);
            Assert.Equal("Icon", window.FindControl<TextBlock>("LabelIcon")!.Text);
            Assert.Equal("Banner", window.FindControl<TextBlock>("LabelBanner")!.Text);
            Assert.Equal("System", window.FindControl<TextBlock>("LabelSystem")!.Text);
            Assert.Equal("Region", window.FindControl<TextBlock>("LabelRegion")!.Text);
            Assert.Equal("Output folder", window.FindControl<TextBlock>("LabelOutDir")!.Text);
            Assert.Equal("Log", window.FindControl<TextBlock>("LabelLog")!.Text);
            Assert.Equal("Drop zip files here (one or more)", window.FindControl<TextBlock>("DropHint")!.Text);
            Assert.Equal("Icon (48×48)", window.FindControl<TextBlock>("LabelIconPreview")!.Text);
            Assert.Equal("Banner (256×128)", window.FindControl<TextBlock>("LabelBannerPreview")!.Text);
            Assert.Equal("Title", window.FindControl<TextBox>("TitleBox")!.PlaceholderText);

            window.Close();
        }
        finally
        {
            Lang.Set(saved, remember: false);
        }
    }

    /// <summary>#112: the language button switches in place; the process must not restart (Avalonia cannot re-init).</summary>
    [AvaloniaFact]
    public void LangButton_SwitchesLive_AndKeepsComboSelection()
    {
        bool saved = Lang.Korean;
        try
        {
            Lang.Set(false, remember: false);
            var window = new MainWindow();
            window.Show();
            var system = window.FindControl<ComboBox>("SystemBox")!;
            var region = window.FindControl<ComboBox>("RegionBox")!;
            system.SelectedIndex = 2;
            region.SelectedIndex = 1;

            window.FindControl<Button>("LangButton")!.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));

            Assert.True(Lang.Korean);
            Assert.True(window.IsVisible);                                  // stayed open
            Assert.Equal("게임 이름", window.FindControl<TextBlock>("LabelTitle")!.Text);
            Assert.Equal("출력 폴더", window.FindControl<TextBlock>("LabelOutDir")!.Text);
            Assert.Equal(2, system.SelectedIndex);                          // selection kept
            Assert.Equal(1, region.SelectedIndex);
            Assert.Equal("English", window.FindControl<Button>("LangButton")!.Content /* target language */);

            window.Close();
        }
        finally
        {
            Lang.Set(saved, remember: false);
        }
    }

    static void PumpUntil(Window window, Func<bool> done, int timeoutMs)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < timeoutMs)
        {
            Dispatcher.UIThread.RunJobs();
            CloseDialogs(window);
            if (done()) return;
            Thread.Sleep(20);
        }
    }

    static void CloseDialogs(Window owner)
    {
        if (Application.Current?.ApplicationLifetime is not Avalonia.Controls.ApplicationLifetimes.IClassicDesktopStyleApplicationLifetime life) return;
        foreach (var w in life.Windows.ToList())
            if (!ReferenceEquals(w, owner)) w.Close();
    }
}
