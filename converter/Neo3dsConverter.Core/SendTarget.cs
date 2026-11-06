namespace Neo3dsConverter;

/// <summary>A CIA this session built; the launcher CIA is labelled so it is not mistaken for a game.</summary>
public sealed record SessionCia(string Path, bool Launcher);

/// <summary>What the PC serves: an installable CIA (FBI) or a launcher game file.</summary>
public enum SendKind { Cia, Launcher }

/// <summary>Who scans the QR code.</summary>
public enum SendGuide { Fbi, Launcher }

/// <summary>Why a chosen path cannot be sent; <see cref="None"/> means it can.</summary>
public enum SendRefusal { None, MissingFile, NotAFile, UnsupportedExtension, NameTooLong, NameUnsafe }

/// <summary>The three states the dialog shows: waiting for the 3DS, sending, and sent by the PC.</summary>
public enum SendState { Waiting, Sending, Sent }

/// <summary>
/// #255: one file chosen for "send to 3DS", judged before any server starts. Both windows call this,
/// so the kind, the label and the refusal are the same in Avalonia and WinForms.
/// </summary>
public sealed record SendCandidate(string FullPath, string FileName, SendKind? Kind, bool SessionLauncher, SendRefusal Refusal)
{
    public bool Allowed => Refusal == SendRefusal.None;

    public SendGuide Guide => Kind == SendKind.Launcher ? SendGuide.Launcher : SendGuide.Fbi;

    public string DisplayName => SessionLauncher ? Lang.L("런처", "Launcher") + " · " + FileName : FileName;

    public string Reason => SendText.Refusal(Refusal, FileName);

    /// <summary>The judgement for <paramref name="path"/>; null when nothing was chosen.</summary>
    public static SendCandidate? Resolve(string? path, IReadOnlyList<SessionCia> session)
    {
        if (string.IsNullOrWhiteSpace(path)) return null;
        string full = Path.GetFullPath(path);
        string name = Path.GetFileName(full);
        bool launcher = session.Any(c => c.Launcher && string.Equals(Path.GetFullPath(c.Path), full, StringComparison.OrdinalIgnoreCase));
        if (Directory.Exists(full)) return new SendCandidate(full, name, null, launcher, SendRefusal.NotAFile);
        if (!File.Exists(full)) return new SendCandidate(full, name, null, launcher, SendRefusal.MissingFile);
        if (!name.EndsWith(".cia", StringComparison.OrdinalIgnoreCase))
            return new SendCandidate(full, name, null, launcher, SendRefusal.UnsupportedExtension);
        return new SendCandidate(full, name, SendKind.Cia, launcher, SendRefusal.None);
    }
}

/// <summary>The send dialog's wording, shared by both windows so the two never drift apart.</summary>
public static class SendText
{
    public static string Steps(SendGuide guide) => guide == SendGuide.Launcher
        ? Lang.L("런처에서 Y(QR)를 누르고 QR 코드를 스캔하세요.\nPC와 3DS가 같은 네트워크(같은 공유기)에 있어야 합니다. 3DS는 2.4 GHz Wi-Fi만 됩니다.",
                 "Press Y (QR) in the launcher, then scan the QR code.\nThe PC and the 3DS must be on the same network (router). The 3DS is 2.4 GHz Wi-Fi only.")
        : Lang.L("FBI → Remote Install → Scan QR Code\nPC와 3DS가 같은 네트워크(같은 공유기)에 있어야 합니다. 3DS는 2.4 GHz Wi-Fi만 됩니다.",
                 "FBI → Remote Install → Scan QR Code\nThe PC and the 3DS must be on the same network (router). The 3DS is 2.4 GHz Wi-Fi only.");

    public static string Notes(SendGuide guide) => guide == SendGuide.Launcher
        ? Lang.L("• 방화벽이 물으면 허용하세요. 차단하면 런처가 내려받지 못합니다.\n• VPN이 켜져 있으면 위 주소에서 실제 Wi-Fi/LAN 주소를 고르세요.\n• 3DS 저장 공간이 부족하면 런처가 SD에 쓰기 전에 거부합니다.",
                 "• Allow it when the firewall asks; blocking it stops the launcher's download.\n• With a VPN on, pick the real Wi-Fi/LAN address above.\n• If the 3DS SD card is short on space, the launcher refuses before writing.")
        : Lang.L("• 방화벽이 물으면 허용하세요. 차단하면 FBI 다운로드가 실패합니다.\n• VPN이 켜져 있으면 위 주소에서 실제 Wi-Fi/LAN 주소를 고르세요. VPN 주소로는 3DS가 접속하지 못합니다.\n• SD 카드 공간이 부족하면 FBI 설치가 실패합니다.",
                 "• Allow it when the firewall asks; blocking it makes the FBI download fail.\n• With a VPN on, pick the real Wi-Fi/LAN address above; the 3DS cannot reach a VPN address.\n• FBI fails to install if the SD card lacks free space.");

    public static string Status(SendState state, SendGuide guide) => state switch
    {
        SendState.Waiting => guide == SendGuide.Launcher
            ? Lang.L("3DS 대기 — 런처에서 Y를 눌러 QR을 스캔하세요.", "Waiting for the 3DS — press Y in the launcher and scan the QR.")
            : Lang.L("3DS 대기 — FBI에서 QR을 스캔하세요.", "Waiting for the 3DS — scan the QR in FBI."),
        SendState.Sending => Lang.L("보내는 중 — 3DS가 내려받고 있습니다.", "Sending — the 3DS is downloading."),
        SendState.Sent => guide == SendGuide.Launcher
            ? Lang.L("PC 전송 완료 — 런처가 검사한 뒤 목록에 추가합니다.", "Sent by the PC — the launcher checks it and adds it to the list.")
            : Lang.L("PC 전송 완료 — FBI가 설치를 계속합니다.", "Sent by the PC — FBI continues with the install."),
        _ => "",
    };

    /// <summary>The file size shown next to the name.</summary>
    public static string Size(long bytes) => bytes >= 1048576
        ? $"{bytes / 1048576.0:0.0} MB"
        : $"{Math.Max(1, bytes / 1024)} KB";

    public static string Refusal(SendRefusal refusal, string name) => refusal switch
    {
        SendRefusal.None => "",
        SendRefusal.MissingFile => Lang.L($"파일을 찾을 수 없습니다: {name}", $"File not found: {name}"),
        SendRefusal.NotAFile => Lang.L("폴더는 보낼 수 없습니다. 파일을 고르세요.", "A folder cannot be sent. Pick a file."),
        SendRefusal.UnsupportedExtension => Lang.L(".cia 파일만 보낼 수 있습니다.", "Only .cia files can be sent."),
        SendRefusal.NameTooLong => Lang.L("파일 이름이 너무 깁니다 (103바이트 이하).", "The file name is too long (103 bytes or less)."),
        SendRefusal.NameUnsafe => Lang.L("파일 이름에 3DS가 쓸 수 없는 문자가 있거나 끝이 점·공백입니다.",
                                         "The file name has characters the 3DS cannot store, or ends with a dot or space."),
        _ => "",
    };
}
