using System.IO.Compression;
using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Xunit;

namespace Neo3dsConverter.Desktop.Tests;

/// <summary>#404: the output box follows the picked zips, and a batch's done window can open its folder.</summary>
public sealed class BatchFolderTests : IDisposable
{
    readonly string dir = Path.Combine(Path.GetTempPath(), "neo3ds-batch-ui-" + Guid.NewGuid().ToString("N"));

    public BatchFolderTests() => Directory.CreateDirectory(dir);

    public void Dispose()
    {
        try { Directory.Delete(dir, recursive: true); } catch (IOException) { }
    }

    string Zip(string folder, string name)
    {
        string path = Path.Combine(dir, folder, name);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        using (var zip = ZipFile.Open(path, ZipArchiveMode.Create)) zip.CreateEntry("x.bin");
        return path;
    }

    static void Pump(Func<bool> done, int timeoutMs = 5000)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < timeoutMs)
        {
            Dispatcher.UIThread.RunJobs();
            if (done()) return;
            Thread.Sleep(10);
        }
    }

    [AvaloniaTheory]
    [InlineData(false, ".cia")]
    [InlineData(true, ".neo3ds")]
    public void SameNamedInputsProduceTwoResultsInTheDoneFolder(bool pack, string extension)
    {
        var window = new MainWindow();
        window.OpenFolder = _ => { };
        window.CreateBatchJob = path => new CiaJob
        {
            RomZip = path, RomName = "mslug", Title = "Metal Slug",
            OutputDir = dir, BiosZip = Path.Combine(dir, "neogeo.zip"), Game = GameDb.Find("mslug")
        };
        window.BuildBatchJob = (job, isPack) =>
        {
            Assert.Equal(pack, isPack);
            string result = Path.Combine(job.OutputDir, job.OutputName + extension);
            File.WriteAllText(result, job.RomZip);
            return result;
        };
        window.Show();
        string first = Zip("one", "mslug.zip");
        string second = Zip("two", "mslug.zip");
        window.LoadRoms([first, second]);
        window.FindControl<TextBox>("OutDirBox")!.Text = dir;

        window.FindControl<Button>(pack ? "PackButton" : "BuildButton")!
            .RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
        Pump(() => window.LastDialog?.IsVisible == true);

        Assert.NotNull(window.LastDialog);
        string folder = Assert.Single(Directory.GetDirectories(dir), p => Path.GetFileName(p).StartsWith(OutputFolder.Prefix));
        Assert.Equal(first, File.ReadAllText(Path.Combine(folder, "mslug" + extension)));
        Assert.Equal(second, File.ReadAllText(Path.Combine(folder, "mslug-2" + extension)));
        Assert.Contains("2", window.LastDialog!.GetVisualDescendants().OfType<TextBlock>().Single(t => t.Name == "DialogText").Text);
        window.LastDialog.Close();
        window.Close();
    }

    [AvaloniaFact]
    public void PickingAZipPutsItsFolderInTheOutputBox()
    {
        var window = new MainWindow();
        window.Show();
        string zip = Zip("roms", "mslug.zip");

        window.LoadRoms([zip]);

        Assert.Equal(Path.Combine(dir, "roms"), window.FindControl<TextBox>("OutDirBox")!.Text);
        window.Close();
    }

    [AvaloniaFact]
    public void ABatchTakesTheFolderOfTheFirstZipByNameAndCountsAZipOnce()
    {
        var window = new MainWindow();
        window.Show();
        string later = Zip("z", "mslug2.zip");
        string first = Zip("a", "mslug.zip");

        window.LoadRoms([later, first, first]);

        Assert.Equal(Path.Combine(dir, "a"), window.FindControl<TextBox>("OutDirBox")!.Text);
        Assert.StartsWith("2", window.FindControl<TextBox>("RomPathBox")!.Text);
        window.Close();
    }

    [AvaloniaFact]
    public void TheDoneWindowOfABatchFolderOpensIt()
    {
        var window = new MainWindow();
        string? opened = null;
        window.OpenFolder = f => opened = f;
        window.Show();
        string folder = Path.Combine(dir, "neo3ds-batch-20261120-130509");

        var shown = window.ShowDialog("Done", "2 CIAs\n\n" + folder, folder);
        Pump(() => window.LastDialog?.IsVisible == true);
        var dlg = window.LastDialog!;
        Assert.Contains(folder, dlg.GetVisualDescendants().OfType<TextBlock>().Single(t => t.Name == "DialogText").Text);

        var open = dlg.GetVisualDescendants().OfType<Button>().Single(b => b.Name == "OpenFolderButton");
        open.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
        Assert.Equal(folder, opened);
        Assert.True(dlg.IsVisible); // [Open folder] leaves the window up

        dlg.GetVisualDescendants().OfType<Button>().Single(b => b.Name == "DialogOk").RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
        Pump(() => shown.IsCompleted);
        Assert.True(shown.IsCompleted);
        window.Close();
    }

    [AvaloniaFact]
    public void ADoneWindowWithoutAFolderHasNoOpenButton()
    {
        var window = new MainWindow();
        window.Show();

        var shown = window.ShowDialog("Done", "1 CIA");
        Pump(() => window.LastDialog?.IsVisible == true);
        var dlg = window.LastDialog!;

        Assert.DoesNotContain(dlg.GetVisualDescendants().OfType<Button>(), b => b.Name == "OpenFolderButton");
        dlg.Close();
        Pump(() => shown.IsCompleted);
        window.Close();
    }
}
