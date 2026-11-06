using System.Drawing.Drawing2D;
using static Neo3dsConverter.Lang;

namespace Neo3dsConverter;

/// <summary>
/// #255/#264: the Windows Forms twin of the Avalonia send window. Both call
/// <see cref="SendCandidate.Resolve"/>, <see cref="SendBatch"/> and <see cref="SendText"/>, so the
/// kind, the refusal and the wording cannot drift apart. Closing the window stops the server.
/// </summary>
public sealed class SendDialog : Form
{
    static string EmptyHint => L("보낼 .cia 또는 .neo3ds 파일을 고르거나 끌어다 놓으세요.",
                                 "Pick a .cia or .neo3ds file, or drop one here.");

    readonly IReadOnlyList<LanAddress> addresses;
    readonly List<SessionCia> session;
    readonly ListBox targets;
    readonly ListBox batchList = new()
    {
        Width = 420,
        Height = 60,
        Visible = false,
        Margin = new Padding(0, 0, 0, 8),
    };
    readonly PictureBox qr = new() { Size = new Size(240, 240), SizeMode = PictureBoxSizeMode.Zoom, Margin = new Padding(0, 0, 0, 8) };
    readonly Label status = new() { AutoSize = true, Margin = new Padding(0, 0, 0, 4), Font = new Font("Malgun Gothic", 9.5f, FontStyle.Bold) };
    readonly Label info = new() { AutoSize = true, Margin = new Padding(0, 0, 0, 6) };
    readonly ComboBox addressBox = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 420, Margin = new Padding(0, 0, 0, 4) };
    readonly Label hint = new() { AutoSize = true, MaximumSize = new Size(420, 0), Margin = new Padding(0, 0, 0, 6) };
    readonly TextBox url = new() { ReadOnly = true, Width = 420, Multiline = true, Height = 24, ScrollBars = ScrollBars.Vertical, Margin = new Padding(0, 0, 0, 6) };
    readonly Label steps = new() { AutoSize = true, MaximumSize = new Size(420, 0), Margin = new Padding(0, 0, 0, 6) };
    readonly Label notes = new() { AutoSize = true, MaximumSize = new Size(420, 0), Margin = new Padding(0, 0, 0, 10) };
    readonly Dictionary<string, SendState> batchStates = new(StringComparer.OrdinalIgnoreCase);
    SendCandidate? target;
    SendBatch? batch;
    LanSender? sender;
    bool syncing;

    public SendDialog(IReadOnlyList<SessionCia> session, IReadOnlyList<LanAddress> addresses)
    {
        this.session = [.. session];
        this.addresses = addresses;
        targets = new ListBox
        {
            Width = 420,
            Height = Math.Min(110, Math.Max(44, session.Count * 24)),
            Visible = session.Count > 0,
            Margin = new Padding(0, 0, 0, 8),
            SelectionMode = SelectionMode.MultiExtended,
        };
        Text = L("3DS로 보내기", "Send to 3DS");
        ClientSize = new Size(480, 760);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterParent;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowIcon = false;
        Padding = new Padding(16);
        AllowDrop = true;
        Font = new Font("Malgun Gothic", 9.5f);

        var pick = new Button { Text = L("파일 선택", "Pick files"), AutoSize = true, Padding = new Padding(12, 2, 12, 2) };
        var dropHint = new Label
        {
            Text = L("여기에 .cia 또는 .neo3ds 파일을 여러 개 끌어다 놓아도 됩니다.",
                     "You can also drop several .cia or .neo3ds files here."),
            AutoSize = true,
            MaximumSize = new Size(300, 0),
            Margin = new Padding(10, 6, 0, 0),
        };
        var pickRow = new FlowLayoutPanel
        {
            FlowDirection = FlowDirection.LeftToRight,
            AutoSize = true,
            WrapContents = false,
            Margin = new Padding(0, 0, 0, 8),
        };
        pickRow.Controls.AddRange(new Control[] { pick, dropHint });
        hint.Text = L("3DS와 같은 공유기에 연결된 주소를 고르세요.", "Pick the address on the network the 3DS shares.");
        var close = new Button { Text = L("닫기", "Close"), AutoSize = true, Padding = new Padding(20, 2, 20, 2) };
        addressBox.Items.AddRange(addresses.Select(a => (object)a.ToString()).ToArray());
        addressBox.SelectedIndex = 0;
        RebuildSessionRows();

        var panel = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.TopDown,
            WrapContents = false,
            AutoScroll = true,
        };
        panel.Controls.AddRange(new Control[] { targets, pickRow, batchList, qr, status, info, addressBox, hint, url, steps, notes, close });
        Controls.Add(panel);

        pick.Click += (_, _) => PickFiles();
        close.Click += (_, _) => Close();
        addressBox.SelectedIndexChanged += (_, _) =>
        {
            if (addressBox.SelectedIndex < 0) return;
            if (batch is { Allowed: true }) ConnectBatch(addressBox.SelectedIndex);
            else if (batch is { Refusal: SendRefusal.QrTooLarge }) RetryBatch(addressBox.SelectedIndex);
            else if (target is { Allowed: true }) Connect(addressBox.SelectedIndex);
        };
        targets.SelectedIndexChanged += (_, _) =>
        {
            if (syncing) return;
            var paths = SelectedPaths();
            if (paths.Count == 0) ClearAll();
            else if (paths.Count == 1) Choose(paths[0]);
            else ChooseMany(paths);
        };
        DragEnter += (_, e) => e.Effect = e.Data?.GetDataPresent(DataFormats.FileDrop) == true ? DragDropEffects.Copy : DragDropEffects.None;
        DragDrop += (_, e) => DroppedFiles(e.Data);
        FormClosed += (_, _) => { ClearQr(); Stop(); };

        SetGuide(SendGuide.Fbi);
        if (session.Count > 0) Choose(session[0].Path);
        else status.Text = EmptyHint;
    }

    /// <summary>#299: the labels and selection the Windows test project checks.</summary>
    internal string[] TargetLabels => targets.Items.Cast<object>().Select(i => i.ToString() ?? "").ToArray();
    internal int SelectedTarget => targets.SelectedIndex;
    internal int SelectedCount => targets.SelectedItems.Count;
    internal int SessionCount => session.Count;
    internal void SelectAddress(int index) => addressBox.SelectedIndex = index;
    internal SendCandidate? Target => target;
    internal SendBatch? Batch => batch;
    internal string[] BatchRows => batchList.Items.Cast<object>().Select(i => i.ToString() ?? "").ToArray();
    internal string StatusText => status.Text;
    internal string InfoText => info.Text;
    internal string StepsText => steps.Text;
    internal string NotesText => notes.Text;
    internal LanSender? Sender => sender;
    internal string? QrText => sender?.QrText;

    void RebuildSessionRows()
    {
        targets.Items.Clear();
        targets.Items.AddRange(session.Select(c => (object)SendSessionRow.From(c, session)).ToArray());
        targets.Visible = session.Count > 0;
        targets.Height = Math.Min(110, Math.Max(44, session.Count * 24));
    }

    IReadOnlyList<string> SelectedPaths()
    {
        var selected = targets.SelectedItems.Cast<object>().OfType<SendSessionRow>().ToArray();
        return selected.Select(r => r.Cia.Path).ToArray();
    }

    /// <summary>Highlights the paths that are session rows; files from elsewhere clear the list.</summary>
    void SetSelection(IReadOnlyList<string> paths)
    {
        syncing = true;
        try { SetSelectionCore(paths); }
        finally { syncing = false; }
    }

    void SetSelectionCore(IReadOnlyList<string> paths)
    {
        var wanted = new HashSet<string>(paths.Select(SafeFullPath), StringComparer.OrdinalIgnoreCase);
        targets.ClearSelected();
        for (int i = 0; i < targets.Items.Count; i++)
            if (targets.Items[i] is SendSessionRow row && wanted.Contains(SafeFullPath(row.Cia.Path)))
                targets.SetSelected(i, true);
    }

    static string SafeFullPath(string path)
    {
        try { return Path.GetFullPath(path); }
        catch { return path; }
    }

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

    /// <summary>Judges <paramref name="path"/> and serves it when it can be sent; a refusal stops the server.</summary>
    void Choose(string path)
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

    void SetGuide(SendGuide guide, int count = 1)
    {
        steps.Text = count > 1 ? SendText.BatchSteps(guide, count) : SendText.Steps(guide);
        notes.Text = SendText.Notes(guide);
    }

    void PickFiles()
    {
        using var pick = new OpenFileDialog
        {
            Title = L("보낼 파일", "Files to send"),
            Filter = L(".cia · .neo3ds 파일 (*.cia;*.neo3ds)|*.cia;*.neo3ds", ".cia · .neo3ds file (*.cia;*.neo3ds)|*.cia;*.neo3ds"),
            Multiselect = true,
        };
        if (pick.ShowDialog(this) != DialogResult.OK) return;
        if (pick.FileNames.Length == 1) Choose(pick.FileNames[0]);
        else if (pick.FileNames.Length > 1) ChooseMany(pick.FileNames);
    }

    void DroppedFiles(IDataObject? data)
    {
        if (data?.GetData(DataFormats.FileDrop) is not string[] files || files.Length == 0) return;
        if (files.Length == 1) Choose(files[0]);
        else ChooseMany(files);
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
            s.Started += () => OnUi(() =>
            {
                if (ReferenceEquals(sender, s)) status.Text = SendText.Status(SendState.Sending, guide);
            });
            s.Downloaded += () => OnUi(() =>
            {
                if (ReferenceEquals(sender, s)) status.Text = SendText.Status(SendState.Sent, guide);
            });
            ClearQr();
            qr.Image = ScaleQr(QrCode.Png(s.Url), 240);
            url.Height = 24;
            url.Text = s.Url;
            info.Text = $"{s.FileName} · {SendText.Size(s.Length)}";
            status.Text = SendText.Status(SendState.Waiting, guide);
        }
        catch (Exception ex)
        {
            Stop();
            ClearQr();
            info.Text = url.Text = "";
            status.Text = L("전송 실패: ", "Send failed: ") + ex.Message;
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
            qr.Image = ScaleQr(QrCode.BatchPng(s.QrText), 240);
            url.Height = Math.Min(96, Math.Max(24, sized.Items.Count * 16));
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
            status.Text = L("전송 실패: ", "Send failed: ") + ex.Message;
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
        OnUi(() =>
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
        batchList.Items.Clear();
        batchList.Items.AddRange(b.Items.Select(i =>
            (object)SendText.ItemLine(batchStates.GetValueOrDefault(i.FullPath, SendState.Waiting), i.DisplayName, i.Length)).ToArray());
        batchList.Visible = true;
        batchList.Height = Math.Min(130, Math.Max(44, b.Items.Count * 22));
    }

    void HideBatchRows()
    {
        batchList.Items.Clear();
        batchList.Visible = false;
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

    void OnUi(Action action)
    {
        if (IsDisposed || !IsHandleCreated) return;
        try { BeginInvoke(action); }
        catch (InvalidOperationException) { /* window already gone */ }
    }

    static Bitmap ScaleQr(byte[] png, int targetSize)
    {
        using var src = new Bitmap(new MemoryStream(png));
        int scale = Math.Max(1, targetSize / src.Width);
        var bmp = new Bitmap(src.Width * scale, src.Height * scale);
        using var g = Graphics.FromImage(bmp);
        g.InterpolationMode = InterpolationMode.NearestNeighbor;
        g.PixelOffsetMode = PixelOffsetMode.Half;
        g.DrawImage(src, 0, 0, bmp.Width, bmp.Height);
        return bmp;
    }

    void ClearQr()
    {
        var image = qr.Image;
        qr.Image = null;
        image?.Dispose();
    }

    void Stop()
    {
        sender?.Dispose();
        sender = null;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { ClearQr(); Stop(); }
        base.Dispose(disposing);
    }
}
