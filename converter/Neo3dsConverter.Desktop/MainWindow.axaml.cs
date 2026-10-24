using System.Diagnostics;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Platform.Storage;
using Avalonia.Threading;

namespace Neo3dsConverter.Desktop;

/// <summary>Single + batch window: one zip -&gt; one CIA, or several zips in a row. KO/EN toggle is P2c.</summary>
public partial class MainWindow : Window
{
    CiaJob? job;
    readonly List<CiaJob> batch = new();

    public MainWindow()
    {
        InitializeComponent();
        if (OperatingSystem.IsLinux())
            FontFamily = new Avalonia.Media.FontFamily("fonts:NotoSansKR#Noto Sans KR");
        ApplyLang();
        OutDirBox.Text = DefaultOutDir();
        OpenButton.Click += OnOpenClicked;
        OutDirButton.Click += OnOutDirClicked;
        LangButton.Click += (_, _) => { Lang.Set(!Lang.Korean, remember: true); ApplyLang(); };
        BuildButton.Click += async (_, _) => await BuildAsync(pack: false);
        PackButton.Click += async (_, _) => await BuildAsync(pack: true);
        LauncherButton.Click += async (_, _) => await BuildLauncherAsync();
        IconPickButton.Click += async (_, _) => await PickImage(IconBox);
        BannerPickButton.Click += async (_, _) => await PickImage(BannerBox);
        IconClearButton.Click += (_, _) => { IconBox.Text = ""; RefreshPreview(); };
        BannerClearButton.Click += (_, _) => { BannerBox.Text = ""; RefreshPreview(); };
        TitleBox.TextChanged += (_, _) => RefreshPreview();
        DragDrop.SetAllowDrop(DropZone, true);
        DropZone.AddHandler(DragDrop.DropEvent, OnDrop);
        Log(Lang.L("MAME 네오지오 롬셋 zip을 끌어다 놓거나 [롬 zip 열기]를 누르세요.", "Drop MAME Neo Geo romset zips here or press [Open]."));
        Log(Lang.L("MAME 롬셋 zip만 지원합니다. MAME 규격(롬셋 이름·칩 CRC)과 다른 롬셋은 변환되지 않습니다.",
                   "Only MAME romset zips are supported. A romset whose names or chip CRCs differ from MAME's does not convert."));
        Log(Lang.L("여러 개를 한꺼번에 놓거나 고르면 차례로 변환합니다.", "Drop or pick several to convert them one after the other."));
        Log(Lang.L("neogeo.zip(바이오스)은 롬과 같은 폴더에 있어야 합니다.", "neogeo.zip (BIOS) must be in the same folder as the game zip."));
    }

    void ApplyLang()
    {
        // Rebuilding ItemsSource clears the selection, so keep what the user picked.
        int system = SystemBox.SelectedIndex, region = RegionBox.SelectedIndex;
        Title = Lang.L("neo3ds 변환기 - 네오지오 롬 → 3DS CIA", "neo3ds converter - Neo Geo ROM → 3DS CIA");
        LangButton.Content = Lang.Korean ? "English" : "한국어";
        OpenButton.Content = Lang.L("롬 zip 열기 (여러 개 가능)", "Open ROM zips (one or more)");
        DropHint.Text = Lang.L("여기에 zip을 끌어다 놓기 (여러 개 가능)", "Drop zip files here (one or more)");
        LabelRom.Text = Lang.L("롬 파일", "ROM file");
        LabelTitle.Text = Lang.L("게임 이름", "Title");
        LabelIcon.Text = Lang.L("아이콘", "Icon");
        LabelBanner.Text = Lang.L("배너", "Banner");
        LabelSystem.Text = Lang.L("시스템", "System");
        LabelRegion.Text = Lang.L("지역", "Region");
        LabelIconPreview.Text = Lang.L("아이콘 (48×48)", "Icon (48×48)");
        LabelBannerPreview.Text = Lang.L("배너 (256×128)", "Banner (256×128)");
        LabelOutDir.Text = Lang.L("출력 폴더", "Output folder");
        LabelLog.Text = Lang.L("로그", "Log");
        TitleBox.PlaceholderText = Lang.L("제목", "Title");
        IconBox.PlaceholderText = BannerBox.PlaceholderText = Lang.L("자동 생성", "Generated");
        IconPickButton.Content = BannerPickButton.Content = Lang.L("선택", "Pick");
        OutDirButton.Content = Lang.L("변경", "Change");
        LauncherButton.Content = Lang.L("런처 CIA 만들기 (한 번만 설치)", "Build the launcher CIA (install once)");
        SystemBox.ItemsSource = new[]
        {
            Lang.L("자동 (가정용 AES, 필요한 게임만 MVS)", "Automatic (home AES, MVS where a game needs it)"),
            Lang.L("AES (가정용)", "AES (home console)"),
            Lang.L("MVS (아케이드)", "MVS (arcade)"),
        };
        SystemBox.SelectedIndex = Math.Clamp(system, 0, 2);
        RegionBox.ItemsSource = new[]
        {
            Lang.L("유럽·아시아 (기본)", "Europe/Asia (default)"),
            Lang.L("일본 (무검열, 일본어)", "Japan (uncensored, Japanese text)"),
            Lang.L("미국", "USA"),
        };
        RegionBox.SelectedIndex = Math.Clamp(region, 0, 2);
        RefreshState();
    }

    /// <summary>Build buttons say how many games are queued when a batch is loaded.</summary>
    void SetBuildLabels()
    {
        if (batch.Count > 0)
        {
            int ok = batch.Count(Buildable);
            BuildButton.Content = Lang.L($"CIA {ok}개 만들기", $"Build {ok} CIAs");
            PackButton.Content = Lang.L($"런처용 파일 {ok}개 만들기", $"{ok} launcher files");
        }
        else
        {
            BuildButton.Content = Lang.L("CIA 만들기", "Build CIA");
            PackButton.Content = Lang.L("런처용 파일 만들기", "Launcher file");
        }
    }

    static readonly Avalonia.Media.IBrush Ok = Avalonia.Media.Brushes.ForestGreen;
    static readonly Avalonia.Media.IBrush Bad = Avalonia.Media.Brushes.Firebrick;

    /// <summary>Romset/BIOS/path lines recomputed from the loaded state, including on a language switch (#114).</summary>
    internal void RefreshState()
    {
        if (batch.Count > 0)
        {
            int ok = batch.Count(Buildable), noBios = batch.Count(j => j.BiosZip == null);
            RomPathBox.Text = Lang.L($"{batch.Count}개 선택", $"{batch.Count} zips");
            RomsetLabel.Text = ok == batch.Count
                ? Lang.L($"✔ 모두 변환 가능 ({ok}개)", $"✔ all {ok} can be converted")
                : Lang.L($"변환 가능 {ok}개 / 불가 {batch.Count - ok}개 (아래 로그 참고)", $"{ok} can be converted, {batch.Count - ok} can't (see the log)");
            RomsetLabel.Foreground = ok == batch.Count ? Ok : Bad;
            BiosLabel.Text = noBios == 0
                ? Lang.L("✔ neogeo.zip 발견", "✔ neogeo.zip found")
                : Lang.L($"✘ neogeo.zip 없는 폴더의 롬 {noBios}개", $"✘ {noBios} zips have no neogeo.zip next to them");
            BiosLabel.Foreground = noBios == 0 ? Ok : Bad;
            StatusText.Text = RomsetLabel.Text;
            SetBuildLabels();
            return;
        }
        if (job == null)
        {
            RomPathBox.Text = "";
            RomsetLabel.Text = "";
            BiosLabel.Text = "";
            StatusText.Text = Lang.L("롬을 선택하세요", "Pick a ROM");
            SetBuildLabels();
            return;
        }
        RomPathBox.Text = job.RomZip;
        RomsetLabel.Text = job.Game != null ? $"✔ {job.Game.Name} - {job.Game.Desc}" : "✘ " + job.Problem;
        RomsetLabel.Foreground = job.Game != null ? Ok : Bad;
        BiosLabel.Text = job.BiosZip != null
            ? Lang.L("✔ neogeo.zip 발견", "✔ neogeo.zip found")
            : Lang.L("✘ neogeo.zip 없음 (롬과 같은 폴더에 넣어주세요)", "✘ no neogeo.zip (put it next to the game zip)");
        BiosLabel.Foreground = job.BiosZip != null ? Ok : Bad;
        StatusText.Text = job.Game != null
            ? $"{job.RomName} — {job.Title} (Title ID {job.TitleId})"
            : $"{job.RomName}: {job.Problem}";
        SetBuildLabels();
    }

    /// <summary>#116: batch progress shown in the window title.</summary>
    internal static string ProgressTitle(int index, int count, string rom, string baseTitle)
        => $"[{index}/{count}] {rom} - {baseTitle}";

    /// <summary>#115: what to do with the file we just built.</summary>
    internal static string DoneMessage(bool pack, string file) => (pack
        ? Lang.L("런처용 파일을 만들었습니다. SD카드의 /neo3ds/games/ 폴더에 복사하세요 (런처 CIA가 설치돼 있어야 합니다).",
                 "The launcher file is ready. Copy it to /neo3ds/games/ on the SD card (the launcher CIA must be installed).")
        : Lang.L("CIA를 만들었습니다. FBI로 설치하세요: SD카드에 복사 → FBI → SD → 파일 선택 → Install CIA",
                 "The CIA is ready. Install with FBI: copy to the SD card → FBI → SD → pick the file → Install CIA"))
        + $"\n\n{file}";

    bool? SelectedMvs => SystemBox.SelectedIndex switch { 1 => false, 2 => true, _ => null };
    Region SelectedRegion => RegionBox.SelectedIndex switch { 1 => Region.Japan, 2 => Region.Usa, _ => Region.Europe };

    static string DefaultOutDir()
    {
        string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        string dl = Path.Combine(home, "Downloads");
        return Directory.Exists(dl) ? dl : Path.Combine(home, "Documents");
    }

    async void OnOpenClicked(object? sender, RoutedEventArgs e)
    {
        var type = new FilePickerFileType("ROM zip") { Patterns = ["*.zip"], AppleUniformTypeIdentifiers = ["public.zip-archive"] };
        var files = await StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
        {
            Title = Lang.L("롬 zip 선택 (여러 개 가능)", "Select ROM zips (one or more)"),
            AllowMultiple = true,
            FileTypeFilter = [type],
        });
        LoadRoms(files.Select(f => f.TryGetLocalPath()).OfType<string>().ToArray());
    }

    async void OnOutDirClicked(object? sender, RoutedEventArgs e)
    {
        var dirs = await StorageProvider.OpenFolderPickerAsync(new FolderPickerOpenOptions
        {
            Title = Lang.L("출력 폴더 선택", "Select output folder"),
            AllowMultiple = false,
        });
        if (dirs.Count > 0 && dirs[0].TryGetLocalPath() is string p) OutDirBox.Text = p;
    }

    async Task PickImage(TextBox box)
    {
        var type = new FilePickerFileType("Images") { Patterns = ["*.png", "*.jpg", "*.jpeg", "*.bmp", "*.gif"] };
        var files = await StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
        {
            Title = Lang.L("이미지 선택", "Pick a picture"),
            AllowMultiple = false,
            FileTypeFilter = [type],
        });
        if (files.Count > 0 && files[0].TryGetLocalPath() is string p) { box.Text = p; RefreshPreview(); }
    }

    void OnDrop(object? sender, DragEventArgs e)
    {
        var zips = e.DataTransfer.TryGetFiles()?.Select(f => f.TryGetLocalPath())
            .OfType<string>().Where(p => p.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)).ToArray() ?? [];
        LoadRoms(zips);
    }

    static bool IsBios(string zip) => Path.GetFileName(zip).Equals("neogeo.zip", StringComparison.OrdinalIgnoreCase);
    static bool Buildable(CiaJob j) => j.Game != null && j.BiosZip != null;

    string? IconImage => string.IsNullOrEmpty(IconBox.Text) ? null : IconBox.Text;
    string? BannerImage => string.IsNullOrEmpty(BannerBox.Text) ? null : BannerBox.Text;
    string CurrentTitle => string.IsNullOrWhiteSpace(TitleBox.Text) ? job?.Title ?? "" : TitleBox.Text.Trim();

    void LoadRoms(string[] zips)
    {
        var games = zips.Where(z => !IsBios(z)).OrderBy(Path.GetFileName, StringComparer.OrdinalIgnoreCase).ToArray();
        if (games.Length == 1) LoadRom(games[0]);
        else if (games.Length > 1) LoadBatch(games);
        else if (zips.Length > 0) Log(Lang.L("neogeo.zip은 바이오스입니다. 게임 롬 zip을 선택하세요.", "neogeo.zip is the BIOS. Pick a game zip."));
    }

    void SetSingleFields(bool single)
    {
        TitleBox.IsEnabled = IconBox.IsEnabled = BannerBox.IsEnabled = single;
        IconPickButton.IsEnabled = IconClearButton.IsEnabled = BannerPickButton.IsEnabled = BannerClearButton.IsEnabled = single;
        if (single) return;
        TitleBox.Text = Lang.L("(게임마다 자동)", "(automatic for each game)");
        IconBox.Text = BannerBox.Text = "";
        IconPreview.Source = BannerPreview.Source = null;
    }

    internal void LoadRom(string path)
    {
        if (IsBios(path))
        {
            Log(Lang.L("neogeo.zip은 바이오스입니다. 게임 롬 zip을 선택하세요.", "neogeo.zip is the BIOS. Pick a game zip."));
            return;
        }
        batch.Clear();
        SetSingleFields(true);
        SetBuildLabels();
        try
        {
            job = CiaJob.FromRomZip(path);
        }
        catch (Exception ex)
        {
            StatusText.Text = Lang.L($"오류: {ex.Message}", $"Error: {ex.Message}");
            SetBuildEnabled(false);
            return;
        }
        TitleBox.Text = job.Title;
        SetBuildEnabled(Buildable(job));
        RefreshState();
        Log(Lang.L("선택: ", "Selected: ") + $"{Path.GetFileName(path)}  (Title ID {job.TitleId})");
        if (!Buildable(job)) Log(Lang.L("변환 불가: ", "Can't convert: ") + (job.Problem ?? Lang.L("neogeo.zip 없음", "no neogeo.zip")));
        RefreshPreview();
    }

    void LoadBatch(string[] zips)
    {
        job = null;
        batch.Clear();
        Log("");
        foreach (var zip in zips)
        {
            var j = CiaJob.FromRomZip(zip);
            batch.Add(j);
            if (j.Game == null) Log($"  ✘ {j.RomName}: {j.Problem}");
            else if (j.BiosZip == null) Log($"  ✘ {j.RomName}: " + Lang.L("같은 폴더에 neogeo.zip 없음", "no neogeo.zip in the same folder"));
            else Log($"  ✔ {j.RomName}: {j.Title}");
        }
        int ok = batch.Count(Buildable);
        SetSingleFields(false);
        SetBuildEnabled(ok > 0);
        RefreshState();
        Log(Lang.L($"{batch.Count}개 선택: 변환 가능 {ok}개", $"{batch.Count} zips picked, {ok} can be converted"));
    }

    void SetBuildEnabled(bool on) => BuildButton.IsEnabled = PackButton.IsEnabled = on;

    void RefreshPreview()
    {
        if (job == null) return;
        try
        {
            IconPreview.Source = new Avalonia.Media.Imaging.Bitmap(new MemoryStream(Art.Icon(CurrentTitle, IconImage)));
            BannerPreview.Source = new Avalonia.Media.Imaging.Bitmap(new MemoryStream(Art.Banner(CurrentTitle, BannerImage)));
        }
        catch (Exception ex)
        {
            Log(Lang.L("이미지를 읽을 수 없습니다: ", "Can't read the picture: ") + ex.Message);
        }
    }

    string OutDir()
    {
        string dir = string.IsNullOrEmpty(OutDirBox.Text) ? DefaultOutDir() : OutDirBox.Text;
        Directory.CreateDirectory(dir);
        return dir;
    }

    void SetBusy(bool busy)
    {
        Cursor = busy ? new Cursor(StandardCursorType.Wait) : null;
        OpenButton.IsEnabled = OutDirButton.IsEnabled = LauncherButton.IsEnabled = !busy;
        if (!busy) SetBuildEnabled(batch.Count > 0 ? batch.Any(Buildable) : job != null && Buildable(job));
        else SetBuildEnabled(false);
    }

    async Task BuildAsync(bool pack)
    {
        if (batch.Count > 0) { await BuildBatchAsync(pack); return; }
        if (job == null) return;
        var j = job;
        j.Title = CurrentTitle;
        j.IconImage = IconImage;
        j.BannerImage = BannerImage;
        j.StartMvs = SelectedMvs;
        j.Region = SelectedRegion;
        j.OutputDir = OutDir();
        SetBusy(true);
        var sw = Stopwatch.StartNew();
        try
        {
            string file = await Task.Run(() => pack ? new CiaBuilder(Log).BuildPack(j) : new CiaBuilder(Log).Build(j));
            Log(Lang.L($"완료 ({sw.ElapsedMilliseconds} ms): {file}", $"Done ({sw.ElapsedMilliseconds} ms): {file}"));
            await ShowDialog(Lang.L("완료", "Done"), DoneMessage(pack, file));
        }
        catch (Exception ex)
        {
            Log(Lang.L($"실패: {ex.Message}", $"Failed: {ex.Message}"));
            await ShowDialog(Lang.L("실패", "Failed"), ex.Message);
        }
        finally
        {
            SetBusy(false);
        }
    }

    async Task BuildBatchAsync(bool pack)
    {
        var jobs = batch.Where(Buildable).ToList();
        string outDir = OutDir();
        string baseTitle = Title ?? "";
        var done = new List<string>();
        var failed = new List<string>();
        SetBusy(true);
        try
        {
            for (int i = 0; i < jobs.Count; i++)
            {
                var j = jobs[i];
                j.StartMvs = SelectedMvs;
                j.Region = SelectedRegion;
                j.OutputDir = outDir;
                Title = ProgressTitle(i + 1, jobs.Count, j.RomName, baseTitle);
                Log("");
                Log($"[{i + 1}/{jobs.Count}] {j.RomName} - {j.Title}");
                try
                {
                    await Task.Run(() => pack ? new CiaBuilder(Log).BuildPack(j) : new CiaBuilder(Log).Build(j));
                    done.Add(j.RomName);
                }
                catch (Exception ex)
                {
                    Log(Lang.L("오류: ", "Error: ") + ex.Message);
                    failed.Add($"{j.RomName}: {ex.Message}");
                }
            }
            Log("");
            Log(Lang.L($"끝: 성공 {done.Count}개, 실패 {failed.Count}개", $"Finished: {done.Count} built, {failed.Count} failed"));
            string msg = (pack
                ? Lang.L($"런처용 파일 {done.Count}개: SD카드 /neo3ds/games/에 복사하세요.", $"{done.Count} launcher files: copy to /neo3ds/games/ on the SD card.")
                : Lang.L($"CIA {done.Count}개. FBI로 설치하세요: SD카드에 복사 → FBI → SD → 파일 선택 → Install CIA", $"{done.Count} CIAs. Install with FBI: copy to the SD card → FBI → SD → pick the file → Install CIA"))
                + $"\n\n{outDir}";
            if (failed.Count > 0) msg += "\n\n" + Lang.L("실패:", "Failed:") + "\n" + string.Join("\n", failed);
            await ShowDialog(Lang.L("완료", "Done"), msg);
        }
        finally
        {
            Title = baseTitle;
            SetBusy(false);
        }
    }

    async Task BuildLauncherAsync()
    {
        SetBusy(true);
        try
        {
            string dir = OutDir();
            string cia = await Task.Run(() => new CiaBuilder(Log).BuildLauncher(dir));
            Log(Lang.L("FBI로 한 번만 설치하세요.", "Install it once with FBI."));
            await ShowDialog(Lang.L("완료", "Done"), cia);
        }
        catch (Exception ex)
        {
            Log(Lang.L("오류: ", "Error: ") + ex.Message);
            await ShowDialog(Lang.L("실패", "Failed"), ex.Message);
        }
        finally
        {
            SetBusy(false);
        }
    }

    async Task ShowDialog(string title, string message)
    {
        var ok = new Button { Content = "OK", HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Center, Padding = new Avalonia.Thickness(24, 4) };
        var dlg = new Window
        {
            Title = title,
            Width = 400,
            SizeToContent = SizeToContent.Height,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Content = new StackPanel
            {
                Margin = new Avalonia.Thickness(16),
                Spacing = 12,
                Children = { new TextBlock { Text = message, TextWrapping = Avalonia.Media.TextWrapping.Wrap }, ok },
            },
        };
        ok.Click += (_, _) => dlg.Close();
        await dlg.ShowDialog(this);
    }

    void Log(string s) => Dispatcher.UIThread.Post(() => LogBox.Text += s + "\n");
}
