using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform.Storage;
using Avalonia.Threading;

namespace Neo3dsConverter.Desktop;

/// <summary>
/// #255: the one window for "send to 3DS". A session CIA is listed, and a file can be dropped or
/// picked; the PC judgement decides the QR, the wording and the refusal. Closing it stops the server.
/// </summary>
internal sealed class SendDialog : IDisposable
{
    readonly Window window;
    readonly ListBox targets;
    readonly Image qr = new() { Stretch = Stretch.Uniform, HorizontalAlignment = HorizontalAlignment.Center };
    readonly TextBlock status = new() { TextWrapping = TextWrapping.Wrap, FontWeight = FontWeight.Bold };
    readonly TextBlock info = new() { TextWrapping = TextWrapping.Wrap };
    readonly TextBlock steps;
    readonly TextBlock notes;
    readonly TextBox url = new() { IsReadOnly = true };
    readonly ComboBox addressBox;
    readonly IReadOnlyList<LanAddress> addresses;
    readonly List<SessionCia> session;
    SendCandidate? target;
    LanSender? sender;
    bool syncing;

    public SendDialog(IReadOnlyList<SessionCia> session, IReadOnlyList<LanAddress> addresses)
    {
        this.session = [.. session];
        this.addresses = addresses;
        RenderOptions.SetBitmapInterpolationMode(qr, BitmapInterpolationMode.None);

        targets = new ListBox
        {
            ItemsSource = session.Select(c => SendCandidate.Resolve(c.Path, session)?.DisplayName ?? Path.GetFileName(c.Path)).ToArray(),
            IsVisible = session.Count > 0,
            Height = Math.Min(120, Math.Max(44, session.Count * 30)),
        };
        var pick = new Button
        {
            Content = Lang.L("파일 선택", "Pick file"),
            Padding = new Avalonia.Thickness(16, 4),
        };
        pick.Click += async (_, _) => await PickFile();
        var dropHint = new TextBlock
        {
            Text = Lang.L("여기에 .cia 또는 .neo3ds 파일을 끌어다 놓아도 됩니다.", "You can also drop a .cia or .neo3ds file here."),
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
            if (addressBox.SelectedIndex >= 0 && target is { Allowed: true }) Connect(addressBox.SelectedIndex);
        };
        targets.SelectionChanged += (_, _) =>
        {
            if (!syncing && targets.SelectedIndex >= 0 && targets.SelectedIndex < session.Count)
                Choose(session[targets.SelectedIndex].Path);
        };
        window.Closed += (_, _) => Stop();

        SetGuide(SendGuide.Fbi);
        if (session.Count > 0) targets.SelectedIndex = 0;
        else status.Text = Lang.L("보낼 .cia 또는 .neo3ds 파일을 고르거나 끌어다 놓으세요.", "Pick a .cia or .neo3ds file, or drop one here.");
    }

    public Window Window => window;

    /// <summary>The running server, or null after a failed start, a refused file, or after the window closed.</summary>
    public LanSender? Sender => sender;

    public string? Url => sender?.Url;

    internal string StatusText => status.Text ?? "";
    internal string InfoText => info.Text ?? "";
    internal string StepsText => steps.Text ?? "";
    internal string NotesText => notes.Text ?? "";
    internal int SelectedSession => targets.SelectedIndex;
    internal int SessionCount => session.Count;
    internal SendCandidate? Target => target;

    /// <summary>#306: a CIA built while the window is open joins the list; the served file keeps its QR.</summary>
    internal void RefreshSession(IReadOnlyList<SessionCia> cias)
    {
        session.Clear();
        session.AddRange(cias);
        syncing = true;
        try
        {
            targets.ItemsSource = session.Select(c => SendCandidate.Resolve(c.Path, session)?.DisplayName ?? Path.GetFileName(c.Path)).ToArray();
            targets.IsVisible = session.Count > 0;
            targets.Height = Math.Min(120, Math.Max(44, session.Count * 30));
            targets.SelectedIndex = target == null ? -1 : IndexOf(target.FullPath);
        }
        finally
        {
            syncing = false;
        }
    }

    int IndexOf(string fullPath)
    {
        for (int i = 0; i < session.Count; i++)
            if (string.Equals(Path.GetFullPath(session[i].Path), fullPath, StringComparison.OrdinalIgnoreCase)) return i;
        return -1;
    }

    /// <summary>Judges <paramref name="path"/> and serves it when it can be sent; a refusal stops the server.</summary>
    internal void Choose(string path)
    {
        var candidate = SendCandidate.Resolve(path, session);
        if (candidate == null) return;
        target = candidate;
        SelectInList(candidate);
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

    /// <summary>Highlights the session row that matches; a file from elsewhere clears the highlight.</summary>
    void SelectInList(SendCandidate candidate)
    {
        int index = IndexOf(candidate.FullPath);
        if (index == targets.SelectedIndex) return;
        syncing = true;
        try { targets.SelectedIndex = index; }
        finally { syncing = false; }
    }

    async Task PickFile()
    {
        var type = new FilePickerFileType(Lang.L(".cia · .neo3ds 파일", ".cia · .neo3ds file")) { Patterns = ["*.cia", "*.neo3ds"] };
        var files = await window.StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
        {
            Title = Lang.L("보낼 파일", "File to send"),
            AllowMultiple = false,
            FileTypeFilter = [type],
        });
        if (files.Count > 0 && files[0].TryGetLocalPath() is string path) Choose(path);
    }

    void OnDrop(object? sender, DragEventArgs e)
    {
        string? path = e.DataTransfer.TryGetFiles()?.Select(f => f.TryGetLocalPath()).OfType<string>().FirstOrDefault();
        if (path != null) Choose(path);
    }

    void SetGuide(SendGuide guide)
    {
        steps.Text = SendText.Steps(guide);
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
            s.Started += () => Dispatcher.UIThread.Post(() =>
            {
                if (ReferenceEquals(sender, s)) status.Text = SendText.Status(SendState.Sending, guide);
            });
            s.Downloaded += () => Dispatcher.UIThread.Post(() =>
            {
                if (ReferenceEquals(sender, s)) status.Text = SendText.Status(SendState.Sent, guide);
            });
            ClearQr();
            var png = new Bitmap(new MemoryStream(QrCode.Png(s.Url)));
            int scale = Math.Max(1, 240 / png.PixelSize.Width);
            sender = s;
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
