using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;

namespace Neo3dsConverter;

/// <summary>
/// Serves one built file to a 3DS on the same network (#225). FBI's Remote Install scans a QR
/// code for this URL, downloads the file, and installs it, so the SD card never leaves the console.
/// Local network only: the URL carries a random token, and the listener stops with the dialog.
/// </summary>
public sealed class LanSender : IDisposable
{
    /// <summary>Enough for a request line and headers from FBI's HTTP client; anything longer is dropped.</summary>
    const int RequestLimit = 8192;
    const int BufferSize = 64 * 1024;

    readonly TcpListener listener;
    readonly CancellationTokenSource stop = new();
    readonly Task loop;
    readonly string file;
    readonly string expectedPath;
    int disposed;

    LanSender(string file, TcpListener listener, string address, string token)
    {
        this.file = file;
        this.listener = listener;
        FileName = Path.GetFileName(file);
        Length = new FileInfo(file).Length;
        Address = address;
        Port = ((IPEndPoint)listener.LocalEndpoint).Port;
        expectedPath = "/" + token + "/" + Uri.EscapeDataString(FileName);
        Url = $"http://{address}:{Port}{expectedPath}";
        loop = Task.Run(() => AcceptAsync(stop.Token));
    }

    /// <summary>The URL to put in the QR code.</summary>
    public string Url { get; }
    public string FileName { get; }
    public string Address { get; }
    public int Port { get; }
    public long Length { get; }

    /// <summary>Raised after a client received the whole file (on a worker thread).</summary>
    public event Action? Downloaded;

    /// <summary>
    /// Starts serving <paramref name="filePath"/>. <paramref name="address"/> is the IPv4 address
    /// the 3DS uses to reach this PC; when null the first LAN address with a gateway is picked.
    /// </summary>
    public static LanSender Start(string filePath, string? address = null)
    {
        if (!File.Exists(filePath)) throw new FileNotFoundException("File to send not found.", filePath);
        address ??= FindLanAddress() ?? throw new InvalidOperationException("No LAN IPv4 address found.");
        var listener = new TcpListener(IPAddress.Any, 0);
        listener.Start();
        try
        {
            string token = Convert.ToHexString(RandomNumberGenerator.GetBytes(8)).ToLowerInvariant();
            return new LanSender(Path.GetFullPath(filePath), listener, address, token);
        }
        catch
        {
            listener.Stop();
            throw;
        }
    }

    /// <summary>
    /// The IPv4 address a 3DS on the same Wi-Fi can reach. Prefers an interface with a default
    /// gateway, then a private range; virtual adapters without a gateway rank below the real one.
    /// </summary>
    public static string? FindLanAddress()
    {
        var found = new List<(int Score, string Address)>();
        foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (nic.OperationalStatus != OperationalStatus.Up) continue;
            if (nic.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel) continue;
            IPInterfaceProperties props;
            try { props = nic.GetIPProperties(); }
            catch (NetworkInformationException) { continue; }
            bool gateway = props.GatewayAddresses.Any(g =>
                g.Address.AddressFamily == AddressFamily.InterNetwork && !g.Address.Equals(IPAddress.Any));
            foreach (var unicast in props.UnicastAddresses)
            {
                if (unicast.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                if (IPAddress.IsLoopback(unicast.Address)) continue;
                int score = (IsPrivate(unicast.Address) ? 2 : 0) + (gateway ? 4 : 0);
                if (unicast.Address.GetAddressBytes()[0] == 169) score -= 8; // APIPA: not routable
                found.Add((score, unicast.Address.ToString()));
            }
        }
        return found.Count == 0 ? null : found.OrderByDescending(f => f.Score).First().Address;
    }

    static bool IsPrivate(IPAddress ip)
    {
        byte[] b = ip.GetAddressBytes();
        return b[0] == 10
            || (b[0] == 172 && b[1] >= 16 && b[1] <= 31)
            || (b[0] == 192 && b[1] == 168);
    }

    async Task AcceptAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            TcpClient client;
            try { client = await listener.AcceptTcpClientAsync(ct); }
            catch (OperationCanceledException) { break; }
            catch (ObjectDisposedException) { break; }
            catch (SocketException) { break; }
            using (client)
            {
                try { await HandleAsync(client, ct); }
                catch (OperationCanceledException) { }
                catch (IOException) { }
                catch (SocketException) { }
            }
        }
    }

    async Task HandleAsync(TcpClient client, CancellationToken ct)
    {
        NetworkStream stream = client.GetStream();
        using var readCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        readCts.CancelAfter(TimeSpan.FromSeconds(15));
        string? line = await ReadRequestLineAsync(stream, readCts.Token);
        if (line == null) return;

        string[] parts = line.Split(' ', 3, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 2)
        {
            await WriteStatusAsync(stream, "400 Bad Request", ct);
            return;
        }
        string method = parts[0];
        if (method is not ("GET" or "HEAD"))
        {
            await WriteStatusAsync(stream, "405 Method Not Allowed", ct);
            return;
        }
        if (!string.Equals(TargetPath(parts[1]), expectedPath, StringComparison.Ordinal))
        {
            await WriteStatusAsync(stream, "404 Not Found", ct);
            return;
        }

        await using var input = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read,
            BufferSize, FileOptions.Asynchronous | FileOptions.SequentialScan);
        await WriteHeadersAsync(stream, input.Length, ct);
        if (method == "GET")
        {
            await input.CopyToAsync(stream, BufferSize, ct);
            await stream.FlushAsync(ct);
            Downloaded?.Invoke();
            return;
        }
        await stream.FlushAsync(ct);
    }

    /// <summary>Reads the request line, stopping at LF. Null when the client sent nothing usable.</summary>
    static async Task<string?> ReadRequestLineAsync(NetworkStream stream, CancellationToken ct)
    {
        var buffer = new byte[RequestLimit];
        int length = 0;
        while (length < buffer.Length)
        {
            int read = await stream.ReadAsync(buffer.AsMemory(length), ct);
            if (read == 0) return null;
            int newline = Array.IndexOf(buffer, (byte)'\n', length, read);
            length += read;
            if (newline < 0) continue;
            int end = newline > 0 && buffer[newline - 1] == (byte)'\r' ? newline - 1 : newline;
            return Encoding.ASCII.GetString(buffer, 0, end);
        }
        return null;
    }

    /// <summary>Origin-form ("/path") from a normal client; absolute-form when a proxy-like client sends one.</summary>
    static string TargetPath(string target)
    {
        if (Uri.TryCreate(target, UriKind.Absolute, out Uri? uri) && uri.Scheme is "http" or "https")
            return uri.AbsolutePath;
        int query = target.IndexOf('?');
        return query < 0 ? target : target[..query];
    }

    static Task WriteStatusAsync(NetworkStream stream, string status, CancellationToken ct)
    {
        string head = $"HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        return stream.WriteAsync(Encoding.ASCII.GetBytes(head), ct).AsTask();
    }

    static Task WriteHeadersAsync(NetworkStream stream, long length, CancellationToken ct)
    {
        string head = "HTTP/1.1 200 OK\r\n"
            + "Content-Type: application/octet-stream\r\n"
            + $"Content-Length: {length}\r\n"
            + "Cache-Control: no-store\r\n"
            + "Connection: close\r\n\r\n";
        return stream.WriteAsync(Encoding.ASCII.GetBytes(head), ct).AsTask();
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0) return;
        stop.Cancel();
        listener.Stop();
        try
        {
            if (loop.Wait(TimeSpan.FromSeconds(2))) stop.Dispose();
        }
        catch (AggregateException)
        {
            stop.Dispose();
        }
    }
}
