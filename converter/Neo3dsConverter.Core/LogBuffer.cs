namespace Neo3dsConverter;

/// <summary>#402: the batch a GUI log writes into its widget.</summary>
/// <param name="Added">Lines to append, in order.</param>
/// <param name="Rewrite">True when old lines were dropped: the widget then needs the whole text.</param>
/// <param name="TopShift">A line that was at index i before this update is at i - TopShift after
/// it. The widget uses this to keep a reader's line in place when the text is rewritten.</param>
public readonly record struct LogUpdate(IReadOnlyList<string> Added, bool Rewrite, int TopShift)
{
    /// <summary>Nothing was added since the last drain.</summary>
    public bool Empty => Added.Count == 0;
}

/// <summary>
/// #402: what both GUI logs keep behind the widget. Lines arrive from one or more threads, the
/// window writes them once per <see cref="FlushMilliseconds"/> batch, and older lines drop off at
/// <see cref="MaxLines"/> so a long batch session stays quick and the widget never has to lay out
/// more than that. Only a trimmed log needs the whole text written again.
/// </summary>
public sealed class LogBuffer
{
    /// <summary>Lines kept besides the omission marker; the issue fixes this at 5000.</summary>
    public const int MaxLines = 5000;

    /// <summary>The batch window; the issue fixes this at 100ms.</summary>
    public const int FlushMilliseconds = 100;

    /// <summary>Stands in for the lines dropped at the cap. A visible line, so it follows the language.</summary>
    public static string Omission => Lang.L("…앞부분 생략", "…earlier lines omitted");

    readonly object gate = new();
    readonly List<string> lines = new();
    readonly List<string> pending = new();
    readonly string newLine;
    /// <summary>The marker takes line 0, so it is inserted once and then left alone.</summary>
    bool marked;

    /// <param name="newLine">"\n" for Avalonia, "\r\n" for the WinForms text box.</param>
    public LogBuffer(string newLine = "\n") => this.newLine = newLine;

    /// <summary>Adds to the next batch; any thread may call this. One entry may be a whole raw
    /// exception, so it is split into the lines the widget will show.</summary>
    public void Add(string line)
    {
        string[] parts = line.Split('\n');
        lock (gate)
            foreach (string part in parts) pending.Add(TrimCarriageReturn(part));
    }

    static string TrimCarriageReturn(string line) => line.EndsWith('\r') ? line[..^1] : line;

    public bool HasPending
    {
        get { lock (gate) return pending.Count > 0; }
    }

    /// <summary>Lines currently kept, marker included.</summary>
    public int Count
    {
        get { lock (gate) return lines.Count; }
    }

    /// <summary>The whole log with a trailing newline: what a rewritten widget shows.</summary>
    public string Text
    {
        get
        {
            lock (gate)
            {
                if (lines.Count == 0) return "";
                return string.Join(newLine, lines) + newLine;
            }
        }
    }

    /// <summary>Takes the batch and trims the log; one call per flush.</summary>
    public LogUpdate Drain()
    {
        lock (gate)
        {
            if (pending.Count == 0) return new LogUpdate([], Rewrite: false, TopShift: 0);
            string[] added = pending.ToArray();
            pending.Clear();
            lines.AddRange(added);

            // A marked log keeps MaxLines real lines plus the marker; an unmarked one keeps
            // MaxLines and gains the marker in the slot the first dropped line leaves.
            int room = marked ? MaxLines + 1 : MaxLines;
            int over = lines.Count - room;
            if (over <= 0) return new LogUpdate(added, Rewrite: false, TopShift: 0);
            if (marked)
            {
                lines.RemoveRange(1, over);
                return new LogUpdate(added, Rewrite: true, TopShift: over);
            }
            lines.RemoveRange(0, over);
            marked = true;
            lines.Insert(0, Omission);
            return new LogUpdate(added, Rewrite: true, TopShift: over - 1);
        }
    }

    /// <summary>The text for one batch when the widget can append it.</summary>
    public string Batch(IReadOnlyList<string> added)
    {
        var text = new System.Text.StringBuilder();
        foreach (string line in added) text.Append(line).Append(newLine);
        return text.ToString();
    }
}
