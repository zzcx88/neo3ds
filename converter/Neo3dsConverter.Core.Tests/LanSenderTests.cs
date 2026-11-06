using System.Net;
using System.Net.Sockets;
using System.Text;
using QRCoder;
using Xunit;

namespace Neo3dsConverter.Tests;

/// <summary>
/// The local-network handoff behind "send to 3DS" (#235): FBI downloads the CIA from this URL,
/// so the served bytes, the token path, and the QR's pixel size are what matter.
/// </summary>
public sealed class LanSenderTests : IDisposable
{
    readonly string root = Path.Combine(Path.GetTempPath(), "neo3ds-lan-tests", Guid.NewGuid().ToString("N"));
    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(10) };

    public LanSenderTests() => Directory.CreateDirectory(root);

    public void Dispose()
    {
        try { Directory.Delete(root, true); } catch { /* best effort */ }
    }

    string MakeFile(string name, int size = 256 * 1024)
    {
        var bytes = new byte[size];
        new Random(1234).NextBytes(bytes);
        string path = Path.Combine(root, name);
        File.WriteAllBytes(path, bytes);
        return path;
    }

    [Fact]
    public async Task ServesTheWholeFileAtTheUrl()
    {
        string path = MakeFile("my game.cia");
        byte[] expected = File.ReadAllBytes(path);
        using var sender = LanSender.Start(path, "127.0.0.1");

        byte[] actual = await Http.GetByteArrayAsync(sender.Url, TestContext.Current.CancellationToken);

        Assert.Equal(expected.Length, sender.Length);
        Assert.EndsWith("/my%20game.cia", sender.Url);
        Assert.Equal(expected, actual);
    }

    [Fact]
    public async Task RejectsAPathWithoutTheToken()
    {
        MakeFile("kof98.cia");
        using var sender = LanSender.Start(Path.Combine(root, "kof98.cia"), "127.0.0.1");
        var wrong = new UriBuilder(sender.Url) { Path = "/kof98.cia" }.Uri;

        using var response = await Http.GetAsync(wrong, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task AnswersHeadWithTheSizeAndNoBody()
    {
        string path = MakeFile("kof98.cia", 4096);
        using var sender = LanSender.Start(path, "127.0.0.1");
        using var request = new HttpRequestMessage(HttpMethod.Head, sender.Url);

        using var response = await Http.SendAsync(request, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(new FileInfo(path).Length, response.Content.Headers.ContentLength);
        Assert.Empty(await response.Content.ReadAsByteArrayAsync(TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task RaisesDownloadedWhenTheClientGotTheFile()
    {
        MakeFile("kof98.cia");
        using var sender = LanSender.Start(Path.Combine(root, "kof98.cia"), "127.0.0.1");
        var done = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        sender.Downloaded += () => done.TrySetResult();

        await Http.GetByteArrayAsync(sender.Url, TestContext.Current.CancellationToken);

        await done.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task StopsServingWhenStopped()
    {
        string path = MakeFile("kof98.cia", 1024);
        var sender = LanSender.Start(path, "127.0.0.1");
        string url = sender.Url;

        sender.Stop();

        Assert.False(sender.IsRunning);
        await Assert.ThrowsAnyAsync<Exception>(
            () => Http.GetByteArrayAsync(url, TestContext.Current.CancellationToken));
        sender.Dispose();
    }

    [Fact]
    public async Task ServesTheWholeFileWhenTheRequestArrivesInTwoWrites()
    {
        string path = MakeFile("kof98.cia", 512 * 1024);
        byte[] expected = File.ReadAllBytes(path);
        using var sender = LanSender.Start(path, "127.0.0.1");
        var uri = new Uri(sender.Url);
        using var client = new TcpClient();
        await client.ConnectAsync(IPAddress.Loopback, uri.Port, TestContext.Current.CancellationToken);
        NetworkStream stream = client.GetStream();

        await stream.WriteAsync(Encoding.ASCII.GetBytes($"GET {uri.PathAndQuery} HTTP/1.1\r\nHost: {uri.Host}\r\n"),
            TestContext.Current.CancellationToken);
        await Task.Delay(50, TestContext.Current.CancellationToken);
        await stream.WriteAsync(Encoding.ASCII.GetBytes("Connection: close\r\n\r\n"), TestContext.Current.CancellationToken);

        using var received = new MemoryStream();
        await stream.CopyToAsync(received, TestContext.Current.CancellationToken);
        byte[] response = received.ToArray();
        int headerEnd = response.AsSpan().IndexOf("\r\n\r\n"u8);
        Assert.True(headerEnd >= 0);
        Assert.Equal(expected, response[(headerEnd + 4)..]);
    }

    [Fact]
    public async Task ServesOtherClientsWhileOneStalls()
    {
        string path = MakeFile("kof98.cia", 64 * 1024);
        using var sender = LanSender.Start(path, "127.0.0.1");
        using var stalled = new TcpClient();
        await stalled.ConnectAsync(IPAddress.Loopback, sender.Port, TestContext.Current.CancellationToken);

        var fetch = Http.GetByteArrayAsync(sender.Url, TestContext.Current.CancellationToken);
        var first = await Task.WhenAny(fetch, Task.Delay(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken));

        Assert.Same(fetch, first);
        Assert.Equal(File.ReadAllBytes(path), await fetch);
    }

    /// <summary>#255: the dialog shows "sending" from the moment the 3DS asks, not before.</summary>
    [Fact]
    public async Task StartedFiresOnceWhenThe3dsAsksForTheFile()
    {
        string path = MakeFile("kof98.cia", 4096);
        using var sender = LanSender.Start(path, "127.0.0.1");
        int started = 0;
        sender.Started += () => Interlocked.Increment(ref started);
        Assert.Equal(0, Volatile.Read(ref started));

        await Http.GetByteArrayAsync(sender.Url, TestContext.Current.CancellationToken);

        Assert.Equal(1, Volatile.Read(ref started));
    }

    [Fact]
    public async Task ServesEveryFileInOneBatchAtItsOwnUrl()
    {
        string one = MakeFile("kof98.cia", 2048);
        string two = MakeFile("nam1975.cia", 4096);
        byte[] first = File.ReadAllBytes(one);
        byte[] second = File.ReadAllBytes(two);
        using var sender = LanSender.StartBatch(
        [
            new LanFile(one, "0"),
            new LanFile(two, "1"),
        ], "127.0.0.1");

        byte[] actualFirst = await Http.GetByteArrayAsync(sender.Items[0].Url, TestContext.Current.CancellationToken);
        byte[] actualSecond = await Http.GetByteArrayAsync(sender.Items[1].Url, TestContext.Current.CancellationToken);

        Assert.Equal(first, actualFirst);
        Assert.Equal(second, actualSecond);
        Assert.Equal(2, sender.Items.Count);
        Assert.Equal("0", new Uri(sender.Items[0].Url).AbsolutePath.Split('/')[2]);
        Assert.Equal("1", new Uri(sender.Items[1].Url).AbsolutePath.Split('/')[2]);
    }

    [Fact]
    public async Task BatchUrlsShareOneOriginAndToken()
    {
        string one = MakeFile("kof98.cia", 64);
        string two = MakeFile("nam1975.cia", 64);
        using var sender = LanSender.StartBatch(
        [
            new LanFile(one, "kof98.cia"),
            new LanFile(two, "nam1975.cia"),
        ], "127.0.0.1");

        var first = new Uri(sender.Items[0].Url);
        var second = new Uri(sender.Items[1].Url);
        string[] firstParts = first.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        string[] secondParts = second.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);

        Assert.Equal(first.Host, second.Host);
        Assert.Equal(first.Port, second.Port);
        Assert.Equal(firstParts[0], secondParts[0]);
        Assert.Equal(16, firstParts[0].Length);
        Assert.Equal("kof98.cia", Uri.UnescapeDataString(firstParts[1]));
        Assert.Equal("nam1975.cia", Uri.UnescapeDataString(secondParts[1]));
        Assert.Equal(sender.Items[0].Url + "\n" + sender.Items[1].Url, sender.QrText);
    }

    [Fact]
    public async Task BatchRejectsAPathThatIsNotInTheMap()
    {
        string one = MakeFile("kof98.cia", 64);
        string two = MakeFile("nam1975.cia", 64);
        using var sender = LanSender.StartBatch(
        [
            new LanFile(one, "0"),
            new LanFile(two, "1"),
        ], "127.0.0.1");
        var wrong = new UriBuilder(sender.Items[0].Url) { Path = "/" + new Uri(sender.Items[0].Url).AbsolutePath.Split('/')[1] + "/2" }.Uri;

        using var response = await Http.GetAsync(wrong, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task BatchRaisesItemDownloadedWithThatFile()
    {
        string one = MakeFile("kof98.cia", 64);
        string two = MakeFile("nam1975.cia", 128);
        using var sender = LanSender.StartBatch(
        [
            new LanFile(one, "0"),
            new LanFile(two, "1"),
        ], "127.0.0.1");
        var done = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        sender.ItemDownloaded += item => done.TrySetResult(item.FileName);

        await Http.GetByteArrayAsync(sender.Items[1].Url, TestContext.Current.CancellationToken);

        Assert.Equal("nam1975.cia", await done.Task.WaitAsync(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task BatchAnswersHeadForEveryItem()
    {
        string one = MakeFile("kof98.cia", 2048);
        string two = MakeFile("nam1975.cia", 4096);
        using var sender = LanSender.StartBatch(
        [
            new LanFile(one, "0"),
            new LanFile(two, "1"),
        ], "127.0.0.1");

        foreach (var item in sender.Items)
        {
            using var request = new HttpRequestMessage(HttpMethod.Head, item.Url);
            using var response = await Http.SendAsync(request, TestContext.Current.CancellationToken);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal(item.Length, response.Content.Headers.ContentLength);
            Assert.Empty(await response.Content.ReadAsByteArrayAsync(TestContext.Current.CancellationToken));
        }
    }

    [Fact]
    public async Task ServesAllSixFilesInOneBatch()
    {
        string[] paths = Enumerable.Range(0, 6)
            .Select(i => MakeFile($"game{i}.cia", 512 + i))
            .ToArray();
        using var sender = LanSender.StartBatch(
            paths.Select((path, i) => new LanFile(path, i.ToString())).ToArray(), "127.0.0.1");

        Assert.Equal(6, sender.Items.Count);
        foreach (var item in sender.Items)
        {
            byte[] expected = File.ReadAllBytes(item.Path);
            byte[] actual = await Http.GetByteArrayAsync(item.Url, TestContext.Current.CancellationToken);
            Assert.Equal(expected, actual);
        }
    }

    /// <summary>
    /// #312: six launcher packs keep their encoded file names in the URL path, and all six bodies
    /// arrive from the one batch listener.
    /// </summary>
    [Fact]
    public async Task ServesSixLauncherPacksByTheirEncodedNamesInOneBatch()
    {
        string[] names =
        [
            "게임.neo3ds",
            "game two.neo3ds",
            "game three.neo3ds",
            "game four.neo3ds",
            "game five.neo3ds",
            "game six.neo3ds",
        ];
        string[] paths = names.Select((name, i) => MakeFile(name, 512 + i)).ToArray();
        var batch = SendBatch.Resolve(paths, []);
        Assert.NotNull(batch);
        using var sender = LanSender.StartBatch(
            batch.Items.Select(i => new LanFile(i.FullPath, i.FileName)).ToArray(), "127.0.0.1");
        var sized = batch.WithQr(sender.Items.Select(i => i.Url).ToArray());

        Assert.True(sized.Allowed);
        Assert.Equal(6, sized.AllowedCount);
        Assert.Equal(6, sender.QrText.Split('\n').Length);

        for (int i = 0; i < sender.Items.Count; i++)
        {
            byte[] expected = File.ReadAllBytes(sender.Items[i].Path);
            byte[] actual = await Http.GetByteArrayAsync(sender.Items[i].Url, TestContext.Current.CancellationToken);
            string route = new Uri(sender.Items[i].Url).AbsolutePath
                .Split('/', StringSplitOptions.RemoveEmptyEntries)[1];
            Assert.Equal(expected, actual);
            Assert.Equal(names[i], Uri.UnescapeDataString(route));
        }
    }

    [Fact]
    public void BatchRejectsADuplicateRouteName()
    {
        string one = MakeFile("kof98.cia", 64);
        string two = MakeFile("nam1975.cia", 64);

        Assert.Throws<ArgumentException>(() => LanSender.StartBatch(
        [
            new LanFile(one, "0"),
            new LanFile(two, "0"),
        ], "127.0.0.1"));
    }

    [Fact]
    public void QrPngIsOnePixelPerModule()
    {
        const string url = "http://192.168.0.9:1234/0123456789abcdef/kof98.cia";

        byte[] png = QrCode.Png(url);

        Assert.Equal(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }, png[..8]);
        using var generator = new QRCodeGenerator();
        using QRCodeData data = generator.CreateQrCode(url, QRCodeGenerator.ECCLevel.M);
        int modules = data.ModuleMatrix.Count;
        Assert.Equal(modules, PngWidth(png));
        Assert.Equal(modules, PngHeight(png));
        Assert.True(modules > 20 && modules < 80, $"unexpected QR size {modules}");
    }

    [Fact]
    public void RejectsANonIpv4Address()
    {
        string path = MakeFile("kof98.cia", 16);

        Assert.Throws<ArgumentException>(() => LanSender.Start(path, "not-an-ip"));
    }

    [Fact]
    public void LanAddressesAreAllIpv4AndFindPicksTheFirst()
    {
        var addresses = LanSender.LanAddresses();

        Assert.All(addresses, a =>
        {
            Assert.True(IPAddress.TryParse(a.Address, out IPAddress? ip));
            Assert.Equal(AddressFamily.InterNetwork, ip!.AddressFamily);
        });
        Assert.Equal(addresses.FirstOrDefault()?.Address, LanSender.FindLanAddress());
    }

    static int PngWidth(byte[] png) => (png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19];
    static int PngHeight(byte[] png) => (png[20] << 24) | (png[21] << 16) | (png[22] << 8) | png[23];
}
