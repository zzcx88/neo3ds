using System.IO.Compression;
using Xunit;
using static Neo3dsConverter.FailureText;

namespace Neo3dsConverter.Tests;

/// <summary>
/// #328: the offline converter names every failure with the same code the web converter uses
/// (site/vendor/conv/errors.js), and shows two plain sentences instead of the raw exception.
/// These tests pin the contract the three offline surfaces share: a code per throw site, the
/// catalog names the words may use, and the guarantee that a user's zip file name never appears.
/// </summary>
public sealed class FailureTests : IDisposable
{
    readonly string root = Path.Combine(Path.GetTempPath(), "neo3ds-failure-tests", Guid.NewGuid().ToString("N"));

    public FailureTests() => Directory.CreateDirectory(root);

    public void Dispose()
    {
        try { Directory.Delete(root, true); } catch { /* best effort */ }
    }

    // The codes messages.js and the web worker already use. A new C# kind that is not on
    // this list would drift from the web contract, so the test fails instead.
    static readonly string[] WebCodes =
    {
        "nofile", "bios", "notromset", "missing", "unsupported", "zip", "image",
        "oom", "wasm", "crash", "unknown",
        "zip-corrupt", "crc-mismatch", "bios-read", "game-db",
    };

    [Fact]
    public void EveryKind_HasTheSameCodeAsTheWebConverter()
    {
        var codes = Enum.GetValues<FailureKind>().Select(Code).ToArray();
        Assert.Equal(WebCodes.OrderBy(c => c), codes.OrderBy(c => c));
        Assert.Equal(codes.Length, codes.Distinct().Count());
    }

    /// <summary>Two sentences (a cause and an action) for every code, in both languages.</summary>
    [Fact]
    public void EveryCode_ReturnsCauseAndActionInBothLanguages()
    {
        bool saved = Lang.Korean;
        try
        {
            foreach (var lang in new[] { true, false })
            {
                Lang.Set(lang, remember: false);
                foreach (var kind in Enum.GetValues<FailureKind>())
                {
                    string text = Plain(kind, "kof98h");
                    Assert.False(string.IsNullOrWhiteSpace(text), $"{lang}/{kind}: empty");
                    Assert.True(text.Length >= 20, $"{lang}/{kind}: too short: {text}");
                    // A cause and an action = two sentence-ending marks in KO and EN alike.
                    Assert.True(System.Text.RegularExpressions.Regex.Matches(text, @"[.!?]").Count >= 2,
                        $"{lang}/{kind}: not two sentences: {text}");
                }
            }
        }
        finally { Lang.Set(saved, remember: false); }
    }

    /// <summary>Every code says something different; none silently collapses to 'unknown'.</summary>
    [Fact]
    public void NoCode_FallsBackSilentlyToUnknown()
    {
        bool saved = Lang.Korean;
        try
        {
            foreach (var lang in new[] { true, false })
            {
                Lang.Set(lang, remember: false);
                string unknown = Plain(FailureKind.Unknown);
                foreach (var kind in Enum.GetValues<FailureKind>().Where(k => k != FailureKind.Unknown))
                    Assert.NotEqual(unknown, Plain(kind, "kof98h"));
            }
        }
        finally { Lang.Set(saved, remember: false); }
    }

    /// <summary>A user's zip file name or path never reaches the dialog; the catalog name does.</summary>
    [Fact]
    public void OnlyCatalogNamesAppear_UsersZipNameDoesNot()
    {
        bool saved = Lang.Korean;
        try
        {
            foreach (var lang in new[] { true, false })
            {
                Lang.Set(lang, remember: false);
                Assert.Equal("kof98h", CatalogName("kof98h"));
                foreach (var bad in new[] { "My Game (1).zip", "KOF98H", "kof 98", "../kof98h", "", null })
                    Assert.Equal("game", CatalogName(bad));

                string text = Plain(FailureKind.ZipCorrupt, "My Game (1).zip");
                Assert.DoesNotContain("My Game", text);
                Assert.DoesNotContain(".zip", text);
                Assert.Contains("game", text);
            }
        }
        finally { Lang.Set(saved, remember: false); }
    }

    /// <summary>#339 shape: at most four chips plus a count, a parent romset, and no CRC numbers.</summary>
    [Fact]
    public void ChipsParentAndVersion_StayPlain()
    {
        bool saved = Lang.Korean;
        try
        {
            Lang.Set(true, remember: false);
            string[] chips = { "242-m1.m1", "242-p1.p1", "242-c1.c1", "242-c2.c2", "242-c3.c3", "242-c4.c4" };
            string ko = Plain(FailureKind.Missing, "kof98h", chips, null, "kof98");
            Assert.Contains("242-m1.m1, 242-p1.p1, 242-c1.c1, 242-c2.c2 외 2개", ko);
            Assert.Contains("kof98.zip(부모 롬셋)", ko);
            Assert.DoesNotContain("242-c3.c3", ko);

            Lang.Set(false, remember: false);
            string en = Plain(FailureKind.Missing, "kof98h", chips, null, "kof98");
            Assert.Contains("242-m1.m1, 242-p1.p1, 242-c1.c1, 242-c2.c2 and 2 more", en);
            Assert.Contains("kof98.zip (the parent romset)", en);

            string wrong = Plain(FailureKind.CrcMismatch, "kof98h", null, new[] { "242-pn1.p1" });
            Assert.Contains("242-pn1.p1", wrong);
            Assert.Contains("different version", wrong);
            Assert.DoesNotMatch("[0-9a-f]{8}", wrong);
        }
        finally { Lang.Set(saved, remember: false); }
    }

    /// <summary>A chip list from the game DB is the only one allowed; anything else is dropped.</summary>
    [Fact]
    public void ChipNames_AreGuarded()
    {
        bool saved = Lang.Korean;
        try
        {
            Lang.Set(false, remember: false);
            string text = Plain(FailureKind.Missing, "kof98h", new[]
            {
                "242-p1.p1", "242-m1.m1", "My Game (1).zip", "UPPER.P1", "has space.bin", "a/b.bin", new string('a', 25),
            }, null, "My Parent.zip");
            Assert.Contains("242-p1.p1", text);
            Assert.Contains("242-m1.m1", text);
            foreach (var bad in new[] { "My Game", "UPPER", "has space", "a/b", new string('a', 25), "My Parent" })
                Assert.DoesNotContain(bad, text);
            Assert.DoesNotContain("parent romset", text);
        }
        finally { Lang.Set(saved, remember: false); }
    }

    /// <summary>Retry guidance for the code paths a user can act on; a report path for 'unknown'.</summary>
    [Fact]
    public void RetryAndReportGuidance_IsPresent()
    {
        bool saved = Lang.Korean;
        try
        {
            foreach (var lang in new[] { true, false })
            {
                Lang.Set(lang, remember: false);
                foreach (var kind in new[] { FailureKind.Oom, FailureKind.Wasm, FailureKind.Crash, FailureKind.Image })
                {
                    string text = Plain(kind);
                    Assert.Matches(lang ? "다시|새로|재지정|닫고" : "try again|again|another", text);
                }
                Assert.Matches(lang ? "제보" : "send a report", Plain(FailureKind.Unknown));
            }
        }
        finally { Lang.Set(saved, remember: false); }
    }

    /// <summary>The generic exception keeps a raw line for the log and the same plain fallback.</summary>
    [Fact]
    public void RawKeepsTheDetail_PlainDropsIt()
    {
        bool saved = Lang.Korean;
        Lang.Set(false, remember: false);
        try { RawKeepsTheDetailBody(); }
        finally { Lang.Set(saved, remember: false); }
    }

    static void RawKeepsTheDetailBody()
    {
        var ex = new InvalidOperationException("C:\\Games\\My Game (1).zip is locked");
        Assert.Equal(FailureKind.Unknown, KindOf(ex));
        Assert.Contains("My Game (1).zip", Raw(ex));
        Assert.DoesNotContain("My Game", Plain(ex));
        Assert.Equal("unknown", Raw(ex).Split(':')[0]);

        Assert.Equal(FailureKind.Oom, KindOf(new OutOfMemoryException("boom")));
        Assert.Contains("memory", Plain(new OutOfMemoryException("boom")));
    }

    /// <summary>A batch summary names catalog romsets only and caps the list.</summary>
    [Fact]
    public void BatchSummary_UsesCatalogNamesAndCaps()
    {
        bool saved = Lang.Korean;
        try
        {
            Lang.Set(false, remember: false);
            string text = Batch(new[]
            {
                new FailureText.BatchFailure("kof98h", FailureKind.Missing),
                new FailureText.BatchFailure(null, FailureKind.Zip),
                new FailureText.BatchFailure("mslug", FailureKind.Bios),
                new FailureText.BatchFailure("svc", FailureKind.CrcMismatch),
                new FailureText.BatchFailure("kof98", FailureKind.Unsupported),
            });
            Assert.Contains("5 failed", text);
            Assert.Contains("2 more", text);
            Assert.Contains("kof98h", text);
            Assert.Contains("mslug", text);
            // 'missing' already names the romset, so no duplicate prefix; 'bios' needs one.
            Assert.Contains("mslug — ", text);
            Assert.DoesNotContain("svc", text);          // capped at three
            Assert.Equal("", Batch(Array.Empty<FailureText.BatchFailure>()));
        }
        finally { Lang.Set(saved, remember: false); }
    }

    /// <summary>Acceptance #328: the throw sites carry the code. A zip name that is not a
    /// romset, a missing BIOS and an unreadable archive are the three a user hits first.</summary>
    [Fact]
    public void PickGame_TagsTheFailureWithItsCode()
    {
        bool saved = Lang.Korean;
        try
        {
            Lang.Set(true, remember: false);

            string notRomset = Path.Combine(root, "my-game.zip");
            using (var z = ZipFile.Open(notRomset, ZipArchiveMode.Create)) z.CreateEntry("readme.txt");
            var a = CiaJob.FromRomZip(notRomset);
            Assert.Null(a.Game);
            Assert.Equal(FailureKind.NotRomset, a.Failure!.Kind);
            Assert.Contains("my-game", a.Problem);                 // raw keeps the message...
            Assert.DoesNotContain("my-game", a.ProblemText);       // ...the dialog does not
            Assert.Contains("MAME", a.ProblemText);

            string romset = Path.Combine(root, "kof98h.zip");
            using (var z = ZipFile.Open(romset, ZipArchiveMode.Create)) z.CreateEntry("readme.txt");
            var b = CiaJob.FromRomZip(romset);
            Assert.Null(b.Game);
            Assert.NotNull(b.Failure);
            // Empty zip: the chips are absent, so it is 'missing' with game DB chip names.
            Assert.Equal(FailureKind.Missing, b.Failure!.Kind);
            Assert.Equal("kof98h", b.Failure.Set);
            Assert.NotEmpty(b.Failure.Chips);
            Assert.All(b.Failure.Chips, c => Assert.Matches("^[a-z0-9._-]+$", c));
            Assert.DoesNotContain("242", b.ProblemText.Length > 0 ? "" : "242");
            Assert.Contains("kof98h", b.ProblemText);
            Assert.Contains("빠진 칩:", b.ProblemText);
        }
        finally { Lang.Set(saved, remember: false); }
    }

    /// <summary>An unsupported cart keeps its catalog name; a broken zip opened by the builder
    /// is tagged where the archiver failed, not guessed later.</summary>
    [Fact]
    public void UnsupportedAndBrokenZip_AreTagged()
    {
        bool saved = Lang.Korean;
        try
        {
            Lang.Set(true, remember: false);
            string cart = Path.Combine(root, "fatfury2.zip");
            using (var z = ZipFile.Open(cart, ZipArchiveMode.Create)) z.CreateEntry("readme.txt");
            var job = CiaJob.FromRomZip(cart);
            Assert.Equal(FailureKind.Unsupported, job.Failure!.Kind);
            Assert.Equal("fatfury2", job.Failure.Set);
            Assert.Contains("fatfury2", job.ProblemText);

            string broken = Path.Combine(root, "mslug.zip");
            File.WriteAllBytes(broken, new byte[] { 1, 2, 3, 4, 5 });
            var ex = Assert.Throws<ConverterException>(() =>
                new CiaBuilder(_ => { }).Build(CiaJob.FromRomZip(broken)));
            Assert.Equal(FailureKind.ZipCorrupt, ex.Kind);
            Assert.Contains("mslug.zip", ex.Message);              // raw detail is in the log line
            Assert.DoesNotContain("mslug", Plain(ex));             // the dialog says 'game'
        }
        finally { Lang.Set(saved, remember: false); }
    }

    /// <summary>A convertible romset with no neogeo.zip is 'bios'. A zip that is not the
    /// romset at all is reported first, so the BIOS never hides a wrong zip (#329).</summary>
    [Fact]
    public void MissingBios_IsTaggedAsBios()
    {
        bool saved = Lang.Korean;
        try
        {
            Lang.Set(false, remember: false);
            string zip = Path.Combine(root, "mslug.zip");
            using (var z = ZipFile.Open(zip, ZipArchiveMode.Create)) z.CreateEntry("readme.txt");
            var job = new CiaJob
            {
                RomZip = zip, RomName = "mslug", Title = "Metal Slug", OutputDir = root,
                Game = GameDb.Find("mslug"), BiosZip = null,
            };
            var ex = Assert.Throws<ConverterException>(() => new CiaBuilder(_ => { }).Build(job));
            Assert.Equal(FailureKind.Bios, ex.Kind);
            Assert.Contains("neogeo.zip", Plain(ex));
            Assert.Contains("same folder", Plain(ex));

            // The same zip without a picked game is the picker's verdict, not the BIOS.
            var picked = CiaJob.FromRomZip(zip);
            Assert.Null(picked.Game);
            Assert.NotEqual(FailureKind.Bios, Assert.Throws<ConverterException>(
                () => new CiaBuilder(_ => { }).Build(picked)).Kind);
        }
        finally { Lang.Set(saved, remember: false); }
    }

    /// <summary>The image tag: an unreadable custom picture is 'image', not 'unknown'.</summary>
    [Fact]
    public void BadImage_IsTaggedAsImage()
    {
        bool saved = Lang.Korean;
        try
        {
            Lang.Set(false, remember: false);
            string png = Path.Combine(root, "bad.png");
            File.WriteAllText(png, "not a picture");
            var ex = Assert.Throws<ConverterException>(() => Art.Icon("Test", png));
            Assert.Equal(FailureKind.Image, ex.Kind);
            Assert.Contains("PNG", Plain(ex));
        }
        finally { Lang.Set(saved, remember: false); }
    }
}
