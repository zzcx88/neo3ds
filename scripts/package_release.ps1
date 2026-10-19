#Requires -Version 5.1
<#
.SYNOPSIS
  neo3ds converter release zip builder (Windows GUI / Linux and macOS CLI).
.DESCRIPTION
  Publishes self-contained releases under one top-level folder per RID.
  Windows keeps neo3ds-converter.zip and its existing GUI/tools layout.
  Unix CLI archives include native libraries and executable Unix permissions.
  Prerequisites: engine built (docs/build.md 1), Windows tools (2), or Unix
  tools built by scripts/build_unix_tools.sh under tools/{rid}/.
.EXAMPLE
  powershell -File scripts/package_release.ps1 -WithLauncher
.EXAMPLE
  .\scripts\package_release.ps1 -Runtimes win-x64,linux-x64,osx-arm64
.EXAMPLE
  powershell -File scripts/package_release.ps1 -FrameworkDependent
  # Windows only: smaller zip, requires the .NET 10 runtime
#>
param(
  [string]$Configuration = "Release",
  [ValidateSet("win-x64", "linux-x64", "osx-arm64")]
  [string[]]$Runtimes = @("win-x64"),
  [switch]$FrameworkDependent,
  [switch]$WithLauncher,
  [string]$OutDir = "dist"
)
$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent
if ($Runtimes.Count -eq 0) { throw "Specify at least one runtime." }

# 1. Version comes from converter\Directory.Build.props (single source of truth for all projects).
$props = Join-Path $root "converter\Directory.Build.props"
[xml]$xml = Get-Content $props
$version = ($xml.Project.PropertyGroup | ForEach-Object { $_.Version } |
  Where-Object { $_ } | Select-Object -First 1)
if (-not $version) { throw "Version not found in $props" }

# 2. Check every requested RID before publishing any release.
$commonFiles = @(
  "engine\engine.elf",
  "converter\assets\neo3ds.rsf",
  "converter\assets\README.txt",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md"
)
foreach ($runtime in ($Runtimes | Select-Object -Unique)) {
  $required = if ($runtime -eq "win-x64") {
    @("converter\Neo3dsConverter\Neo3dsConverter.csproj",
      "tools\makerom\makerom.exe", "tools\bannertool\windows-x86_64\bannertool.exe")
  } else {
    @("converter\Neo3dsConverter.Cli\Neo3dsConverter.Cli.csproj",
      "tools\$runtime\makerom", "tools\$runtime\bannertool")
  }
  foreach ($src in ($commonFiles + $required)) {
    if (-not (Test-Path (Join-Path $root $src) -PathType Leaf)) {
      throw "$src is missing for $runtime. See docs/build.md 1-2 or scripts/build_unix_tools.sh."
    }
  }
}

Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
foreach ($runtime in ($Runtimes | Select-Object -Unique)) {
  $isWindowsRid = $runtime -eq "win-x64"
  $packageName = if ($isWindowsRid) { "neo3ds-converter" } else { "neo3ds-converter-$runtime" }
  $project = if ($isWindowsRid) { "Neo3dsConverter" } else { "Neo3dsConverter.Cli" }
  $binary = if ($isWindowsRid) { "Neo3dsConverter.exe" } else { "neo3ds-converter" }
  $selfContained = -not ($isWindowsRid -and $FrameworkDependent)
  if (-not $isWindowsRid -and $WithLauncher) {
    Write-Warning "${runtime}: -WithLauncher skipped; launcher CIA packaging requires win-x64."
  }
  if (-not $isWindowsRid -and $FrameworkDependent) {
    Write-Warning "${runtime}: -FrameworkDependent ignored; Unix CLI releases are self-contained."
  }

  # 3. Publish separately per RID so outputs cannot leak between packages.
  $publishDir = Join-Path $root "out\publish-tmp\$runtime"
  if (Test-Path $publishDir) { Remove-Item $publishDir -Recurse -Force }
  $sc = if ($selfContained) { "true" } else { "false" }
  dotnet publish (Join-Path $root "converter\$project") `
    -c $Configuration -r $runtime --self-contained $sc -o $publishDir
  if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed for $runtime (code $LASTEXITCODE)" }
  if (-not (Test-Path (Join-Path $publishDir $binary) -PathType Leaf)) {
    throw "$binary missing from the $runtime publish output"
  }

  # CLI None/Link items normally supply tools; fill any missing items here.
  if (-not $isWindowsRid) {
    $toolsDir = Join-Path $publishDir "tools"
    New-Item $toolsDir -ItemType Directory -Force | Out-Null
    $payload = @{
      "makerom" = "tools\$runtime\makerom"
      "bannertool" = "tools\$runtime\bannertool"
      "engine.elf" = "engine\engine.elf"
      "neo3ds.rsf" = "converter\assets\neo3ds.rsf"
    }
    foreach ($name in $payload.Keys) {
      $destination = Join-Path $toolsDir $name
      if (-not (Test-Path $destination -PathType Leaf)) {
        Copy-Item (Join-Path $root $payload[$name]) $destination
      }
    }
  }
  $toolNames = if ($isWindowsRid) { @("makerom.exe", "bannertool.exe") } else { @("makerom", "bannertool") }
  foreach ($name in ($toolNames + @("engine.elf", "neo3ds.rsf"))) {
    if (-not (Test-Path (Join-Path $publishDir "tools\$name") -PathType Leaf)) {
      throw "tools\$name missing from the $runtime publish output"
    }
  }

  # 4. Keep the Windows layout; Unix also needs published native libraries.
  $stage = Join-Path $root "$OutDir\stage\$packageName"
  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
  New-Item $stage -ItemType Directory -Force | Out-Null
  if ($isWindowsRid) {
    Copy-Item (Join-Path $publishDir $binary) $stage
    Copy-Item (Join-Path $publishDir "tools") (Join-Path $stage "tools") -Recurse
  } else {
    Get-ChildItem $publishDir -Force | Copy-Item -Destination $stage -Recurse -Force
  }
  $readme = (Get-Content (Join-Path $root "converter\assets\README.txt") -Raw -Encoding UTF8).Replace("{VERSION}", $version)
  Set-Content (Join-Path $stage "README.txt") $readme -Encoding UTF8
  Copy-Item (Join-Path $root "LICENSE") (Join-Path $stage "LICENSE.txt") -Force
  Copy-Item (Join-Path $root "THIRD_PARTY_NOTICES.md") $stage -Force

  # 5. Only the Windows GUI exe builds the optional launcher CIA.
  $includeLauncher = $isWindowsRid -and $WithLauncher
  if ($includeLauncher) {
    $exe = Join-Path $stage "Neo3dsConverter.exe"
    $p = Start-Process $exe -ArgumentList "--launcher", "`"$stage`"" -Wait -PassThru -WindowStyle Hidden
    $cia = Join-Path $stage "neo3ds-launcher.cia"
    if ($p.ExitCode -ne 0 -or -not (Test-Path $cia)) { throw "launcher CIA build failed (code $($p.ExitCode))" }
    Copy-Item $cia (Join-Path $root "$OutDir\neo3ds-launcher.cia") -Force
  }

  # 6. Slash-separated entries; Windows asset name protects latest/download links.
  $zip = Join-Path $root "$OutDir\$packageName.zip"
  if (Test-Path $zip) { Remove-Item $zip -Force }
  $base = Split-Path $stage -Parent
  $z = [IO.Compression.ZipFile]::Open($zip, [IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($f in Get-ChildItem $stage -Recurse -File) {
      $name = $f.FullName.Substring($base.Length + 1).Replace('\', '/')
      $entry = [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, $f.FullName, $name, [IO.Compression.CompressionLevel]::Optimal)
      if (-not $isWindowsRid) {
        $relative = $name.Substring($packageName.Length + 1)
        # Unix regular files: 0100755 for programs, 0100644 for data.
        $mode = if ($relative -in @($binary, "tools/makerom", "tools/bannertool") -or
          $relative -match '\.(so(\.[0-9]+)*|dylib)$') { 33261 } else { 33188 }
        $entry.ExternalAttributes = $mode -shl 16
      }
    }
  } finally {
    $z.Dispose()
  }
  $z = [IO.Compression.ZipFile]::OpenRead($zip)
  try {
    $bad = @($z.Entries | Where-Object { $_.FullName.Contains('\') }).Count
  } finally {
    $z.Dispose()
  }
  if ($bad) { throw "$bad zip entries use backslashes" }
  $mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
  Write-Host "OK v$version runtime=$runtime self-contained=$selfContained launcher=$includeLauncher -> $zip ($mb MB)"
}
