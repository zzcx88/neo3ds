using System.Diagnostics;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Platform.Storage;
using Avalonia.Threading;

namespace Neo3dsConverter.Desktop;

/// <summary>Single-flow window: one ROM zip -&gt; one CIA. Batch, pack, launcher, KO/EN toggle are P2b/P2c.</summary>
public partial class MainWindow : Window
{
    CiaJob? job;

    public MainWindow()
    {
        InitializeComponent();
        OutDirBox.Text = DefaultOutDir();
        OpenButton.Click += OnOpenClicked;
        OutDirButton.Click += OnOutDirClicked;
        BuildButton.Click += OnBuildClicked;
        TitleBox.TextChanged += (_, _) => RefreshPreview();
        DragDrop.SetAllowDrop(DropZone, true);
        DropZone.AddHandler(DragDrop.DropEvent, OnDrop);
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
            Title = Lang.L("롬 zip 선택", "Select a ROM zip"),
            AllowMultiple = false,
            FileTypeFilter = [type],
        });
        if (files.Count > 0 && files[0].TryGetLocalPath() is string p) LoadRom(p);
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

    void OnDrop(object? sender, DragEventArgs e)
    {
        var file = e.DataTransfer.TryGetFiles()?.FirstOrDefault();
        if (file?.TryGetLocalPath() is string p) LoadRom(p);
    }

    void LoadRom(string path)
    {
        try
        {
            job = CiaJob.FromRomZip(path);
        }
        catch (Exception ex)
        {
            StatusText.Text = Lang.L($"오류: {ex.Message}", $"Error: {ex.Message}");
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
        string title = string.IsNullOrEmpty(TitleBox.Text) ? job.Title : TitleBox.Text;
        try
        {
            IconPreview.Source = new Avalonia.Media.Imaging.Bitmap(new MemoryStream(Art.Icon(title, null)));
            BannerPreview.Source = new Avalonia.Media.Imaging.Bitmap(new MemoryStream(Art.Banner(title, null)));
        }
        catch (Exception ex)
        {
            Log(Lang.L($"미리보기 실패: {ex.Message}", $"Preview failed: {ex.Message}"));
        }
    }

    async void OnBuildClicked(object? sender, RoutedEventArgs e)
    {
        if (job == null) return;
        OpenButton.IsEnabled = OutDirButton.IsEnabled = BuildButton.IsEnabled = false;
        var j = job;
        j.Title = string.IsNullOrEmpty(TitleBox.Text) ? j.Title : TitleBox.Text;
        j.OutputDir = string.IsNullOrEmpty(OutDirBox.Text) ? DefaultOutDir() : OutDirBox.Text;
        Directory.CreateDirectory(j.OutputDir);
        Log(Lang.L($"변환 시작: {j.RomName} → {j.OutputDir}", $"Building {j.RomName} → {j.OutputDir}"));
        var sw = Stopwatch.StartNew();
        try
        {
            string cia = await Task.Run(() => new CiaBuilder(Log).Build(j));
            Log(Lang.L($"완료: {cia} ({sw.ElapsedMilliseconds} ms)", $"Done: {cia} ({sw.ElapsedMilliseconds} ms)"));
            await ShowDialog(Lang.L("완료", "Done"), cia);
        }
        catch (Exception ex)
        {
            Log(Lang.L($"실패: {ex.GetType().Name}: {ex.Message}", $"Failed: {ex.GetType().Name}: {ex.Message}"));
            await ShowDialog(Lang.L("실패", "Failed"), ex.Message);
        }
        finally
        {
            OpenButton.IsEnabled = OutDirButton.IsEnabled = BuildButton.IsEnabled = true;
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
