using System.Drawing.Drawing2D;
using static Neo3dsConverter.Lang;

namespace Neo3dsConverter;

/// <summary>
/// #255/#264/#313: the Windows Forms twin of the Avalonia send window. Both hand the picked paths
/// to the shared <see cref="SendSession"/>, so the kind, the refusal, the QR and the wording
/// cannot drift apart. Closing the window stops the server.
/// </summary>
public sealed class SendDialog : Form
{
    static string EmptyHint => L("보낼 .cia 또는 .neo3ds 파일을 고르거나 끌어다 놓으세요.",
                                 "Pick a .cia or .neo3ds file, or drop one here.");

    readonly IReadOnlyList<LanAddress> addresses;
    readonly List<SessionCia> session;
    readonly SendSession send;
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
    string? shownQr;
    bool syncing;

    public SendDialog(IReadOnlyList<SessionCia> session, IReadOnlyList<LanAddress> addresses)
    {
        this.session = [.. session];
        this.addresses = addresses;
        send = new SendSession(session, addresses.Count > 0 ? addresses[0].Address : null);
        send.Changed += () => OnUi(ApplySnapshot);
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
            if (addressBox.SelectedIndex < 0 || addressBox.SelectedIndex >= addresses.Count) return;
            send.SetAddress(addresses[addressBox.SelectedIndex].Address);
            ApplySnapshot();
        };
        targets.SelectedIndexChanged += (_, _) =>
        {
            if (!syncing) Select(SelectedPaths());
        };
        DragEnter += (_, e) => e.Effect = e.Data?.GetDataPresent(DataFormats.FileDrop) == true ? DragDropEffects.Copy : DragDropEffects.None;
        DragDrop += (_, e) => DroppedFiles(e.Data);
        FormClosed += (_, _) => { ClearQr(); send.Dispose(); };

        if (session.Count > 0) Select([session[0].Path]);
        else ApplySnapshot();
    }

    /// <summary>#299: the labels and selection the Windows test project checks.</summary>
    internal string[] TargetLabels => targets.Items.Cast<object>().Select(i => i.ToString() ?? "").ToArray();
    internal int SelectedTarget => targets.SelectedIndex;
    internal int SelectedCount => targets.SelectedItems.Count;
    internal int SessionCount => session.Count;
    internal void SelectAddress(int index) => addressBox.SelectedIndex = index;
    internal SendCandidate? Target => (send.Selection as SendSelectionResult.Single)?.Candidate;
    internal SendBatchResult? BatchResult => (send.Selection as SendSelectionResult.Batch)?.Result;
    internal string[] BatchRows => batchList.Items.Cast<object>().Select(i => i.ToString() ?? "").ToArray();
    internal string StatusText => status.Text;
    internal string InfoText => info.Text;
    internal string StepsText => steps.Text;
    internal string NotesText => notes.Text;
    internal LanSender? Sender => send.Sender;
    internal string? QrText => send.Snapshot.QrText;

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

    void Select(IReadOnlyList<string> paths)
    {
        send.SetSelection(paths);
        ApplySnapshot();
    }

    /// <summary>Judges <paramref name="path"/> and serves it when it can be sent; a refusal stops the server.</summary>
    void Choose(string path)
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
            status.Text = L("전송 실패: ", "Send failed: ") + s.StartError;
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
            url.Height = s.IsBatch ? Math.Min(96, Math.Max(24, s.Items.Count * 16)) : 24;
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

    /// <summary>Highlights the paths that are session rows; files from elsewhere clear the list.</summary>
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
        if (pick.FileNames.Length > 0) Select(pick.FileNames);
    }

    void DroppedFiles(IDataObject? data)
    {
        if (data?.GetData(DataFormats.FileDrop) is not string[] files || files.Length == 0) return;
        Select(files);
    }

    void RenderQr(string? text, bool batch)
    {
        if (text == shownQr) return;
        shownQr = text;
        ClearQr();
        if (text == null) return;
        try
        {
            qr.Image = ScaleQr(batch ? QrCode.BatchPng(text) : QrCode.Png(text), 240);
        }
        catch (Exception ex)
        {
            shownQr = null;
            send.ReportStartFailure(ex.Message);
        }
    }

    void ShowBatchRows(IReadOnlyList<SendItem> items)
    {
        batchList.Items.Clear();
        batchList.Items.AddRange(items.Select(i =>
            (object)SendText.ItemLine(i.State, i.DisplayName, i.Length)).ToArray());
        batchList.Visible = true;
        batchList.Height = Math.Min(130, Math.Max(44, items.Count * 22));
    }

    void HideBatchRows()
    {
        batchList.Items.Clear();
        batchList.Visible = false;
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

    protected override void Dispose(bool disposing)
    {
        if (disposing) { ClearQr(); send.Dispose(); }
        base.Dispose(disposing);
    }
}
