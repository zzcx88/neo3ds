using System.Drawing.Drawing2D;
using static Neo3dsConverter.Lang;

namespace Neo3dsConverter;

/// <summary>
/// #255: the Windows Forms twin of the Avalonia send window. Both call
/// <see cref="SendCandidate.Resolve"/> and <see cref="SendText"/>, so the kind, the refusal and the
/// wording cannot drift apart. Closing the window stops the server.
/// </summary>
public sealed class SendDialog : Form
{
    readonly IReadOnlyList<SessionCia> session;
    readonly IReadOnlyList<LanAddress> addresses;
    readonly ListBox targets;
    readonly PictureBox qr = new() { Size = new Size(240, 240), SizeMode = PictureBoxSizeMode.Zoom, Margin = new Padding(0, 0, 0, 8) };
    readonly Label status = new() { AutoSize = true, Margin = new Padding(0, 0, 0, 4), Font = new Font("Malgun Gothic", 9.5f, FontStyle.Bold) };
    readonly Label info = new() { AutoSize = true, Margin = new Padding(0, 0, 0, 6) };
    readonly ComboBox addressBox = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 420, Margin = new Padding(0, 0, 0, 4) };
    readonly Label hint = new() { AutoSize = true, MaximumSize = new Size(420, 0), Margin = new Padding(0, 0, 0, 6) };
    readonly TextBox url = new() { ReadOnly = true, Width = 420, Margin = new Padding(0, 0, 0, 6) };
    readonly Label steps = new() { AutoSize = true, MaximumSize = new Size(420, 0), Margin = new Padding(0, 0, 0, 6) };
    readonly Label notes = new() { AutoSize = true, MaximumSize = new Size(420, 0), Margin = new Padding(0, 0, 0, 10) };
    SendCandidate? target;
    LanSender? sender;

    public SendDialog(IReadOnlyList<SessionCia> session, IReadOnlyList<LanAddress> addresses)
    {
        this.session = session;
        this.addresses = addresses;
        targets = new ListBox
        {
            Width = 420,
            Height = Math.Min(110, Math.Max(44, session.Count * 24)),
            Visible = session.Count > 0,
            Margin = new Padding(0, 0, 0, 8),
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

        var pick = new Button { Text = L("파일 선택", "Pick file"), AutoSize = true, Padding = new Padding(12, 2, 12, 2) };
        var dropHint = new Label
        {
            Text = L("여기에 .cia 또는 .neo3ds 파일을 끌어다 놓아도 됩니다.", "You can also drop a .cia or .neo3ds file here."),
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

        var panel = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.TopDown,
            WrapContents = false,
            AutoScroll = true,
        };
        panel.Controls.AddRange(new Control[] { targets, pickRow, qr, status, info, addressBox, hint, url, steps, notes, close });
        Controls.Add(panel);

        pick.Click += (_, _) => PickFile();
        close.Click += (_, _) => Close();
        addressBox.SelectedIndexChanged += (_, _) =>
        {
            if (addressBox.SelectedIndex >= 0 && target is { Allowed: true }) Connect(addressBox.SelectedIndex);
        };
        targets.SelectedIndexChanged += (_, _) =>
        {
            if (targets.SelectedIndex >= 0 && targets.SelectedIndex < session.Count) Choose(session[targets.SelectedIndex].Path);
        };
        DragEnter += (_, e) => e.Effect = e.Data?.GetDataPresent(DataFormats.FileDrop) == true ? DragDropEffects.Copy : DragDropEffects.None;
        DragDrop += (_, e) => DroppedFile(e.Data);
        FormClosed += (_, _) => { ClearQr(); Stop(); };

        SetGuide(SendGuide.Fbi);
        if (session.Count > 0) targets.SelectedIndex = 0;
        else status.Text = L("보낼 .cia 또는 .neo3ds 파일을 고르거나 끌어다 놓으세요.", "Pick a .cia or .neo3ds file, or drop one here.");
    }

    /// <summary>The running server, or null after a failed start, a refused file, or after the window closed.</summary>
    public LanSender? Sender => sender;

    public string? Url => sender?.Url;

    internal string StatusText => status.Text ?? "";
    internal SendCandidate? Target => target;

    /// <summary>Judges <paramref name="path"/> and serves it when it can be sent; a refusal stops the server.</summary>
    internal void Choose(string path)
    {
        var candidate = SendCandidate.Resolve(path, session);
        if (candidate == null) return;
        target = candidate;
        SetGuide(candidate.Guide);
        if (!candidate.Allowed)
        {
            Stop();
            ClearQr();
            info.Text = candidate.DisplayName;
            url.Text = "";
            status.Text = candidate.Reason;
            return;
        }
        Connect(addressBox.SelectedIndex < 0 ? 0 : addressBox.SelectedIndex);
    }

    void SetGuide(SendGuide guide)
    {
        steps.Text = SendText.Steps(guide);
        notes.Text = SendText.Notes(guide);
    }

    void PickFile()
    {
        using var pick = new OpenFileDialog
        {
            Title = L("보낼 파일", "File to send"),
            Filter = L("CIA · 런처 파일 (*.cia;*.neo3ds)|*.cia;*.neo3ds", "CIA or launcher file (*.cia;*.neo3ds)|*.cia;*.neo3ds"),
            Multiselect = false,
        };
        if (pick.ShowDialog(this) == DialogResult.OK) Choose(pick.FileName);
    }

    void DroppedFile(IDataObject? data)
    {
        if (data?.GetData(DataFormats.FileDrop) is string[] files && files.Length > 0) Choose(files[0]);
    }

    void Connect(int index)
    {
        Stop();
        if (target is not { Allowed: true } t || index < 0 || index >= addresses.Count) return;
        SendGuide guide = t.Guide;
        try
        {
            var s = LanSender.Start(t.FullPath, addresses[index].Address);
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
            sender = s;
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

    void OnUi(Action action)
    {
        if (IsDisposed || !IsHandleCreated) return;
        try { BeginInvoke(action); }
        catch (InvalidOperationException) { /* window already gone */ }
    }

    static Bitmap ScaleQr(byte[] png, int target)
    {
        using var src = new Bitmap(new MemoryStream(png));
        int scale = Math.Max(1, target / src.Width);
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
