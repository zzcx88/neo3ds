using System.Diagnostics;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Platform.Storage;
using Avalonia.Threading;

namespace Neo3dsConverter.Desktop;

/// <summary>P1a spike: single-flow window only. Not production (batch, pack, launcher, KO/EN toggle are P2).</summary>
public partial class MainWindow : Window
{
    CiaJob? job;
    readonly string defaultOutDir;

    public MainWindow()
    {
        InitializeComponent();
        defaultOutDir = Directory.Exists(Path.Combine(Home(), "Downloads"))
            ? Path.Combine(Home(), "Downloads") : Path.Combine(Home(), "Documents");
        Opened += (_, _) => Console.WriteLine($"startup: {StartupMs()} ms (Main -> Opened)");
        OpenButton.Click += OnOpenClicked;
        BuildButton.Click += OnBuildClicked;
        TitleBox.TextChanged += (_, _) => RefreshPreview();
        DragDrop.SetAllowDrop(DropZone, true);
        DropZone.AddHandler(DragDrop.DropEvent, OnDrop);
        static string Home() => Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    }

    static long StartupMs()
        => (long)Stopwatch.GetElapsedTime(Program.StartTicks).TotalMilliseconds;

    async void OnOpenClicked(object? sender, RoutedEventArgs e)
    {
        var type = new FilePickerFileType("ROM zip") { Patterns = ["*.zip"], AppleUniformTypeIdentifiers = ["public.zip-archive"] };
        var files = await StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
        {
            Title = Lang.L("롬 zip 선택", "Select a ROM zip"),
            AllowMultiple = false,
            FileTypeFilter = [type],
        });
        if (files.Count > 0) LoadRom(files[0].TryGetLocalPath()!);
    }

    async void OnDrop(object? sender, DragEventArgs e)
    {
        var files = e.DataTransfer.TryGetFiles()?.ToList();
        if (files?.Count > 0 && files[0].TryGetLocalPath() is string p) LoadRom(p);
        await Task.CompletedTask;
    }

    void LoadRom(string path)
    {
        try
        {
            job = CiaJob.FromRomZip(path);
        }
        catch (Exception ex)
        {
            StatusText.Text = $"오류: {ex.Message}";
            BuildButton.IsEnabled = false;
            return;
        }
        if (job.Problem != null)
        {
            StatusText.Text = $"{job.RomName}: {job.Problem}";
            BuildButton.IsEnabled = false;
            return;
        }
        StatusText.Text = $"{job.RomName} — {job.Title} (Title ID {job.TitleId})";
        TitleBox.Text = job.Title;
        BuildButton.IsEnabled = true;
        RefreshPreview();
    }

    void RefreshPreview()
    {
        if (job == null) return;
        string title = TitleBox.Text is { Length: > 0 } t ? t : job.Title;
        try
        {
            IconPreview.Source = new Avalonia.Media.Imaging.Bitmap(new MemoryStream(Art.Icon(title, null)));
            BannerPreview.Source = new Avalonia.Media.Imaging.Bitmap(new MemoryStream(Art.Banner(title, null)));
        }
        catch (Exception ex)
        {
            Log($"미리보기 실패: {ex.Message}");
        }
    }

    async void OnBuildClicked(object? sender, RoutedEventArgs e)
    {
        if (job == null) return;
        OpenButton.IsEnabled = BuildButton.IsEnabled = false;
        var j = job;
        j.Title = TitleBox.Text is { Length: > 0 } t ? t : j.Title;
        j.OutputDir = defaultOutDir;
        Directory.CreateDirectory(defaultOutDir);
        Log(Lang.L($"변환 시작: {j.RomName} → {defaultOutDir}", $"Building {j.RomName} → {defaultOutDir}"));
        var sw = Stopwatch.StartNew();
        try
        {
            string cia = await Task.Run(() => new CiaBuilder(Log).Build(j));
            Log(Lang.L($"완료: {cia} ({sw.ElapsedMilliseconds} ms)", $"Done: {cia} ({sw.ElapsedMilliseconds} ms)"));
        }
        catch (Exception ex)
        {
            Log($"실패: {ex.GetType().Name}: {ex.Message}");
        }
        finally
        {
            OpenButton.IsEnabled = BuildButton.IsEnabled = true;
        }
    }

    void Log(string s) => Dispatcher.UIThread.Post(() => LogBox.Text += s + "\n");
}
