using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Threading;

namespace Neo3dsConverter.Desktop;

/// <summary>A CIA this session built; the launcher CIA is labelled so it is not mistaken for a game.</summary>
internal sealed record BuiltCia(string Path, bool Launcher);

/// <summary>
/// #236: the QR window for "send to 3DS". It owns the <see cref="LanSender"/>, so closing the
/// window (or disposing the dialog) stops the server and frees the port.
/// </summary>
internal sealed class SendDialog : IDisposable
{
    readonly Window window;
    readonly Image qr = new() { Stretch = Stretch.Uniform, HorizontalAlignment = HorizontalAlignment.Center };
    readonly TextBlock status = new() { TextWrapping = TextWrapping.Wrap, FontWeight = FontWeight.Bold };
    readonly TextBlock info = new() { TextWrapping = TextWrapping.Wrap };
    readonly TextBox url = new() { IsReadOnly = true };
    readonly ComboBox addressBox;
    readonly IReadOnlyList<LanAddress> addresses;
    readonly BuiltCia target;
    LanSender? sender;

    public SendDialog(BuiltCia target, IReadOnlyList<LanAddress> addresses)
    {
        this.target = target;
        this.addresses = addresses;
        addressBox = new ComboBox
        {
            ItemsSource = addresses.Select(a => a.ToString()).ToArray(),
            SelectedIndex = 0,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        RenderOptions.SetBitmapInterpolationMode(qr, BitmapInterpolationMode.None);

        var hint = new TextBlock
        {
            Text = Lang.L("3DS와 같은 공유기에 연결된 주소를 고르세요.", "Pick the address on the network the 3DS shares."),
            TextWrapping = TextWrapping.Wrap,
        };
        var steps = new TextBlock
        {
            Text = Lang.L("FBI → Remote Install → Scan QR Code\nPC와 3DS가 같은 네트워크(같은 공유기)에 있어야 합니다. 3DS는 2.4 GHz Wi-Fi만 됩니다. 방화벽이 물으면 허용하세요.",
                          "FBI → Remote Install → Scan QR Code\nThe PC and the 3DS must be on the same network (router). The 3DS is 2.4 GHz Wi-Fi only. Allow it if the firewall asks."),
            TextWrapping = TextWrapping.Wrap,
        };
        var close = new Button
        {
            Content = Lang.L("닫기", "Close"),
            HorizontalAlignment = HorizontalAlignment.Center,
            Padding = new Avalonia.Thickness(24, 4),
        };
        window = new Window
        {
            Title = Lang.L("3DS로 보내기", "Send to 3DS"),
            Width = 460,
            SizeToContent = SizeToContent.Height,
            CanResize = false,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            Content = new StackPanel
            {
                Margin = new Avalonia.Thickness(16),
                Spacing = 10,
                Children = { qr, status, info, addressBox, hint, url, steps, close },
            },
        };
        close.Click += (_, _) => window.Close();
        addressBox.SelectionChanged += (_, _) => { if (addressBox.SelectedIndex >= 0) Connect(addressBox.SelectedIndex); };
        window.Closed += (_, _) => Stop();
        Connect(0);
    }

    public Window Window => window;

    /// <summary>The running server, or null after a failed start or after the dialog closed.</summary>
    public LanSender? Sender => sender;

    public string? Url => sender?.Url;

    internal string StatusText => status.Text ?? "";
    internal string InfoText => info.Text ?? "";

    public Task ShowAsync(Window owner) => window.ShowDialog(owner);

    void Connect(int index)
    {
        Stop();
        try
        {
            var s = LanSender.Start(target.Path, addresses[index].Address);
            s.Downloaded += () => Dispatcher.UIThread.Post(() =>
            {
                if (ReferenceEquals(sender, s))
                    status.Text = Lang.L("전송 완료 — FBI가 설치를 계속합니다.", "Sent — FBI continues with the install.");
            });
            (qr.Source as IDisposable)?.Dispose();
            var png = new Bitmap(new MemoryStream(QrCode.Png(s.Url)));
            int scale = Math.Max(1, 240 / png.PixelSize.Width);
            sender = s;
            qr.Source = png;
            qr.Width = png.PixelSize.Width * scale;
            qr.Height = png.PixelSize.Height * scale;
            url.Text = s.Url;
            info.Text = $"{s.FileName} · {MainWindow.Size(s.Length)}";
            status.Text = Lang.L("3DS의 FBI에서 QR을 스캔하세요.", "Scan the QR code in FBI on the 3DS.");
        }
        catch (Exception ex)
        {
            Stop();
            (qr.Source as IDisposable)?.Dispose();
            qr.Source = null;
            info.Text = url.Text = "";
            status.Text = Lang.L("전송 실패: ", "Send failed: ") + ex.Message;
        }
    }

    void Stop()
    {
        sender?.Dispose();
        sender = null;
    }

    public void Dispose() => Stop();
}
