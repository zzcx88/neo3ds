using static Neo3dsConverter.Lang;
namespace Neo3dsConverter;

/// <summary>Single-window converter: pick a romset zip, press the button, get a CIA.</summary>
public sealed class MainForm : Form
{
    readonly TextBox romBox = new() { ReadOnly = true, Dock = DockStyle.Fill };
    readonly TextBox titleBox = new() { Dock = DockStyle.Fill };
    readonly TextBox outBox = new() { Dock = DockStyle.Fill };
    readonly Label biosLabel = new() { AutoSize = true, Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft };
    readonly Label setLabel = new() { AutoSize = false, Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft };
    readonly TextBox iconBox = new() { ReadOnly = true, Dock = DockStyle.Fill, PlaceholderText = L("자동 생성 (약어 + 넘버링)", "generated (abbreviation + number)") };
    readonly TextBox bannerBox = new() { ReadOnly = true, Dock = DockStyle.Fill, PlaceholderText = L("자동 생성 (게임 이름)", "generated (game title)") };
    readonly PictureBox iconPreview = new() { Size = new Size(96, 96), SizeMode = PictureBoxSizeMode.Zoom, Margin = new Padding(0, 0, 12, 0) };
    readonly PictureBox bannerPreview = new() { Size = new Size(Art.BannerW, Art.BannerH), SizeMode = PictureBoxSizeMode.Zoom };
    readonly Button buildButton = new() { Text = L("CIA 만들기", "Build CIA"), Dock = DockStyle.Fill, Height = 40, Enabled = false };
    readonly TextBox logBox = new()
    {
        Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Fill,
        Font = new Font("Consolas", 9f), BackColor = Color.FromArgb(24, 24, 28), ForeColor = Color.Gainsboro,
    };

    CiaJob? job;

    /// <summary>Set when the window closed to reopen in the other language.</summary>
    public bool Restart { get; private set; }

    public MainForm()
    {
        Text = L("neo3ds 변환기 - 네오지오 롬 → 3DS CIA", "neo3ds converter - Neo Geo ROM → 3DS CIA");
        ClientSize = new Size(660, 680);
        MinimumSize = new Size(560, 620);
        Font = new Font("Malgun Gothic", 9.5f);
        AllowDrop = true;

        var grid = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, Padding = new Padding(10) };
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 90));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 90));

        var browseRom = new Button { Text = L("찾아보기...", "Browse..."), Dock = DockStyle.Fill };
        var browseOut = new Button { Text = L("변경...", "Change..."), Dock = DockStyle.Fill };
        browseRom.Click += (_, _) => PickRom();
        browseOut.Click += (_, _) => PickOutput();
        buildButton.Click += async (_, _) => await BuildAsync();

        AddRow(grid, L("롬 파일", "ROM zip"), romBox, browseRom);
        AddRow(grid, L("롬셋", "Romset"), setLabel, null);
        AddRow(grid, L("바이오스", "BIOS"), biosLabel, null);
        AddRow(grid, L("게임 이름", "Title"), titleBox, null);
        AddRow(grid, L("아이콘", "Icon"), iconBox, ImageButtons(iconBox, L("아이콘 (48×48로 맞춰집니다)", "Icon (fitted to 48×48)")));
        AddRow(grid, L("배너", "Banner"), bannerBox, ImageButtons(bannerBox, L("배너 (256×128로 맞춰집니다)", "Banner (fitted to 256×128)")));
        var previews = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = false, BackColor = Color.FromArgb(40, 40, 44) };
        previews.Controls.Add(iconPreview);
        previews.Controls.Add(bannerPreview);
        grid.Controls.Add(previews, 1, grid.RowCount);
        grid.SetColumnSpan(previews, 2);
        grid.RowStyles.Add(new RowStyle(SizeType.Absolute, Art.BannerH + 8));
        grid.RowCount++;
        AddRow(grid, L("저장 위치", "Save to"), outBox, browseOut);
        titleBox.TextChanged += (_, _) => UpdatePreview();
        grid.Controls.Add(buildButton, 1, grid.RowCount);
        // Switches the language and reopens the window (Program runs it again while Restart is set).
        var language = new Button { Text = Korean ? "English" : "한국어", Dock = DockStyle.Fill, Height = 40 };
        language.Click += (_, _) => { Set(!Korean, remember: true); Restart = true; Close(); };
        grid.Controls.Add(language, 2, grid.RowCount);
        grid.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        grid.RowCount++;
        grid.Controls.Add(logBox, 0, grid.RowCount);
        grid.SetColumnSpan(logBox, 3);
        grid.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        grid.RowCount++;
        Controls.Add(grid);

        DragEnter += (_, e) => e.Effect = DroppedZip(e) != null ? DragDropEffects.Copy : DragDropEffects.None;
        DragDrop += (_, e) => { if (DroppedZip(e) is { } zip) LoadRom(zip); };

        Log(L("네오지오 롬 zip(예: kof98.zip)을 이 창에 끌어다 놓거나 [찾아보기]를 누르세요.", "Drop a Neo Geo ROM zip (e.g. kof98.zip) on this window or press [Browse...]."));
        Log(L("neogeo.zip(바이오스)은 롬과 같은 폴더에 있어야 합니다.", "neogeo.zip (BIOS) must be in the same folder as the game zip."));
    }

    static void AddRow(TableLayoutPanel grid, string label, Control main, Control? side)
    {
        int row = grid.RowCount++;
        grid.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        grid.Controls.Add(new Label { Text = label, Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft }, 0, row);
        grid.Controls.Add(main, 1, row);
        if (side != null) grid.Controls.Add(side, 2, row);
    }

    /// <summary>[선택] picks a picture for the box, [X] goes back to the generated one.</summary>
    Control ImageButtons(TextBox box, string what)
    {
        var panel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, Margin = Padding.Empty };
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 30));
        var pick = new Button { Text = L("선택...", "Pick..."), Dock = DockStyle.Fill };
        var clear = new Button { Text = "✕", Dock = DockStyle.Fill };
        pick.Click += (_, _) =>
        {
            using var dlg = new OpenFileDialog { Filter = L("이미지", "Images") + " (*.png;*.jpg;*.jpeg;*.bmp;*.gif)|*.png;*.jpg;*.jpeg;*.bmp;*.gif", Title = what };
            if (dlg.ShowDialog(this) != DialogResult.OK) return;
            box.Text = dlg.FileName;
            UpdatePreview();
        };
        clear.Click += (_, _) => { box.Text = ""; UpdatePreview(); };
        panel.Controls.Add(pick, 0, 0);
        panel.Controls.Add(clear, 1, 0);
        return panel;
    }

    string? IconImage => string.IsNullOrEmpty(iconBox.Text) ? null : iconBox.Text;
    string? BannerImage => string.IsNullOrEmpty(bannerBox.Text) ? null : bannerBox.Text;
    string CurrentTitle => string.IsNullOrWhiteSpace(titleBox.Text) ? job?.RomName.ToUpperInvariant() ?? "" : titleBox.Text.Trim();

    /// <summary>Shows the HOME menu icon (2x) and banner exactly as they will be built.</summary>
    void UpdatePreview()
    {
        if (job == null) return;
        try
        {
            SetPreview(iconPreview, Art.Icon(CurrentTitle, IconImage));
            SetPreview(bannerPreview, Art.Banner(CurrentTitle, BannerImage));
        }
        catch (Exception e)
        {
            Log(L("이미지를 읽을 수 없습니다: ", "Can't read the picture: ") + e.Message);
        }
    }

    static void SetPreview(PictureBox box, Bitmap bmp)
    {
        var old = box.Image;
        box.Image = bmp;
        old?.Dispose();
    }

    static string? DroppedZip(DragEventArgs e) =>
        e.Data?.GetData(DataFormats.FileDrop) is string[] { Length: > 0 } files &&
        files[0].EndsWith(".zip", StringComparison.OrdinalIgnoreCase) ? files[0] : null;

    void PickRom()
    {
        using var dlg = new OpenFileDialog { Filter = L("네오지오 롬", "Neo Geo ROM") + " (*.zip)|*.zip", Title = L("롬 zip 선택", "Pick a ROM zip") };
        if (dlg.ShowDialog(this) == DialogResult.OK) LoadRom(dlg.FileName);
    }

    void PickOutput()
    {
        using var dlg = new FolderBrowserDialog { SelectedPath = outBox.Text };
        if (dlg.ShowDialog(this) == DialogResult.OK) outBox.Text = dlg.SelectedPath;
    }

    void LoadRom(string zip)
    {
        if (Path.GetFileName(zip).Equals("neogeo.zip", StringComparison.OrdinalIgnoreCase))
        {
            Log(L("neogeo.zip은 바이오스입니다. 게임 롬 zip을 선택하세요.", "neogeo.zip is the BIOS. Pick a game zip."));
            return;
        }
        job = CiaJob.FromRomZip(zip);
        romBox.Text = job.RomZip;
        titleBox.Text = job.Title;
        outBox.Text = job.OutputDir;
        biosLabel.Text = job.BiosZip != null ? L("✔ neogeo.zip 발견", "✔ neogeo.zip found") : L("✘ neogeo.zip 없음 (롬과 같은 폴더에 넣어주세요)", "✘ no neogeo.zip (put it next to the game zip)");
        biosLabel.ForeColor = job.BiosZip != null ? Color.ForestGreen : Color.Firebrick;
        setLabel.Text = job.Game != null ? $"✔ {job.Game.Name} - {job.Game.Desc}" : "✘ " + job.Problem;
        setLabel.ForeColor = job.Game != null ? Color.ForestGreen : Color.Firebrick;
        buildButton.Enabled = job.BiosZip != null && job.Game != null;
        Log(L("선택: ", "Selected: ") + $"{Path.GetFileName(zip)}  (Title ID {job.TitleId})");
        if (job.Game == null) Log(L("변환 불가: ", "Can't convert: ") + job.Problem);
        UpdatePreview();
    }

    async Task BuildAsync()
    {
        if (job == null) return;
        job.Title = CurrentTitle;
        job.IconImage = IconImage;
        job.BannerImage = BannerImage;
        job.OutputDir = outBox.Text;
        buildButton.Enabled = false;
        UseWaitCursor = true;
        try
        {
            var builder = new CiaBuilder(msg => BeginInvoke(() => Log(msg)));
            string cia = await Task.Run(() => builder.Build(job));
            Log(L("FBI로 설치하세요: SD카드에 복사 → FBI → SD → 파일 선택 → Install CIA", "Install with FBI: copy to the SD card → FBI → SD → pick the file → Install CIA"));
            MessageBox.Show(this, L("CIA를 만들었습니다.", "The CIA is ready.") + $"\n\n{cia}", L("완료", "Done"), MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception e)
        {
            Log(L("오류: ", "Error: ") + e.Message);
            MessageBox.Show(this, e.Message, L("실패", "Failed"), MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            buildButton.Enabled = true;
            UseWaitCursor = false;
        }
    }

    void Log(string msg) => logBox.AppendText(msg + Environment.NewLine);
}
