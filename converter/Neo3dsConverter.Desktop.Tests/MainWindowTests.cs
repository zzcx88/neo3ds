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
            Assert.Equal(Lang.L("보낼 .cia 또는 .neo3ds 파일을 고르거나 끌어다 놓으세요.", "Pick a .cia or .neo3ds file, or drop one here."), dialog.StatusText);

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

    /// <summary>#257: a .neo3ds is served with the launcher's Y guidance, not FBI's.</summary>
    [AvaloniaFact]
    public void SendDialog_ServesALauncherFileAndGuidesToTheLauncher()
    {
        var addresses = LanSender.LanAddresses();
        if (addresses.Count == 0) Assert.Skip("no LAN IPv4 interface on this machine");
        string tmp = Path.Combine(Path.GetTempPath(), "neo3ds-send-pack-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);
        try
        {
            string pack = Path.Combine(tmp, "kof98.neo3ds");
            File.WriteAllBytes(pack, new byte[4096]);

            using var dialog = new SendDialog([], addresses);
            dialog.Choose(pack);

            Assert.NotNull(dialog.Sender);
            Assert.EndsWith(".neo3ds", dialog.Url);
            Assert.Contains("kof98.neo3ds", dialog.InfoText);
            Assert.Contains("4 KB", dialog.InfoText);
            Assert.Equal(SendGuide.Launcher, dialog.Target!.Guide);
            Assert.Equal(SendText.Status(SendState.Waiting, SendGuide.Launcher), dialog.StatusText);
            Assert.StartsWith(Lang.L("3DS 대기", "Waiting for the 3DS"), dialog.StatusText);
        }
        finally
        {
            try { Directory.Delete(tmp, recursive: true); } catch { /* best effort */ }
        }
    }

    /// <summary>#255: the list highlight names the file the QR serves, and a refusal shows no scan steps.</summary>
    [AvaloniaFact]
    public void SendDialog_TracksTheFileTheQrServes()
    {
        var addresses = LanSender.LanAddresses();
        if (addresses.Count == 0) Assert.Skip("no LAN IPv4 interface on this machine");
        string tmp = Path.Combine(Path.GetTempPath(), "neo3ds-send-track-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);
        try
        {
            string built = Path.Combine(tmp, "built.cia");
            string pack = Path.Combine(tmp, "kof98.neo3ds");
            string zip = Path.Combine(tmp, "kof98.zip");
            File.WriteAllBytes(built, new byte[1024]);
            File.WriteAllBytes(pack, new byte[1024]);
            File.WriteAllBytes(zip, new byte[1024]);

            using var dialog = new SendDialog([new SessionCia(built, Launcher: false)], addresses);
            Assert.Equal(0, dialog.SelectedSession);
            Assert.NotEmpty(dialog.StepsText);

            dialog.Choose(pack);
            Assert.Equal(-1, dialog.SelectedSession);
            Assert.Contains(Lang.L("런처", "launcher"), dialog.StatusText);

            dialog.Choose(zip);
            Assert.Equal(-1, dialog.SelectedSession);
            Assert.Equal("", dialog.StepsText);
            Assert.Equal("", dialog.NotesText);

            dialog.Choose(built);
            Assert.Equal(0, dialog.SelectedSession);
            Assert.NotEmpty(dialog.StepsText);
            Assert.NotEmpty(dialog.NotesText);
        }
        finally
        {
            try { Directory.Delete(tmp, recursive: true); } catch { /* best effort */ }
        }
    }

    /// <summary>#306: one modeless send window; a build made while it is open joins its list without changing the QR.</summary>
    [AvaloniaFact]
    public void SendWindowIsReusedAndTakesBuildsWhileOpen()
    {
        var addresses = LanSender.LanAddresses();
        if (addresses.Count == 0) Assert.Skip("no LAN IPv4 interface on this machine");
        string tmp = Path.Combine(Path.GetTempPath(), "neo3ds-send-modeless-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);
        try
        {
            string one = Path.Combine(tmp, "one.cia");
            string two = Path.Combine(tmp, "two.cia");
            File.WriteAllBytes(one, new byte[2048]);
            File.WriteAllBytes(two, new byte[4096]);

            var window = new MainWindow();
            window.Show();
            var dialog = window.OpenSendDialog(addresses);
            Assert.Same(dialog, window.OpenSendDialog(addresses));
            Assert.Equal(0, dialog.SessionCount);
            Assert.Null(dialog.Sender);

            window.AddBuilt(one, launcher: false);
            Assert.Equal(1, dialog.SessionCount);
            Assert.Null(dialog.Sender);

            dialog.Choose(one);
            string url = dialog.Url!;
            Assert.NotNull(dialog.Sender);

            window.AddBuilt(two, launcher: false);
            Assert.Equal(2, dialog.SessionCount);
            Assert.Equal(url, dialog.Url);
            Assert.Equal(0, dialog.SelectedSession);

            dialog.Window.Close();
            PumpUntilVisible(() => dialog.Sender == null, 2000);
            Assert.Null(dialog.Sender);

            var again = window.OpenSendDialog(addresses);
            Assert.NotSame(dialog, again);
            Assert.Equal(2, again.SessionCount);
            Assert.NotNull(again.Sender);

            window.Close();
            PumpUntilVisible(() => again.Sender == null, 2000);
            Assert.Null(again.Sender);
        }
        finally
        {
            try { Directory.Delete(tmp, recursive: true); } catch { /* best effort */ }
        }
    }

    /// <summary>#264: two CIAs are served from one token and one QR, with a row per file.</summary>
    [AvaloniaFact]
    public void SendDialog_ServesABatchOfCiasAndMarksEachFile()
    {
        var addresses = LanSender.LanAddresses();
        if (addresses.Count == 0) Assert.Skip("no LAN IPv4 interface on this machine");
        string tmp = Path.Combine(Path.GetTempPath(), "neo3ds-send-batch-live-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);
        try
        {
            string one = Path.Combine(tmp, "kof98.cia");
            string two = Path.Combine(tmp, "nam1975.cia");
            byte[] first = new byte[2048];
            byte[] second = new byte[4096];
            new Random(11).NextBytes(first);
            new Random(12).NextBytes(second);
            File.WriteAllBytes(one, first);
            File.WriteAllBytes(two, second);

            using var dialog = new SendDialog([], addresses);
            dialog.ChooseMany([one, two]);

            Assert.NotNull(dialog.Sender);
            Assert.Equal(SendKind.Cia, dialog.Batch!.Kind);
            Assert.True(dialog.Batch.Allowed);
            Assert.Equal(2, dialog.BatchRows.Length);
            Assert.Contains("\n", dialog.QrText);
            Assert.Contains("2", dialog.InfoText);
            Assert.Null(dialog.Target);

            byte[]? gotFirst = null;
            byte[]? gotSecond = null;
            Exception? error = null;
            var fetch = Task.Run(async () =>
            {
                try
                {
                    using var http = new HttpClient();
                    gotFirst = await http.GetByteArrayAsync(dialog.Sender!.Items[0].Url);
                    gotSecond = await http.GetByteArrayAsync(dialog.Sender!.Items[1].Url);
                }
                catch (Exception ex) { error = ex; }
            });
            PumpUntilVisible(() => fetch.IsCompleted, 10000);

            Assert.Null(error);
            Assert.Equal(first, gotFirst);
            Assert.Equal(second, gotSecond);
            PumpUntilVisible(() => dialog.StatusText.Contains(Lang.L("전송 완료", "Sent")), 3000);
            Assert.Contains(Lang.L("전송 완료", "Sent"), dialog.StatusText);
            Assert.All(dialog.BatchRows, row => Assert.Contains(Lang.L("보냄", "Sent"), row));

            dialog.Dispose();
            Assert.Null(dialog.Sender);
        }
        finally
        {
            try { Directory.Delete(tmp, recursive: true); } catch { /* best effort */ }
        }
    }

    /// <summary>#264: multi-selecting two session CIAs makes one batch and stops the first server.</summary>
    [AvaloniaFact]
    public void SendDialog_BatchesTheSessionCiasSelectedInTheList()
    {
        var addresses = LanSender.LanAddresses();
        if (addresses.Count == 0) Assert.Skip("no LAN IPv4 interface on this machine");
        string tmp = Path.Combine(Path.GetTempPath(), "neo3ds-send-batch-session-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);
        try
        {
            string one = Path.Combine(tmp, "kof98.cia");
            string two = Path.Combine(tmp, "nam1975.cia");
            File.WriteAllBytes(one, new byte[2048]);
            File.WriteAllBytes(two, new byte[4096]);

            using var dialog = new SendDialog([new SessionCia(one, false), new SessionCia(two, false)], addresses);
            dialog.Window.Show();
            string first = dialog.Url!;
            var list = dialog.Window.GetVisualDescendants().OfType<ListBox>()
                .Single(l => l.SelectionMode == SelectionMode.Multiple);
            var rows = list.ItemsSource!.Cast<SendSessionRow>().ToArray();

            list.SelectedItems = new List<object> { rows[0], rows[1] };

            Assert.Equal(2, dialog.SelectedCount);
            Assert.NotNull(dialog.Sender);
            Assert.Equal(SendKind.Cia, dialog.Batch!.Kind);
            Assert.Equal(2, dialog.BatchRows.Length);
            Assert.NotEqual(first, dialog.Url);
            dialog.Window.Close();
        }
        finally
        {
            try { Directory.Delete(tmp, recursive: true); } catch { /* best effort */ }
        }
    }

    /// <summary>#264: a mixed selection and a duplicate base name start no server.</summary>
    [AvaloniaFact]
    public void SendDialog_RefusesMixedAndDuplicateBatchesBeforeStartingAServer()
    {
        var addresses = LanSender.LanAddresses();
        if (addresses.Count == 0) Assert.Skip("no LAN IPv4 interface on this machine");
        string tmp = Path.Combine(Path.GetTempPath(), "neo3ds-send-batch-refuse-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);
        try
        {
            string cia = Path.Combine(tmp, "kof98.cia");
            string pack = Path.Combine(tmp, "nam1975.neo3ds");
            string other = Path.Combine(tmp, "other");
            Directory.CreateDirectory(other);
            string duplicate = Path.Combine(other, "KOF98.cia");
            File.WriteAllBytes(cia, new byte[1024]);
            File.WriteAllBytes(pack, new byte[1024]);
            File.WriteAllBytes(duplicate, new byte[1024]);

            using var dialog = new SendDialog([], addresses);

            dialog.ChooseMany([cia, pack]);
            Assert.Null(dialog.Sender);
            Assert.Equal(SendRefusal.MixedKinds, dialog.Batch!.Refusal);
            Assert.Contains(Lang.L("두 번", "two batches"), dialog.StatusText);

            dialog.ChooseMany([cia, duplicate]);
            Assert.Null(dialog.Sender);
            Assert.Equal(SendRefusal.DuplicateName, dialog.Batch!.Refusal);
            Assert.Contains("kof98.cia", dialog.StatusText, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            try { Directory.Delete(tmp, recursive: true); } catch { /* best effort */ }
        }
    }

    /// <summary>#264: six long pack names still fit the file rules but not one version-12 QR.</summary>
    [AvaloniaFact]
    public void SendDialog_ReportsTheAllowedCountWhenTheBatchQrWouldBeTooLarge()
    {
        var addresses = LanSender.LanAddresses();
        if (addresses.Count == 0) Assert.Skip("no LAN IPv4 interface on this machine");
        string tmp = Path.Combine(Path.GetTempPath(), "neo3ds-send-batch-qr-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);
        try
        {
            string[] packs = Enumerable.Range(0, 6)
                .Select(i =>
                {
                    string path = Path.Combine(tmp, new string((char)('a' + i), 96) + ".neo3ds");
                    File.WriteAllBytes(path, new byte[1024]);
                    return path;
                }).ToArray();

            using var dialog = new SendDialog([], addresses);
            dialog.ChooseMany(packs);

            Assert.Null(dialog.Sender);
            Assert.Equal(SendRefusal.QrTooLarge, dialog.Batch!.Refusal);
            Assert.InRange(dialog.Batch.AllowedCount, 1, 5);
            Assert.Contains(dialog.Batch.AllowedCount.ToString(), dialog.StatusText);
            Assert.Equal(6, dialog.BatchRows.Length);
        }
        finally
        {
            try { Directory.Delete(tmp, recursive: true); } catch { /* best effort */ }
        }
    }

    /// <summary>#264: a new batch stops the previous server and its URLs.</summary>
    [AvaloniaFact]
    public void SendDialog_StopsThePreviousBatchServerWhenTheSelectionChanges()
    {
        var addresses = LanSender.LanAddresses();
        if (addresses.Count == 0) Assert.Skip("no LAN IPv4 interface on this machine");
        string tmp = Path.Combine(Path.GetTempPath(), "neo3ds-send-batch-switch-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);
        try
        {
            string one = Path.Combine(tmp, "one.cia");
            string two = Path.Combine(tmp, "two.cia");
            string three = Path.Combine(tmp, "three.cia");
            string four = Path.Combine(tmp, "four.cia");
            foreach (string path in new[] { one, two, three, four })
                File.WriteAllBytes(path, new byte[2048]);

            using var dialog = new SendDialog([], addresses);
            dialog.ChooseMany([one, two]);
            string[] first = dialog.Sender!.Items.Select(i => i.Url).ToArray();

            dialog.ChooseMany([three, four]);
            string[] second = dialog.Sender!.Items.Select(i => i.Url).ToArray();

            Assert.NotEqual(first[0], second[0]);
            bool failed = false;
            var after = Task.Run(async () =>
            {
                try { await new HttpClient().GetByteArrayAsync(first[0]); }
                catch { failed = true; }
            });
            PumpUntilVisible(() => after.IsCompleted, 5000);
            Assert.True(failed, "the previous batch server must stop when the selection changes");
        }
        finally
        {
            try { Directory.Delete(tmp, recursive: true); } catch { /* best effort */ }
        }
    }

    /// <summary>
    /// #312: a batch follows a new address, the old listener stops, and closing the window stops
    /// the listener that is still serving.
    /// </summary>
    [AvaloniaFact]
    public void SendDialog_RestartsABatchOnAnotherAddressAndStopsItOnClose()
    {
        string tmp = Path.Combine(Path.GetTempPath(), "neo3ds-send-batch-address-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);
        try
        {
            string one = Path.Combine(tmp, "one.cia");
            string two = Path.Combine(tmp, "two.cia");
            byte[] firstBytes = new byte[2048];
            byte[] secondBytes = new byte[4096];
            new Random(21).NextBytes(firstBytes);
            new Random(22).NextBytes(secondBytes);
            File.WriteAllBytes(one, firstBytes);
            File.WriteAllBytes(two, secondBytes);

            // Both spellings bind to loopback, but the long one makes visibly longer URLs.
            var addresses = new[]
            {
                new LanAddress("127.000.000.001", "long loopback"),
                new LanAddress("127.0.0.1", "loopback"),
            };
            using var dialog = new SendDialog([], addresses);
            dialog.Window.Show();
            dialog.ChooseMany([one, two]);

            Assert.NotNull(dialog.Sender);
            string[] firstUrls = dialog.Sender!.Items.Select(i => i.Url).ToArray();
            Assert.Contains("127.000.000.001", firstUrls[0]);

            dialog.SelectAddress(1);

            Assert.NotNull(dialog.Sender);
            string[] secondUrls = dialog.Sender!.Items.Select(i => i.Url).ToArray();
            Assert.Contains("127.0.0.1", secondUrls[0]);
            Assert.NotEqual(firstUrls[0], secondUrls[0]);

            bool oldStopped = false;
            var oldFetch = Task.Run(async () =>
            {
                try { await new HttpClient().GetByteArrayAsync(firstUrls[0]); }
                catch { oldStopped = true; }
            });
            PumpUntilVisible(() => oldFetch.IsCompleted, 5000);
            Assert.True(oldStopped, "the previous address must stop serving the batch");

            byte[]? served = null;
            var newFetch = Task.Run(async () => served = await new HttpClient().GetByteArrayAsync(secondUrls[0]));
            PumpUntilVisible(() => newFetch.IsCompleted, 5000);
            Assert.Equal(firstBytes, served);

            dialog.Window.Close();
            PumpUntilVisible(() => dialog.Sender == null, 2000);
            Assert.Null(dialog.Sender);

            bool closedStopped = false;
            var afterClose = Task.Run(async () =>
            {
                try { await new HttpClient().GetByteArrayAsync(secondUrls[0]); }
                catch { closedStopped = true; }
            });
            PumpUntilVisible(() => afterClose.IsCompleted, 5000);
            Assert.True(closedStopped, "closing the window must stop the batch server");
        }
        finally
        {
            try { Directory.Delete(tmp, recursive: true); } catch { /* best effort */ }
        }
    }

    /// <summary>#312: the 16-hex token stays in the URL/QR, not in status, rows, steps, or the log.</summary>
    [AvaloniaFact]
    public void SendDialog_KeepsTheTokenOutOfStatusAndLogText()
    {
        string tmp = Path.Combine(Path.GetTempPath(), "neo3ds-send-batch-token-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);
        var window = new MainWindow();
        window.Show();
        try
        {
            string one = Path.Combine(tmp, "one.cia");
            string two = Path.Combine(tmp, "two.cia");
            File.WriteAllBytes(one, new byte[2048]);
            File.WriteAllBytes(two, new byte[4096]);

            var dialog = window.OpenSendDialog([new LanAddress("127.0.0.1", "loopback")]);
            dialog.ChooseMany([one, two]);

            Assert.NotNull(dialog.Url);
            string token = new Uri(dialog.Url!).AbsolutePath
                .Split('/', StringSplitOptions.RemoveEmptyEntries)[0];
            Assert.Equal(16, token.Length);
            Assert.Contains(token, dialog.Url);
            Assert.DoesNotContain(token, dialog.StatusText);
            Assert.DoesNotContain(token, dialog.InfoText);
            Assert.DoesNotContain(token, dialog.StepsText);
            Assert.DoesNotContain(token, dialog.NotesText);
            Assert.DoesNotContain(token, string.Join("\n", dialog.BatchRows));
            Assert.DoesNotContain(token, window.FindControl<TextBox>("LogBox")!.Text ?? "");
        }
        finally
        {
            window.Close();
            try { Directory.Delete(tmp, recursive: true); } catch { /* best effort */ }
        }
    }

    /// <summary>#300: a failed QR must stop the server it just started, not leave the port listening.</summary>
    [AvaloniaFact]
    public void SendDialog_StopsTheServerWhenQrGenerationFails()
    {
        var addresses = LanSender.LanAddresses();
        if (addresses.Count == 0) Assert.Skip("no LAN IPv4 interface on this machine");
        string tmp = Path.Combine(Path.GetTempPath(), "neo3ds-send-qr-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);
        try
        {
            string cia = Path.Combine(tmp, "kof98.cia");
            File.WriteAllBytes(cia, new byte[1024]);

            string? url = null;
            using var dialog = new SendDialog([], addresses, u =>
            {
                url = u;
                throw new InvalidOperationException("qr failed");
            });

            dialog.Choose(cia);

            Assert.Null(dialog.Sender);
            Assert.Contains(Lang.L("전송 실패", "Send failed"), dialog.StatusText);
            Assert.NotNull(url);
            bool answered = false;
            var probe = Task.Run(async () =>
            {
                try { await new HttpClient().GetByteArrayAsync(url); answered = true; }
                catch { /* expected: the server is gone */ }
            });
            PumpUntilVisible(() => probe.IsCompleted, 5000);
            Assert.False(answered, "the server started for the failed QR is still serving");
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
