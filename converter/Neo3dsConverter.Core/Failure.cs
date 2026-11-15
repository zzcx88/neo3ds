using System.IO.Compression;
using System.Text.RegularExpressions;
using static Neo3dsConverter.Lang;

namespace Neo3dsConverter;

/// <summary>
/// Why a conversion stopped (#328). Every conversion code means the same thing in the web
/// converter (site/vendor/conv/errors.js: FAILURE_CODES), so a failure reported from either
/// surface reads the same way. <see cref="FailureKind.Usage"/> is offline-only: the web page
/// has no command line. The throw site tags the code where it happens; nothing parses an
/// exception message to guess a cause, and the first throw wins.
/// </summary>
public enum FailureKind
{
    NoFile, Bios, NotRomset, Missing, Unsupported, Zip, Image, Oom, Wasm, Crash, Unknown,
    ZipCorrupt, CrcMismatch, BiosRead, GameDb,

    /// <summary>A mistyped command line (--region xx, no zip). The message is the instruction,
    /// so it is shown verbatim: this is not a conversion failure and not a bug report (#329).</summary>
    Usage,
}

/// <summary>
/// The failure a throw site saw, with the code and the catalog names the plain text may
/// use. <see cref="Exception.Message"/> is raw detail for the log; users only see
/// <see cref="FailureText.Plain(Exception)"/> (#328, #329).
/// </summary>
public sealed class ConverterException : Exception
{
    public FailureKind Kind { get; }

    /// <summary>Public catalog romset name, never the user's zip file name.</summary>
    public string? Set { get; init; }

    /// <summary>The parent romset a clone's split set also needs, when it explains the failure.</summary>
    public string? Parent { get; init; }

    /// <summary>Chips the romset does not have at all.</summary>
    public IReadOnlyList<string> Chips { get; init; } = Array.Empty<string>();

    /// <summary>Chips present by name but with another CRC: a different romset version.</summary>
    public IReadOnlyList<string> Mismatch { get; init; } = Array.Empty<string>();

    public ConverterException(FailureKind kind, string detail, Exception? inner = null) : base(detail, inner) => Kind = kind;

    /// <summary>Opens a zip, tagging an archiver failure where it happened. A damaged archive
    /// is 'zip-corrupt'; a file that cannot be read at all is 'zip'. One helper so the same
    /// three-type filter is not copied into every opener (#328).</summary>
    public static ZipArchive OpenZip(string path)
    {
        try { return ZipFile.OpenRead(path); }
        catch (Exception e) when (e is InvalidDataException or IOException or UnauthorizedAccessException)
        {
            throw ForZip(path, e);
        }
    }

    /// <summary>A game or BIOS zip the archiver could not open, tagged where it was opened.</summary>
    public static ConverterException ForZip(string path, Exception inner) =>
        new(inner is InvalidDataException ? FailureKind.ZipCorrupt : FailureKind.Zip,
            $"{Path.GetFileName(path)}: {inner.Message}", inner);
}

/// <summary>
/// The wording table for offline failures (#328): one cause sentence and one action
/// sentence, in the converter's language (<see cref="Lang.L"/>), for the CLI, the
/// Avalonia window and the WinForms window alike. Only a public catalog romset name and
/// game DB chip names may appear here — a user's zip file name or picture path never
/// does; that is the log's job.
/// </summary>
public static class FailureText
{
    /// <summary>The stable code for a kind, the same string the web converter uses.</summary>
    public static string Code(FailureKind kind) => kind switch
    {
        FailureKind.NoFile => "nofile",
        FailureKind.Bios => "bios",
        FailureKind.NotRomset => "notromset",
        FailureKind.Missing => "missing",
        FailureKind.Unsupported => "unsupported",
        FailureKind.Zip => "zip",
        FailureKind.Image => "image",
        FailureKind.Oom => "oom",
        FailureKind.Wasm => "wasm",
        FailureKind.Crash => "crash",
        FailureKind.ZipCorrupt => "zip-corrupt",
        FailureKind.CrcMismatch => "crc-mismatch",
        FailureKind.BiosRead => "bios-read",
        FailureKind.GameDb => "game-db",
        FailureKind.Usage => "usage",
        _ => "unknown",
    };

    // Same guards as messages.js: a romset name is lowercase MAME, a chip name is a file
    // name from the game DB. 'game' is the sentinel when the name is not a catalog one.
    static readonly Regex SetName = new("^[a-z0-9_]{1,40}$", RegexOptions.CultureInvariant);
    static readonly Regex ChipName = new("^[a-z0-9._-]{1,24}$", RegexOptions.CultureInvariant);
    const string GenericName = "game";

    /// <summary>The catalog name, or the generic 'game' when the value is not one.</summary>
    public static string CatalogName(string? value) => value != null && SetName.IsMatch(value) ? value : GenericName;

    static bool IsCatalogName(string? value) => value != null && SetName.IsMatch(value);

    static string[] ChipNames(IEnumerable<string>? names) => names == null
        ? Array.Empty<string>()
        : names.Where(v => ChipName.IsMatch(v)).Distinct(StringComparer.Ordinal).ToArray();

    // At most four names plus a count, so a broken romset cannot turn the line into a wall.
    static string ChipText(string[] names) => names.Length switch
    {
        0 => "",
        <= 4 => string.Join(", ", names),
        _ => string.Join(", ", names.Take(4)) + L($" 외 {names.Length - 4}개", $" and {names.Length - 4} more"),
    };

    /// <summary>The code a failure carries; a plain exception is 'unknown', an allocation
    /// failure is 'oom' (the CLR words it differently from the browser).</summary>
    public static FailureKind KindOf(Exception? ex) => ex switch
    {
        ConverterException c => c.Kind,
        OutOfMemoryException => FailureKind.Oom,
        _ => FailureKind.Unknown,
    };

    /// <summary>What the log gets for a failure: the raw coded line, then the same plain pair
    /// the reader sees, so a report can reproduce the run without the dialog leaking detail.
    /// Newline-separated and unindented; callers add their own prefix (#329).</summary>
    public static string LogLines(Exception? ex) => Raw(ex) + Environment.NewLine + Plain(ex);

    /// <summary>The raw line for the log: code + detail, never shown in a dialog (#329).
    /// A usage error is shown as written: its message already tells the user what to type.</summary>
    public static string Raw(Exception? ex) => ex == null
        ? Code(FailureKind.Unknown)
        : KindOf(ex) == FailureKind.Usage
            ? ex.Message
            : $"{Code(KindOf(ex))}: {ex.Message}";

    /// <summary>Cause + action for any failure, using the names its throw site carried.</summary>
    public static string Plain(Exception? ex) => ex is ConverterException c
        ? Plain(c.Kind, c.Set, c.Chips, c.Mismatch, c.Parent)
        : Plain(KindOf(ex));

    /// <summary>
    /// Cause + action in two sentences. <paramref name="set"/> is a catalog romset name,
    /// <paramref name="chips"/>/<paramref name="mismatch"/> are game DB chip names and
    /// <paramref name="parent"/> a catalog romset name; anything else falls back safely.
    /// </summary>
    public static string Plain(FailureKind kind, string? set = null, IEnumerable<string>? chips = null,
        IEnumerable<string>? mismatch = null, string? parent = null)
    {
        string n = CatalogName(set);
        string? p = IsCatalogName(parent) ? parent : null;
        string[] missingChips = ChipNames(chips);
        string[] wrongChips = ChipNames(mismatch);
        string missingList = ChipText(missingChips);
        string wrongList = ChipText(wrongChips);
        return kind switch
        {
            FailureKind.NoFile => L(
                "게임 zip을 찾지 못했어요. 게임 zip과 neogeo.zip을 같은 폴더에 두고 다시 실행해 주세요.",
                "No game zip was found. Keep the game zip and neogeo.zip in the same folder and run the converter again."),
            FailureKind.Bios => L(
                "neogeo.zip(바이오스)이 없어요. neogeo.zip을 게임 zip과 같은 폴더에 두세요.",
                "neogeo.zip (the BIOS) is missing. Put it in the same folder as the game zip."),
            FailureKind.NotRomset => L(
                "이 zip 이름은 MAME 네오지오 롬셋이 아니에요. zip 파일 이름을 원래대로 두고 다시 골라 주세요.",
                "This zip name is not a MAME Neo Geo romset. Keep the zip file name as it was and pick it again."),
            FailureKind.Missing => L(
                $"{n}에 필요한 롬 파일이 빠져 있어요{(missingList.Length > 0 ? $"(빠진 칩: {missingList})" : "")}. " +
                (p != null ? $"같은 버전의 롬셋 zip과 {p}.zip(부모 롬셋)을 같은 폴더에 두세요." : "같은 버전의 롬셋 zip을 모두 같은 폴더에 두세요."),
                $"{n} is missing required ROM files{(missingList.Length > 0 ? $" (chips: {missingList})" : "")}. " +
                (p != null ? $"Put every zip of the same romset version in the same folder, plus {p}.zip (the parent romset)." : "Put every zip of the same romset version in the same folder.")),
            FailureKind.Unsupported => L(
                $"{n}은(는) 이 변환기가 지원하지 않는 카트리지예요. 지원 목록에 있는 다른 게임을 골라 주세요.",
                $"{n} uses a cartridge this converter does not support. Pick another game from the supported list."),
            FailureKind.Zip => L(
                $"{n} zip을 읽지 못했어요. zip이 손상되지 않았는지 확인하고 다시 골라 주세요.",
                $"The {n} zip could not be read. Check that the zip is not damaged and pick it again."),
            FailureKind.Image => L(
                "아이콘·배너 이미지를 읽지 못했어요. 다른 PNG나 JPG로 다시 지정해 주세요.",
                "The icon or banner image could not be read. Pick another PNG or JPG."),
            FailureKind.Oom => L(
                "메모리가 부족해요. 다른 프로그램을 닫고 다시 시도해 주세요.",
                "The computer ran out of memory. Close other programs and try again."),
            FailureKind.Wasm => L(
                "변환 도구가 중간에 멈췄어요. 변환기 폴더를 통째로 둔 채 다시 실행해 주세요.",
                "A conversion tool stopped in the middle. Keep the converter folder together and run it again."),
            FailureKind.Crash => L(
                "변환 작업이 예기치 않게 끝났어요. 다시 시도하고, 계속되면 제보해 주세요.",
                "The conversion stopped unexpectedly. Try again; if it keeps happening, send a report."),
            FailureKind.ZipCorrupt => L(
                $"{n} zip 안의 항목이 손상됐어요. 다른 롬셋 zip으로 다시 골라 주세요.",
                $"An entry inside the {n} zip is damaged. Pick a different romset zip."),
            FailureKind.CrcMismatch => L(
                $"{n}이(가) 기대한 버전과 달라요{(wrongList.Length > 0 ? $"(다른 버전 칩: {wrongList})" : "")}. " +
                (p != null ? $"MAME 롬셋 zip 원본과 {p}.zip(부모 롬셋)을 같은 폴더에 두세요." : "MAME 롬셋 zip 원본을 같은 폴더에 두세요."),
                $"{n} is a different version than expected{(wrongList.Length > 0 ? $" (chips: {wrongList})" : "")}. " +
                (p != null ? $"Put the original MAME romset zip in the same folder, plus {p}.zip (the parent romset)." : "Put the original MAME romset zip in the same folder.")),
            FailureKind.BiosRead => L(
                "neogeo.zip에서 필요한 바이오스 칩을 찾지 못했어요. neogeo.zip을 게임 zip과 같은 폴더에 다시 두세요.",
                "neogeo.zip is missing a required BIOS chip. Put neogeo.zip back in the same folder as the game zip."),
            FailureKind.GameDb => L(
                $"{n} 그래픽을 처리하는 중 문제가 생겼어요. 다시 시도하고, 계속되면 제보해 주세요.",
                $"Something went wrong while processing {n} graphics. Try again; if it keeps happening, send a report."),
            // The command-line message is already an instruction; Plain() is not used for it.
            FailureKind.Usage => L(
                "명령줄 사용법이 맞지 않아요. --help로 사용법을 확인해 주세요.",
                "The command line is not right. Run --help to see the usage."),
            _ => L(
                "확실한 원인을 찾지 못했어요. 다시 시도해 보고, 계속되면 제보해 주세요.",
                "The exact cause could not be found. Try again; if it keeps happening, send a report."),
        };
    }

    /// <summary>One failed game of a batch: a catalog name and a code, never the user's zip
    /// file name, so a summary cannot leak it (#329).</summary>
    public readonly record struct BatchFailure(string? Set, FailureKind Kind)
    {
        /// <summary>The row for a job whose build threw: the picked game's romset, else the
        /// verdict the job already carried. One place unpacks the exception (#329).</summary>
        public static BatchFailure Of(CiaJob job, Exception ex)
            => new(job.FailureSet(ex), KindOf(ex));
    }

    /// <summary>The summary a batch dialog ends with: three failures at most, each the same
    /// cause+action pair as a single failure, plus where the rest is written.</summary>
    public static string Batch(IEnumerable<BatchFailure> failures, bool hasLog = true)
    {
        var list = failures as IReadOnlyList<BatchFailure> ?? failures.ToList();
        if (list.Count == 0) return "";
        var shown = list.Take(3).Select(f =>
        {
            string text = Plain(f.Kind, f.Set);
            // The message usually names the romset already; prefix only when it does not.
            return IsCatalogName(f.Set) && !text.Contains(f.Set!, StringComparison.Ordinal) ? $"{f.Set} — {text}" : text;
        }).ToList();
        int rest = list.Count - shown.Count;
        // Each entry is already two complete sentences, so join them and close only one period.
        string body = string.Join(" / ", shown).TrimEnd('.');
        string where = hasLog
            ? L("게임별 이유는 로그에 있습니다.", "Per-game reasons are in the log.")
            : L("위 FAILED 줄에 게임별 이유가 있습니다.", "The FAILED lines above say why each game failed.");
        return L(
            $"변환 실패 {list.Count}개: {body}{(rest > 0 ? $" 외 {rest}개" : "")}. {where}",
            $"{list.Count} failed: {body}{(rest > 0 ? $", {rest} more" : "")}. {where}");
    }
}
