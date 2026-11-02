using QRCoder;

namespace Neo3dsConverter;

/// <summary>QR images for the "send to 3DS" dialogs (#235).</summary>
public static class QrCode
{
    /// <summary>
    /// Medium error correction, one pixel per module: the smallest lossless rendering. The dialogs
    /// scale it up by a whole number with nearest-neighbour filtering, so no blurry resampling and
    /// no oversized PNG is generated here.
    /// </summary>
    public static byte[] Png(string text)
    {
        using var generator = new QRCodeGenerator();
        using QRCodeData data = generator.CreateQrCode(text, QRCodeGenerator.ECCLevel.M);
        return new PngByteQRCode(data).GetGraphic(1);
    }
}
