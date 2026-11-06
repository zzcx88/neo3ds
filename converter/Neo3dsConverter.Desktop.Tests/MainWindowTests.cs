using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Headless.XUnit;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Avalonia.VisualTree;
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
        Assert.NotNull(window.FindControl<Button>("SendButton"));
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

    /// <summary>#117: the window title follows the language.</summary>
    [AvaloniaFact]
    public void WindowTitle_FollowsLanguage()
    {
        bool saved = Lang.Korean;
        try
        {
            Lang.Set(true, remember: false);
            var ko = new MainWindow();
            ko.Show();
            Assert.Contains("변환기", ko.Title);
            ko.Close();

            Lang.Set(false, remember: false);
            var en = new MainWindow();
            en.Show();
            Assert.Contains("converter", en.Title);
            en.Close();
        }
        finally { Lang.Set(saved, remember: false); }
    }

    /// <summary>#114: romset/BIOS/path lines show the real state, with colours.</summary>
    [AvaloniaFact]
    public void RomState_ShowsUnsupportedZipWithPathAndBios()
    {
        bool saved = Lang.Korean;
        string tmp = Path.Combine(Path.GetTempPath(), "neo3ds-state-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);
        try
        {
            Lang.Set(true, remember: false);
            string zip = Path.Combine(tmp, "kof98.zip");
            using (var z = System.IO.Compression.ZipFile.Open(zip, System.IO.Compression.ZipArchiveMode.Create))
                z.CreateEntry("readme.txt");

            var window = new MainWindow();
            window.Show();
            window.LoadRom(zip);

            Assert.Equal(zip, window.FindControl<TextBox>("RomPathBox")!.Text);
            Assert.StartsWith("✘", window.FindControl<TextBlock>("RomsetLabel")!.Text);
            Assert.NotNull(window.FindControl<TextBlock>("RomsetLabel")!.Foreground);
            Assert.Contains("neogeo.zip", window.FindControl<TextBlock>("BiosLabel")!.Text);
            window.Close();
        }
        finally
        {
            Lang.Set(saved, remember: false);
            try { Directory.Delete(tmp, recursive: true); } catch { /* best effort */ }
        }
    }

    /// <summary>#115: completion text tells the user what to do next.</summary>
    [Fact]
    public void DoneMessage_IncludesInstallGuidance()
    {
        Assert.Contains("FBI", MainWindow.DoneMessage(pack: false, "/tmp/game.cia"));
        Assert.Contains("/neo3ds/games/", MainWindow.DoneMessage(pack: true, "/tmp/game.neo3ds"));
    }

    /// <summary>#255: builds are remembered, deleted files drop out, and the dialog opens without any build.</summary>
    [AvaloniaFact]
    public void SendTargets_KeepOnlyExistingSessionCias()
    {
        string tmp = Path.Combine(Path.GetTempPath(), "neo3ds-send-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);
        try
        {
            string cia = Path.Combine(tmp, "kof98.cia");
            string launcher = Path.Combine(tmp, "neo3ds-launcher.cia");
            string pack = Path.Combine(tmp, "kof98.neo3ds");
            File.WriteAllBytes(cia, [1]);
            File.WriteAllBytes(launcher, [2]);
            File.WriteAllBytes(pack, [3]);

            var window = new MainWindow();
            window.Show();
            window.AddBuilt(pack, launcher: false);
            Assert.Empty(window.SendTargets());
            Assert.True(window.FindControl<Button>("SendButton")!.IsEnabled, "the dialog opens before anything is built");

            window.AddBuilt(cia, launcher: false);
            window.AddBuilt(launcher, launcher: true);
            var targets = window.SendTargets();
            Assert.Equal(2, targets.Count);
            Assert.Contains(Lang.L("런처", "Launcher"),
                SendCandidate.Resolve(targets.Single(t => t.Launcher).Path, targets)!.DisplayName);
            Assert.Equal("kof98.cia",
                SendCandidate.Resolve(targets.Single(t => !t.Launcher).Path, targets)!.DisplayName);

            File.Delete(cia);
            Assert.Single(window.SendTargets());
            Assert.False(File.Exists(cia));

            window.Close();
        }
        finally
        {
            try { Directory.Delete(tmp, recursive: true); } catch { /* best effort */ }
        }
    }

    /// <summary>#236: the sizes the send dialog shows.</summary>
    [Fact]
    public void SizeFormatsKilobytesAndMegabytes()
    {
        Assert.Equal("400 KB", SendText.Size(400 * 1024));
        Assert.Equal("45.0 MB", SendText.Size(45L * 1024 * 1024));
        Assert.Equal("1 KB", SendText.Size(1));
    }

    /// <summary>#236: the dialog's server really serves the built bytes, and closing it stops serving.</summary>
    [AvaloniaFact]
    public void SendDialog_ServesTheBuiltCiaAndStopsOnClose()
    {
        var addresses = LanSender.LanAddresses();
        if (addresses.Count == 0) Assert.Skip("no LAN IPv4 interface on this machine");
        string tmp = Path.Combine(Path.GetTempPath(), "neo3ds-send-live-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);
        try
        {
            string cia = Path.Combine(tmp, "kof98.cia");
            var bytes = new byte[64 * 1024];
            new Random(5).NextBytes(bytes);
            File.WriteAllBytes(cia, bytes);

            var window = new MainWindow();
            window.Show();
            using var dialog = new SendDialog([new SessionCia(cia, Launcher: false)], addresses);

            Assert.NotNull(dialog.Sender);
            Assert.StartsWith("http://", dialog.Url);
            Assert.Contains("kof98.cia", dialog.InfoText);
            Assert.Contains("64 KB", dialog.InfoText);

            string url = dialog.Url!;
            byte[]? downloaded = null;
            Exception? error = null;
            var fetch = Task.Run(async () =>
            {
                try { downloaded = await new HttpClient().GetByteArrayAsync(url); }
                catch (Exception ex) { error = ex; }
            });
            PumpUntilVisible(() => fetch.IsCompleted, 10000);

            Assert.Null(error);
            Assert.Equal(bytes, downloaded);
            PumpUntilVisible(() => dialog.StatusText.Contains(Lang.L("전송 완료", "Sent")), 2000);
            Assert.Contains(Lang.L("전송 완료", "Sent"), dialog.StatusText);

            dialog.Dispose();
            Assert.Null(dialog.Sender);
            bool failed = false;
            var after = Task.Run(async () =>
            {
                try { await new HttpClient().GetByteArrayAsync(url); }
                catch { failed = true; }
            });
            PumpUntilVisible(() => after.IsCompleted, 5000);
            Assert.True(failed, "the server must stop when the dialog closes");

            window.Close();
        }
        finally
        {
            try { Directory.Delete(tmp, recursive: true); } catch { /* best effort */ }
        }
    }

    /// <summary>#255: a refused file shows why and starts nothing; a CIA afterwards serves normally.</summary>
    [AvaloniaFact]
    public void SendDialog_RefusesWhatThe3dsCannotUseAndStartsOnACia()
    {
        var addresses = LanSender.LanAddresses();
        if (addresses.Count == 0) Assert.Skip("no LAN IPv4 interface on this machine");
        string tmp = Path.Combine(Path.GetTempPath(), "neo3ds-send-refuse-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);
        try
        {
            string cia = Path.Combine(tmp, "kof98.cia");
            string zip = Path.Combine(tmp, "kof98.zip");
            File.WriteAllBytes(cia, new byte[1024]);
            File.WriteAllBytes(zip, new byte[1024]);

            using var dialog = new SendDialog([], addresses);
            Assert.Null(dialog.Sender);
            Assert.Equal(Lang.L("보낼 .cia 파일을 고르거나 끌어다 놓으세요.", "Pick a .cia file or drop one here."), dialog.StatusText);

            dialog.Choose(zip);
            Assert.Null(dialog.Sender);
            Assert.Equal(SendRefusal.UnsupportedExtension, dialog.Target!.Refusal);
            Assert.NotEmpty(dialog.StatusText);
            Assert.DoesNotContain(Lang.L("3DS 대기", "Waiting for the 3DS"), dialog.StatusText);

            dialog.Choose(cia);
            Assert.NotNull(dialog.Sender);
            Assert.StartsWith("http://", dialog.Url);
            Assert.Contains("kof98.cia", dialog.InfoText);

            dialog.Choose(Path.Combine(tmp, "gone.cia"));
            Assert.Null(dialog.Sender);
            Assert.Equal(SendRefusal.MissingFile, dialog.Target!.Refusal);
        }
        finally
        {
            try { Directory.Delete(tmp, recursive: true); } catch { /* best effort */ }
        }
    }

    /// <summary>#255: picking another file stops the server that served the previous one.</summary>
    [AvaloniaFact]
    public void SendDialog_StopsThePreviousServerWhenTheFileChanges()
    {
        var addresses = LanSender.LanAddresses();
        if (addresses.Count == 0) Assert.Skip("no LAN IPv4 interface on this machine");
        string tmp = Path.Combine(Path.GetTempPath(), "neo3ds-send-switch-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);
        try
        {
            string one = Path.Combine(tmp, "one.cia");
            string two = Path.Combine(tmp, "two.cia");
            File.WriteAllBytes(one, new byte[2048]);
            File.WriteAllBytes(two, new byte[4096]);

            using var dialog = new SendDialog([], addresses);
            dialog.Choose(one);
            string first = dialog.Url!;
            Assert.Contains("one.cia", first);

            dialog.Choose(two);
            string second = dialog.Url!;
            Assert.Contains("two.cia", second);
            Assert.NotEqual(first, second);

            bool failed = false;
            var after = Task.Run(async () =>
            {
                try { await new HttpClient().GetByteArrayAsync(first); }
                catch { failed = true; }
            });
            PumpUntilVisible(() => after.IsCompleted, 5000);
            Assert.True(failed, "the previous server must stop when another file is chosen");
        }
        finally
        {
            try { Directory.Delete(tmp, recursive: true); } catch { /* best effort */ }
        }
    }

    /// <summary>Pumps the dispatcher; the send dialog must not be closed by the test pump.</summary>
    static void PumpUntilVisible(Func<bool> done, int timeoutMs)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < timeoutMs)
        {
            Dispatcher.UIThread.RunJobs();
            if (done()) return;
            Thread.Sleep(20);
        }
    }

    /// <summary>#116: batch progress title format.</summary>
    [Fact]
    public void ProgressTitle_ShowsIndexAndRoms()
        => Assert.Equal("[2/5] kof98 - base", MainWindow.ProgressTitle(2, 5, "kof98", "base"));

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
