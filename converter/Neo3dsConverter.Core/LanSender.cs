using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;

namespace Neo3dsConverter;

/// <summary>A LAN IPv4 address a 3DS on the same network can reach; <see cref="Name"/> is the adapter name.</summary>
public sealed record LanAddress(string Address, string Name)
{
    public override string ToString() => $"{Address} · {Name}";
}

/// <summary>#264: one file in a batch and the last URL segment the 3DS asks for.</summary>
public sealed record LanFile(string Path, string RouteName);

/// <summary>#264: a served file as the 3DS sees it. The batch event carries this so the dialog can mark one row.</summary>
public sealed record LanItem(string Path, string FileName, string Route, long Length, string Url)
{
    public override string ToString() => FileName;
}

/// <summary>
/// Serves built CIAs or launcher packs to a 3DS on the same network (#235, #264). FBI's Remote
/// Install scans a QR code holding the URL list, downloads each file, and installs it, so the SD
/// card stays in the console. Local network only: every path carries one random 64-bit token and
/// the listener stops with the dialog.
/// </summary>
public sealed class LanSender : IDisposable
{
    /// <summary>Enough for a request line from FBI's HTTP client; anything longer is dropped.</summary>
    const int RequestLimit = 8192;
    const int BufferSize = 64 * 1024;
    static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(15);

    const int Prepared = 0;
    const int Listening = 1;
    const int DisposedState = 2;

    readonly Socket socket;
    readonly object stateGate = new();
    readonly CancellationTokenSource stop = new();
    readonly IReadOnlyList<LanItem> items;
    readonly Dictionary<string, LanItem> byRoute;
    Task? loop;
    int state;

    LanSender(IReadOnlyList<LanFile> files, Socket socket, string address, string token)
    {
        this.socket = socket;
        Address = address;
        Port = ((IPEndPoint)socket.LocalEndPoint!).Port;
        var served = new List<LanItem>(files.Count);
        foreach (var file in files)
        {
            string full = Path.GetFullPath(file.Path);
            string name = Path.GetFileName(full);
            string route = "/" + token + "/" + Uri.EscapeDataString(file.RouteName);
            served.Add(new LanItem(full, name, route, new FileInfo(full).Length,
                $"http://{address}:{Port}{route}"));
        }
        items = served;
        byRoute = served.ToDictionary(i => i.Route, StringComparer.Ordinal);
    }

    /// <summary>Every served file, in the order the 3DS should fetch them.</summary>
    public IReadOnlyList<LanItem> Items => items;

    /// <summary>The newline-separated URL list for one batch QR (no trailing newline).</summary>
    public string QrText => string.Join("\n", items.Select(i => i.Url));

    public string Address { get; }
    public int Port { get; }

    /// <summary>True only while listening; a prepared but not started sender holds its port silently.</summary>
    public bool IsRunning => Volatile.Read(ref state) == Listening;

    /// <summary>Raised after a client received the whole file (on a worker thread).</summary>
    public event Action<LanItem>? ItemDownloaded;

    /// <summary>Raised when a client with the right path asked for the file and the body starts (worker thread).</summary>
    public event Action<LanItem>? ItemStarted;

    /// <summary>
    /// Starts serving <paramref name="filePath"/>. <paramref name="address"/> is the IPv4 address
    /// the 3DS uses to reach this PC; when null the first LAN address with a gateway is picked.
    /// </summary>
    public static LanSender Start(string filePath, string? address = null) =>
        StartBatch([new LanFile(filePath, Path.GetFileName(filePath))], address);

    /// <summary>
    /// #264: serves every file from one listener and one token. <see cref="LanFile.RouteName"/> is
    /// the last URL segment before escaping: a short index for a CIA batch, the file name for packs.
    /// </summary>
    public static LanSender StartBatch(IReadOnlyList<LanFile> files, string? address = null)
    {
        var sender = Prepare(files, address);
        sender.Start();
        return sender;
    }

    /// <summary>
    /// #313: binds the socket and builds the token and URLs, but listens for nothing yet. The
    /// caller measures a QR against the real port and starts it only when the batch fits.
    /// </summary>
    public static LanSender Prepare(IReadOnlyList<LanFile> files, string? address = null)
    {
        if (files.Count == 0) throw new ArgumentException("At least one file is required.", nameof(files));
        if (files.Count > SendBatch.MaxFiles)
            throw new ArgumentException($"At most {SendBatch.MaxFiles} files can be sent at once.", nameof(files));
        var routes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in files)
        {
            if (string.IsNullOrWhiteSpace(file.RouteName))
                throw new ArgumentException("A route name is required.", nameof(files));
            if (!routes.Add(file.RouteName))
                throw new ArgumentException($"Duplicate route name: {file.RouteName}", nameof(files));
            if (!File.Exists(file.Path)) throw new FileNotFoundException("File to send not found.", file.Path);
        }

        address ??= FindLanAddress() ?? throw new InvalidOperationException("No LAN IPv4 address found.");
        if (!IPAddress.TryParse(address, out IPAddress? bound) || bound.AddressFamily != AddressFamily.InterNetwork)
            throw new ArgumentException($"Not an IPv4 address: {address}", nameof(address));
        var socket = new Socket(bound.AddressFamily, SocketType.Stream, ProtocolType.Tcp);
        try
        {
            socket.Bind(new IPEndPoint(bound, 0));
            string token = Convert.ToHexString(RandomNumberGenerator.GetBytes(8)).ToLowerInvariant();
            return new LanSender(files.Select(f => new LanFile(Path.GetFullPath(f.Path), f.RouteName)).ToArray(),
                socket, address, token);
        }
        catch
        {
            socket.Close();
            throw;
        }
    }

    /// <summary>Listens for connections; an already started or disposed sender cannot start again.</summary>
    public void Start()
    {
        lock (stateGate)
        {
            if (state != Prepared)
                throw new InvalidOperationException("The sender was already started or disposed.");
            socket.Listen(8);
            state = Listening;
            loop = Task.Run(() => AcceptAsync(stop.Token));
        }
    }

    /// <summary>
    /// Every IPv4 address a 3DS can reach, best first: an interface with a default gateway ranks
    /// above one without, a private range above a public one, and APIPA (169.254.0.0/16) last.
    /// The first entry is what <see cref="FindLanAddress"/> picks and what the dialogs preselect.
    /// </summary>
    public static IReadOnlyList<LanAddress> LanAddresses()
    {
        var found = new List<(int Score, LanAddress Address)>();
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
                string text = unicast.Address.ToString();
                if (found.Any(f => f.Address.Address == text)) continue;
                int score = (IsPrivate(unicast.Address) ? 2 : 0) + (gateway ? 4 : 0)
                    + InterfaceScore(nic.NetworkInterfaceType);
                if (unicast.Address.GetAddressBytes()[0] == 169) score -= 8; // APIPA: not routable
                found.Add((score, new LanAddress(text, nic.Name)));
            }
        }
        return found
            .OrderByDescending(f => f.Score)
            .ThenBy(f => f.Address.Address, StringComparer.Ordinal)
            .Select(f => f.Address)
            .ToArray();
    }

    /// <summary>The address a 3DS on the same Wi-Fi can reach, or null when there is no LAN interface.</summary>
    public static string? FindLanAddress() => LanAddresses().FirstOrDefault()?.Address;

    /// <summary>A real LAN adapter beats a virtual one; a VPN (Ppp) ranks below both.</summary>
    static int InterfaceScore(NetworkInterfaceType type) => type switch
    {
        NetworkInterfaceType.Wireless80211 or NetworkInterfaceType.Ethernet
            or NetworkInterfaceType.GigabitEthernet or NetworkInterfaceType.FastEthernetT
            or NetworkInterfaceType.FastEthernetFx => 2,
        NetworkInterfaceType.Ppp => -4,
        _ => 0,
    };

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
            Socket client;
            try { client = await socket.AcceptAsync(ct); }
            catch (OperationCanceledException) { break; }
            catch (ObjectDisposedException) { break; }
            catch (SocketException) { break; }
            _ = ServeAsync(client, ct);
        }
    }

    /// <summary>
    /// One connection per task: a client that connects and sends nothing must not block the 3DS
    /// behind it for the whole request timeout. Failures drop that client only.
    /// </summary>
    async Task ServeAsync(Socket client, CancellationToken ct)
    {
        using (var stream = new NetworkStream(client, ownsSocket: true))
        {
            try { await HandleAsync(stream, ct); }
            catch (Exception) { /* dropped client: the 3DS retries */ }
        }
    }

    async Task HandleAsync(NetworkStream stream, CancellationToken ct)
    {
        using var readCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        readCts.CancelAfter(RequestTimeout);
        string? line = await ReadRequestAsync(stream, readCts.Token);
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
        if (!byRoute.TryGetValue(TargetPath(parts[1]), out LanItem? item))
        {
            await WriteStatusAsync(stream, "404 Not Found", ct);
            return;
        }

        FileStream? input = null;
        try
        {
            input = new FileStream(item.Path, FileMode.Open, FileAccess.Read, FileShare.Read,
                BufferSize, FileOptions.Asynchronous | FileOptions.SequentialScan);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            await WriteStatusAsync(stream, "404 Not Found", ct);
            return;
        }

        await using (input)
        {
            await WriteHeadersAsync(stream, input.Length, ct);
            if (method == "GET")
            {
                ItemStarted?.Invoke(item);
                await input.CopyToAsync(stream, BufferSize, ct);
                await stream.FlushAsync(ct);
                ItemDownloaded?.Invoke(item);
                return;
            }
            await stream.FlushAsync(ct);
        }
    }

    /// <summary>
    /// Reads the request line and the rest of the header block, so the socket holds no unread input
    /// when the response ends: closing with unread bytes makes TCP send RST and can truncate the file.
    /// Null when the client sent nothing usable.
    /// </summary>
    static async Task<string?> ReadRequestAsync(NetworkStream stream, CancellationToken ct)
    {
        var buffer = new byte[RequestLimit];
        int length = 0;
        while (length < buffer.Length)
        {
            int read = await stream.ReadAsync(buffer.AsMemory(length), ct);
            if (read == 0) return length == 0 ? null : FirstLine(buffer, length);
            length += read;
            if (HeadersComplete(buffer, length)) return FirstLine(buffer, length);
        }
        return null;
    }

    static string FirstLine(byte[] buffer, int length)
    {
        int newline = Array.IndexOf(buffer, (byte)'\n', 0, length);
        int end = newline > 0 && buffer[newline - 1] == (byte)'\r' ? newline - 1 : newline;
        return Encoding.ASCII.GetString(buffer, 0, end);
    }

    /// <summary>True once the blank line that ends the headers arrived ("\n\n" or "\r\n\r\n").</summary>
    static bool HeadersComplete(byte[] buffer, int length)
    {
        for (int i = 0; i + 1 < length; i++)
        {
            if (buffer[i] != (byte)'\n') continue;
            if (buffer[i + 1] == (byte)'\n') return true;
            if (buffer[i + 1] == (byte)'\r' && i + 2 < length && buffer[i + 2] == (byte)'\n') return true;
        }
        return false;
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

    /// <summary>Stops serving and releases the port.</summary>
    public void Stop() => Dispose();

    public void Dispose()
    {
        bool wait;
        lock (stateGate)
        {
            if (state == DisposedState) return;
            wait = state == Listening;
            state = DisposedState;
        }
        stop.Cancel();
        try { socket.Close(); } catch { }
        if (wait)
        {
            try { loop?.Wait(TimeSpan.FromSeconds(2)); }
            catch (AggregateException) { }
        }
        // The token source stays undisposed: per-connection tasks may still hold its token.
    }
}
