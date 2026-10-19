using SkiaSharp;
using System.Text.RegularExpressions;

namespace Neo3dsConverter;

/// <summary>HOME menu icon (48x48) and banner (256x128): the user's own pictures when given,
/// otherwise generated from the game title on a dark red gradient.</summary>
public static class Art
{
    public const int IconSize = 48, BannerW = 256, BannerH = 128;

    static readonly SKColor Top = new(20, 24, 40);
    static readonly SKColor Bottom = new(120, 16, 24);
    static readonly SKColor Gold = new(232, 190, 80);

    public static byte[] Icon(string title, string? image) => CreatePng(title, image, false);

    public static byte[] Banner(string title, string? image) => CreatePng(title, image, true);

    static byte[] CreatePng(string title, string? image, bool banner)
    {
        using var bitmap = image != null
            ? Fit(image, banner ? BannerW : IconSize, banner ? BannerH : IconSize)
            : banner ? RenderBanner(title) : RenderIcon(title);
        using var encoded = bitmap.Encode(SKEncodedImageFormat.Png, 100);
        return encoded.ToArray();
    }

    /// <summary>Scales a picture to cover w x h and crops the overflow evenly from both sides.</summary>
    static SKBitmap Fit(string path, int w, int h)
    {
        using var src = SKBitmap.Decode(path)
            ?? throw new InvalidDataException($"Cannot decode image: {path}");
        var bmp = new SKBitmap(w, h);
        using var canvas = new SKCanvas(bmp);
        canvas.Clear(SKColors.Transparent);
        float scale = Math.Max((float)w / src.Width, (float)h / src.Height);
        float sw = src.Width * scale, sh = src.Height * scale;
        float x = (float)Math.Round((w - sw) / 2), y = (float)Math.Round((h - sh) / 2);
        // Cubic sampling replaces SKFilterQuality.High in SkiaSharp 4.x.
        using var shader = src.ToShader(SKShaderTileMode.Mirror, SKShaderTileMode.Mirror,
                                        new SKSamplingOptions(SKCubicResampler.Mitchell));
        using var paint = new SKPaint { Shader = shader };
        canvas.Translate(x, y);
        canvas.Scale((float)Math.Round(sw) / src.Width, (float)Math.Round(sh) / src.Height);
        canvas.DrawRect(0, 0, src.Width, src.Height, paint);
        return bmp;
    }

    static (SKBitmap, SKCanvas) Canvas(int w, int h, int border)
    {
        var bmp = new SKBitmap(w, h);
        var canvas = new SKCanvas(bmp);
        using var bg = SKShader.CreateLinearGradient(new SKPoint(0, 0), new SKPoint(0, h),
                                                     new[] { Top, Bottom }, SKShaderTileMode.Clamp);
        using var paint = new SKPaint { IsAntialias = true, Shader = bg };
        canvas.DrawRect(0, 0, w, h, paint);
        using var pen = new SKPaint { IsAntialias = true, Color = Gold,
                                     Style = SKPaintStyle.Stroke, StrokeWidth = border };
        canvas.DrawRect(border / 2f, border / 2f, w - border, h - border, pen);
        return (bmp, canvas);
    }

    // Arial Black is its own family on macOS but only the Black weight of "Arial" on Windows (DirectWrite);
    // without either, the platform's sans face in the same weight.
    static readonly SKTypeface Heavy = Face("Arial Black", SKFontStyle.Normal) ?? Face("Arial", Weight(SKFontStyleWeight.Black))
                                       ?? SKTypeface.FromFamilyName(null, Weight(SKFontStyleWeight.Black));
    static readonly SKTypeface BoldFace = Face("Arial", SKFontStyle.Bold) ?? SKTypeface.FromFamilyName(null, SKFontStyle.Bold);

    static SKTypeface? Face(string family, SKFontStyle style) => SKFontManager.Default.MatchFamily(family, style);
    static SKFontStyle Weight(SKFontStyleWeight w) => new(w, SKFontStyleWidth.Normal, SKFontStyleSlant.Upright);

    /// <summary>Banner: NEO·GEO tag, the main title as large as fits, the subtitle under it.</summary>
    static SKBitmap RenderBanner(string title)
    {
        var (bmp, canvas) = Canvas(BannerW, BannerH, 4);
        using (canvas)
        {
            using var tag = new SKFont(Heavy, 14f);
            using var gold = new SKPaint { IsAntialias = true, Color = Gold };
            canvas.DrawText("NEO·GEO", 10, 8 - tag.Metrics.Ascent, SKTextAlign.Left, tag, gold);

            var (main, sub) = SplitTitle(title);
            var area = SKRect.Create(12, 30, BannerW - 24, BannerH - 40);
            if (sub != null)
            {
                var subArea = SKRect.Create(area.Left, area.Bottom - 22, area.Width, 22);
                DrawFitted(canvas, sub, BoldFace, 16f, subArea, Gold, 1);
                area.Bottom -= 24;
            }
            DrawFitted(canvas, main, BoldFace, 40f, area, SKColors.White, 2);
        }
        return bmp;
    }

    /// <summary>Icon: a three letter abbreviation over the series number ("KOF" / "98").</summary>
    static SKBitmap RenderIcon(string title)
    {
        var (bmp, canvas) = Canvas(IconSize, IconSize, 2);
        using (canvas)
        {
            var (abbr, number) = Abbreviate(title);
            if (number == null)
                DrawFitted(canvas, abbr, Heavy, 22f, SKRect.Create(6, 6, 36, 36), SKColors.White, 1);
            else
            {
                DrawFitted(canvas, abbr, Heavy, 20f, SKRect.Create(5, 4, 38, 21), SKColors.White, 1);
                DrawFitted(canvas, number, Heavy, 20f, SKRect.Create(5, 24, 38, 20), Gold, 1);
            }
        }
        return bmp;
    }

    /// <summary>Draws text centered in the box, shrinking it until every line fits whole.</summary>
    static void DrawFitted(SKCanvas canvas, string text, SKTypeface face, float maxSize, SKRect box,
                           SKColor color, int maxLines)
    {
        for (float size = maxSize; ; size -= 0.5f)
        {
            using var font = new SKFont(face, size);
            var lines = WrapLines(text, font, maxLines == 1 ? float.MaxValue : box.Width);
            var metrics = font.Metrics;
            float lineHeight = metrics.Descent - metrics.Ascent + metrics.Leading;
            float height = lines.Count * lineHeight;
            if ((lines.All(line => font.MeasureText(line) <= box.Width) && height <= box.Height
                 && lines.Count <= maxLines && !BreaksWord(text, font, box.Width)) || size <= 6f)
            {
                using var paint = new SKPaint { IsAntialias = true, Color = color };
                using var shadow = new SKPaint { IsAntialias = true, Color = new SKColor(0, 0, 0, 160) };
                float y = box.MidY - height / 2 - metrics.Ascent;
                canvas.Save();
                canvas.ClipRect(SKRect.Create(box.Left, box.Top, box.Width + 1, box.Height + 1));
                foreach (string line in lines)
                {
                    canvas.DrawText(line, box.MidX + 1, y + 1, SKTextAlign.Center, font, shadow);
                    canvas.DrawText(line, box.MidX, y, SKTextAlign.Center, font, paint);
                    y += lineHeight;
                }
                canvas.Restore();
                return;
            }
        }
    }

    // Wrap at spaces; only split an oversized word when the minimum font size is reached.
    static List<string> WrapLines(string text, SKFont font, float width)
    {
        var lines = new List<string>();
        foreach (string paragraph in text.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n'))
        {
            string line = "";
            foreach (string word in paragraph.Split(' ', StringSplitOptions.RemoveEmptyEntries))
            {
                string next = line.Length == 0 ? word : line + " " + word;
                if (line.Length > 0 && font.MeasureText(next) > width)
                {
                    lines.Add(line);
                    line = word;
                }
                else line = next;
                while (font.Size <= 6f && line.Length > 1 && font.MeasureText(line) > width)
                {
                    int length = 1;
                    while (length < line.Length && font.MeasureText(line[..(length + 1)]) <= width) length++;
                    lines.Add(line[..length]);
                    line = line[length..];
                }
            }
            lines.Add(line);
        }
        return lines;
    }

    /// <summary>True when a single word is wider than the box (it would be split mid-word).</summary>
    static bool BreaksWord(string text, SKFont font, float width) =>
        text.Split(' ', StringSplitOptions.RemoveEmptyEntries).Any(w => font.MeasureText(w) > width);

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
