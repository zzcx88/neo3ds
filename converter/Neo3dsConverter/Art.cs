using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Text.RegularExpressions;

namespace Neo3dsConverter;

/// <summary>HOME menu icon (48x48) and banner (256x128): the user's own pictures when given,
/// otherwise generated from the game title on a dark red gradient.</summary>
public static class Art
{
    public const int IconSize = 48, BannerW = 256, BannerH = 128;

    static readonly Color Top = Color.FromArgb(20, 24, 40);
    static readonly Color Bottom = Color.FromArgb(120, 16, 24);
    static readonly Color Gold = Color.FromArgb(232, 190, 80);

    public static Bitmap Icon(string title, string? image) =>
        image != null ? Fit(image, IconSize, IconSize) : RenderIcon(title);

    public static Bitmap Banner(string title, string? image) =>
        image != null ? Fit(image, BannerW, BannerH) : RenderBanner(title);

    /// <summary>Scales a picture to cover w x h and crops the overflow evenly from both sides.</summary>
    static Bitmap Fit(string path, int w, int h)
    {
        using var src = Image.FromFile(path);
        var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using var g = Graphics.FromImage(bmp);
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        float scale = Math.Max((float)w / src.Width, (float)h / src.Height);
        float sw = src.Width * scale, sh = src.Height * scale;
        using var attr = new ImageAttributes();
        attr.SetWrapMode(WrapMode.TileFlipXY); // no dark fringe at the edges
        g.DrawImage(src, new Rectangle((int)Math.Round((w - sw) / 2), (int)Math.Round((h - sh) / 2),
                                       (int)Math.Round(sw), (int)Math.Round(sh)),
                    0, 0, src.Width, src.Height, GraphicsUnit.Pixel, attr);
        return bmp;
    }

    static (Bitmap, Graphics) Canvas(int w, int h, int border)
    {
        var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        var g = Graphics.FromImage(bmp);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        using (var bg = new LinearGradientBrush(new Rectangle(0, 0, w, h), Top, Bottom, 90f))
            g.FillRectangle(bg, 0, 0, w, h);
        using (var pen = new Pen(Gold, border))
            g.DrawRectangle(pen, border / 2f, border / 2f, w - border, h - border);
        return (bmp, g);
    }

    /// <summary>Banner: NEO·GEO tag, the main title as large as fits, the subtitle under it.</summary>
    static Bitmap RenderBanner(string title)
    {
        var (bmp, g) = Canvas(BannerW, BannerH, 4);
        using (g)
        {
            using (var tag = new Font("Arial Black", 14f, FontStyle.Bold, GraphicsUnit.Pixel))
            using (var gold = new SolidBrush(Gold))
                g.DrawString("NEO·GEO", tag, gold, 10, 8);

            var (main, sub) = SplitTitle(title);
            var area = new RectangleF(12, 30, BannerW - 24, BannerH - 40);
            if (sub != null)
            {
                var subArea = new RectangleF(area.X, area.Bottom - 22, area.Width, 22);
                DrawFitted(g, sub, "Arial", FontStyle.Bold, 16f, subArea, Gold, 1);
                area.Height -= 24;
            }
            DrawFitted(g, main, "Arial", FontStyle.Bold, 40f, area, Color.White, 2);
        }
        return bmp;
    }

    /// <summary>Icon: a three letter abbreviation over the series number ("KOF" / "98").</summary>
    static Bitmap RenderIcon(string title)
    {
        var (bmp, g) = Canvas(IconSize, IconSize, 2);
        using (g)
        {
            var (abbr, number) = Abbreviate(title);
            if (number == null)
                DrawFitted(g, abbr, "Arial Black", FontStyle.Regular, 22f, new RectangleF(6, 6, 36, 36), Color.White, 1);
            else
            {
                DrawFitted(g, abbr, "Arial Black", FontStyle.Regular, 20f, new RectangleF(5, 4, 38, 21), Color.White, 1);
                DrawFitted(g, number, "Arial Black", FontStyle.Regular, 20f, new RectangleF(5, 24, 38, 20), Gold, 1);
            }
        }
        return bmp;
    }

    /// <summary>Draws text centered in the box, shrinking it until every line fits whole.</summary>
    static void DrawFitted(Graphics g, string text, string family, FontStyle style, float maxSize, RectangleF box,
                           Color color, int maxLines)
    {
        using var fmt = new StringFormat(StringFormat.GenericTypographic)
        {
            Alignment = StringAlignment.Center,
            LineAlignment = StringAlignment.Center,
            Trimming = StringTrimming.None,
        };
        if (maxLines == 1) fmt.FormatFlags |= StringFormatFlags.NoWrap;
        for (float size = maxSize; ; size -= 0.5f)
        {
            using var font = new Font(family, size, style, GraphicsUnit.Pixel);
            var need = g.MeasureString(text, font, maxLines == 1 ? int.MaxValue : (int)box.Width, fmt);
            int lines = (int)Math.Round(need.Height / font.GetHeight(g));
            if ((need.Width <= box.Width && need.Height <= box.Height && lines <= maxLines && !BreaksWord(g, text, font, box.Width))
                || size <= 6f)
            {
                using var brush = new SolidBrush(color);
                using var shadow = new SolidBrush(Color.FromArgb(160, 0, 0, 0));
                var shadowBox = box;
                shadowBox.Offset(1, 1);
                g.DrawString(text, font, shadow, shadowBox, fmt);
                g.DrawString(text, font, brush, box, fmt);
                return;
            }
        }
    }

    /// <summary>True when a single word is wider than the box (it would be split mid-word).</summary>
    static bool BreaksWord(Graphics g, string text, Font font, float width) =>
        text.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Any(w => g.MeasureString(w, font, int.MaxValue, StringFormat.GenericTypographic).Width > width);

    /// <summary>"Metal Slug X - Super Vehicle-001" -> ("Metal Slug X", "Super Vehicle-001").</summary>
    public static (string main, string? sub) SplitTitle(string title)
    {
        int i = title.IndexOf(" - ", StringComparison.Ordinal);
        return i > 0 ? (title[..i].Trim(), title[(i + 3)..].Trim()) : (title.Trim(), null);
    }

    static readonly Regex NumberWord = new(@"^('?\d+|\d+(st|nd|rd|th)|[IVX]+|EX|DX|R|SP)$", RegexOptions.IgnoreCase);
    static readonly HashSet<string> SkipWords = new(StringComparer.OrdinalIgnoreCase) { "The", "A", "An" };

    /// <summary>
    /// "The King of Fighters '98" -> ("KOF", "98"), "Metal Slug X" -> ("MSL", "X"), "Garou" -> ("GAR", null).
    /// Initials of the words before the series number; short names borrow letters from the last word.
    /// </summary>
    public static (string abbr, string? number) Abbreviate(string title)
    {
        string main = SplitTitle(title).main;
        main = Regex.Replace(main, @"[:!?.,~]", " ");
        var words = main.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToList();
        while (words.Count > 1 && SkipWords.Contains(words[0])) words.RemoveAt(0);

        // "Special" editions read as a number: "Fatal Fury Special" -> FFU / SP
        for (int i = 1; i < words.Count; i++)
            if (words[i].Equals("Special", StringComparison.OrdinalIgnoreCase)) words[i] = "SP";

        string? number = null;
        for (int i = 1; i < words.Count; i++) // first number word: "Samurai Shodown V SP" -> V SP
            if (NumberWord.IsMatch(words[i]))
            {
                number = words[i].TrimStart('\'').ToUpperInvariant();
                string rest = string.Join(" ", words.Skip(i + 1)).ToUpperInvariant();
                if (rest.Length > 0 && number.Length + 1 + rest.Length <= 6) number += " " + rest;
                words = words.Take(i).ToList();
                break;
            }

        var clean = words.Select(w => new string(w.Where(char.IsLetterOrDigit).ToArray()))
                         .Where(w => w.Length > 0).ToList();
        if (clean.Count == 0) clean.Add(main.Replace(" ", ""));
        string abbr = clean.Count switch
        {
            1 => clean[0],
            2 => clean[0][..1] + clean[1],
            _ => string.Concat(clean.Take(3).Select(w => w[0])),
        };
        abbr = abbr.ToUpperInvariant();
        if (abbr.Length > 3) abbr = abbr[..3];
        return (abbr, number);
    }

    /// <summary>Banners need a sound clip; 0.5 s of silence keeps the HOME menu quiet.</summary>
    public static void SaveSilentWav(string path)
    {
        const int rate = 22050, samples = rate / 2;
        using var w = new BinaryWriter(File.Create(path));
        w.Write("RIFF"u8); w.Write(36 + samples * 2); w.Write("WAVE"u8);
        w.Write("fmt "u8); w.Write(16); w.Write((short)1); w.Write((short)1);
        w.Write(rate); w.Write(rate * 2); w.Write((short)2); w.Write((short)16);
        w.Write("data"u8); w.Write(samples * 2); w.Write(new byte[samples * 2]);
    }
}
