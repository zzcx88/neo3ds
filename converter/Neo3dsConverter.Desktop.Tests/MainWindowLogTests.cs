using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Xunit;

namespace Neo3dsConverter.Desktop.Tests;

/// <summary>
/// #402: the log follows the end while a build runs, stays put once it is done, keeps 5000 lines
/// with one omission line, and reaches the box in 100ms batches instead of line by line.
/// </summary>
public class MainWindowLogTests
{
    /// <summary>A log long enough to scroll, so "the end" and "scrolled up" differ.</summary>
    static (MainWindow Window, TextBox Box, ScrollViewer Scroll) ScrolledLog(int lines = 400)
    {
        var window = new MainWindow();
        window.Show();
        var box = window.FindControl<TextBox>("LogBox")!;
        for (int i = 0; i < lines; i++) window.Log($"line {i}");
        window.FlushLog();
        Dispatcher.UIThread.RunJobs();
        var scroll = box.GetVisualDescendants().OfType<ScrollViewer>().First();
        return (window, box, scroll);
    }

    static void ScrollToTop(ScrollViewer scroll)
    {
        scroll.Offset = scroll.Offset.WithY(0);
        Dispatcher.UIThread.RunJobs();
    }

    /// <summary>Acceptance 4: a burst reaches the box in one write after the window, not per line.</summary>
    [AvaloniaFact]
    public void LogBatch_IsWrittenInOneWidgetUpdate()
    {
        var window = new MainWindow();
        window.Show();
        var box = window.FindControl<TextBox>("LogBox")!;
        window.FlushLog();
        string before = box.Text ?? "";
        int writes = 0;
        box.PropertyChanged += (_, e) => { if (e.Property == TextBox.TextProperty) writes++; };

        for (int i = 0; i < 200; i++) window.Log($"burst {i}");
        Assert.Equal(before, box.Text ?? "");                 // nothing written yet

        window.FlushLog();
        Assert.Equal(1, writes);                              // one update for the whole batch
        string[] lines = (box.Text ?? "").Split('\n')[..^1];
        Assert.Equal(before.Split('\n')[..^1].Length + 200, lines.Length);
        Assert.Equal("burst 0", lines[^200]);
        Assert.Equal("burst 199", lines[^1]);
        window.Close();
    }

    /// <summary>The timer is the real path: lines appear without the test flushing by hand.</summary>
    [AvaloniaFact]
    public async Task Log_ReachesTheBoxOnTheTimer()
    {
        var window = new MainWindow();
        window.Show();
        var box = window.FindControl<TextBox>("LogBox")!;

        window.Log("timer line");

        var sw = System.Diagnostics.Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < 3000 && !(box.Text ?? "").Contains("timer line"))
            await Task.Delay(20);

        Assert.Contains("timer line", box.Text);
        window.Close();
    }

    /// <summary>Acceptance 3: 5200 lines leave the cap plus the omission marker.</summary>
    [AvaloniaFact]
    public void Log_KeepsFiveThousandLinesAndOneOmissionMarker()
    {
        var (window, box, _) = ScrolledLog(lines: 0);

        for (int i = 0; i < 5200; i++) window.Log($"line {i}");
        window.FlushLog();
        Dispatcher.UIThread.RunJobs();

        string[] shown = (box.Text ?? "").Split('\n')[..^1];
        Assert.Equal(Neo3dsConverter.LogBuffer.MaxLines + 1, shown.Length);
        Assert.Equal(Neo3dsConverter.LogBuffer.Omission, shown[0]);
        Assert.Equal("line 200", shown[1]);
        Assert.Equal("line 5199", shown[^1]);
        window.Close();
    }

    /// <summary>Acceptance 1: while a build runs the log returns to the end even after scrolling up.</summary>
    [AvaloniaFact]
    public void DuringBuild_TheLogAlwaysShowsItsEnd()
    {
        var (window, _, scroll) = ScrolledLog();
        window.SetBusy(true);
        ScrollToTop(scroll);
        Assert.Equal(0, scroll.Offset.Y);

        window.Log("build progress");
        window.FlushLog();
        Dispatcher.UIThread.RunJobs();

        Assert.Contains("build progress", window.FindControl<TextBox>("LogBox")!.Text);
        Assert.Equal(scroll.ScrollBarMaximum.Y, scroll.Offset.Y, 3);
        window.SetBusy(false);
        window.Close();
    }

    /// <summary>Acceptance 2: after the build, new lines leave the reader's position alone.</summary>
    [AvaloniaFact]
    public void AfterTheBuild_NewLinesDoNotMoveTheScrollPosition()
    {
        var (window, box, scroll) = ScrolledLog();
        window.SetBusy(false);
        ScrollToTop(scroll);

        window.Log("send log line");
        window.FlushLog();
        Dispatcher.UIThread.RunJobs();

        Assert.Contains("send log line", box.Text);
        Assert.Equal(0, scroll.Offset.Y);
        window.Close();
    }

    /// <summary>A trimmed log rewrites the text, and the reader still sees the same line at the top.</summary>
    [AvaloniaFact]
    public void AfterTheBuild_ATrimmedLogKeepsTheLineTheReaderWasReading()
    {
        var (window, box, scroll) = ScrolledLog(lines: Neo3dsConverter.LogBuffer.MaxLines - 2);
        window.SetBusy(false);
        scroll.Offset = scroll.Offset.WithY(1200);
        Dispatcher.UIThread.RunJobs();
        string before = LineAtTop(box, scroll);

        for (int i = 0; i < 20; i++) window.Log($"over {i}");
        window.FlushLog();
        Dispatcher.UIThread.RunJobs();

        Assert.StartsWith("line ", before);
        Assert.Equal(before, LineAtTop(box, scroll));
        window.Close();
    }

    /// <summary>The text of the first line inside the visible part of the log.</summary>
    static string LineAtTop(TextBox box, ScrollViewer scroll)
    {
        var presenter = box.GetVisualDescendants()
            .OfType<Avalonia.Controls.Presenters.TextPresenter>().First();
        double y = scroll.Offset.Y, top = 0;
        foreach (var line in presenter.TextLayout!.TextLines)
        {
            if (top + line.Height > y)
            {
                int start = line.FirstTextSourceIndex;
                return (box.Text ?? "").Substring(start, line.Length).TrimEnd('\n');
            }
            top += line.Height;
        }
        return "";
    }

    /// <summary>The build's last lines are still shown at the end when the build finishes: ending the
    /// build writes the pending batch while it still follows, before the reader regains control.</summary>
    [AvaloniaFact]
    public void TheBuildsLastLinesAreWrittenBeforeFollowingStops()
    {
        var (window, box, scroll) = ScrolledLog();
        window.SetBusy(true);
        ScrollToTop(scroll);

        window.Log("finished: 150 built");
        window.SetBusy(false);
        Dispatcher.UIThread.RunJobs();

        Assert.Contains("finished: 150 built", box.Text);
        Assert.Equal(scroll.ScrollBarMaximum.Y, scroll.Offset.Y, 3);
        window.Close();
    }
}
