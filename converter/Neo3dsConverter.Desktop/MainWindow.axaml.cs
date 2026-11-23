using System.Diagnostics;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Platform.Storage;
using Avalonia.Threading;
using Avalonia.VisualTree;

namespace Neo3dsConverter.Desktop;

/// <summary>Single + batch window: one zip -&gt; one CIA, or several zips in a row. KO/EN toggle is P2c.</summary>
public partial class MainWindow : Window
{
    CiaJob? job;
    readonly List<CiaJob> batch = new();
    /// <summary>#255: CIAs built in this session, in build order; the dialog lists them first.</summary>
    readonly List<SessionCia> built = new();
    /// <summary>#306: the one send window, modeless so the converter stays usable while it serves.</summary>
    SendDialog? sendDialog;
    bool busy;
    /// <summary>#402: lines waiting for the next 100ms batch, and the log's kept lines.</summary>
    readonly LogBuffer logBuffer = new("\n");
    readonly DispatcherTimer logTimer;
    /// <summary>#402: the log follows its end only while a build runs; afterwards the reader scrolls freely.</summary>
    bool logFollowsEnd;


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
        SendButton.Click += async (_, _) => await SendAsync();
        IconPickButton.Click += async (_, _) => await PickImage(IconBox);
        BannerPickButton.Click += async (_, _) => await PickImage(BannerBox);
        IconClearButton.Click += (_, _) => { IconBox.Text = ""; RefreshPreview(); };
        BannerClearButton.Click += (_, _) => { BannerBox.Text = ""; RefreshPreview(); };
        TitleBox.TextChanged += (_, _) => RefreshPreview();
        DragDrop.SetAllowDrop(DropZone, true);
        DropZone.AddHandler(DragDrop.DropEvent, OnDrop);
        // #402: one write per 100ms keeps a 150-game batch off the UI thread's critical path.
        logTimer = new DispatcherTimer(TimeSpan.FromMilliseconds(LogBuffer.FlushMilliseconds),
            DispatcherPriority.Background, (_, _) => FlushLog());
        logTimer.Start();
        Closed += (_, _) =>
        {
            logTimer.Stop();
            sendDialog?.Window.Close();
        };
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
        SendButton.Content = Lang.L("3DS로 보내기 (QR)", "Send to 3DS (QR)");
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
        RomsetLabel.Text = job.Game != null ? $"✔ {job.Game.Name} - {job.Game.Desc}" : "✘ " + job.ProblemText;
        RomsetLabel.Foreground = job.Game != null ? Ok : Bad;
        BiosLabel.Text = job.BiosZip != null
            ? Lang.L("✔ neogeo.zip 발견", "✔ neogeo.zip found")
            : Lang.L("✘ neogeo.zip 없음 (롬과 같은 폴더에 넣어주세요)", "✘ no neogeo.zip (put it next to the game zip)");
        BiosLabel.Foreground = job.BiosZip != null ? Ok : Bad;
        // #329: a convertible game is named by its title; a blocked one by the plain verdict
        // only, because RomName is the user's zip file name.
        StatusText.Text = job.Game != null
            ? $"{job.RomName} — {job.Title} (Title ID {job.TitleId})"
            : job.ProblemText;
        SetBuildLabels();
    }

    /// <summary>#116: batch progress shown in the window title.</summary>
    internal static string ProgressTitle(int index, int count, string rom, string baseTitle)
        => $"[{index}/{count}] {rom} - {baseTitle}";

    /// <summary>#115: what to do with the file we just built.</summary>
    internal static string DoneMessage(bool pack, string file) => (pack
        ? Lang.L("런처용 파일을 만들었습니다. SD카드의 /neo3ds/games/ 폴더에 복사하세요 (런처 CIA가 설치돼 있어야 합니다).",
                 "The launcher file is ready. Copy it to /neo3ds/games/ on the SD card (the launcher CIA must be installed).")
        : Lang.L("CIA를 만들었습니다. [3DS로 보내기]로 바로 설치하거나, SD카드에 복사해 FBI로 설치하세요.",
                 "The CIA is ready. Use [Send to 3DS], or copy it to the SD card and install it with FBI."))
        + $"\n\n{file}";

    bool? SelectedMvs => SystemBox.SelectedIndex switch { 1 => false, 2 => true, _ => null };
    Region SelectedRegion => RegionBox.SelectedIndex switch { 1 => Region.Japan, 2 => Region.Usa, _ => Region.Europe };

    /// <summary>#404: until a zip is picked, and for the launcher CIA.</summary>
    static string DefaultOutDir() => OutputFolder.DefaultDir();

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

    /// <summary>#329: the log keeps the raw verdict next to the plain line, so a report can be
    /// reproduced while the window itself only shows the plain pair.</summary>
    void LogCannotConvert(CiaJob job) => Log(job.Failure == null
        ? Lang.L("변환 불가: ", "Can't convert: ") + Lang.L("neogeo.zip 없음", "no neogeo.zip")
        : Lang.L("변환 불가: ", "Can't convert: ") + FailureText.LogLines(job.Failure));

    string? IconImage => string.IsNullOrEmpty(IconBox.Text) ? null : IconBox.Text;
    string? BannerImage => string.IsNullOrEmpty(BannerBox.Text) ? null : BannerBox.Text;
    string CurrentTitle => string.IsNullOrWhiteSpace(TitleBox.Text) ? job?.Title ?? "" : TitleBox.Text.Trim();

    internal void LoadRoms(string[] zips)
    {
        // #404: the same zip picked twice converts once.
        var games = OutputFolder.Distinct(zips.Where(z => !IsBios(z))).OrderBy(Path.GetFileName, StringComparer.OrdinalIgnoreCase).ToArray();
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
            // #329: the status line carries the plain pair; the raw text only reaches the log.
            Log(Lang.L("오류: ", "Error: ") + FailureText.LogLines(ex));
            StatusText.Text = FailureText.Plain(ex);
            SetBuildEnabled(false);
            return;
        }
        TitleBox.Text = job.Title;
        OutDirBox.Text = job.OutputDir; // #404: results go next to the zip on every OS
        SetBuildEnabled(Buildable(job));
        RefreshState();
        Log(Lang.L("선택: ", "Selected: ") + $"{Path.GetFileName(path)}  (Title ID {job.TitleId})");
        if (!Buildable(job)) LogCannotConvert(job);
        RefreshPreview();
    }

    internal Func<string, CiaJob> CreateBatchJob { get; set; } = path => CiaJob.FromRomZip(path);
    internal Func<CiaJob, bool, string>? BuildBatchJob { get; set; }

    void LoadBatch(string[] zips)
    {
        job = null;
        batch.Clear();
        Log("");
        foreach (var zip in zips)
        {
            var j = CreateBatchJob(zip);
            batch.Add(j);
            if (j.Game == null) Log($"  ✘ {j.ProblemText}" + (j.Failure != null ? $" ({FailureText.Raw(j.Failure)})" : ""));
            else if (j.BiosZip == null) Log($"  ✘ {j.RomName}: " + Lang.L("같은 폴더에 neogeo.zip 없음", "no neogeo.zip in the same folder"));
            else Log($"  ✔ {j.RomName}: {j.Title}");
        }
        int ok = batch.Count(Buildable);
        OutDirBox.Text = batch[0].OutputDir; // #404: the folder of the first zip by name
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
            Log(Lang.L("이미지를 읽을 수 없습니다: ", "Can't read the picture: ") + FailureText.LogLines(ex));
        }
    }

    string OutDir()
    {
        string dir = string.IsNullOrEmpty(OutDirBox.Text) ? DefaultOutDir() : OutDirBox.Text;
        Directory.CreateDirectory(dir);
        return dir;
    }

    /// <summary>Build work in progress: controls off, wait cursor, and (#402) the log follows its end.</summary>
    internal void SetBusy(bool on)
    {
        // #402: the log only follows its end while build work runs. On the way out, the lines of
        // the last batch are written first so the finished log still shows its end.
        if (!on) FlushLog();
        logFollowsEnd = on;
        busy = on;
        Cursor = on ? new Cursor(StandardCursorType.Wait) : null;
        OpenButton.IsEnabled = OutDirButton.IsEnabled = LauncherButton.IsEnabled = !on;
        RefreshSendButton();
        if (!on) SetBuildEnabled(batch.Count > 0 ? batch.Any(Buildable) : job != null && Buildable(job));
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
            if (!pack) AddBuilt(file, launcher: false);
            Log(Lang.L($"완료 ({sw.ElapsedMilliseconds} ms): {file}", $"Done ({sw.ElapsedMilliseconds} ms): {file}"));
            await ShowDialog(Lang.L("완료", "Done"), DoneMessage(pack, file));
        }
        catch (Exception ex)
        {
            Log(Lang.L("실패: ", "Failed: ") + FailureText.LogLines(ex));
            await ShowDialog(Lang.L("실패", "Failed"), FailureText.Plain(ex));
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
        var files = new List<string>();
        var failed = new List<FailureText.BatchFailure>();
        var reservedNames = new HashSet<string>(OperatingSystem.IsLinux() ? StringComparer.Ordinal : StringComparer.OrdinalIgnoreCase);
        string extension = pack ? ".neo3ds" : ".cia";
        SetBusy(true);
        using var spare = ParallelLimit.ForBatch(); // #403: one core stays with the window
        try
        {
            for (int i = 0; i < jobs.Count; i++)
            {
                var j = jobs[i];
                j.StartMvs = SelectedMvs;
                j.Region = SelectedRegion;
                j.OutputDir = outDir;
                j.OutputName = OutputFolder.ReserveBatchOutputName(j, outDir, extension, reservedNames);
                Title = ProgressTitle(i + 1, jobs.Count, j.RomName, baseTitle);
                Log("");
                Log($"[{i + 1}/{jobs.Count}] {j.RomName} - {j.Title}");
                bool completed = false;
                try
                {
                    string file = await Task.Run(() => BuildBatchJob != null
                        ? BuildBatchJob(j, pack)
                        : pack ? new CiaBuilder(Log).BuildPack(j) : new CiaBuilder(Log).Build(j));
                    completed = true;
                    if (!pack) AddBuilt(file, launcher: false);
                    files.Add(file);
                    done.Add(j.RomName);
                }
                catch (Exception ex)
                {
                    if (!completed && j.OutputName != null) reservedNames.Remove(j.OutputName);
                    // #329: the row keeps the catalog name and code; the raw line is the log's.
                    Log(Lang.L("오류: ", "Error: ") + FailureText.LogLines(ex));
                    failed.Add(FailureText.BatchFailure.Of(j, ex));
                }
            }
            // #404: two or more results go into one batch folder under the output folder.
            var gathered = OutputFolder.Gather(outDir, files, DateTime.Now);
            if (!pack) foreach (var file in gathered.Paths) AddBuilt(file, launcher: false); // the moved CIAs stay sendable
            Log("");
            Log(Lang.L($"끝: 성공 {done.Count}개, 실패 {failed.Count}개", $"Finished: {done.Count} built, {failed.Count} failed"));
            if (gathered.Folder != null) Log(Lang.L("묶음 폴더: ", "Batch folder: ") + gathered.Folder);
            if (gathered.Warning != null) Log(gathered.Warning);
            string msg = (pack
                ? Lang.L($"런처용 파일 {done.Count}개: SD카드 /neo3ds/games/에 복사하세요.", $"{done.Count} launcher files: copy to /neo3ds/games/ on the SD card.")
                : Lang.L($"CIA {done.Count}개. [3DS로 보내기]로 바로 설치하거나, SD카드에 복사해 FBI로 설치하세요.", $"{done.Count} CIAs. Use [Send to 3DS], or copy them to the SD card and install with FBI."))
                + $"\n\n{gathered.Folder ?? outDir}";
            if (gathered.Warning != null) msg += "\n\n" + gathered.Warning;
            // #329: catalog names and plain words only; the per-game raw text is in the log.
            if (failed.Count > 0) msg += "\n\n" + FailureText.Batch(failed);
            if (gathered.Folder != null) OpenFolder(gathered.Folder);
            await ShowDialog(Lang.L("완료", "Done"), msg, gathered.Folder);
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
            AddBuilt(cia, launcher: true);
            Log(Lang.L("FBI로 한 번만 설치하세요.", "Install it once with FBI."));
            await ShowDialog(Lang.L("완료", "Done"), cia);
        }
        catch (Exception ex)
        {
            Log(Lang.L("오류: ", "Error: ") + FailureText.LogLines(ex));
            await ShowDialog(Lang.L("실패", "Failed"), FailureText.Plain(ex));
        }
        finally
        {
            SetBusy(false);
        }
    }

    /// <summary>#255: CIAs built this session that still exist; deleted files drop out of the list.</summary>
    internal IReadOnlyList<SessionCia> SendTargets()
    {
        built.RemoveAll(b => !File.Exists(b.Path));
        return built;
    }

    /// <summary>#255: remembers a successful build. Launcher CIAs are included; .neo3ds files never are.</summary>
    internal void AddBuilt(string path, bool launcher)
    {
        if (!path.EndsWith(".cia", StringComparison.OrdinalIgnoreCase) || !File.Exists(path)) return;
        built.RemoveAll(b => string.Equals(b.Path, path, StringComparison.OrdinalIgnoreCase));
        built.Add(new SessionCia(Path.GetFullPath(path), launcher));
        RefreshSendButton();
        sendDialog?.RefreshSession(SendTargets());
    }

    /// <summary>#255: the dialog can be opened before anything is built, so it is only off while busy.</summary>
    void RefreshSendButton() => SendButton.IsEnabled = !busy;

    /// <summary>#255: one window for the session's CIAs and a dropped or picked file.</summary>
    async Task SendAsync()
    {
        var addresses = LanSender.LanAddresses();
        if (addresses.Count == 0)
        {
            await ShowDialog(Lang.L("3DS로 보내기", "Send to 3DS"),
                Lang.L("같은 네트워크에 연결된 LAN 주소를 찾지 못했습니다. PC와 3DS를 같은 공유기에 연결하세요.",
                       "No LAN address found. Connect the PC and the 3DS to the same router."));
            return;
        }

        OpenSendDialog(addresses);
    }

    /// <summary>#306: one modeless window; pressing the button again brings it forward instead of stacking servers.</summary>
    internal SendDialog OpenSendDialog(IReadOnlyList<LanAddress> addresses)
    {
        if (sendDialog != null)
        {
            sendDialog.Window.Activate();
            return sendDialog;
        }

        var dialog = new SendDialog(SendTargets(), addresses);
        sendDialog = dialog;
        dialog.Window.Closed += (_, _) =>
        {
            sendDialog = null;
            dialog.Dispose();
            Log(Lang.L("3DS 전송을 마쳤습니다.", "Stopped sending to the 3DS."));
        };
        dialog.Window.Show(this);
        return dialog;
    }

    /// <summary>#404: opens a batch folder in Finder, Explorer or the file manager. A test replaces
    /// it so a headless run does not start a file manager.</summary>
    internal Action<string> OpenFolder { get; set; } = OutputFolder.Open;

    /// <summary>#404: the window the next <see cref="ShowDialog"/> opens, for a test to read and close.</summary>
    internal Window? LastDialog { get; private set; }

    /// <param name="folder">#404: a batch folder; the window then also has [Open folder].</param>
    internal async Task ShowDialog(string title, string message, string? folder = null)
    {
        var ok = new Button { Name = "DialogOk", Content = "OK", Padding = new Avalonia.Thickness(24, 4) };
        var buttons = new StackPanel
        {
            Orientation = Avalonia.Layout.Orientation.Horizontal,
            HorizontalAlignment = Avalonia.Layout.HorizontalAlignment.Center,
            Spacing = 8,
        };
        if (folder != null)
        {
            var open = new Button { Name = "OpenFolderButton", Content = Lang.L("폴더 열기", "Open folder"), Padding = new Avalonia.Thickness(16, 4) };
            open.Click += (_, _) => OpenFolder(folder);
            buttons.Children.Add(open);
        }
        buttons.Children.Add(ok);
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
                Children = { new TextBlock { Name = "DialogText", Text = message, TextWrapping = Avalonia.Media.TextWrapping.Wrap }, buttons },
            },
        };
        ok.Click += (_, _) => dlg.Close();
        LastDialog = dlg;
        await dlg.ShowDialog(this);
    }

    internal void Log(string s)
    {
        logBuffer.Add(s);
    }

    /// <summary>#402: writes the lines collected since the last batch. The timer calls this every
    /// 100ms; a test calls it directly. One write per batch keeps a long batch off the UI thread.</summary>
    internal void FlushLog()
    {
        var update = logBuffer.Drain();
        if (update.Empty) return;

        // Read before the text changes. Appending leaves a scrolled-up reader alone, but a trim
        // rewrites the whole text, which moves every line up by TopShift.
        int? top = !logFollowsEnd && update.Rewrite ? TopLine() : null;

        if (update.Rewrite) LogBox.Text = logBuffer.Text;
        else LogBox.Text += logBuffer.Batch(update.Added);

        if (logFollowsEnd) FollowLogEnd();
        else if (top is int line) ScrollLineToTop(Math.Max(0, line - update.TopShift));
    }

    /// <summary>#402: the log line at the top of the visible box (0 is the first line).</summary>
    int? TopLine()
    {
        if (LogScroll is not { } scroll || LogPresenter?.TextLayout is not { } layout) return null;
        double y = scroll.Offset.Y, top = 0;
        foreach (var textLine in layout.TextLines)
        {
            if (top + textLine.Height > y)
            {
                string text = LogBox.Text ?? "";
                int index = Math.Min(textLine.FirstTextSourceIndex, text.Length);
                return text[..index].Count(c => c == '\n');
            }
            top += textLine.Height;
        }
        return null;
    }

    /// <summary>#402: scrolls one log line back to the top, wrapped lines included.</summary>
    void ScrollLineToTop(int line)
    {
        if (LogScroll is not { } scroll) return;
        LogBox.UpdateLayout();
        if (LogPresenter?.TextLayout is not { } layout) return;
        string text = LogBox.Text ?? "";
        int start = 0;
        for (int i = 0; i < line; i++)
        {
            int next = text.IndexOf('\n', start);
            if (next < 0) break;
            start = next + 1;
        }
        double top = 0;
        foreach (var textLine in layout.TextLines)
        {
            if (textLine.FirstTextSourceIndex + textLine.Length > start)
            {
                scroll.Offset = scroll.Offset.WithY(top);
                return;
            }
            top += textLine.Height;
        }
    }

    /// <summary>#402: the log's text layout, which maps pixels to the lines a reader sees.</summary>
    Avalonia.Controls.Presenters.TextPresenter? LogPresenter =>
        LogBox.GetVisualDescendants().OfType<Avalonia.Controls.Presenters.TextPresenter>().FirstOrDefault();

    /// <summary>#402: the log's own scroll viewer, or null before the window is laid out.</summary>
    ScrollViewer? LogScroll => LogBox.GetVisualDescendants().OfType<ScrollViewer>().FirstOrDefault();

    /// <summary>#402: puts the last line in view after the new text has been laid out.</summary>
    void FollowLogEnd()
    {
        if (LogScroll is not { } scroll) return;
        LogBox.UpdateLayout();
        scroll.Offset = scroll.Offset.WithY(scroll.ScrollBarMaximum.Y);
    }
}
