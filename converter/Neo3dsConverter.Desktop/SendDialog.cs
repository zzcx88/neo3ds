using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform.Storage;
using Avalonia.Threading;

namespace Neo3dsConverter.Desktop;

/// <summary>
/// #255/#264/#313: the one window for "send to 3DS". Session CIAs can be multi-selected, or several
/// files dropped/picked; the shared <see cref="SendSession"/> decides the QR, the wording and the
/// refusal, and this window only draws what it is told. Closing it stops the server.
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
    readonly SendSession send;
    readonly Func<string, byte[]> qrPng;
    readonly Func<string, byte[]> batchQrPng;
    string? shownQr;
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
        send = new SendSession(session, addresses.Count > 0 ? addresses[0].Address : null);
        send.Changed += () => Dispatcher.UIThread.Post(ApplySnapshot);
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
            if (addressBox.SelectedIndex < 0 || addressBox.SelectedIndex >= addresses.Count) return;
            send.SetAddress(addresses[addressBox.SelectedIndex].Address);
            ApplySnapshot();
        };
        targets.SelectionChanged += (_, _) =>
        {
            if (!syncing) Select(SelectedPaths());
        };
        window.Closed += (_, _) => send.Dispose();

        if (session.Count > 0) Select([session[0].Path]);
        else ApplySnapshot();
    }

    public Window Window => window;

    /// <summary>The running server, or null after a failed start, a refused file, or after the window closed.</summary>
    public LanSender? Sender => send.Sender;

    /// <summary>The first served URL; the whole list is <see cref="QrText"/>.</summary>
    public string? Url => send.Sender?.Items[0].Url;
    public string? QrText => send.Snapshot.QrText;

    internal string StatusText => status.Text ?? "";
    internal string InfoText => info.Text ?? "";
    internal string StepsText => steps.Text ?? "";
    internal string NotesText => notes.Text ?? "";
    internal int SelectedSession => targets.SelectedIndex;
    internal int SelectedCount => targets.SelectedItems?.Count ?? 0;
    internal int SessionCount => session.Count;
    internal void SelectAddress(int index) => addressBox.SelectedIndex = index;
    internal SendCandidate? Target => (send.Selection as SendSelectionResult.Single)?.Candidate;
    internal SendBatchResult? BatchResult =>
        (send.Selection as SendSelectionResult.Batch)?.Result;
    internal string[] BatchRows => batchList.ItemsSource?.Cast<string>().ToArray() ?? [];

    /// <summary>#306: a CIA built while the window is open joins the list; the served batch keeps its QR.</summary>
    internal void RefreshSession(IReadOnlyList<SessionCia> cias)
    {
        session.Clear();
        session.AddRange(cias);
        send.SetSessionCias(cias);
        bool wasSyncing = syncing;
        syncing = true;
        try
        {
            RebuildSessionRows();
            ApplySnapshot();
        }
        finally { syncing = wasSyncing; }
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

    void Select(IReadOnlyList<string> paths)
    {
        send.SetSelection(paths);
        ApplySnapshot();
    }

    /// <summary>Judges <paramref name="path"/> and serves it when it can be sent; a refusal stops the server.</summary>
    internal void Choose(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        Select([path]);
    }

    /// <summary>#264: judges and serves 2 to 6 files as one QR; a refusal starts no server.</summary>
    internal void ChooseMany(IReadOnlyList<string> paths) => Select(paths);

    void ApplySnapshot()
    {
        RenderQr(send.Snapshot.QrText, send.Snapshot.IsBatch);
        var s = send.Snapshot;
        SyncSelection(s);
        if (s.Empty)
        {
            status.Text = EmptyHint;
            info.Text = url.Text = steps.Text = notes.Text = "";
            HideBatchRows();
            return;
        }
        if (s.Reason == "") SetGuide(s.Guide, s.IsBatch ? s.Items.Count : 1);
        else { steps.Text = notes.Text = ""; }
        if (s.StartError != null)
        {
            info.Text = url.Text = "";
            status.Text = Lang.L("전송 실패: ", "Send failed: ") + s.StartError;
        }
        else if (s.Reason != "")
        {
            info.Text = s.IsBatch ? SendText.BatchInfo(s.Items.Count, s.TotalLength) : s.Items[0].DisplayName;
            url.Text = "";
            status.Text = s.Reason;
        }
        else
        {
            info.Text = s.IsBatch ? SendText.BatchInfo(s.Items.Count, s.TotalLength)
                : $"{s.Items[0].FileName} · {SendText.Size(s.Items[0].Length)}";
            url.Text = s.QrText ?? "";
            status.Text = s.IsBatch ? SendText.BatchStatus(s.Guide, s.Overall, s.Items.Count, s.Sent)
                : SendText.Status(s.Overall, s.Guide);
        }
        if (s.IsBatch) ShowBatchRows(s.Items);
        else HideBatchRows();
    }

    void SyncSelection(SendSnapshot snapshot)
    {
        bool wasSyncing = syncing;
        syncing = true;
        try { SetSelectionCore(snapshot.Items.Select(i => i.FullPath).ToArray()); }
        finally { syncing = wasSyncing; }
    }

    /// <summary>Highlights the paths that are session rows; a file from elsewhere clears the list.</summary>
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
        if (paths.Length > 0) Select(paths);
    }

    void OnDrop(object? sender, DragEventArgs e)
    {
        var paths = e.DataTransfer.TryGetFiles()?.Select(f => f.TryGetLocalPath()).OfType<string>().ToArray()
            ?? [];
        if (paths.Length > 0) Select(paths);
    }

    void SetGuide(SendGuide guide, int count = 1)
    {
        steps.Text = count > 1 ? SendText.BatchSteps(guide, count) : SendText.Steps(guide);
        notes.Text = SendText.Notes(guide);
    }

    void RenderQr(string? text, bool batch)
    {
        if (text == shownQr) return;
        shownQr = text;
        ClearQr();
        if (text == null) return;
        try
        {
            var png = new Bitmap(new MemoryStream((batch ? batchQrPng : qrPng)(text)));
            int scale = Math.Max(1, 240 / png.PixelSize.Width);
            qr.Source = png;
            qr.Width = png.PixelSize.Width * scale;
            qr.Height = png.PixelSize.Height * scale;
        }
        catch (Exception ex)
        {
            shownQr = null;
            send.ReportStartFailure(ex.Message);
        }
    }

    void ShowBatchRows(IReadOnlyList<SendItem> items)
    {
        batchList.ItemsSource = items.Select(i =>
            SendText.ItemLine(i.State, i.DisplayName, i.Length)).ToArray();
        batchList.IsVisible = true;
        batchList.Height = Math.Min(150, Math.Max(44, items.Count * 28));
    }

    void HideBatchRows()
    {
        batchList.ItemsSource = null;
        batchList.IsVisible = false;
    }

    void ClearQr()
    {
        (qr.Source as IDisposable)?.Dispose();
        qr.Source = null;
    }

    public void Dispose()
    {
        send.Dispose();
        ClearQr();
    }
}
