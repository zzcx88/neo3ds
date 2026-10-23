using Avalonia.Media.Fonts;

namespace Neo3dsConverter.Desktop;

/// <summary>Bundled Noto Sans KR (Linux only, D7a). Reference as "fonts:NotoSansKR#Noto Sans KR".</summary>
public sealed class NotoFontCollection : EmbeddedFontCollection
{
    public NotoFontCollection() : base(
        new Uri("fonts:NotoSansKR", UriKind.Absolute),
        new Uri("avares://neo3ds-converter/Assets/Fonts", UriKind.Absolute))
    {
    }
}
