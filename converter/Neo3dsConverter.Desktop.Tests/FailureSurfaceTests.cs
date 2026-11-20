using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Threading;
using Xunit;
using static Neo3dsConverter.FailureText;

namespace Neo3dsConverter.Desktop.Tests;

/// <summary>
/// #329: the window's reader-facing lines carry the plain cause+action pair; the raw
/// exception stays in the log. These tests pin which of the two each surface gets.
/// </summary>
public class FailureSurfaceTests
{
    /// <summary>A zip whose name is not a romset: the window line must not repeat the name.</summary>
    [AvaloniaFact]
    public void RomStateLine_ShowsPlainText_NotTheRawDetail()
    {
        bool saved = Lang.Korean;
        string tmp = Path.Combine(Path.GetTempPath(), "neo3ds-surface-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);
        try
        {
            Lang.Set(false, remember: false);
            string zip = Path.Combine(tmp, "My Game (1).zip");
            using (var z = System.IO.Compression.ZipFile.Open(zip, System.IO.Compression.ZipArchiveMode.Create))
                z.CreateEntry("readme.txt");

            var window = new MainWindow();
            window.Show();
            window.LoadRom(zip);
            // #402: the log is written in 100ms batches, so the test asks for the pending batch.
            window.FlushLog();
            Dispatcher.UIThread.RunJobs();

            string status = window.FindControl<TextBlock>("StatusText")!.Text ?? "";
            string romset = window.FindControl<TextBlock>("RomsetLabel")!.Text ?? "";
            string log = window.FindControl<TextBox>("LogBox")!.Text ?? "";

            // The reader-facing lines never carry the user's file name — in any casing, since
            // the window lowercases the basename into RomName.
            Assert.DoesNotContain("my game", status, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("my game", romset, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain(".zip", status);
            Assert.Contains("MAME", status);
            // The log keeps the raw verdict, so a report can reproduce it.
            Assert.Contains("notromset", log);

            window.Close();
        }
        finally
        {
            Lang.Set(saved, remember: false);
            try { Directory.Delete(tmp, recursive: true); } catch { /* best effort */ }
        }
    }

    /// <summary>The batch summary entry names the catalog romset, never the zip.</summary>
    [Fact]
    public void FailureSet_UsesTheCatalogNameOnly()
    {
        bool saved = Lang.Korean;
        try
        {
            Lang.Set(false, remember: false);
            var job = new CiaJob
            {
                RomZip = "/tmp/My Game (1).zip",
                RomName = "my game (1)",
                Title = "My Game",
                OutputDir = "/tmp",
                Game = GameDb.Find("mslug"),
                Failure = new ConverterException(FailureKind.Missing, "raw") { Set = "mslug" },
            };
            Assert.Equal("mslug", job.FailureSet(new Exception("boom")));

            // With no game picked the job's own verdict is the only catalog name there is.
            var blocked = new CiaJob
            {
                RomZip = "/tmp/fatfury2.zip",
                RomName = "fatfury2",
                Title = "Fatal Fury 2",
                OutputDir = "/tmp",
                Failure = new ConverterException(FailureKind.Unsupported, "raw") { Set = "fatfury2" },
            };
            Assert.Equal("fatfury2", blocked.FailureSet(new Exception("boom")));

            // An uncoded failure has no catalog name at all; the summary must not invent one.
            var anonymous = new CiaJob
            {
                RomZip = "/tmp/unknown.zip", RomName = "unknown", Title = "?", OutputDir = "/tmp",
            };
            Assert.Null(anonymous.FailureSet(new InvalidOperationException("boom")));
        }
        finally { Lang.Set(saved, remember: false); }
    }

    /// <summary>The batch dialog body is the shared `FailureText.Batch`, so its words and cap
    /// are the Core contract's, not this window's.</summary>
    [Fact]
    public void BatchSummary_IsTheSharedPlainText()
    {
        bool saved = Lang.Korean;
        try
        {
            Lang.Set(false, remember: false);
            var items = new List<BatchFailure>
            {
                new("kof98h", FailureKind.Missing),
                new(null, FailureKind.Zip),
                new("mslug", FailureKind.Bios),
                new("svc", FailureKind.Oom),
            };
            string text = Batch(items);
            Assert.Contains("4 failed", text);
            Assert.Contains("1 more", text);
            Assert.Contains("kof98h", text);
            Assert.DoesNotContain("svc", text); // capped at three
            Assert.DoesNotContain("raw", text);
        }
        finally { Lang.Set(saved, remember: false); }
    }
}
