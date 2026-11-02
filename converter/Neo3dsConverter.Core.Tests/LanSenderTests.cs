using System.Net;
using Xunit;

namespace Neo3dsConverter.Tests;

/// <summary>
/// The local-network handoff used by the "send to 3DS" dialog (#225): FBI downloads the CIA
/// from this URL, so the served bytes and the token path are what matter.
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
        byte[] expected = File.ReadAllBytes(MakeFile("my game.cia"));
        using var sender = LanSender.Start(Path.Combine(root, "my game.cia"), "127.0.0.1");

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
    public void QrPngIsAPng()
    {
        byte[] png = QrCode.Png("http://192.168.0.9:1234/0123456789abcdef/kof98.cia");

        Assert.True(png.Length > 100);
        Assert.Equal(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }, png[..8]);
    }
}
