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
        OutDirBox.Text = DefaultOutDir();
        OpenButton.Click += OnOpenClicked;
        OutDirButton.Click += OnOutDirClicked;
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
    }

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

    void LoadRom(string path)
    {
        if (IsBios(path))
        {
            Log(Lang.L("neogeo.zip은 바이오스입니다. 게임 롬 zip을 선택하세요.", "neogeo.zip is the BIOS. Pick a game zip."));
            return;
        }
        batch.Clear();
        SetSingleFields(true);
        BuildButton.Content = Lang.L("CIA 만들기", "Build CIA");
        PackButton.Content = Lang.L("런처용 파일 만들기", "Launcher file");
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
        StatusText.Text = job.Game != null
            ? $"{job.RomName} — {job.Title} (Title ID {job.TitleId})"
            : $"{job.RomName}: {job.Problem}";
        SetBuildEnabled(Buildable(job));
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
        StatusText.Text = ok == batch.Count
            ? Lang.L($"✔ 모두 변환 가능 ({ok}개)", $"✔ all {ok} can be converted")
            : Lang.L($"변환 가능 {ok}개 / 불가 {batch.Count - ok}개 (로그 참고)", $"{ok} can be converted, {batch.Count - ok} can't (see the log)");
        BuildButton.Content = Lang.L($"CIA {ok}개 만들기", $"Build {ok} CIAs");
        PackButton.Content = Lang.L($"런처용 파일 {ok}개 만들기", $"{ok} launcher files");
        SetBuildEnabled(ok > 0);
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
        j.OutputDir = OutDir();
        SetBusy(true);
        var sw = Stopwatch.StartNew();
        try
        {
            string file = await Task.Run(() => pack ? new CiaBuilder(Log).BuildPack(j) : new CiaBuilder(Log).Build(j));
            Log(Lang.L($"완료 ({sw.ElapsedMilliseconds} ms): {file}", $"Done ({sw.ElapsedMilliseconds} ms): {file}"));
            await ShowDialog(Lang.L("완료", "Done"), file);
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
        var done = new List<string>();
        var failed = new List<string>();
        SetBusy(true);
        try
        {
            for (int i = 0; i < jobs.Count; i++)
            {
                var j = jobs[i];
                j.OutputDir = outDir;
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
                : Lang.L($"CIA {done.Count}개:", $"{done.Count} CIAs:")) + $"\n\n{outDir}";
            if (failed.Count > 0) msg += "\n\n" + Lang.L("실패:", "Failed:") + "\n" + string.Join("\n", failed);
            await ShowDialog(Lang.L("완료", "Done"), msg);
        }
        finally
        {
            SetBusy(false);
        }
    }

    async Task BuildLauncherAsync()
    {
        SetBusy(true);
        try
        {
            string cia = await Task.Run(() => new CiaBuilder(Log).BuildLauncher(OutDir()));
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
