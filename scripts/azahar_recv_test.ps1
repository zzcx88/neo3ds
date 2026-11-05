# Azahar test of the launcher's receive screen (issue #256): builds the launcher with
# NEO3DS_RECV_TEST (the address comes from sdmc:/3ds/neo3ds/recv_url.txt instead of a QR code),
# serves a game file with scripts/recv_test_server.py and presses the buttons in Azahar.
#
# The cam-* scenarios use Azahar's still image camera (its config is put back) and need pip for the
# qrcode package.
#
# usage: pwsh scripts/azahar_recv_test.ps1 -Pack <file.neo3ds> [-Converter <folder with Neo3dsConverter.exe>]
#        [-Scenarios ok,404,...] [-SkipBuild]
# Results: out/recvtest/results.txt and one screenshot per scenario. The test file goes in Azahar's
# SD card folder as recvtest.neo3ds and is deleted at the end; launcher.txt is put back.
param(
    [Parameter(Mandatory)] [string] $Pack,
    [string] $Converter = "dist/converter",
    [string[]] $Scenarios = @("badurl", "404", "405", "redirect", "nolength", "chunked", "twolengths", "truncheader", "huge", "nospace", "short", "corrupt", "ok", "replace-no", "replace-yes", "cancel", "spacename", "empty", "cam-ok", "cam-wrong", "cam-none", "home", "home-cam", "badwrite", "noserver", "recover", "logcap", "b-ok3", "b-six", "b-corrupt", "b-short", "b-404", "b-headdiff", "b-cancel", "b-home", "b-replace", "b-nospace", "b-bad", "cam-six", "snap", "badpack", "badopen", "keep", "case", "home-ask"),
    [switch] $SkipBuild
)
$ErrorActionPreference = "Stop"
$Scenarios = $Scenarios -split "," # powershell -File passes "a,b" as one string
$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $root "out/recvtest"
$sd = Join-Path $env:APPDATA "Azahar/sdmc"
$games = Join-Path $sd "neo3ds/games"
$cfg = Join-Path $sd "3ds/neo3ds"
$target = Join-Path $games "recvtest.neo3ds"
$log = Join-Path $cfg "receive.log"
$azahar = Join-Path $root "tools/azahar/azahar-windows-msvc-2126.2/azahar.exe"
$py = (Get-Command py).Source
$server = Join-Path $root "scripts/recv_test_server.py"
$urlFile = Join-Path $cfg "recv_url.txt"
$freeFile = Join-Path $cfg "recv_free.txt"

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win {
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@

# The test build takes a button from this file: Azahar needs no focus and the PC stays usable.
function Press([string] $key) {
    $file = Join-Path $cfg "recv_key.txt"
    [IO.File]::WriteAllText($file, $key)
    for ($i = 0; $i -lt 30 -and (Test-Path $file); $i++) { Start-Sleep -Milliseconds 100 }
    if (Test-Path $file) { Remove-Item $file; throw "the launcher did not take the key $key" }
    Start-Sleep -Milliseconds 300
}
$KeyA = "A"; $KeyB = "B"; $KeyY = "Y"; $KeyDown = "D"; $KeyRight = "R"; $KeyLeft = "T"
# Not buttons: as if HOME had opened, the next SD write fails, note the sleep setting,
# leave a running game for the list, take a snapshot
$KeyHome = "H"; $KeyBadWrite = "W"; $KeySleepState = "S"; $KeyLeaveGame = "L"; $KeySnapshot = "P"

function Shot([string] $name) {
    $p = Get-Process azahar
    $r = New-Object Win+RECT
    [Win]::GetWindowRect($p.MainWindowHandle, [ref] $r) | Out-Null
    $bmp = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $dc = $g.GetHdc()
    [Win]::PrintWindow($p.MainWindowHandle, $dc, 2) | Out-Null # 2: also what the GPU drew
    $g.ReleaseHdc($dc)
    $bmp.Save((Join-Path $out "$name.png"))
    $g.Dispose(); $bmp.Dispose()
}

function LastLog {
    if (Test-Path $log) { (Get-Content $log -Tail 1) } else { "(no log)" }
}

function WaitLog([int] $before, [int] $seconds) {
    for ($i = 0; $i -lt $seconds * 2; $i++) {
        if ((LogCount) -gt $before) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

New-Item -ItemType Directory -Force $out | Out-Null
if (-not $SkipBuild) {
    $ErrorActionPreference = "Continue" # the compiler's warnings arrive on stderr
    & "C:\devkitPro\msys2\usr\bin\bash.exe" -lc "cd '$($root -replace '\\','/')/engine' && export DEVKITPRO=/opt/devkitpro DEVKITARM=/opt/devkitpro/devkitARM && LANG=C make BUILD=build_recv TARGET=engine_recv EXTRA_CFLAGS=-DNEO3DS_RECV_TEST" *> (Join-Path $out "build.log")
    $built = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    if ($built) { throw "engine build failed: see out/recvtest/build.log" }
    $conv = Join-Path $out "conv"
    if (Test-Path $conv) { Remove-Item -Recurse -Force $conv }
    Copy-Item -Recurse (Join-Path $root $Converter) $conv
    Copy-Item (Join-Path $root "engine/engine_recv.elf") (Join-Path $conv "tools/engine.elf") -Force
    $env:NEO3DS_CXI = "1"
    & (Join-Path $conv "Neo3dsConverter.exe") --launcher $out | Select-Object -Last 1
}
$cxi = Join-Path $out "neo3ds-launcher.cxi"
if (-not (Test-Path $cxi)) { throw "no $cxi" }

New-Item -ItemType Directory -Force $games, $cfg | Out-Null
$configBackup = $null
if (Test-Path "$cfg/launcher.txt") { $configBackup = Get-Content -Raw "$cfg/launcher.txt" }
$logBackup = $null
if (Test-Path $log) { $logBackup = [IO.File]::ReadAllBytes($log) }

$results = @()
$hash = (Get-FileHash $Pack).Hash
$badUrls = @(
    "https://192.0.2.1:80/x/a.neo3ds",        # not http
    "http://example.com:80/x/a.neo3ds",       # not IPv4 numbers
    "http://192.0.2.1/x/a.neo3ds",            # no port
    "http://127.0.0.1:80/x/a.neo3ds",         # this 3DS
    "http://224.0.0.1:80/x/a.neo3ds",         # multicast
    "http://0.0.0.0:80/x/a.neo3ds",           # no one
    "http://192.0.2.1:80/x/a.cia",            # not a game file
    "http://192.0.2.1:80/x/..%2Fa.neo3ds",    # a folder in the name
    "http://192.0.2.1:80/x/a%00.neo3ds",      # NUL
    "http://192.0.2.1:80/x/a%2.neo3ds",       # bad escape
    "http://192.0.2.1:80/x/a%3A.neo3ds",      # a character FAT refuses
    "http://192.0.2.1:80/x/$('a' * 100).neo3ds" # 107 bytes: .part would not fit
)
# Azahar's still image camera reads one picture, chosen in its config, when the game starts.
$ini = Join-Path $env:APPDATA "Azahar/config/qt-config.ini"
$iniBackup = [IO.File]::ReadAllText($ini)
$pydeps = Join-Path $out "pydeps"
function StopAzahar { Stop-Process -Name azahar -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2 }
function LaunchAzahar { Start-Process $azahar -ArgumentList "`"$cxi`"" }
function StartAzahar { LaunchAzahar; Start-Sleep -Seconds 8 }
function Restart { StopAzahar; StartAzahar }
function StartWithPicture([string] $picture) {
    StopAzahar
    $text = $iniBackup
    $text = $text -replace "(?m)^camera_outer_right_name\\default=.*$", "camera_outer_right_name\default=false"
    $text = $text -replace "(?m)^camera_outer_right_name=.*$", "camera_outer_right_name=image"
    $text = $text -replace "(?m)^camera_outer_right_config\\default=.*$", "camera_outer_right_config\default=false"
    $text = $text -replace "(?m)^camera_outer_right_config=.*$", ("camera_outer_right_config=" + ($picture -replace "\\", "/"))
    [IO.File]::WriteAllText($ini, $text)
    StartAzahar
}
function Report([string] $name, [bool] $ok, [string] $note) {
    $script:results += "$name : $(if ($ok) { 'PASS' } else { 'FAIL' }) $note | $(LastLog)"
    $script:results[-1]
}
function SleepState {
    $file = Join-Path $cfg "recv_state.txt"
    Remove-Item $file -ErrorAction SilentlyContinue
    Press $KeySleepState
    for ($i = 0; $i -lt 20 -and -not (Test-Path $file); $i++) { Start-Sleep -Milliseconds 100 }
    if (Test-Path $file) { (Get-Content $file) -join "" } else { "(no state)" }
}
function RunServer([string[]] $arguments, [string] $logName = "last") {
    $a = @("-I", "-u", $server) + $arguments
    $script:srv = Start-Process $py -ArgumentList $a -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $out "server-$logName.log")
    Start-Sleep -Seconds 1
}
function StartServer([string] $name, [string[]] $more = @()) { RunServer (@($Pack, "--name", $name, "--url-file", $urlFile) + $more) }
function ListState {
    $file = Join-Path $cfg "recv_list.txt"
    if (Test-Path $file) { (Get-Content $file -Raw).Trim() } else { "(no state)" }
}
function GoToGame([string] $name) {
    for ($i = 0; $i -lt 30; $i++) {
        if ((ListState) -match "sel=$([regex]::Escape($name)) ") { return $true }
        Press $KeyDown
        Start-Sleep -Milliseconds 200
    }
    return $false
}
function StartServerFile([string] $file) { RunServer @($file, "--name", "recvtest.neo3ds", "--url-file", $urlFile) }
function LogCount { if (Test-Path $log) { (Get-Content $log).Count } else { 0 } }
# Batches: files named recvb1.neo3ds, recvb2.neo3ds...
function BatchFile([int] $i) { Join-Path $games "recvb$i.neo3ds" }
function CleanBatch { 1..6 | ForEach-Object { $f = BatchFile $_; Remove-Item $f, "$f.part", "$f.bak" -ErrorAction SilentlyContinue } }
function StartBatch([string[]] $scenarios, [string] $urls = $urlFile) {
    $list = @()
    for ($i = 0; $i -lt $scenarios.Count; $i++) { $list += "recvb$($i + 1).neo3ds:$($scenarios[$i])" }
    RunServer (@($Pack, "--url-file", $urls, "--batch") + $list)
}
function StopServer { Stop-Process -Id $srv.Id -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 300 }
function WaitLine([string] $pattern, [int] $before, [int] $seconds) {
    for ($i = 0; $i -lt $seconds * 2; $i++) {
        if (Test-Path $log) {
            $new = @(Get-Content $log) | Select-Object -Skip $before
            if ($new -match $pattern) { return $true }
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}
function GoodFile([int] $i) { $f = BatchFile $i; (Test-Path $f) -and (Get-FileHash $f).Hash -eq $hash }
function NoBatchLeftovers { -not (Get-ChildItem $games -Filter "recvb*.part") -and -not (Get-ChildItem $games -Filter "recvb*.bak") }
function ServerLog { Get-Content (Join-Path $out "server-last.log") -Raw }
function MakeQr([string] $text, [string] $path, [string] $module = "") {
    if (-not (Test-Path $pydeps)) { & $py -m pip install -q --target $pydeps qrcode | Out-Null }
    $env:PYTHONPATH = $pydeps
    if ($module) { & $py (Join-Path $root "scripts/recv_test_qr.py") $text $path $module }
    else { & $py (Join-Path $root "scripts/recv_test_qr.py") $text $path }
    Remove-Item Env:PYTHONPATH
}
try {
    [IO.File]::WriteAllText("$cfg/launcher.txt", "tab=0`nfav=kof98.neo3ds`n")
    Remove-Item $target, "$target.part", "$target.bak", (Join-Path $cfg "recv_key.txt") -ErrorAction SilentlyContinue
    if (Test-Path $log) { Remove-Item $log }
    Restart
    foreach ($s in $Scenarios) {
        if ($s -eq "badpack") {
            # Damaged game files are refused whole, without being opened
            & $py -I (Join-Path $root "scripts/recv_test_pack.py") $Pack $out
            foreach ($bad in "p0", "block1", "midoffset", "unordered", "fewblocks") {
                StartServerFile (Join-Path $out "bad-$bad.neo3ds")
                $before = LogCount
                Press $KeyY
                $done = WaitLine " skipped " $before 60
                Start-Sleep -Seconds 1
                Shot "$s-$bad"
                Press $KeyA
                Start-Sleep -Seconds 1
                Report "$s-$bad" ($done -and -not (Test-Path $target) -and -not (Test-Path "$target.part")) ""
                StopServer
            }
            Remove-Item $urlFile -ErrorAction SilentlyContinue
            continue
        }
        if ($s -eq "badopen") {
            # One copied to the SD card gets a message when opened, not a crash
            & $py -I (Join-Path $root "scripts/recv_test_pack.py") $Pack $out
            $bad = Join-Path $games "recvbad.neo3ds"
            Copy-Item (Join-Path $out "bad-block1.neo3ds") $bad
            Restart
            $found = GoToGame "recvbad.neo3ds"
            Press $KeyA
            Start-Sleep -Seconds 4
            Shot $s
            Report $s ($found -and [bool](Get-Process azahar -ErrorAction SilentlyContinue)) "see the $s screenshot"
            StopAzahar
            Remove-Item $bad -ErrorAction SilentlyContinue
            Restart
            continue
        }
        if ($s -eq "keep") {
            # Receiving from the Favorites tab: tab, cursor and favorites stay
            Remove-Item $target -ErrorAction SilentlyContinue
            Restart
            Press $KeyRight
            Start-Sleep -Milliseconds 500
            $was = ListState
            StartServer "recvtest.neo3ds"
            $before = LogCount
            Press $KeyY
            $done = WaitLine " saved " $before 60
            Start-Sleep -Seconds 1
            Press $KeyA
            Start-Sleep -Seconds 1
            $now = ListState
            Report $s ($done -and $was -match "^tab=1 sel=kof98\.neo3ds favs=1 " -and $now -match "^tab=1 sel=kof98\.neo3ds favs=1 ") "was: $was now: $now"
            Press $KeyLeft
            StopServer
            Remove-Item $target, $urlFile -ErrorAction SilentlyContinue
            Restart
            continue
        }
        if ($s -eq "case") {
            # Replaced by the same name in other letters: the SD card takes it for the same file
            $lower = Join-Path $games "recvcase.neo3ds"
            Copy-Item $Pack $lower
            Restart
            $found = GoToGame "recvcase.neo3ds"
            StartServer "RECVCASE.neo3ds"
            $before = LogCount
            Press $KeyY
            Start-Sleep -Seconds 1
            Press $KeyA
            $done = WaitLine " saved " $before 60
            Start-Sleep -Seconds 1
            Press $KeyA
            Start-Sleep -Seconds 1
            $now = ListState
            Report $s ($found -and $done -and $now -match "(?i)sel=recvcase\.neo3ds") "now: $now"
            StopServer
            StopAzahar
            Remove-Item $lower, $urlFile -ErrorAction SilentlyContinue
            Restart
            continue
        }
        if ($s -eq "home-ask") {
            # HOME at the question goes back to the list; the next try is not stopped by it
            Copy-Item $Pack $target -Force
            StartServer "recvtest.neo3ds"
            $before = LogCount
            Press $KeyY
            Start-Sleep -Seconds 1
            Press $KeyHome
            Start-Sleep -Seconds 1
            Shot "$s-list"
            Press $KeyY
            Start-Sleep -Seconds 1
            Press $KeyA
            $done = WaitLine " saved " $before 60
            Start-Sleep -Seconds 1
            Press $KeyA
            $clean = -not ((@(Get-Content $log) | Select-Object -Skip $before) -match "interrupted")
            Report $s ($done -and $clean) ""
            StopServer
            Remove-Item $target, $urlFile -ErrorAction SilentlyContinue
            Restart # the list still has the file just removed
            continue
        }
        if ($s -in "b-ok3", "b-six", "b-corrupt", "b-short", "b-headdiff", "b-replace") {
            CleanBatch
            $list = switch ($s) {
                "b-ok3" { "ok", "ok", "ok" }
                "b-six" { "ok", "ok", "ok", "ok", "ok", "ok" }
                "b-corrupt" { "ok", "corrupt", "ok" }
                "b-short" { "ok", "short", "ok" }
                "b-headdiff" { "ok", "headdiff", "ok" }
                "b-replace" { "ok", "ok" }
            }
            if ($s -eq "b-replace") { [IO.File]::WriteAllText((BatchFile 1), "the old game") }
            StartBatch $list
            $before = LogCount
            Press $KeyY
            Start-Sleep -Seconds 2
            Shot "$s-ask"
            Press $KeyA
            $done = WaitLine " summary " $before 180
            Start-Sleep -Seconds 1
            Shot "$s-results"
            Press $KeyA
            Start-Sleep -Seconds 1
            Shot "$s-list"
            $want = switch ($s) {
                "b-ok3" { 1, 2, 3 }
                "b-six" { 1, 2, 3, 4, 5, 6 }
                "b-corrupt" { 1, 3 }
                "b-short" { , 1 }
                "b-headdiff" { , 1 }
                "b-replace" { 1, 2 }
            }
            $files = $true
            1..6 | ForEach-Object { if ((GoodFile $_) -ne ($want -contains $_)) { $files = $false } }
            $third = (ServerLog) -match "GET recvb3"
            $thirdOk = if ($s -in "b-short", "b-headdiff") { -not $third } else { $true }
            Report $s ($done -and $files -and $thirdOk -and (NoBatchLeftovers)) "files=$files third-requested=$third"
            StopServer
            CleanBatch
            Remove-Item $urlFile -ErrorAction SilentlyContinue
            continue
        }
        if ($s -in "b-404", "b-nospace") {
            # Refused before any file is asked for
            CleanBatch
            if ($s -eq "b-nospace") { [IO.File]::WriteAllText($freeFile, "15`n") }
            StartBatch $(if ($s -eq "b-404") { "ok", "404", "ok" } else { "ok", "ok" })
            $before = LogCount
            Press $KeyY
            $done = WaitLine " failed " $before 20
            Start-Sleep -Seconds 1
            Shot $s
            Press $KeyA
            $none = -not (Get-ChildItem $games -Filter "recvb*")
            Report $s ($done -and $none -and -not ((ServerLog) -match "GET ")) "no file, no GET"
            StopServer
            Remove-Item $urlFile, $freeFile -ErrorAction SilentlyContinue
            continue
        }
        if ($s -eq "b-cancel") {
            CleanBatch
            StartBatch "ok", "ok"
            $before = LogCount
            Press $KeyY
            Start-Sleep -Seconds 2
            Press $KeyB
            Start-Sleep -Seconds 1
            Shot "$s-list"
            $none = -not (Get-ChildItem $games -Filter "recvb*")
            Report $s ($none -and -not ((ServerLog) -match "GET ") -and (LogCount) -eq $before) "nothing fetched"
            StopServer
            Remove-Item $urlFile -ErrorAction SilentlyContinue
            continue
        }
        if ($s -eq "b-home") {
            # HOME in the second file: the first stays, the second leaves nothing
            CleanBatch
            StartBatch "ok", "slow", "ok"
            $before = LogCount
            Press $KeyY
            Start-Sleep -Seconds 2
            Press $KeyA
            $first = WaitLine " saved " $before 60
            Start-Sleep -Seconds 3
            Press $KeyHome
            $done = WaitLine " summary " $before 15
            Start-Sleep -Seconds 1
            Shot "$s-results"
            Press $KeyA
            Start-Sleep -Seconds 1
            $state = SleepState
            Report $s ($first -and $done -and (GoodFile 1) -and -not (Test-Path (BatchFile 2)) -and -not (Test-Path (BatchFile 3)) -and (NoBatchLeftovers) -and $state -eq "sleep=1") "after=$state"
            StopServer
            CleanBatch
            Remove-Item $urlFile -ErrorAction SilentlyContinue
            continue
        }
        if ($s -eq "b-bad") {
            $u = "http://192.0.2.1:80/0123456789abcdef"
            $lists = @{
                "seven" = (1..7 | ForEach-Object { "$u/g$_.neo3ds" }) -join "`n"
                "origin" = "$u/g1.neo3ds`nhttp://192.0.2.2:80/0123456789abcdef/g2.neo3ds"
                "port" = "$u/g1.neo3ds`nhttp://192.0.2.1:81/0123456789abcdef/g2.neo3ds"
                "twice" = "$u/g1.neo3ds`n$u/G1.NEO3DS"
                "cia" = "$u/g1.neo3ds`n$u/g2.cia"
                "blank" = "$u/g1.neo3ds`n`n$u/g2.neo3ds"
                "cr" = "$u/g1.neo3ds`r`n$u/g2.neo3ds"
            }
            foreach ($k in $lists.Keys) {
                $before = LogCount
                [IO.File]::WriteAllText($urlFile, $lists[$k])
                Press $KeyY
                $done = WaitLine " refused " $before 5
                Press $KeyA
                Report "b-bad-$k" $done ""
            }
            Remove-Item $urlFile -ErrorAction SilentlyContinue
            continue
        }
        if ($s -eq "cam-six") {
            # Six addresses in one code, read by the camera
            CleanBatch
            Remove-Item $urlFile -ErrorAction SilentlyContinue
            $camUrls = Join-Path $out "url.txt"
            StartBatch ("ok", "ok", "ok", "ok", "ok", "ok") $camUrls
            $picture = Join-Path $out "$s.png"
            MakeQr ([IO.File]::ReadAllText($camUrls).TrimEnd("`n")) $picture "6" # 3 pixels a module on the camera
            StartWithPicture $picture
            $before = LogCount
            Press $KeyY
            Start-Sleep -Seconds 5
            Shot "$s-ask"
            Press $KeyA
            $done = WaitLine " summary " $before 180
            Start-Sleep -Seconds 1
            Shot "$s-results"
            Press $KeyA
            $files = $true
            1..6 | ForEach-Object { if (-not (GoodFile $_)) { $files = $false } }
            Report $s ($done -and $files) "six files"
            StopServer
            CleanBatch
            continue
        }
        if ($s -eq "snap") {
            # Pictures for the list: the first game in it, on leaving, by hand, and kept
            $snaps = Join-Path $cfg "snaps"
            $first = Join-Path $snaps "sonicwi3.bin"
            Remove-Item $first -ErrorAction SilentlyContinue
            Restart
            Shot "$s-none"
            Press $KeyA
            Start-Sleep -Seconds 25
            Press $KeyLeaveGame # Azahar does not start a CXI again by itself: the list comes from a restart
            Start-Sleep -Seconds 3
            Restart
            Shot "$s-auto"
            $auto = (Test-Path $first) -and (Get-Item $first).Length -eq 192008
            $autoHash = if (Test-Path $first) { (Get-FileHash $first).Hash } else { "" }
            Press $KeyDown
            Start-Sleep -Seconds 1
            Shot "$s-other"
            Restart
            Press $KeyA
            Start-Sleep -Seconds 15
            Press $KeySnapshot
            Start-Sleep -Seconds 3
            Shot "$s-game"
            $manualHash = if (Test-Path $first) { (Get-FileHash $first).Hash } else { "" }
            Start-Sleep -Seconds 5
            Press $KeyLeaveGame
            Start-Sleep -Seconds 3
            Restart
            Shot "$s-manual"
            $kept = (Test-Path $first) -and (Get-FileHash $first).Hash -eq $manualHash
            Report $s ($auto -and $manualHash -ne $autoHash -and $kept) "auto=$auto manual-kept=$kept"
            Remove-Item $first -ErrorAction SilentlyContinue
            continue
        }
        if ($s -eq "home") {
            # A transfer stopped by the HOME menu: nothing left, sleep back, and it works again
            Remove-Item $target, "$target.part" -ErrorAction SilentlyContinue
            StartServer "recvtest.neo3ds" @("--slow-kbps", "256")
            $before = LogCount
            $idle = SleepState
            Press $KeyY
            Start-Sleep -Seconds 3
            $during = SleepState
            $partSeen = Test-Path "$target.part"
            Press $KeyHome
            $stopped = WaitLog $before 10
            Start-Sleep -Seconds 1
            Shot $s
            Press $KeyA
            $after = SleepState
            $clean = -not (Test-Path "$target.part") -and -not (Test-Path $target)
            StopServer
            StartServer "recvtest.neo3ds"
            $before = LogCount
            Press $KeyY
            $again = WaitLog $before 60
            Start-Sleep -Seconds 1
            Press $KeyA
            $saved = $again -and (Test-Path $target) -and (Get-FileHash $target).Hash -eq $hash
            Report $s ($stopped -and $partSeen -and $clean -and $saved -and $idle -eq "sleep=1" -and $during -eq "sleep=0" -and $after -eq "sleep=1") "idle=$idle during=$during after=$after clean=$clean retried=$saved"
            StopServer
            Remove-Item $target, $urlFile -ErrorAction SilentlyContinue
            continue
        }
        if ($s -eq "home-cam") {
            # HOME during the scan goes back to the list and the camera starts again afterwards
            Remove-Item $urlFile -ErrorAction SilentlyContinue
            $picture = Join-Path $out "$s.png"
            MakeQr "--blank" $picture
            StartWithPicture $picture
            Press $KeyY
            Start-Sleep -Seconds 2
            Shot "$s-scanning"
            Press $KeyHome
            Start-Sleep -Seconds 1
            Shot "$s-list"
            Press $KeyY
            Start-Sleep -Seconds 2
            Shot "$s-again"
            Press $KeyB
            Start-Sleep -Seconds 1
            Report $s ([bool](Get-Process azahar -ErrorAction SilentlyContinue)) "see the $s screenshots"
            continue
        }
        if ($s -eq "badwrite") {
            # A failed write replaces nothing
            Restart
            [IO.File]::WriteAllText($target, "the old game")
            StartServer "recvtest.neo3ds"
            $before = LogCount
            Press $KeyBadWrite
            Press $KeyY
            Start-Sleep -Seconds 1
            Press $KeyA # replace it
            $done = WaitLog $before 60
            Start-Sleep -Seconds 1
            Shot $s
            Press $KeyA
            $old = (Test-Path $target) -and (Get-Content $target) -eq "the old game"
            Report $s ($done -and $old -and -not (Test-Path "$target.part") -and -not (Test-Path "$target.bak") -and (LastLog) -match "failed") "old file kept=$old"
            StopServer
            Remove-Item $target, $urlFile -ErrorAction SilentlyContinue
            continue
        }
        if ($s -eq "noserver") {
            StartServer "recvtest.neo3ds"
            StopServer
            Start-Sleep -Seconds 1
            $before = LogCount
            Press $KeyY
            $done = WaitLog $before 15
            Start-Sleep -Seconds 1
            Shot $s
            Press $KeyA
            Report $s ($done -and (LastLog) -match "failed" -and (LastLog) -match "error") ""
            Remove-Item $urlFile -ErrorAction SilentlyContinue
            continue
        }
        if ($s -eq "recover") {
            StopAzahar
            $part = Join-Path $games "recvcut.neo3ds.part"
            $backBak = Join-Path $games "recvback.neo3ds.bak"
            $backFinal = Join-Path $games "recvback.neo3ds"
            $newFinal = Join-Path $games "recvnew.neo3ds"
            $newBak = Join-Path $games "recvnew.neo3ds.bak"
            [IO.File]::WriteAllText($part, "half a file")
            Copy-Item $Pack $backBak
            Copy-Item $Pack $newFinal
            [IO.File]::WriteAllText($newBak, "the old game")
            LaunchAzahar
            for ($i = 0; $i -lt 40 -and ((Test-Path $part) -or (Test-Path $backBak) -or (Test-Path $newBak)); $i++) { Start-Sleep -Milliseconds 500 }
            Start-Sleep -Seconds 1
            Shot $s
            $ok = -not (Test-Path $part) -and -not (Test-Path $backBak) -and (Test-Path $backFinal) -and (Test-Path $newFinal) -and -not (Test-Path $newBak)
            Report $s $ok "part removed, old game back, stale backup removed"
            StopAzahar
            Remove-Item $part, $backBak, $backFinal, $newFinal, $newBak -ErrorAction SilentlyContinue
            StartAzahar
            continue
        }
        if ($s -eq "logcap") {
            # An attempt at a full log starts a new one; the old one is kept once
            [IO.File]::WriteAllText($log, ("x" * 79 + "`n") * 500)
            [IO.File]::WriteAllText("$log.old", "the older log`n")
            [IO.File]::WriteAllText($urlFile, "http://127.0.0.1:80/x/a.neo3ds`n")
            Press $KeyY
            Start-Sleep -Seconds 2
            Press $KeyA
            $newSize = (Get-Item $log).Length
            $oldSize = (Get-Item "$log.old").Length
            Report $s ($newSize -lt 1000 -and $oldSize -eq 40000) "new=$newSize old=$oldSize"
            Remove-Item "$log.old", $urlFile -ErrorAction SilentlyContinue
            continue
        }
        if ($s -like "cam-*") {
            # The camera path: a fixed port so the picture can be made first
            Remove-Item $urlFile, $target -ErrorAction SilentlyContinue
            $camUrls = Join-Path $out "url.txt"
            RunServer @($Pack, "--name", "recvtest.neo3ds", "--port", "50123", "--url-file", "`"$camUrls`"") $s
            $picture = Join-Path $out "$s.png"
            if ($s -eq "cam-ok") { MakeQr (Get-Content $camUrls) $picture }
            if ($s -eq "cam-wrong") { MakeQr "http://192.0.2.1:80/0123456789abcdef/game.cia" $picture }
            if ($s -eq "cam-none") { MakeQr "--blank" $picture }
            StartWithPicture $picture
            $before = LogCount
            Press $KeyY
            if ($s -eq "cam-ok") {
                $finished = WaitLog $before 120
                Start-Sleep -Seconds 1
                Shot "$s-done"
                Press $KeyA
                Start-Sleep -Seconds 1
                Shot "$s-list"
                $ok = $finished -and (Test-Path $target) -and (Get-FileHash $target).Hash -eq $hash
                Report $s $ok ""
            } else {
                Start-Sleep -Seconds 4
                Shot "$s-scanning"
                $still = (LogCount) -eq $before
                Press $KeyB # leaves the camera
                Start-Sleep -Seconds 1
                Shot "$s-back"
                Press $KeyY # and again: the camera must start a second time
                Start-Sleep -Seconds 3
                Shot "$s-again"
                Press $KeyB
                Start-Sleep -Seconds 1
                Shot "$s-list"
                $ok = $still -and -not (Test-Path $target) -and (Get-Process azahar -ErrorAction SilentlyContinue)
                Report $s $ok "stayed on the camera, left, came back"
            }
            StopServer
            continue
        }
        if ($s -eq "badurl") {
            foreach ($u in $badUrls) {
                $before = LogCount
                [IO.File]::WriteAllText($urlFile, "$u`n")
                Press $KeyY
                $finished = WaitLog $before 5
                Shot $s
                Press $KeyA
                $ok = $finished -and (LastLog) -match " refused "
                Report "badurl $($u.Substring(0, [Math]::Min(44, $u.Length)))" $ok ""
            }
            continue
        }
        if ($s -eq "spacename") {
            $spaced = Join-Path $games "recv test.neo3ds"
            RunServer @($Pack, "--name", "`"recv test.neo3ds`"", "--url-file", $urlFile) $s
            $before = LogCount
            Press $KeyY
            $finished = WaitLog $before 120
            Start-Sleep -Seconds 1
            Press $KeyA
            $ok = $finished -and (Test-Path $spaced) -and (Get-FileHash $spaced).Hash -eq $hash
            Report $s $ok ""
            StopServer
            Remove-Item $spaced -ErrorAction SilentlyContinue
            continue
        }
        if ($s -eq "empty") {
            # no game folder at all: the first game comes over the network
            StopAzahar
            Rename-Item $games "games.keep"
            $moved = $true
            StartAzahar
            Shot "$s-before"
            RunServer @($Pack, "--name", "recvtest.neo3ds", "--url-file", $urlFile) $s
            $before = LogCount
            Press $KeyY
            $finished = WaitLog $before 120
            Start-Sleep -Seconds 1
            Press $KeyA
            Start-Sleep -Seconds 1
            Shot "$s-after"
            $ok = $finished -and (Test-Path $target) -and (Get-FileHash $target).Hash -eq $hash
            Report $s $ok ""
            StopServer
            StopAzahar
            Remove-Item -Recurse -Force $games
            Rename-Item (Join-Path (Split-Path $games) "games.keep") "games"
            $moved = $false
            continue
        }
        $mode = $s
        $slow = 0
        if ($s -eq "nospace") { $mode = "ok"; [IO.File]::WriteAllText($freeFile, "5`n") }
        if ($s -like "replace-*") { $mode = "ok" }
        if ($s -eq "cancel") { $mode = "ok"; $slow = 256 }
        $serverArgs = @($Pack, "--scenario", $mode, "--name", "recvtest.neo3ds", "--url-file", $urlFile)
        if ($slow) { $serverArgs += @("--slow-kbps", "$slow") }
        if ($s -notin "ok", "replace-no", "replace-yes", "cancel") { Remove-Item $target -ErrorAction SilentlyContinue }
        RunServer $serverArgs $s
        $before = LogCount

        if ($s -eq "cancel") { Remove-Item $target -ErrorAction SilentlyContinue }
        $listBefore = ""
        if ($s -eq "ok") { 1..3 | ForEach-Object { Press $KeyDown }; Start-Sleep -Milliseconds 300; Shot "$s-before"; $listBefore = ListState } # the cursor must stay
        if ($s -eq "replace-yes") { # the old game: same size, other contents
            $old = [IO.File]::ReadAllBytes($target)
            $old[$old.Length - 1] = $old[$old.Length - 1] -bxor 0xFF
            [IO.File]::WriteAllBytes($target, $old)
        }
        Press $KeyY
        if ($s -eq "replace-no") {
            Start-Sleep -Seconds 1
            Shot $s
            Press $KeyB
            Start-Sleep -Seconds 1
            $ok = (Test-Path $target) -and (Get-FileHash $target).Hash -eq $hash -and (LogCount) -eq $before
            Report $s $ok "no download, old file kept"
        } elseif ($s -eq "cancel") {
            Start-Sleep -Seconds 4
            Shot "$s-running"
            $partSeen = Test-Path "$target.part"
            Press $KeyB
            $stopped = WaitLog $before 10
            Start-Sleep -Seconds 1
            $ok = $stopped -and $partSeen -and -not (Test-Path "$target.part") -and -not (Test-Path $target)
            Report $s $ok "part seen=$partSeen, then removed"
        } else {
            if ($s -eq "replace-yes") { Start-Sleep -Seconds 1; Shot "$s-ask"; Press $KeyA }
            $finished = WaitLog $before 120
            Start-Sleep -Seconds 1
            Shot $s
            Press $KeyA
            Start-Sleep -Seconds 1
            $saved = (Test-Path $target) -and (Get-FileHash $target).Hash -eq $hash
            $part = Test-Path "$target.part"
            $bak = Test-Path "$target.bak"
            $want = $s -in "ok", "replace-yes"
            $exists = Test-Path $target
            $ok = $finished -and ($saved -eq $want) -and ($exists -eq $want) -and -not $part -and -not $bak
            if ($s -eq "ok") { # same tab, cursor and favorites; one more game
                $now = ListState
                $n = [int]([regex]::Match($listBefore, "count=(\d+)").Groups[1].Value) + 1
                $wanted = $listBefore -replace "count=\d+", "count=$n"
                if ($now -ne $wanted) { $ok = $false; "list: wanted '$wanted', got '$now'" }
            }
            Report $s $ok "saved=$saved part=$part bak=$bak"
        }
        Shot "$s-list"
        StopServer
        Remove-Item $freeFile -ErrorAction SilentlyContinue
    }
} finally {
    if ($srv) { Stop-Process -Id $srv.Id -ErrorAction SilentlyContinue }
    $results | Set-Content (Join-Path $out "results.txt")
    StopAzahar
    [IO.File]::WriteAllText($ini, $iniBackup)
    CleanBatch
    Remove-Item (Join-Path $cfg "snaps/sonicwi3.bin") -ErrorAction SilentlyContinue
    if ($moved) {
        Remove-Item -Recurse -Force $games -ErrorAction SilentlyContinue
        Rename-Item (Join-Path (Split-Path $games) "games.keep") "games"
    }
    Remove-Item $target, "$target.part", "$target.bak", $urlFile, $freeFile, (Join-Path $cfg "recv_state.txt"), (Join-Path $cfg "recv_list.txt"), (Join-Path $cfg "recv_key.txt"), "$log.old" -ErrorAction SilentlyContinue
    foreach ($left in "recvcut.neo3ds.part", "recvback.neo3ds", "recvback.neo3ds.bak", "recvnew.neo3ds", "recvnew.neo3ds.bak", "recvbad.neo3ds", "recvcase.neo3ds", "recv test.neo3ds") {
        Remove-Item -LiteralPath (Join-Path $games $left) -ErrorAction SilentlyContinue
    }
    if ($null -ne $logBackup) { [IO.File]::WriteAllBytes($log, $logBackup) }
    else { Remove-Item $log -ErrorAction SilentlyContinue }
    if ($null -ne $configBackup) { [IO.File]::WriteAllText("$cfg/launcher.txt", $configBackup) }
    else { Remove-Item "$cfg/launcher.txt" -ErrorAction SilentlyContinue }
}
