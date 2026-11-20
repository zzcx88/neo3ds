using Xunit;

namespace Neo3dsConverter.Tests;

/// <summary>
/// #402: both GUI logs keep their lines here. The window appends one batch per timer tick and has
/// to know whether the text can be appended or must be replaced, because only a trimmed log needs
/// the whole text written again.
/// </summary>
public sealed class LogBufferTests
{
    static LogBuffer Buffer(string newLine = "\n") => new(newLine);

    static string[] Lines(string text, string newLine) => text.Split(newLine)[..^1]; // drop the empty tail after the last newline

    [Fact]
    public void OneDrainReturnsEverythingAddedSinceTheLastOne()
    {
        var log = Buffer();

        log.Add("first");
        log.Add("second");
        Assert.True(log.HasPending);
        var update = log.Drain();

        Assert.Equal(["first", "second"], update.Added);
        Assert.False(update.Rewrite);
        Assert.False(log.HasPending);
        Assert.Equal("first\nsecond\n", log.Text);
    }

    /// <summary>Acceptance 3: 5200 lines leave the cap plus one omission marker.</summary>
    [Fact]
    public void KeepsFiveThousandLinesAndOneOmissionMarker()
    {
        var log = Buffer();
        for (int i = 0; i < 5200; i++) log.Add($"line {i}");

        var update = log.Drain();
        string[] shown = Lines(log.Text, "\n");

        Assert.True(update.Rewrite);
        Assert.Equal(199, update.TopShift);
        Assert.Equal(LogBuffer.MaxLines + 1, log.Count);
        Assert.Equal(LogBuffer.MaxLines + 1, shown.Length);
        Assert.Equal(LogBuffer.Omission, shown[0]);
        Assert.Equal("line 200", shown[1]);
        Assert.Equal("line 5199", shown[^1]);
    }

    /// <summary>A batch over the cap is trimmed in the buffer, so the render never grows past it.</summary>
    [Fact]
    public void ABurstLargerThanTheCapKeepsOnlyTheNewestLines()
    {
        var log = Buffer();

        for (int i = 0; i < LogBuffer.MaxLines + 300; i++) log.Add($"line {i}");
        var update = log.Drain();

        Assert.Equal(299, update.TopShift);
        Assert.Equal($"line {LogBuffer.MaxLines + 299}", Lines(log.Text, "\n")[^1]);
    }

    /// <summary>The marker takes a slot once; later batches only drop the oldest real line.</summary>
    [Fact]
    public void TheMarkerAppearsOnlyOnce()
    {
        var log = Buffer();
        for (int i = 0; i < LogBuffer.MaxLines + 10; i++) log.Add($"line {i}");
        log.Drain();
        log.Add("after");
        var update = log.Drain();

        string[] shown = Lines(log.Text, "\n");
        Assert.True(update.Rewrite);
        Assert.Equal(1, update.TopShift);
        Assert.Equal(LogBuffer.MaxLines + 1, shown.Length);
        Assert.Single(shown, LogBuffer.Omission);
        Assert.Equal("after", shown[^1]);
    }

    /// <summary>Below the cap nothing is dropped, so the window can append a short batch.</summary>
    [Fact]
    public void UnderTheCapNothingIsDropped()
    {
        var log = Buffer();
        for (int i = 0; i < LogBuffer.MaxLines; i++) log.Add($"line {i}");
        var update = log.Drain();

        Assert.False(update.Rewrite);
        Assert.Equal(0, update.TopShift);
        Assert.Equal(LogBuffer.MaxLines, Lines(log.Text, "\n").Length);
    }

    [Fact]
    public void OneMoreLineOverTheCapStartsWithTheMarker()
    {
        var log = Buffer();
        for (int i = 0; i < LogBuffer.MaxLines; i++) log.Add($"line {i}");
        log.Drain();
        log.Add("over");
        var update = log.Drain();

        Assert.True(update.Rewrite);
        Assert.Equal(0, update.TopShift);
        Assert.Equal(LogBuffer.Omission, Lines(log.Text, "\n")[0]);
    }

    [Fact]
    public void AnEmptyDrainChangesNothing()
    {
        var log = Buffer();
        log.Add("kept");
        log.Drain();

        var update = log.Drain();

        Assert.True(update.Empty);
        Assert.Empty(update.Added);
        Assert.Equal("kept\n", log.Text);
    }

    /// <summary>The Windows window needs CRLF; the same batch text is built with its own newline.</summary>
    [Fact]
    public void BatchTextUsesTheBufferNewLine()
    {
        var log = Buffer("\r\n");
        log.Add("one");
        log.Add("two");
        var update = log.Drain();

        Assert.Equal("one\r\ntwo\r\n", log.Batch(update.Added));
        Assert.Equal("one\r\ntwo\r\n", log.Text);
    }

    /// <summary>Build callbacks and the window both add lines, so the buffer takes them from any thread.</summary>
    [Fact]
    public void LinesFromManyThreadsAllArrive()
    {
        var log = Buffer();
        var threads = Enumerable.Range(0, 4).Select(t => new Thread(() =>
        {
            for (int i = 0; i < 250; i++) log.Add($"t{t} {i}");
        })).ToArray();

        foreach (var thread in threads) thread.Start();
        foreach (var thread in threads) thread.Join();

        Assert.Equal(1000, log.Drain().Added.Count);
        Assert.Equal(1000, log.Count);
    }

    /// <summary>A raw exception in one Log() call is several shown lines, so the cap counts them.</summary>
    [Fact]
    public void AMultiLineEntryCountsAsTheLinesItShows()
    {
        var log = Buffer();
        log.Add("first");
        log.Add("boom\n   at Foo()\r\n   at Bar()");
        var update = log.Drain();

        Assert.Equal(4, log.Count);
        Assert.Equal("first\nboom\n   at Foo()\n   at Bar()\n", log.Text);
        Assert.Equal("first\nboom\n   at Foo()\n   at Bar()\n", log.Batch(update.Added));
    }

    /// <summary>The ticket fixes the batch window at 100ms.</summary>
    [Fact]
    public void FlushIntervalIsOneHundredMilliseconds() => Assert.Equal(100, LogBuffer.FlushMilliseconds);

    /// <summary>The marker is a user-visible line, so it is a KO/EN pair like every other message.</summary>
    [Fact]
    public void TheOmissionMarkerFollowsTheLanguage()
    {
        bool saved = Lang.Korean;
        try
        {
            Lang.Set(true, remember: false);
            Assert.Equal("…앞부분 생략", LogBuffer.Omission);
            Lang.Set(false, remember: false);
            Assert.Equal("…earlier lines omitted", LogBuffer.Omission);
        }
        finally { Lang.Set(saved, remember: false); }
    }
}
