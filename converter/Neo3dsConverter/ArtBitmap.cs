using System.Drawing;

namespace Neo3dsConverter;

/// <summary>Owns the decoded PNG pixels independently of the input stream.</summary>
static class ArtBitmap
{
    public static Bitmap ToBitmap(this byte[] png)
    {
        using var stream = new MemoryStream(png);
        using var decoded = new Bitmap(stream);
        return new Bitmap(decoded);
    }
}
