using System.Text;
using Neo3dsConverter;
using QRCoder;
using Xunit;

namespace Neo3dsConverter.Tests;

/// <summary>
/// #264/#313: selection resolves to a single file or to a batch of 2 to 6 files. The 3DS refuses
/// a list it cannot parse, so the PC decides the kind, the duplicates, the refusal and the real
/// number of files that fit before serving.
/// </summary>
public sealed class SendBatchTests : IDisposable
{
    readonly string root = Path.Combine(Path.GetTempPath(), "neo3ds-send-batch", Guid.NewGuid().ToString("N"));

    public SendBatchTests() => Directory.CreateDirectory(root);

    public void Dispose()
    {
        try { Directory.Delete(root, true); } catch { /* best effort */ }
    }

    string Make(string name, int size = 1024, string? folder = null)
    {
        string dir = folder == null ? root : Path.Combine(root, folder);
        Directory.CreateDirectory(dir);
        string path = Path.Combine(dir, name);
        File.WriteAllBytes(path, new byte[size]);
        return path;
    }

    static SendBatch ReadyBatch(string[] paths) =>
        Assert.IsType<SendBatchResult.Ready>(
            Assert.IsType<SendSelectionResult.Batch>(SendSelection.Resolve(paths, [])).Result).Batch;

    static SendBatchResult.Refused RefusedBatch(string[] paths) =>
        Assert.IsType<SendBatchResult.Refused>(
            Assert.IsType<SendSelectionResult.Batch>(SendSelection.Resolve(paths, [])).Result);

    [Fact]
    public void TwoCiasAreOneBatchGuidedToFbi()
    {
        string one = Make("kof98.cia", 2048);
        string two = Make("nam1975.cia", 4096);

        var ready = ReadyBatch([one, two]);
        var batch = ready;

        Assert.Equal(2, batch.Items.Count);
        Assert.Equal(SendKind.Cia, batch.Kind);
        Assert.Equal(SendGuide.Fbi, batch.Guide);
        Assert.Equal(6144, batch.TotalLength);
        Assert.Equal("kof98.cia", batch.Items[0].FileName);
    }

    [Fact]
    public void TwoPacksAreOneBatchGuidedToTheLauncher()
    {
        var batch = ReadyBatch([Make("kof98.neo3ds"), Make("nam1975.neo3ds")]);

        Assert.Equal(SendKind.Launcher, batch.Kind);
        Assert.Equal(SendGuide.Launcher, batch.Guide);
    }

    [Fact]
    public void MixedCiaAndPackIsRefusedWithTheTwoStepReason()
    {
        var refused = RefusedBatch([Make("kof98.cia"), Make("nam1975.neo3ds")]);

        Assert.IsType<BatchRefusal.MixedKinds>(refused.Refusal);
        Assert.Contains(Lang.L("두 번", "two batches"), refused.Refusal.Reason);
    }

    [Fact]
    public void DuplicateBaseNameIsRefusedCaseInsensitively()
    {
        string one = Make("KOF98.cia", folder: "one");
        string two = Make("kof98.cia", folder: "two");

        var refused = RefusedBatch([one, two]);

        var duplicate = Assert.IsType<BatchRefusal.DuplicateName>(refused.Refusal);
        Assert.Contains("kof98.cia", duplicate.Name, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("kof98.cia", refused.Refusal.Reason, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void SevenFilesAreRefusedWithoutSplitting()
    {
        var paths = Enumerable.Range(0, 7).Select(i => Make($"game{i}.cia")).ToArray();

        var refused = RefusedBatch(paths);

        Assert.IsType<BatchRefusal.TooManyFiles>(refused.Refusal);
        Assert.Contains("6", refused.Refusal.Reason);
    }

    [Fact]
    public void OneBadFileRefusesTheWholeBatchWithItsReason()
    {
        var refused = RefusedBatch([Make("kof98.cia"), Make("kof98.zip")]);

        var file = Assert.IsType<BatchRefusal.File>(refused.Refusal);
        Assert.Equal(FileRefusal.UnsupportedExtension, file.Candidate.Refusal);
        Assert.Contains("kof98.zip", refused.Refusal.Reason);
        Assert.Contains(Lang.L(".cia 또는 .neo3ds", "Only .cia or .neo3ds"), refused.Refusal.Reason);
    }

    [Fact]
    public void MissingFileAndFolderAreRefused()
    {
        string folder = Path.Combine(root, "games");
        Directory.CreateDirectory(folder);

        var missing = RefusedBatch([Make("kof98.cia"), Path.Combine(root, "gone.cia")]);
        var notAFile = RefusedBatch([Make("kof98.cia"), folder]);

        Assert.Equal(FileRefusal.MissingFile,
            Assert.IsType<BatchRefusal.File>(missing.Refusal).Candidate.Refusal);
        Assert.Equal(FileRefusal.NotAFile,
            Assert.IsType<BatchRefusal.File>(notAFile.Refusal).Candidate.Refusal);
    }

    [Fact]
    public void NoSelectionHasNoSelection()
    {
        Assert.Null(SendSelection.Resolve([], []));
        Assert.Null(SendSelection.Resolve(["  "], []));
    }

    [Fact]
    public void OneFileIsSingleNotBatch()
    {
        string path = Make(new string('a', 96) + ".neo3ds");

        var single = Assert.IsType<SendSelectionResult.Single>(SendSelection.Resolve([path], []));

        Assert.True(single.Candidate.Allowed);
        Assert.Equal(SendKind.Launcher, single.Candidate.Kind);
    }

    /// <summary>#313: a batch cannot be built outside the 2 to 6 range.</summary>
    [Fact]
    public void BatchConstructionRefusesOneFile()
    {
        var candidate = SendCandidate.Resolve(Make("kof98.cia"), []);

        Assert.Throws<ArgumentException>(() => SendBatch.Check([candidate!]));
    }

    [Fact]
    public void BatchLanFilesUseIndexRoutesForCias()
    {
        var batch = ReadyBatch([Make("kof98.cia"), Make("nam1975.cia")]);

        var files = batch.LanFiles();

        Assert.Equal(["0", "1"], files.Select(f => f.RouteName).ToArray());
    }

    [Fact]
    public void BatchLanFilesUseFileNamesForPacks()
    {
        var batch = ReadyBatch([Make("kof98.neo3ds"), Make("nam1975.neo3ds")]);

        var files = batch.LanFiles();

        Assert.Equal(["kof98.neo3ds", "nam1975.neo3ds"], files.Select(f => f.RouteName).ToArray());
    }

    [Fact]
    public void CapacityUsesTheRealUrlsAndReportsTheAllowedCount()
    {
        string[] paths = Enumerable.Range(0, 6)
            .Select(i => Make(new string((char)('a' + i), 96) + ".neo3ds"))
            .ToArray();
        var batch = ReadyBatch(paths);
        string[] urls = paths.Select(p =>
            "http://192.168.0.10:52406/0123456789abcdef/" + Uri.EscapeDataString(Path.GetFileName(p))).ToArray();

        var sized = batch.WithQr(urls);

        var refused = Assert.IsType<SendBatchResult.Refused>(sized);
        var tooLarge = Assert.IsType<BatchRefusal.QrTooLarge>(refused.Refusal);
        Assert.InRange(tooLarge.AllowedCount, 1, 5);
        Assert.Equal(QrCode.BatchAllowedCount(urls), tooLarge.AllowedCount);
        Assert.Contains(tooLarge.AllowedCount.ToString(), refused.Refusal.Reason);
    }

    [Fact]
    public void ShortBatchFitsAndKeepsEveryItem()
    {
        var batch = ReadyBatch([Make("kof98.cia"), Make("nam1975.cia")]);
        string[] urls =
        [
            "http://192.168.0.10:52406/0123456789abcdef/0",
            "http://192.168.0.10:52406/0123456789abcdef/1",
        ];

        var sized = batch.WithQr(urls);

        Assert.IsType<SendBatchResult.Ready>(sized);
    }

    /// <summary>#264: batch QR uses ECC L, while the single QR still uses ECC M.</summary>
    [Fact]
    public void BatchQrUsesLowErrorCorrection()
    {
        string text = string.Join("\n", Enumerable.Range(0, 6)
            .Select(i => $"http://192.168.0.10:52406/0123456789abcdef/{i}"));

        using var generator = new QRCodeGenerator();
        using QRCodeData expected = generator.CreateQrCode(text, QRCodeGenerator.ECCLevel.L);
        byte[] png = QrCode.BatchPng(text);

        Assert.Equal(expected.ModuleMatrix.Count, QrCode.BatchModules(text));
        Assert.Equal(expected.ModuleMatrix.Count, PngWidth(png));
        Assert.True(QrCode.BatchModules(text) <= QrCode.BatchMaxModules);
    }

    /// <summary>
    /// #264/#312: the 47/60/73-byte URL cases, measured through the same QRCoder mixed-mode
    /// encoder the product uses. Five 73-byte URLs are 369 bytes with newlines — above the
    /// version-12-L byte-mode table (367 bytes) — but their real modules fit; six do not.
    /// </summary>
    [Fact]
    public void CapacityBoundariesFollowTheActualQrEncoding()
    {
        Assert.Equal(6, QrCode.BatchAllowedCount(UrlsOfLength(47, 6)));
        Assert.Equal(6, QrCode.BatchAllowedCount(UrlsOfLength(60, 6)));
        Assert.Equal(5, QrCode.BatchAllowedCount(UrlsOfLength(73, 6)));

        string five = string.Join("\n", UrlsOfLength(73, 5));
        string six = string.Join("\n", UrlsOfLength(73, 6));
        Assert.True(Encoding.UTF8.GetByteCount(five) > 367);
        Assert.True(QrCode.BatchModules(five) <= QrCode.BatchMaxModules);
        Assert.True(QrCode.BatchModules(six) > QrCode.BatchMaxModules);
    }

    static string[] UrlsOfLength(int length, int count)
    {
        const string prefix = "http://192.168.0.10:52406/0123456789abcdef/";
        string url = prefix + new string('a', length - prefix.Length);
        return Enumerable.Repeat(url, count).ToArray();
    }

    [Fact]
    public void ItemLinesShowWaitingSendingAndSent()
    {
        Assert.StartsWith(Lang.L("대기", "Waiting"), SendText.ItemLine(SendState.Waiting, "kof98.cia", 2048));
        Assert.StartsWith(Lang.L("보내는 중", "Sending"), SendText.ItemLine(SendState.Sending, "kof98.cia", 2048));
        Assert.StartsWith(Lang.L("보냄", "Sent"), SendText.ItemLine(SendState.Sent, "kof98.cia", 2048));
    }

    static int PngWidth(byte[] png) => (png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19];
}
