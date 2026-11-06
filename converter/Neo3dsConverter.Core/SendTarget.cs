using System.Text;

namespace Neo3dsConverter;

/// <summary>A CIA this session built; the launcher CIA is labelled so it is not mistaken for a game.</summary>
public sealed record SessionCia(string Path, bool Launcher);
/// <summary>What the PC serves: an installable CIA (FBI) or a launcher game file.</summary>
public enum SendKind { Cia, Launcher }

/// <summary>Who scans the QR code.</summary>
public enum SendGuide { Fbi, Launcher }

/// <summary>Why a chosen path cannot be sent; <see cref="None"/> means it can.</summary>
public enum SendRefusal
{
    None, MissingFile, NotAFile, UnsupportedExtension, NameTooLong, NameUnsafe, UrlTooLong, NoFileName,
    MixedKinds, DuplicateName, TooManyFiles, QrTooLarge,
}

/// <summary>The three states the dialog shows: waiting for the 3DS, sending, and sent by the PC.</summary>
public enum SendState { Waiting, Sending, Sent }

/// <summary>
/// #255: one file chosen for "send to 3DS", judged before any server starts. Both windows call this,
/// so the kind, the label and the refusal are the same in Avalonia and WinForms.
/// </summary>
public sealed record SendCandidate(string FullPath, string FileName, SendKind? Kind, bool SessionLauncher,
    SendRefusal Refusal, long Length = 0)
{
    public bool Allowed => Refusal == SendRefusal.None;

    public SendGuide Guide => Kind == SendKind.Launcher ? SendGuide.Launcher : SendGuide.Fbi;

    public string DisplayName => SessionLauncher ? Lang.L("런처", "Launcher") + " · " + FileName : FileName;

    public string Reason => SendText.Refusal(Refusal, FileName);

    /// <summary>#257: the launcher's own rule for a file it can save; mirrors name_ok in receive_url.c.</summary>
    public static SendRefusal LauncherNameProblem(string fileName)
    {
        if (!fileName.EndsWith(PackSuffix, StringComparison.OrdinalIgnoreCase))
            return SendRefusal.UnsupportedExtension;
        if (Encoding.UTF8.GetByteCount(fileName) > 103) return SendRefusal.NameTooLong;
        if (fileName.Length == PackSuffix.Length) return SendRefusal.NoFileName;
        char beforeSuffix = fileName[fileName.Length - PackSuffix.Length - 1];
        if (beforeSuffix is ' ' or '.') return SendRefusal.NameUnsafe;
        foreach (char c in fileName)
            if (c < 32 || c == 127 || "/\\:*?\"<>|".Contains(c)) return SendRefusal.NameUnsafe;
        // The launcher keeps the raw URL path in 256 bytes: "/" + 16 hex token + "/" is 18 of them.
        if (Uri.EscapeDataString(fileName).Length > 255 - 18) return SendRefusal.UrlTooLong;
        return SendRefusal.None;
    }

    const string PackSuffix = ".neo3ds";

    /// <summary>The judgement for <paramref name="path"/>; null when nothing was chosen.</summary>
    public static SendCandidate? Resolve(string? path, IReadOnlyList<SessionCia> session)
    {
        if (string.IsNullOrWhiteSpace(path)) return null;
        string full = Path.GetFullPath(path);
        string name = Path.GetFileName(full);
        bool launcher = session.Any(c => c.Launcher && string.Equals(Path.GetFullPath(c.Path), full, StringComparison.OrdinalIgnoreCase));
        if (Directory.Exists(full)) return new SendCandidate(full, name, null, launcher, SendRefusal.NotAFile);
        if (!File.Exists(full)) return new SendCandidate(full, name, null, launcher, SendRefusal.MissingFile);
        long length;
        try { length = new FileInfo(full).Length; }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return new SendCandidate(full, name, null, launcher, SendRefusal.MissingFile);
        }
        if (name.EndsWith(PackSuffix, StringComparison.OrdinalIgnoreCase))
            return new SendCandidate(full, name, SendKind.Launcher, launcher, LauncherNameProblem(name), length);
        if (!name.EndsWith(".cia", StringComparison.OrdinalIgnoreCase))
            return new SendCandidate(full, name, null, launcher, SendRefusal.UnsupportedExtension, length);
        return new SendCandidate(full, name, SendKind.Cia, launcher, SendRefusal.None, length);
    }
}

/// <summary>
/// #264: 2 to 6 files chosen for one QR. Both windows ask this before starting a server, so the
/// batch kind, the refusal and the wording are the same everywhere.
/// </summary>
public sealed record SendBatch(IReadOnlyList<SendCandidate> Items, SendKind? Kind, SendRefusal Refusal,
    int AllowedCount, string Reason, long TotalLength)
{
    public const int MaxFiles = 6;

    public bool Allowed => Refusal == SendRefusal.None;

    public SendGuide Guide => Kind == SendKind.Launcher ? SendGuide.Launcher : SendGuide.Fbi;

    /// <summary>Judges the selection without touching the network; null when nothing was chosen.</summary>
    public static SendBatch? Resolve(IReadOnlyList<string> paths, IReadOnlyList<SessionCia> session)
    {
        var chosen = paths
            .Where(p => !string.IsNullOrWhiteSpace(p))
            .Select(p => SendCandidate.Resolve(p, session))
            .OfType<SendCandidate>()
            .ToArray();
        if (chosen.Length == 0) return null;

        long total = 0;
        foreach (var item in chosen) total = checked(total + item.Length);
        if (chosen.Length > MaxFiles)
            return Refused(chosen, SendRefusal.TooManyFiles, total,
                SendText.BatchReason(SendRefusal.TooManyFiles, "", 0));

        var bad = chosen.FirstOrDefault(c => !c.Allowed);
        if (bad != null)
            return Refused(chosen, bad.Refusal, total, SendText.BatchItemReason(bad));

        var kinds = chosen.Select(c => c.Kind).Distinct().ToArray();
        if (kinds.Length > 1)
            return Refused(chosen, SendRefusal.MixedKinds, total,
                SendText.BatchReason(SendRefusal.MixedKinds, "", 0));

        var duplicate = chosen
            .GroupBy(c => c.FileName, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault(g => g.Count() > 1);
        if (duplicate != null)
            return Refused(chosen, SendRefusal.DuplicateName, total,
                SendText.BatchReason(SendRefusal.DuplicateName, duplicate.Key, 0));

        return new SendBatch(chosen, kinds[0], SendRefusal.None, chosen.Length, "", total);
    }

    static SendBatch Refused(IReadOnlyList<SendCandidate> items, SendRefusal refusal, long total, string reason)
    {
        var kinds = items.Select(i => i.Kind).Distinct().ToArray();
        return new SendBatch(items, kinds.Length == 1 ? kinds[0] : null, refusal, 0, reason, total);
    }

    /// <summary>
    /// #264: keeps the batch only when one ECC L QR stays within version 12 (73 modules with the
    /// quiet zone). A single file keeps the old ECC M path and is not limited here.
    /// </summary>
    public SendBatch WithQr(IReadOnlyList<string> urls)
    {
        if (!Allowed || Items.Count < 2) return this;
        if (urls.Count != Items.Count) throw new ArgumentException("One URL per file is required.", nameof(urls));
        int allowed = QrCode.BatchAllowedCount(urls);
        if (allowed >= Items.Count) return this;
        return this with
        {
            Refusal = SendRefusal.QrTooLarge,
            AllowedCount = allowed,
            Reason = SendText.BatchReason(SendRefusal.QrTooLarge, "", allowed),
        };
    }
}

/// <summary>#264: one row of the session CIA list, with the label both windows show.</summary>
public sealed record SendSessionRow(SessionCia Cia, string Label)
{
    public static SendSessionRow From(SessionCia cia, IReadOnlyList<SessionCia> session) =>
        new(cia, SendCandidate.Resolve(cia.Path, session)?.DisplayName ?? Path.GetFileName(cia.Path));

    public override string ToString() => Label;
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

    /// <summary>#264: why a whole selection was refused; a file-specific refusal is prefixed by the name.</summary>
    public static string BatchReason(SendRefusal refusal, string name, int allowed) => refusal switch
    {
        SendRefusal.TooManyFiles => Lang.L($"한 번에 최대 {SendBatch.MaxFiles}개까지 보낼 수 있습니다.",
                                           $"You can send up to {SendBatch.MaxFiles} files at once."),
        SendRefusal.MixedKinds => Lang.L(
            "CIA와 팩은 함께 보낼 수 없습니다. CIA는 FBI, 팩은 런처 — 두 번 전송하세요.",
            "CIA and pack files cannot be sent together. CIA goes to FBI, packs go to the launcher — send them in two batches."),
        SendRefusal.DuplicateName => Lang.L(
            $"같은 이름의 파일이 두 개 있습니다: {name}. 이름을 바꾸거나 하나를 빼세요.",
            $"Two files have the same name: {name}. Rename one or remove it."),
        SendRefusal.QrTooLarge => allowed >= 1
            ? Lang.L($"QR이 너무 큽니다. 이 선택에서는 최대 {allowed}개까지 보낼 수 있습니다. 파일 이름을 줄이거나 개수를 줄이세요.",
                     $"The QR would be too large. At most {allowed} of these files fit. Shorten the names or send fewer.")
            : Lang.L("QR이 너무 큽니다. 파일 이름을 줄이세요.", "The QR would be too large. Shorten the file names."),
        _ => "",
    };

    /// <summary>#264: a batch refusal names the file whose own rule failed.</summary>
    public static string BatchItemReason(SendCandidate candidate) => candidate.Refusal == SendRefusal.MissingFile
        ? candidate.Reason
        : $"{candidate.FileName}: {candidate.Reason}";

    /// <summary>#264: one row under the QR; "sent" means the PC finished writing the body.</summary>
    public static string ItemLine(SendState state, string name, long bytes)
    {
        string size = bytes > 0 ? " · " + Size(bytes) : "";
        return state switch
        {
            SendState.Sending => Lang.L($"보내는 중 · {name}", $"Sending · {name}"),
            SendState.Sent => Lang.L($"보냄 · {name}{size}", $"Sent · {name}{size}"),
            _ => Lang.L($"대기 · {name}{size}", $"Waiting · {name}{size}"),
        };
    }

    public static string BatchInfo(int count, long total) =>
        Lang.L($"{count}개 · {Size(total)}", $"{count} files · {Size(total)}");

    /// <summary>#264: the status above the per-file rows.</summary>
    public static string BatchStatus(SendGuide guide, SendState state, int total, int done) => state switch
    {
        SendState.Waiting => guide == SendGuide.Launcher
            ? Lang.L($"3DS 대기 — 런처에서 Y를 눌러 QR을 스캔하세요. ({total}개)",
                     $"Waiting for the 3DS — press Y in the launcher and scan the QR. ({total} files)")
            : Lang.L($"3DS 대기 — FBI에서 QR을 스캔하세요. ({total}개)",
                     $"Waiting for the 3DS — scan the QR in FBI. ({total} files)"),
        SendState.Sending => Lang.L($"보내는 중 — {done}/{total}개 보냄. 3DS가 내려받고 있습니다.",
                                    $"Sending — {done}/{total} sent. The 3DS is downloading."),
        SendState.Sent => guide == SendGuide.Launcher
            ? Lang.L($"PC 전송 완료 — {total}개 모두 보냈습니다. 런처가 검사한 뒤 목록에 추가합니다.",
                     $"Sent by the PC — all {total} files. The launcher checks them and adds them to the list.")
            : Lang.L($"PC 전송 완료 — {total}개 모두 보냈습니다. FBI가 설치를 계속합니다.",
                     $"Sent by the PC — all {total} files. FBI continues with the install."),
        _ => "",
    };

    /// <summary>#264: the normal steps plus the one-QR count.</summary>
    public static string BatchSteps(SendGuide guide, int count) =>
        Steps(guide) + "\n" + Lang.L($"QR 하나에 {count}개가 들어 있습니다.", $"One QR holds {count} files.");

    public static string Refusal(SendRefusal refusal, string name) => refusal switch
    {
        SendRefusal.None => "",
        SendRefusal.MissingFile => Lang.L($"파일을 찾을 수 없습니다: {name}", $"File not found: {name}"),
        SendRefusal.NotAFile => Lang.L("폴더는 보낼 수 없습니다. 파일을 고르세요.", "A folder cannot be sent. Pick a file."),
        SendRefusal.UnsupportedExtension => Lang.L(".cia 또는 .neo3ds 파일만 보낼 수 있습니다.", "Only .cia or .neo3ds files can be sent."),
        SendRefusal.NameTooLong => Lang.L("파일 이름이 너무 깁니다 (103바이트 이하).", "The file name is too long (103 bytes or less)."),
        SendRefusal.NoFileName => Lang.L("파일 이름이 없습니다. 확장자 앞에 이름을 붙이세요.",
                                         "The file has no name. Add a name before the extension."),
        SendRefusal.UrlTooLong => Lang.L("파일 이름이 너무 길어 QR 주소가 3DS 한도를 넘습니다. 이름을 줄이세요.",
                                         "The file name is too long for the QR address the 3DS accepts. Shorten it."),
        SendRefusal.NameUnsafe => Lang.L("파일 이름에 3DS가 쓸 수 없는 문자가 있거나 끝이 점·공백입니다.",
                                         "The file name has characters the 3DS cannot store, or ends with a dot or space."),
        _ => "",
    };
}
