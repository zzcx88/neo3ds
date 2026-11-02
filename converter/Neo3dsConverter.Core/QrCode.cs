using QRCoder;

namespace Neo3dsConverter;

/// <summary>QR images for the "send to 3DS" dialog (#225). PNG bytes so both GUIs can show them.</summary>
public static class QrCode
{
    /// <summary>Medium error correction: enough for a printed or on-screen code, still small on screen.</summary>
    public static byte[] Png(string text, int pixelsPerModule = 6)
    {
        using var generator = new QRCodeGenerator();
        using QRCodeData data = generator.CreateQrCode(text, QRCodeGenerator.ECCLevel.M);
        return new PngByteQRCode(data).GetGraphic(pixelsPerModule);
    }
}
