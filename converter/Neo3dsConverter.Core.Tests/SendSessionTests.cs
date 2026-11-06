using Neo3dsConverter;
using Xunit;

namespace Neo3dsConverter.Tests;

/// <summary>
/// #313: one Core session owns the selection, the server and the per-file progress. Both windows
/// ask it, so neither keeps its own batch state machine.
/// </summary>
public sealed class SendSessionTests : IDisposable
{
    readonly string root = Path.Combine(Path.GetTempPath(), "neo3ds-send-session", Guid.NewGuid().ToString("N"));
    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(10) };

    public SendSessionTests() => Directory.CreateDirectory(root);

    public void Dispose()
    {
        try { Directory.Delete(root, true); } catch { /* best effort */ }
    }

    string Make(string name, int size = 1024)
    {
        string path = Path.Combine(root, name);
        File.WriteAllBytes(path, new byte[size]);
        return path;
    }

    [Fact]
    public async Task SingleCiaServesFromTheSession()
    {
        string cia = Make("kof98.cia", 2048);
        byte[] expected = File.ReadAllBytes(cia);
        using var session = new SendSession([], "127.0.0.1");

        session.SetSelection([cia]);

        var snapshot = session.Snapshot;
        Assert.False(snapshot.Empty);
        Assert.False(snapshot.IsBatch);
        Assert.Equal("", snapshot.Reason);
        Assert.Null(snapshot.StartError);
        Assert.Single(snapshot.Items);
        Assert.Equal(SendState.Waiting, snapshot.Overall);
        Assert.NotNull(session.Sender);
        Assert.Equal(session.Sender!.Items[0].Url, snapshot.QrText);
        Assert.DoesNotContain("\n", snapshot.QrText);

        byte[] actual = await Http.GetByteArrayAsync(snapshot.QrText!, TestContext.Current.CancellationToken);
        Assert.Equal(expected, actual);
        WaitFor(session, s => s.Overall == SendState.Sent);
        Assert.Equal(SendState.Sent, session.Snapshot.Items[0].State);
    }

    [Fact]
    public async Task TwoCiasServeAsOneBatchWithIndexRoutes()
    {
        string one = Make("kof98.cia", 2048);
        string two = Make("nam1975.cia", 4096);
        using var session = new SendSession([], "127.0.0.1");

        session.SetSelection([one, two]);

        var snapshot = session.Snapshot;
        Assert.True(snapshot.IsBatch);
        Assert.Equal(2, snapshot.Items.Count);
        Assert.Equal("", snapshot.Reason);
        string[] lines = snapshot.QrText!.Split('\n');
        Assert.Equal(2, lines.Length);
        Assert.EndsWith("/0", lines[0]);
        Assert.EndsWith("/1", lines[1]);
        Assert.Equal(new Uri(lines[0]).Host, new Uri(lines[1]).Host);
        Assert.Equal(new Uri(lines[0]).Port, new Uri(lines[1]).Port);

        Assert.Equal(File.ReadAllBytes(one),
            await Http.GetByteArrayAsync(lines[0], TestContext.Current.CancellationToken));
        Assert.Equal(File.ReadAllBytes(two),
            await Http.GetByteArrayAsync(lines[1], TestContext.Current.CancellationToken));
    }

    [Fact]
    public void MixedKindsAreRefusedWithoutAServer()
    {
        using var session = new SendSession([], "127.0.0.1");

        session.SetSelection([Make("kof98.cia"), Make("nam1975.neo3ds")]);

        var snapshot = session.Snapshot;
        Assert.Null(session.Sender);
        Assert.Null(snapshot.QrText);
        Assert.Equal(2, snapshot.Items.Count);
        Assert.Contains(Lang.L("두 번", "two batches"), snapshot.Reason);
    }

    [Fact]
    public void SevenFilesAreRefusedWithoutAServer()
    {
        string[] paths = Enumerable.Range(0, 7).Select(i => Make($"game{i}.cia")).ToArray();
        using var session = new SendSession([], "127.0.0.1");

        session.SetSelection(paths);

        Assert.Null(session.Sender);
        Assert.Contains("6", session.Snapshot.Reason);
    }

    [Fact]
    public void SingleRefusalDoesNotStartAServer()
    {
        using var session = new SendSession([], "127.0.0.1");

        session.SetSelection([Make("kof98.zip")]);

        var snapshot = session.Snapshot;
        Assert.Null(session.Sender);
        Assert.Single(snapshot.Items);
        Assert.Equal("kof98.zip", snapshot.Items[0].DisplayName);
        Assert.Contains(Lang.L(".cia 또는 .neo3ds", "Only .cia or .neo3ds"), snapshot.Reason);
    }

    [Fact]
    public void EmptySelectionHasAnEmptySnapshot()
    {
        using var session = new SendSession([], "127.0.0.1");

        session.SetSelection([]);

        var snapshot = session.Snapshot;
        Assert.True(snapshot.Empty);
        Assert.Empty(snapshot.Items);
        Assert.Null(snapshot.QrText);
        Assert.Null(session.Sender);
    }

    [Fact]
    public async Task AddressChangeRestartsWithANewQrAndResetsTheProgress()
    {
        string one = Make("kof98.cia", 2048);
        string two = Make("nam1975.cia", 4096);
        using var session = new SendSession([], "127.0.0.1");
        session.SetSelection([one, two]);
        string[] first = session.Snapshot.QrText!.Split('\n');
        Assert.Equal(File.ReadAllBytes(one),
            await Http.GetByteArrayAsync(first[0], TestContext.Current.CancellationToken));
        WaitFor(session, s => s.Sent == 1);

        session.SetAddress("127.0.0.1");

        var snapshot = session.Snapshot;
        Assert.NotNull(session.Sender);
        Assert.Equal(0, snapshot.Sent);
        Assert.All(snapshot.Items, i => Assert.Equal(SendState.Waiting, i.State));
        string[] second = snapshot.QrText!.Split('\n');
        Assert.NotEqual(first[0], second[0]);
        Assert.Equal(File.ReadAllBytes(one),
            await Http.GetByteArrayAsync(second[0], TestContext.Current.CancellationToken));
        await Assert.ThrowsAnyAsync<Exception>(
            () => Http.GetByteArrayAsync(first[0], TestContext.Current.CancellationToken));
    }

    [Fact]
    public void QrTooLargeIsRefusedWithTheAllowedCount()
    {
        string[] packs = Enumerable.Range(0, 6)
            .Select(i => Make(new string((char)('a' + i), 96) + ".neo3ds"))
            .ToArray();
        using var session = new SendSession([], "127.0.0.1");

        session.SetSelection(packs);

        var snapshot = session.Snapshot;
        Assert.Null(session.Sender);
        Assert.Equal(6, snapshot.Items.Count);
        Assert.Contains(Lang.L("개까지", "files fit"), snapshot.Reason);
    }

    /// <summary>#309: the same selection that did not fit on a long address fits on a short one.</summary>
    [Fact]
    public void QrTooLargeRetriesOnAShorterAddress()
    {
        string[] packs = Enumerable.Range(0, 6)
            .Select(i => Make(new string((char)('a' + i), 14) + ".neo3ds"))
            .ToArray();
        using var session = new SendSession([], "127.000.000.001");

        session.SetSelection(packs);
        Assert.Null(session.Sender);

        session.SetAddress("127.0.0.1");

        Assert.NotNull(session.Sender);
        Assert.NotNull(session.Snapshot.QrText);
        Assert.Equal("", session.Snapshot.Reason);
        Assert.Equal(6, session.Snapshot.QrText!.Split('\n').Length);
    }

    [Fact]
    public void RefreshingTheSessionCiasKeepsTheServer()
    {
        string one = Make("kof98.cia", 2048);
        string two = Make("nam1975.cia", 4096);
        using var session = new SendSession([new SessionCia(one, false)], "127.0.0.1");
        session.SetSelection([one]);
        var sender = session.Sender;
        string qr = session.Snapshot.QrText!;

        session.SetSessionCias([new SessionCia(two, false)]);

        Assert.Same(sender, session.Sender);
        Assert.Equal(qr, session.Snapshot.QrText);
    }

    [Fact]
    public void AReportedQrFailureStopsTheServerAndAAddressChangeRetriesIt()
    {
        string cia = Make("kof98.cia", 2048);
        using var session = new SendSession([], "127.0.0.1");
        session.SetSelection([cia]);
        Assert.NotNull(session.Sender);

        session.ReportStartFailure("qr failed");

        Assert.Null(session.Sender);
        Assert.Null(session.Snapshot.QrText);
        Assert.Equal("qr failed", session.Snapshot.StartError);

        session.SetAddress("127.0.0.1");

        Assert.NotNull(session.Sender);
        Assert.Null(session.Snapshot.StartError);
    }

    [Fact]
    public void ASelectionAfterARefusalServesNormally()
    {
        string cia = Make("kof98.cia", 2048);
        using var session = new SendSession([], "127.0.0.1");
        session.SetSelection([Make("kof98.zip")]);
        Assert.Null(session.Sender);

        session.SetSelection([cia]);

        Assert.NotNull(session.Sender);
        Assert.NotNull(session.Snapshot.QrText);
        Assert.Equal("", session.Snapshot.Reason);
    }

    static void WaitFor(SendSession session, Func<SendSnapshot, bool> done)
    {
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(5);
        while (DateTime.UtcNow < deadline)
        {
            if (done(session.Snapshot)) return;
            Thread.Sleep(20);
        }
        throw new Xunit.Sdk.XunitException("Timed out waiting for the send progress.");
    }
}
