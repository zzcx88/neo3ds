namespace Neo3dsConverter;

/// <summary>#313: one chosen file in the dialog's view: its label, size and transfer state.</summary>
public sealed record SendItem(string FullPath, string DisplayName, string FileName, long Length, SendState State);

/// <summary>
/// #313: everything both send windows draw, snapshotted atomically. Null QR means no server is
/// serving; a non-empty <see cref="Reason"/> means the selection was refused.
/// </summary>
public sealed record SendSnapshot(
    bool Empty,
    bool IsBatch,
    string? QrText,
    SendGuide Guide,
    string Reason,
    string? StartError,
    IReadOnlyList<SendItem> Items,
    long TotalLength,
    SendState Overall,
    int Sent);

/// <summary>
/// #313: the one Core owner of a send dialog's state. Both windows hand it the picked paths and
/// the chosen LAN address; it resolves the selection, prepares and starts the server, measures a
/// batch QR against the real port, and tracks per-file progress. The windows only render the
/// snapshot, on whatever thread the UI toolkit owns.
/// </summary>
public sealed class SendSession : IDisposable
{
    readonly object gate = new();
    IReadOnlyList<SessionCia> sessionCias;
    string? address;
    LanSender? sender;
    SendSelectionResult? selection;
    readonly Dictionary<string, SendState> states = new(StringComparer.OrdinalIgnoreCase);
    string? startError;
    bool closed;

    public SendSession(IReadOnlyList<SessionCia> session, string? address = null)
    {
        sessionCias = [.. session];
        this.address = address;
    }

    /// <summary>Raised when the snapshot changed; may arrive on a server worker thread.</summary>
    public event Action? Changed;

    /// <summary>The listening server, or null while refused, stopped or closed.</summary>
    public LanSender? Sender
    {
        get { lock (gate) return sender; }
    }

    /// <summary>The last resolved selection; null when nothing was chosen.</summary>
    public SendSelectionResult? Selection
    {
        get { lock (gate) return selection; }
    }

    /// <summary>The whole view, consistent for the moment it is read.</summary>
    public SendSnapshot Snapshot
    {
        get { lock (gate) return Build(); }
    }

    public void SetSelection(IReadOnlyList<string> paths)
    {
        lock (gate)
        {
            if (closed) return;
            StopServer();
            startError = null;
            states.Clear();
            selection = SendSelection.Resolve(paths, sessionCias);
            if (selection != null)
            {
                ResetProgress(selection);
                TryStart();
            }
        }
        Changed?.Invoke();
    }

    /// <summary>A new address means a new port and token, so a serving or refused-for-size
    /// selection restarts from an empty progress; anything else is left alone.</summary>
    public void SetAddress(string address)
    {
        lock (gate)
        {
            if (closed) return;
            this.address = address;
            if (NeedsRetry)
            {
                StopServer();
                startError = null;
                states.Clear();
                if (selection != null)
                {
                    ResetProgress(selection);
                    TryStart();
                }
            }
        }
        Changed?.Invoke();
    }

    /// <summary>A build while the dialog is open joins the session list without changing the QR.</summary>
    public void SetSessionCias(IReadOnlyList<SessionCia> cias)
    {
        lock (gate)
        {
            if (closed) return;
            sessionCias = [.. cias];
        }
        Changed?.Invoke();
    }

    /// <summary>The window could not make the QR image; stop serving and show why, like a failed start.</summary>
    public void ReportStartFailure(string message)
    {
        lock (gate)
        {
            if (closed) return;
            StopServer();
            startError = message;
        }
        Changed?.Invoke();
    }

    public void Dispose()
    {
        lock (gate)
        {
            if (closed) return;
            closed = true;
            StopServer();
        }
    }

    void ResetProgress(SendSelectionResult result)
    {
        foreach (var item in ItemsOf(result)) states[item.FullPath] = SendState.Waiting;
    }

    void StopServer()
    {
        sender?.Dispose();
        sender = null;
    }

    /// <summary>True while the selection is serving, was refused for QR size, or failed to start.</summary>
    bool NeedsRetry =>
        sender != null || startError != null ||
        selection is SendSelectionResult.Batch
        {
            Result: SendBatchResult.Refused { Refusal: BatchRefusal.QrTooLarge },
        };

    void TryStart()
    {
        try
        {
            switch (selection)
            {
                case SendSelectionResult.Single { Candidate: { Allowed: true } candidate }:
                {
                    var single = LanSender.Prepare(
                        [new LanFile(candidate.FullPath, candidate.FileName)], address);
                    single.Start();
                    sender = single;
                    Attach(single);
                    break;
                }
                case SendSelectionResult.Batch { Result: SendBatchResult.Ready { Batch: var batch } }:
                    StartBatchServer(batch);
                    break;
                // A batch refused only for QR size gets one more measure on the new address.
                case SendSelectionResult.Batch
                {
                    Result: SendBatchResult.Refused { Items: var items, Refusal: BatchRefusal.QrTooLarge },
                }:
                    if (SendBatch.Check(items) is SendBatchResult.Ready { Batch: var batchRetry })
                        StartBatchServer(batchRetry);
                    break;
            }
        }
        catch (Exception ex)
        {
            StopServer();
            startError = ex.Message;
        }
    }

    void StartBatchServer(SendBatch batch)
    {
        var prepared = LanSender.Prepare(batch.LanFiles(), address);
        if (batch.WithQr(prepared.Items.Select(i => i.Url).ToArray())
            is SendBatchResult.Refused refused)
        {
            prepared.Dispose();
            selection = new SendSelectionResult.Batch(refused);
            return;
        }
        prepared.Start();
        sender = prepared;
        selection = new SendSelectionResult.Batch(new SendBatchResult.Ready(batch));
        Attach(prepared);
    }

    void Attach(LanSender s)
    {
        s.ItemStarted += item => OnItem(s, item, SendState.Sending);
        s.ItemDownloaded += item => OnItem(s, item, SendState.Sent);
    }

    void OnItem(LanSender s, LanItem item, SendState state)
    {
        bool fire;
        lock (gate)
        {
            fire = ReferenceEquals(sender, s);
            if (fire) states[item.Path] = state;
        }
        if (fire) Changed?.Invoke();
    }

    SendSnapshot Build()
    {
        if (selection == null)
            return new SendSnapshot(true, false, null, SendGuide.Fbi, "", null, [], 0, SendState.Waiting, 0);

        var resolved = ItemsOf(selection);
        var items = resolved.Select(c => new SendItem(c.FullPath, c.DisplayName, c.FileName, c.Length,
            states.GetValueOrDefault(c.FullPath, SendState.Waiting))).ToArray();
        long total = 0;
        foreach (var item in items) total = checked(total + item.Length);
        var (overall, sent) = SendBatch.ProgressOf(items.Select(i => i.State).ToArray());
        bool isBatch = selection is SendSelectionResult.Batch;
        SendGuide guide = isBatch
            ? BatchKind(resolved) == SendKind.Launcher ? SendGuide.Launcher : SendGuide.Fbi
            : ((SendSelectionResult.Single)selection).Candidate.Guide;
        string reason = selection switch
        {
            SendSelectionResult.Single { Candidate: { Allowed: false } candidate } => candidate.Reason,
            SendSelectionResult.Batch { Result: SendBatchResult.Refused { Refusal: var refusal } } =>
                refusal.Reason,
            _ => "",
        };
        return new SendSnapshot(false, isBatch, sender?.QrText, guide, reason, startError,
            items, total, overall, sent);
    }

    static SendKind? BatchKind(IReadOnlyList<SendCandidate> resolved)
    {
        var kinds = resolved.Select(c => c.Kind).Distinct().ToArray();
        return kinds.Length == 1 ? kinds[0] : null;
    }

    static IReadOnlyList<SendCandidate> ItemsOf(SendSelectionResult selection) => selection switch
    {
        SendSelectionResult.Single single => [single.Candidate],
        SendSelectionResult.Batch { Result: SendBatchResult.Ready { Batch: var batch } } => batch.Items,
        SendSelectionResult.Batch { Result: SendBatchResult.Refused { Items: var items } } => items,
        _ => [],
    };
}
