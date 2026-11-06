using System.Text;
using QRCoder;

namespace Neo3dsConverter;

/// <summary>QR images for the "send to 3DS" dialogs (#235, #264).</summary>
public static class QrCode
{
    /// <summary>Version 12 (65 modules) plus the 4-module quiet zone on each side.</summary>
    public const int BatchMaxModules = 73;

    /// <summary>
    /// Medium error correction, one pixel per module: the smallest lossless rendering. The dialogs
    /// scale it up by a whole number with nearest-neighbour filtering, so no blurry resampling and
    /// no oversized PNG is generated here.
    /// </summary>
    public static byte[] Png(string text) => Create(text, QRCodeGenerator.ECCLevel.M);

    /// <summary>#264: a URL list uses low error correction so up to six files fit in version 12.</summary>
    public static byte[] BatchPng(string text) => Create(text, QRCodeGenerator.ECCLevel.L);

    static byte[] Create(string text, QRCodeGenerator.ECCLevel level)
    {
        using var generator = new QRCodeGenerator();
        using QRCodeData data = generator.CreateQrCode(text, level);
        return new PngByteQRCode(data).GetGraphic(1);
    }

    /// <summary>The module count including the quiet zone, for a batch QR.</summary>
    public static int BatchModules(string text)
    {
        using var generator = new QRCodeGenerator();
        using QRCodeData data = generator.CreateQrCode(text, QRCodeGenerator.ECCLevel.L);
        return data.ModuleMatrix.Count;
    }

    /// <summary>
    /// #264/#312: how many of <paramref name="urls"/>, in order, still fit one version-12 QR. The PC
    /// reports this count instead of splitting a selection; 0 means even the first URL is too big.
    /// The product renders and measures the same text with QRCoder, so this follows the encoder's
    /// real output (its mixed numeric/alphanumeric/byte segments), not a 367-byte byte-mode table.
    /// </summary>
    public static int BatchAllowedCount(IReadOnlyList<string> urls)
    {
        var text = new StringBuilder();
        int allowed = 0;
        for (int i = 0; i < urls.Count; i++)
        {
            if (i > 0) text.Append('\n');
            text.Append(urls[i]);
            if (BatchModules(text.ToString()) > BatchMaxModules) break;
            allowed = i + 1;
        }
        return allowed;
    }
}
