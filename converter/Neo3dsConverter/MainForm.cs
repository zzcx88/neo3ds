using static Neo3dsConverter.Lang;
namespace Neo3dsConverter;

/// <summary>Single-window converter: pick a romset zip, press the button, get a CIA.
/// Several zips at once are converted one after the other, each with its own title and generated art.</summary>
public sealed class MainForm : Form
{
    readonly TextBox romBox = new() { ReadOnly = true, Dock = DockStyle.Fill };
    readonly TextBox titleBox = new() { Dock = DockStyle.Fill };
    readonly TextBox outBox = new() { Dock = DockStyle.Fill };
    readonly Label biosLabel = new() { AutoSize = true, Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft };
    readonly Label setLabel = new() { AutoSize = false, Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft };
    readonly ComboBox systemBox = new() { Dock = DockStyle.Fill, DropDownStyle = ComboBoxStyle.DropDownList };
    readonly ComboBox regionBox = new() { Dock = DockStyle.Fill, DropDownStyle = ComboBoxStyle.DropDownList };
    readonly TextBox iconBox = new() { ReadOnly = true, Dock = DockStyle.Fill, PlaceholderText = L("자동 생성 (약어 + 넘버링)", "generated (abbreviation + number)") };
    readonly TextBox bannerBox = new() { ReadOnly = true, Dock = DockStyle.Fill, PlaceholderText = L("자동 생성 (게임 이름)", "generated (game title)") };
    readonly PictureBox iconPreview = new() { Size = new Size(96, 96), SizeMode = PictureBoxSizeMode.Zoom, Margin = new Padding(0, 0, 12, 0) };
    readonly PictureBox bannerPreview = new() { Size = new Size(Art.BannerW, Art.BannerH), SizeMode = PictureBoxSizeMode.Zoom };
    readonly Button buildButton = new() { Text = L("CIA 만들기", "Build CIA"), Dock = DockStyle.Fill, Height = 40, Enabled = false };
    readonly Button packButton = new() { Text = L("런처용 파일 만들기", "Launcher file"), Dock = DockStyle.Fill, Height = 40, Enabled = false };
    readonly Button launcherButton = new() { Text = L("런처 CIA 만들기 (게임 목록 앱, 한 번만 설치)", "Build the launcher CIA (game list app, install once)"), Dock = DockStyle.Fill, Height = 34 };
    readonly TextBox logBox = new()
    {
        Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Fill,
        Font = new Font("Consolas", 9f), BackColor = Color.FromArgb(24, 24, 28), ForeColor = Color.Gainsboro,
    };

    CiaJob? job;
    /// <summary>The zips picked together (two or more); empty when one game is picked.</summary>
    readonly List<CiaJob> batch = new();
    Control? iconButtons, bannerButtons;

    /// <summary>Set when the window closed to reopen in the other language.</summary>
    public bool Restart { get; private set; }

    public MainForm()
    {
        Text = L("neo3ds 변환기 - 네오지오 롬 → 3DS CIA", "neo3ds converter - Neo Geo ROM → 3DS CIA");
        ClientSize = new Size(660, 791);
        MinimumSize = new Size(560, 731);
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
        buildButton.Click += async (_, _) => await BuildAsync(pack: false);
        packButton.Click += async (_, _) => await BuildAsync(pack: true);
        launcherButton.Click += async (_, _) => await BuildLauncherAsync();

        AddRow(grid, L("롬 파일", "ROM zip"), romBox, browseRom);
        AddRow(grid, L("롬셋", "Romset"), setLabel, null);
        AddRow(grid, L("바이오스", "BIOS"), biosLabel, null);
        AddRow(grid, L("게임 이름", "Title"), titleBox, null);
        systemBox.Items.AddRange(new object[] {
            L("자동 (가정용 AES, 필요한 게임만 MVS)", "Automatic (home AES, MVS where a game needs it)"),
            L("AES (가정용)", "AES (home console)"),
            L("MVS (아케이드)", "MVS (arcade)"),
        });
        systemBox.SelectedIndex = 0;
        AddRow(grid, L("시스템", "System"), systemBox, null);
        regionBox.Items.AddRange(new object[] {
            L("유럽·아시아 (기본)", "Europe/Asia (default)"),
            L("일본 (메탈슬러그 피 표현 등 무검열, 일본어)", "Japan (uncensored, e.g. blood in Metal Slug; Japanese text)"),
            L("미국", "USA"),
        });
        regionBox.SelectedIndex = 0;
        AddRow(grid, L("지역", "Region"), regionBox, null);
        iconButtons = ImageButtons(iconBox, L("아이콘 (48×48로 맞춰집니다)", "Icon (fitted to 48×48)"));
        bannerButtons = ImageButtons(bannerBox, L("배너 (256×128로 맞춰집니다)", "Banner (fitted to 256×128)"));
        AddRow(grid, L("아이콘", "Icon"), iconBox, iconButtons);
        AddRow(grid, L("배너", "Banner"), bannerBox, bannerButtons);
        var previews = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = false, BackColor = Color.FromArgb(40, 40, 44) };
        previews.Controls.Add(iconPreview);
        previews.Controls.Add(bannerPreview);
        grid.Controls.Add(previews, 1, grid.RowCount);
        grid.SetColumnSpan(previews, 2);
        grid.RowStyles.Add(new RowStyle(SizeType.Absolute, Art.BannerH + 8));
        grid.RowCount++;
        AddRow(grid, L("저장 위치", "Save to"), outBox, browseOut);
        titleBox.TextChanged += (_, _) => UpdatePreview();
        // Either a CIA per game, or a .neo3ds file per game for the launcher
        var builds = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, Margin = Padding.Empty };
        builds.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        builds.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        builds.Controls.Add(buildButton, 0, 0);
        builds.Controls.Add(packButton, 1, 0);
        grid.Controls.Add(builds, 0, grid.RowCount);
        grid.SetColumnSpan(builds, 2);
        // Switches the language and reopens the window (Program runs it again while Restart is set).
        var language = new Button { Text = Korean ? "English" : "한국어", Dock = DockStyle.Fill, Height = 40 };
        language.Click += (_, _) => { Set(!Korean, remember: true); Restart = true; Close(); };
        grid.Controls.Add(language, 2, grid.RowCount);
        grid.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        grid.RowCount++;
        grid.Controls.Add(launcherButton, 0, grid.RowCount);
        grid.SetColumnSpan(launcherButton, 3);
        grid.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        grid.RowCount++;
        grid.Controls.Add(logBox, 0, grid.RowCount);
        grid.SetColumnSpan(logBox, 3);
        grid.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        grid.RowCount++;
        Controls.Add(grid);

        DragEnter += (_, e) => e.Effect = DroppedZips(e).Length > 0 ? DragDropEffects.Copy : DragDropEffects.None;
        DragDrop += (_, e) => LoadRoms(DroppedZips(e));

        Log(L("MAME 네오지오 롬셋 zip(예: kof98.zip)을 이 창에 끌어다 놓거나 [찾아보기]를 누르세요.", "Drop a MAME Neo Geo romset zip (e.g. kof98.zip) on this window or press [Browse...]."));
        Log(L("MAME 롬셋 zip만 지원합니다. MAME 규격(롬셋 이름·칩 CRC)과 다른 롬셋은 변환되지 않습니다.", "Only MAME romset zips are supported. A romset whose names or chip CRCs differ from MAME's does not convert."));
        Log(L("여러 개를 한꺼번에 놓거나 고르면 차례로 변환합니다.", "Drop or pick several to convert them one after the other."));
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
            SetPreview(iconPreview, Art.Icon(CurrentTitle, IconImage).ToBitmap());
            SetPreview(bannerPreview, Art.Banner(CurrentTitle, BannerImage).ToBitmap());
        }
        catch (Exception e)
        {
            Log(L("이미지를 읽을 수 없습니다: ", "Can't read the picture: ") + e.Message);
        }
    }

    static void SetPreview(PictureBox box, Bitmap? bmp)
    {
        var old = box.Image;
        box.Image = bmp;
        old?.Dispose();
    }

    static string[] DroppedZips(DragEventArgs e) =>
        e.Data?.GetData(DataFormats.FileDrop) is string[] files
            ? files.Where(f => f.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)).ToArray()
            : Array.Empty<string>();

    void PickRom()
    {
        using var dlg = new OpenFileDialog
        {
            Filter = L("MAME 네오지오 롬셋", "MAME Neo Geo romset") + " (*.zip)|*.zip",
            Title = L("MAME 롬셋 zip 선택 (여러 개 가능)", "Pick MAME romset zips (one or more)"),
            Multiselect = true,
        };
        if (dlg.ShowDialog(this) == DialogResult.OK) LoadRoms(dlg.FileNames);
    }

    static bool IsBios(string zip) => Path.GetFileName(zip).Equals("neogeo.zip", StringComparison.OrdinalIgnoreCase);

    void LoadRoms(string[] zips)
    {
        var games = zips.Where(z => !IsBios(z)).OrderBy(z => Path.GetFileName(z), StringComparer.OrdinalIgnoreCase).ToArray();
        if (games.Length == 1) LoadRom(games[0]);
        else if (games.Length > 1) LoadBatch(games);
        else if (zips.Length > 0) LoadRom(zips[0]); /* only neogeo.zip: says it is the BIOS */
    }

    /// <summary>The fields that only make sense for one game are switched off while several are picked.</summary>
    void SetSingleFields(bool single)
    {
        titleBox.Enabled = iconBox.Enabled = bannerBox.Enabled = single;
        if (iconButtons != null) iconButtons.Enabled = single;
        if (bannerButtons != null) bannerButtons.Enabled = single;
        if (single) return;
        titleBox.Text = L("(게임마다 자동)", "(automatic for each game)");
        iconBox.Text = bannerBox.Text = "";
        SetPreview(iconPreview, null);
        SetPreview(bannerPreview, null);
    }

    void LoadBatch(string[] zips)
    {
        job = null;
        batch.Clear();
        Log("");
        foreach (var zip in zips)
        {
            var j = CiaJob.FromRomZip(zip);
            batch.Add(j);
            if (j.Game == null) Log($"  ✘ {j.RomName}: {j.Problem}");
            else if (j.BiosZip == null) Log($"  ✘ {j.RomName}: " + L("같은 폴더에 neogeo.zip 없음", "no neogeo.zip in the same folder"));
            else Log($"  ✔ {j.RomName}: {j.Title}");
        }
        int ok = batch.Count(Buildable), noBios = batch.Count(j => j.BiosZip == null);
        SetSingleFields(false);
        romBox.Text = L($"{batch.Count}개 선택", $"{batch.Count} zips");
        setLabel.Text = ok == batch.Count ? L($"✔ 모두 변환 가능 ({ok}개)", $"✔ all {ok} can be converted")
            : L($"변환 가능 {ok}개 / 불가 {batch.Count - ok}개 (아래 기록 참고)", $"{ok} can be converted, {batch.Count - ok} can't (see the log)");
        setLabel.ForeColor = ok == batch.Count ? Color.ForestGreen : ok > 0 ? Color.DarkOrange : Color.Firebrick;
        biosLabel.Text = noBios == 0 ? L("✔ neogeo.zip 발견", "✔ neogeo.zip found")
            : L($"✘ neogeo.zip 없는 폴더의 롬 {noBios}개", $"✘ {noBios} zips have no neogeo.zip next to them");
        biosLabel.ForeColor = noBios == 0 ? Color.ForestGreen : Color.Firebrick;
        outBox.Text = batch[0].OutputDir;
        buildButton.Text = L($"CIA {ok}개 만들기", $"Build {ok} CIAs");
        packButton.Text = L($"런처용 파일 {ok}개 만들기", $"{ok} launcher files");
        SetBuildEnabled(ok > 0);
        Log(L($"{batch.Count}개 선택: 변환 가능 {ok}개", $"{batch.Count} zips picked, {ok} can be converted"));
    }

    Neo3dsConverter.Region SelectedRegion => regionBox.SelectedIndex switch
    {
        1 => Neo3dsConverter.Region.Japan, 2 => Neo3dsConverter.Region.Usa, _ => Neo3dsConverter.Region.Europe,
    };

    static bool Buildable(CiaJob j) => j.Game != null && j.BiosZip != null;

    void PickOutput()
    {
        using var dlg = new FolderBrowserDialog { SelectedPath = outBox.Text };
        if (dlg.ShowDialog(this) == DialogResult.OK) outBox.Text = dlg.SelectedPath;
    }

    void LoadRom(string zip)
    {
        if (IsBios(zip))
        {
            Log(L("neogeo.zip은 바이오스입니다. 게임 롬 zip을 선택하세요.", "neogeo.zip is the BIOS. Pick a game zip."));
            return;
        }
        batch.Clear();
        SetSingleFields(true);
        buildButton.Text = L("CIA 만들기", "Build CIA");
        packButton.Text = L("런처용 파일 만들기", "Launcher file");
        job = CiaJob.FromRomZip(zip);
        romBox.Text = job.RomZip;
        titleBox.Text = job.Title;
        outBox.Text = job.OutputDir;
        biosLabel.Text = job.BiosZip != null ? L("✔ neogeo.zip 발견", "✔ neogeo.zip found") : L("✘ neogeo.zip 없음 (롬과 같은 폴더에 넣어주세요)", "✘ no neogeo.zip (put it next to the game zip)");
        biosLabel.ForeColor = job.BiosZip != null ? Color.ForestGreen : Color.Firebrick;
        setLabel.Text = job.Game != null ? $"✔ {job.Game.Name} - {job.Game.Desc}" : "✘ " + job.Problem;
        setLabel.ForeColor = job.Game != null ? Color.ForestGreen : Color.Firebrick;
        SetBuildEnabled(job.BiosZip != null && job.Game != null);
        Log(L("선택: ", "Selected: ") + $"{Path.GetFileName(zip)}  (Title ID {job.TitleId})");
        if (job.Game == null) Log(L("변환 불가: ", "Can't convert: ") + job.Problem);
        UpdatePreview();
    }

    void SetBuildEnabled(bool on) => buildButton.Enabled = packButton.Enabled = on;

    static string Built(bool pack, string file) => pack
        ? L($"런처용 파일을 만들었습니다. SD카드의 /neo3ds/games/ 폴더에 복사하세요 (런처 CIA가 설치돼 있어야 합니다).\n\n{file}",
            $"The launcher file is ready. Copy it to /neo3ds/games/ on the SD card (the launcher CIA must be installed).\n\n{file}")
        : L("CIA를 만들었습니다.", "The CIA is ready.") + $"\n\n{file}";

    async Task BuildLauncherAsync()
    {
        string dir = string.IsNullOrWhiteSpace(outBox.Text) ? AppContext.BaseDirectory : outBox.Text;
        launcherButton.Enabled = false;
        UseWaitCursor = true;
        try
        {
            var builder = new CiaBuilder(msg => BeginInvoke(() => Log(msg)));
            string cia = await Task.Run(() => builder.BuildLauncher(dir));
            Log(L("FBI로 한 번만 설치하세요. 게임은 [런처용 파일 만들기]로 만든 .neo3ds 파일을 SD카드의 /neo3ds/games/에 넣으면 목록에 나옵니다.",
                  "Install it once with FBI. Games appear in its list when their .neo3ds files (from [Launcher file]) are in /neo3ds/games/ on the SD card."));
            MessageBox.Show(this, L("런처 CIA를 만들었습니다.", "The launcher CIA is ready.") + $"\n\n{cia}", L("완료", "Done"), MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception e)
        {
            Log(L("오류: ", "Error: ") + e.Message);
            MessageBox.Show(this, e.Message, L("실패", "Failed"), MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            launcherButton.Enabled = true;
            UseWaitCursor = false;
        }
    }

    async Task BuildAsync(bool pack)
    {
        if (batch.Count > 0) { await BuildBatchAsync(pack); return; }
        if (job == null) return;
        job.Title = CurrentTitle;
        job.IconImage = IconImage;
        job.BannerImage = BannerImage;
        job.StartMvs = systemBox.SelectedIndex switch { 1 => false, 2 => true, _ => null };
        job.Region = SelectedRegion;
        job.OutputDir = outBox.Text;
        SetBuildEnabled(false);
        UseWaitCursor = true;
        try
        {
            var builder = new CiaBuilder(msg => BeginInvoke(() => Log(msg)));
            string file = await Task.Run(() => pack ? builder.BuildPack(job) : builder.Build(job));
            if (!pack) Log(L("FBI로 설치하세요: SD카드에 복사 → FBI → SD → 파일 선택 → Install CIA", "Install with FBI: copy to the SD card → FBI → SD → pick the file → Install CIA"));
            MessageBox.Show(this, Built(pack, file), L("완료", "Done"), MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception e)
        {
            Log(L("오류: ", "Error: ") + e.Message);
            MessageBox.Show(this, e.Message, L("실패", "Failed"), MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            SetBuildEnabled(true);
            UseWaitCursor = false;
        }
    }

    async Task BuildBatchAsync(bool pack)
    {
        var jobs = batch.Where(Buildable).ToList();
        bool? startMvs = systemBox.SelectedIndex switch { 1 => false, 2 => true, _ => null };
        var done = new List<string>();
        var failed = new List<string>();
        string title = Text;
        SetBuildEnabled(false);
        UseWaitCursor = true;
        try
        {
            for (int i = 0; i < jobs.Count; i++)
            {
                var j = jobs[i];
                j.StartMvs = startMvs;
                j.Region = SelectedRegion;
                j.OutputDir = outBox.Text;
                Log("");
                Log($"[{i + 1}/{jobs.Count}] {j.RomName} - {j.Title}");
                Text = $"[{i + 1}/{jobs.Count}] {j.RomName} - {title}";
                try
                {
                    var builder = new CiaBuilder(msg => BeginInvoke(() => Log(msg)));
                    await Task.Run(() => pack ? builder.BuildPack(j) : builder.Build(j));
                    done.Add(j.RomName);
                }
                catch (Exception e)
                {
                    Log(L("오류: ", "Error: ") + e.Message);
                    failed.Add($"{j.RomName}: {e.Message}");
                }
            }
            Log("");
            Log(L($"끝: 성공 {done.Count}개, 실패 {failed.Count}개", $"Finished: {done.Count} built, {failed.Count} failed"));
            if (!pack) Log(L("FBI로 설치하세요: SD카드에 복사 → FBI → SD → 파일 선택 → Install CIA", "Install with FBI: copy to the SD card → FBI → SD → pick the file → Install CIA"));
            string msg = (pack ? L($"런처용 파일 {done.Count}개를 만들었습니다. SD카드의 /neo3ds/games/에 복사하세요.", $"{done.Count} launcher files are ready. Copy them to /neo3ds/games/ on the SD card.")
                : L($"CIA {done.Count}개를 만들었습니다.", $"{done.Count} CIAs are ready.")) + $"\n\n{outBox.Text}";
            if (failed.Count > 0) msg += "\n\n" + L("실패:", "Failed:") + "\n" + string.Join("\n", failed);
            MessageBox.Show(this, msg, L("완료", "Done"), MessageBoxButtons.OK, failed.Count > 0 ? MessageBoxIcon.Warning : MessageBoxIcon.Information);
        }
        finally
        {
            Text = title;
            SetBuildEnabled(true);
            UseWaitCursor = false;
        }
    }

    void Log(string msg) => logBox.AppendText(msg + Environment.NewLine);
}
