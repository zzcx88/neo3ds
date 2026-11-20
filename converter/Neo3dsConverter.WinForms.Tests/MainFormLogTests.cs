using System.Runtime.ExceptionServices;
using Neo3dsConverter;
using Xunit;

namespace Neo3dsConverter.WinForms.Tests;

/// <summary>
/// #402: the Windows log shows its end while a build runs, keeps the reader's place when it does
/// not, and keeps 5000 lines with one omission line. These need the real edit control, so they only
/// run on Windows; elsewhere they are skipped and the shared cap/batch rules are pinned by the
/// Core LogBuffer tests.
/// </summary>
public sealed class MainFormLogTests
{
    /// <summary>Acceptance 3: 5200 lines leave the cap plus the omission marker as line 0.</summary>
    [Fact]
    public void Log_KeepsFiveThousandLinesAndOneOmissionMarker()
    {
        RunSta(form =>
        {
            for (int i = 0; i < 5200; i++) form.Log($"line {i}");
            form.FlushLog();

            string[] shown = ShownLines(form);
            Assert.Equal(LogBuffer.MaxLines + 1, shown.Length);
            Assert.Equal(LogBuffer.Omission, shown[0]);
            Assert.Equal("line 200", shown[1]);
            Assert.Equal("line 5199", shown[^1]);
        });
    }

    /// <summary>Acceptance 1: a reader who scrolled up returns to the end on the next build line.</summary>
    [Fact]
    public void DuringBuild_TheLogAlwaysShowsItsEnd()
    {
        RunSta(form =>
        {
            for (int i = 0; i < 400; i++) form.Log($"line {i}");
            form.FlushLog();
            form.SetBuilding(true);
            form.LogBox.SelectionStart = 0;
            form.LogBox.ScrollToCaret();
            Assert.False(ShowsEnd(form));

            form.Log("build progress");
            form.FlushLog();

            Assert.True(ShowsEnd(form));
            Assert.Contains("build progress", form.LogBox.Text);
        });
    }

    /// <summary>Acceptance 2: a send line after the build must not move the reader's scroll position.</summary>
    [Fact]
    public void AfterTheBuild_NewLinesDoNotMoveTheScrollPosition()
    {
        RunSta(form =>
        {
            for (int i = 0; i < 400; i++) form.Log($"line {i}");
            form.FlushLog();
            form.SetBuilding(false);
            form.LogBox.SelectionStart = 0;
            form.LogBox.ScrollToCaret();

            form.Log("send log line");
            form.FlushLog();

            Assert.Equal(0, FirstVisibleLine(form));
            Assert.Contains("send log line", form.LogBox.Text);
        });
    }

    /// <summary>Acceptance 4: a burst reaches the box in one batch after the 100ms window.</summary>
    [Fact]
    public void LogBatch_IsWrittenOnce_NotPerLine()
    {
        RunSta(form =>
        {
            form.FlushLog();
            int before = ShownLines(form).Length;

            for (int i = 0; i < 200; i++) form.Log($"burst {i}");

            Assert.Equal(before, ShownLines(form).Length);       // nothing written yet
            form.FlushLog();
            string[] shown = ShownLines(form);
            Assert.Equal(before + 200, shown.Length);
            Assert.Equal("burst 0", shown[^200]);
            Assert.Equal("burst 199", shown[^1]);
        });
    }

    /// <summary>The tick is the real path: a line reaches the box without the test flushing by hand.</summary>
    [Fact]
    public void TheTimerWritesTheBatch()
    {
        RunSta(form =>
        {
            form.Log("timer line");

            var sw = System.Diagnostics.Stopwatch.StartNew();
            while (sw.ElapsedMilliseconds < 3000 && !form.LogBox.Text.Contains("timer line"))
            {
                Application.DoEvents();
                Thread.Sleep(20);
            }

            Assert.Contains("timer line", form.LogBox.Text);
        });
    }

    static string[] ShownLines(MainForm form) =>
        form.LogBox.Text.Length == 0 ? [] : form.LogBox.Text.Split("\r\n")[..^1];

    static int FirstVisibleLine(MainForm form) =>
        (int)SendMessage(form.LogBox.Handle, 0xCE, 0, 0);

    /// <summary>True when the edit control draws the last character inside the box.</summary>
    static bool ShowsEnd(MainForm form)
    {
        var box = form.LogBox;
        var bottom = new Point(1, Math.Max(0, box.ClientSize.Height - 2));
        return box.GetCharIndexFromPosition(bottom) >= box.TextLength - 1;
    }

    [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Auto)]
    static extern IntPtr SendMessage(IntPtr hWnd, int msg, int wParam, int lParam);

    /// <summary>Runs the body on an STA thread with a shown window, and rethrows its failure here.</summary>
    static void RunSta(Action<MainForm> body)
    {
        if (!OperatingSystem.IsWindows()) Assert.Skip("WinForms needs Windows");
        Exception? error = null;
        var thread = new Thread(() =>
        {
            try
            {
                using var form = new MainForm();
                form.Show();
                body(form);
            }
            catch (Exception ex) { error = ex; }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        if (error != null) ExceptionDispatchInfo.Capture(error).Throw();
    }
}
