using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform.Storage;
using Avalonia.Threading;

namespace Neo3dsConverter.Desktop;

/// <summary>
/// #255/#264: the one window for "send to 3DS". Session CIAs can be multi-selected, or several
/// files dropped/picked; the PC judgement decides the QR, the wording and the refusal. Closing it
/// stops the server.
/// </summary>
internal sealed class SendDialog : IDisposable
{
    static string EmptyHint => Lang.L("보낼 .cia 또는 .neo3ds 파일을 고르거나 끌어다 놓으세요.",
                                      "Pick a .cia or .neo3ds file, or drop one here.");

    readonly Window window;
    readonly ListBox targets;
    readonly ListBox batchList = new() { IsVisible = false, Height = 44 };
    readonly Image qr = new() { Stretch = Stretch.Uniform, HorizontalAlignment = HorizontalAlignment.Center };
    readonly TextBlock status = new() { TextWrapping = TextWrapping.Wrap, FontWeight = FontWeight.Bold };
    readonly TextBlock info = new() { TextWrapping = TextWrapping.Wrap };
    readonly TextBlock steps;
    readonly TextBlock notes;
    readonly TextBox url = new() { IsReadOnly = true, AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, MaxHeight = 100 };
    readonly ComboBox addressBox;
    readonly IReadOnlyList<LanAddress> addresses;
    readonly List<SessionCia> session;
    readonly Func<string, byte[]> qrPng;
    readonly Func<string, byte[]> batchQrPng;
    readonly Dictionary<string, SendState> batchStates = new(StringComparer.OrdinalIgnoreCase);
    SendCandidate? target;
    SendBatch? batch;
    LanSender? sender;
    bool syncing;

    public SendDialog(IReadOnlyList<SessionCia> session, IReadOnlyList<LanAddress> addresses)
        : this(session, addresses, QrCode.Png, QrCode.BatchPng) { }

    internal SendDialog(IReadOnlyList<SessionCia> session, IReadOnlyList<LanAddress> addresses,
        Func<string, byte[]> qrPng, Func<string, byte[]>? batchQrPng = null)
    {
        this.session = [.. session];
        this.addresses = addresses;
        this.qrPng = qrPng;
        this.batchQrPng = batchQrPng ?? QrCode.BatchPng;
        RenderOptions.SetBitmapInterpolationMode(qr, BitmapInterpolationMode.None);

        targets = new ListBox
        {
            SelectionMode = SelectionMode.Multiple,
            IsVisible = session.Count > 0,
            Height = Math.Min(120, Math.Max(44, session.Count * 30)),
        };
        RebuildSessionRows();
        var pick = new Button
        {
            Content = Lang.L("파일 선택", "Pick files"),
            Padding = new Avalonia.Thickness(16, 4),
        };
        pick.Click += async (_, _) => await PickFiles();
        var dropHint = new TextBlock
        {
            Text = Lang.L("여기에 .cia 또는 .neo3ds 파일을 여러 개 끌어다 놓아도 됩니다.",
                          "You can also drop several .cia or .neo3ds files here."),
            TextWrapping = TextWrapping.Wrap,
            VerticalAlignment = VerticalAlignment.Center,
        };
        addressBox = new ComboBox
        {
            ItemsSource = addresses.Select(a => a.ToString()).ToArray(),
            SelectedIndex = 0,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        var hint = new TextBlock
        {
            Text = Lang.L("3DS와 같은 공유기에 연결된 주소를 고르세요.", "Pick the address on the network the 3DS shares."),
            TextWrapping = TextWrapping.Wrap,
        };
        steps = new TextBlock { TextWrapping = TextWrapping.Wrap };
        notes = new TextBlock { TextWrapping = TextWrapping.Wrap };
        var close = new Button
        {
            Content = Lang.L("닫기", "Close"),
            HorizontalAlignment = HorizontalAlignment.Center,
            Padding = new Avalonia.Thickness(24, 4),
        };
        window = new Window
        {
            Title = Lang.L("3DS로 보내기", "Send to 3DS"),
            Width = 480,
            SizeToContent = SizeToContent.Height,
            CanResize = false,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Content = new StackPanel
            {
                Margin = new Avalonia.Thickness(16),
                Spacing = 10,
                Children =
                {
                    targets,
                    new StackPanel
                    {
                        Orientation = Orientation.Horizontal,
                        Spacing = 10,
                        Children = { pick, dropHint },
                    },
                    batchList,
                    qr,
                    status,
                    info,
                    addressBox,
                    hint,
                    url,
                    steps,
                    notes,
                    close,
                },
            },
        };
        DragDrop.SetAllowDrop(window, true);
        window.AddHandler(DragDrop.DropEvent, OnDrop);
        close.Click += (_, _) => window.Close();
        addressBox.SelectionChanged += (_, _) =>
        {
            if (addressBox.SelectedIndex < 0) return;
            if (batch is { Allowed: true }) ConnectBatch(addressBox.SelectedIndex);
            else if (batch is { Refusal: SendRefusal.QrTooLarge }) RetryBatch(addressBox.SelectedIndex);
            else if (target is { Allowed: true }) Connect(addressBox.SelectedIndex);
        };
        targets.SelectionChanged += (_, _) =>
        {
            if (syncing) return;
            var paths = SelectedPaths();
            if (paths.Count == 0) ClearAll();
            else if (paths.Count == 1) Choose(paths[0]);
            else ChooseMany(paths);
        };
        window.Closed += (_, _) => Stop();

        SetGuide(SendGuide.Fbi);
        if (session.Count > 0) Choose(session[0].Path);
        else status.Text = EmptyHint;
    }

    public Window Window => window;

    /// <summary>The running server, or null after a failed start, a refused file, or after the window closed.</summary>
    public LanSender? Sender => sender;

    public string? Url => sender?.Url;
    public string? QrText => sender?.QrText;

    internal string StatusText => status.Text ?? "";
    internal string InfoText => info.Text ?? "";
    internal string StepsText => steps.Text ?? "";
    internal string NotesText => notes.Text ?? "";
    internal int SelectedSession => targets.SelectedIndex;
    internal int SelectedCount => targets.SelectedItems?.Count ?? 0;
    internal int SessionCount => session.Count;
    internal void SelectAddress(int index) => addressBox.SelectedIndex = index;
    internal SendCandidate? Target => target;
    internal SendBatch? Batch => batch;
    internal string[] BatchRows => batchList.ItemsSource?.Cast<string>().ToArray() ?? [];

    /// <summary>#306: a CIA built while the window is open joins the list; the served batch keeps its QR.</summary>
    internal void RefreshSession(IReadOnlyList<SessionCia> cias)
    {
        var selected = batch?.Items.Select(i => i.FullPath).ToArray()
            ?? (target is { } t ? new[] { t.FullPath } : []);
        session.Clear();
        session.AddRange(cias);
        syncing = true;
        try
        {
            RebuildSessionRows();
            SetSelectionCore(selected);
        }
        finally
        {
            syncing = false;
        }
    }

    void RebuildSessionRows()
    {
        targets.ItemsSource = session.Select(c => SendSessionRow.From(c, session)).ToArray();
        targets.IsVisible = session.Count > 0;
        targets.Height = Math.Min(120, Math.Max(44, session.Count * 30));
    }

    IReadOnlyList<string> SelectedPaths()
    {
        var selected = targets.SelectedItems?.Cast<object>().OfType<SendSessionRow>().ToArray() ?? [];
        return selected.Select(r => r.Cia.Path).ToArray();
    }

    /// <summary>Highlights the paths that are session rows; a file from elsewhere clears the list.</summary>
    void SetSelection(IReadOnlyList<string> paths)
    {
        syncing = true;
        try { SetSelectionCore(paths); }
        finally { syncing = false; }
    }

    void SetSelectionCore(IReadOnlyList<string> paths)
    {
        var wanted = new HashSet<string>(paths.Select(SafeFullPath), StringComparer.OrdinalIgnoreCase);
        var rows = targets.ItemsSource?.OfType<SendSessionRow>() ?? [];
        var selected = rows.Where(r => wanted.Contains(SafeFullPath(r.Cia.Path))).Cast<object>().ToList();
        targets.SelectedItems = selected;
    }

    static string SafeFullPath(string path)
    {
        try { return Path.GetFullPath(path); }
        catch { return path; }
    }

    /// <summary>Judges <paramref name="path"/> and serves it when it can be sent; a refusal stops the server.</summary>
    internal void Choose(string path)
    {
        var candidate = SendCandidate.Resolve(path, session);
        if (candidate == null) return;
        target = candidate;
        batch = null;
        batchStates.Clear();
        HideBatchRows();
        SetSelection([candidate.FullPath]);
        SetGuide(candidate.Guide);
        if (!candidate.Allowed)
        {
            Stop();
            ClearQr();
            steps.Text = notes.Text = "";
            info.Text = candidate.DisplayName;
            url.Text = "";
            status.Text = candidate.Reason;
            return;
        }
        Connect(addressBox.SelectedIndex < 0 ? 0 : addressBox.SelectedIndex);
    }

    /// <summary>#264: judges and serves 2 to 6 files as one QR; a refusal starts no server.</summary>
    internal void ChooseMany(IReadOnlyList<string> paths)
    {
        var chosen = paths.Where(p => !string.IsNullOrWhiteSpace(p)).ToArray();
        if (chosen.Length == 0) { ClearAll(); return; }
        if (chosen.Length == 1) { Choose(chosen[0]); return; }

        var resolved = SendBatch.Resolve(chosen, session);
        if (resolved == null) { ClearAll(); return; }
        target = null;
        batch = resolved;
        batchStates.Clear();
        foreach (var item in resolved.Items) batchStates[item.FullPath] = SendState.Waiting;
        SetSelection(chosen);
        SetGuide(resolved.Guide, resolved.Items.Count);
        ShowBatchRows();
        info.Text = SendText.BatchInfo(resolved.Items.Count, resolved.TotalLength);
        if (!resolved.Allowed)
        {
            Stop();
            ClearQr();
            steps.Text = notes.Text = "";
            url.Text = "";
            status.Text = resolved.Reason;
            return;
        }
        ConnectBatch(addressBox.SelectedIndex < 0 ? 0 : addressBox.SelectedIndex);
    }

    async Task PickFiles()
    {
        var type = new FilePickerFileType(Lang.L(".cia · .neo3ds 파일", ".cia · .neo3ds file")) { Patterns = ["*.cia", "*.neo3ds"] };
        var files = await window.StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
        {
            Title = Lang.L("보낼 파일", "Files to send"),
            AllowMultiple = true,
            FileTypeFilter = [type],
        });
        var paths = files.Select(f => f.TryGetLocalPath()).OfType<string>().ToArray();
        if (paths.Length == 1) Choose(paths[0]);
        else if (paths.Length > 1) ChooseMany(paths);
    }

    void OnDrop(object? sender, DragEventArgs e)
    {
        var paths = e.DataTransfer.TryGetFiles()?.Select(f => f.TryGetLocalPath()).OfType<string>().ToArray()
            ?? [];
        if (paths.Length == 1) Choose(paths[0]);
        else if (paths.Length > 1) ChooseMany(paths);
    }

    void SetGuide(SendGuide guide, int count = 1)
    {
        steps.Text = count > 1 ? SendText.BatchSteps(guide, count) : SendText.Steps(guide);
        notes.Text = SendText.Notes(guide);
    }

    void Connect(int index)
    {
        Stop();
        if (target is not { Allowed: true } t || index < 0 || index >= addresses.Count) return;
        SendGuide guide = t.Guide;
        try
        {
            var s = LanSender.Start(t.FullPath, addresses[index].Address);
            sender = s;
            s.Started += () => Dispatcher.UIThread.Post(() =>
            {
                if (ReferenceEquals(sender, s)) status.Text = SendText.Status(SendState.Sending, guide);
            });
            s.Downloaded += () => Dispatcher.UIThread.Post(() =>
            {
                if (ReferenceEquals(sender, s)) status.Text = SendText.Status(SendState.Sent, guide);
            });
            ClearQr();
            var png = new Bitmap(new MemoryStream(qrPng(s.Url)));
            int scale = Math.Max(1, 240 / png.PixelSize.Width);
            qr.Source = png;
            qr.Width = png.PixelSize.Width * scale;
            qr.Height = png.PixelSize.Height * scale;
            url.Text = s.Url;
            info.Text = $"{s.FileName} · {SendText.Size(s.Length)}";
            status.Text = SendText.Status(SendState.Waiting, guide);
        }
        catch (Exception ex)
        {
            Stop();
            ClearQr();
            info.Text = url.Text = "";
            status.Text = Lang.L("전송 실패: ", "Send failed: ") + ex.Message;
        }
    }

    /// <summary>#264: one listener, one token, one QR. The capacity check uses the real port and token.</summary>
    void ConnectBatch(int index)
    {
        Stop();
        if (batch is not { Allowed: true } b || index < 0 || index >= addresses.Count) return;
        try
        {
            var files = b.Items.Select((item, i) => new LanFile(item.FullPath,
                b.Kind == SendKind.Cia ? i.ToString() : item.FileName)).ToArray();
            var s = LanSender.StartBatch(files, addresses[index].Address);
            sender = s;
            var sized = b.WithQr(s.Items.Select(i => i.Url).ToArray());
            batch = sized;
            if (!sized.Allowed)
            {
                s.Dispose();
                sender = null;
                ClearQr();
                steps.Text = notes.Text = "";
                url.Text = "";
                info.Text = SendText.BatchInfo(sized.Items.Count, sized.TotalLength);
                status.Text = sized.Reason;
                ShowBatchRows();
                return;
            }

            s.ItemStarted += item => OnBatchItem(s, item, SendState.Sending);
            s.ItemDownloaded += item => OnBatchItem(s, item, SendState.Sent);
            SetGuide(sized.Guide, sized.Items.Count);
            ClearQr();
            var png = new Bitmap(new MemoryStream(batchQrPng(s.QrText)));
            int scale = Math.Max(1, 240 / png.PixelSize.Width);
            qr.Source = png;
            qr.Width = png.PixelSize.Width * scale;
            qr.Height = png.PixelSize.Height * scale;
            url.Text = s.QrText;
            info.Text = SendText.BatchInfo(sized.Items.Count, sized.TotalLength);
            status.Text = SendText.BatchStatus(sized.Guide, SendState.Waiting, sized.Items.Count, 0);
            foreach (var item in sized.Items) batchStates[item.FullPath] = SendState.Waiting;
            ShowBatchRows();
        }
        catch (Exception ex)
        {
            Stop();
            ClearQr();
            info.Text = url.Text = "";
            status.Text = Lang.L("전송 실패: ", "Send failed: ") + ex.Message;
        }
    }

    /// <summary>#264: a new address changes the port, so a batch refused for size gets one more try.</summary>
    void RetryBatch(int index)
    {
        if (batch is not { Refusal: SendRefusal.QrTooLarge } b || index < 0 || index >= addresses.Count) return;
        batch = b with { Refusal = SendRefusal.None, AllowedCount = b.Items.Count, Reason = "" };
        ConnectBatch(index);
    }

    void OnBatchItem(LanSender s, LanItem item, SendState state)
    {
        Dispatcher.UIThread.Post(() =>
        {
            if (!ReferenceEquals(sender, s) || batch is not { } b) return;
            batchStates[item.Path] = state;
            int sent = b.Items.Count(i => batchStates.GetValueOrDefault(i.FullPath, SendState.Waiting) == SendState.Sent);
            bool active = b.Items.Any(i => batchStates.GetValueOrDefault(i.FullPath, SendState.Waiting) is SendState.Sending or SendState.Sent);
            SendState overall = sent == b.Items.Count ? SendState.Sent : active ? SendState.Sending : SendState.Waiting;
            status.Text = SendText.BatchStatus(b.Guide, overall, b.Items.Count, sent);
            ShowBatchRows();
        });
    }

    void ShowBatchRows()
    {
        if (batch is not { } b) { HideBatchRows(); return; }
        batchList.ItemsSource = b.Items.Select(i =>
            SendText.ItemLine(batchStates.GetValueOrDefault(i.FullPath, SendState.Waiting), i.DisplayName, i.Length)).ToArray();
        batchList.IsVisible = true;
        batchList.Height = Math.Min(150, Math.Max(44, b.Items.Count * 28));
    }

    void HideBatchRows()
    {
        batchList.ItemsSource = null;
        batchList.IsVisible = false;
    }

    void ClearAll()
    {
        Stop();
        ClearQr();
        target = null;
        batch = null;
        batchStates.Clear();
        HideBatchRows();
        info.Text = url.Text = steps.Text = notes.Text = "";
        status.Text = EmptyHint;
        SetSelection([]);
    }

    void ClearQr()
    {
        (qr.Source as IDisposable)?.Dispose();
        qr.Source = null;
    }

    void Stop()
    {
        sender?.Dispose();
        sender = null;
    }

    public void Dispose()
    {
        Stop();
        ClearQr();
    }
}
