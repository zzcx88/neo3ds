#Requires -Version 5.1
<#
.SYNOPSIS
  neo3ds Windows converter release zip builder.
.DESCRIPTION
  Publishes the self-contained Windows GUI exe plus tools\ into
  dist/neo3ds-converter.zip. Unix packages were replaced by the web
  converter (#35) and are not built.
  Prerequisites: engine built (docs/build.md 1), Windows tools (2).
.EXAMPLE
  powershell -File scripts/package_release.ps1 -WithLauncher
.EXAMPLE
  powershell -File scripts/package_release.ps1 -FrameworkDependent
  # Smaller zip, requires the .NET 10 runtime.
#>
param(
  [string]$Configuration = "Release",
  [switch]$FrameworkDependent,
  [switch]$WithLauncher,
  [string]$OutDir = "dist",
  [string]$VersionOverride = ""
)
$ErrorActionPreference = "Stop"

$root = Split-Path $PSScriptRoot -Parent

# 1. Version comes from converter/Directory.Build.props (single source of truth).
$props = Join-Path $root 'converter' 'Directory.Build.props'
[xml]$xml = Get-Content $props
$version = ($xml.Project.PropertyGroup | ForEach-Object { $_.Version } |
  Where-Object { $_ } | Select-Object -First 1)
if ($VersionOverride) { $version = $VersionOverride }
if (-not $version) { throw "Version not found in $props" }

# 2. Check every required file before publishing.
$required = @(
  ,@('converter', 'Neo3dsConverter', 'Neo3dsConverter.csproj'),
  ,@('engine', 'engine.elf'),
  ,@('converter', 'assets', 'neo3ds.rsf'),
  ,@('converter', 'assets', 'README.txt'),
  ,@('tools', 'makerom', 'makerom.exe'),
  ,@('tools', 'bannertool', 'windows-x86_64', 'bannertool.exe'),
  ,@('LICENSE'),
  ,@('THIRD_PARTY_NOTICES.md')
)
foreach ($segments in $required) {
  $path = $root
  foreach ($seg in $segments) { $path = Join-Path $path $seg }
  if (-not (Test-Path $path -PathType Leaf)) {
    throw "$($segments -join '/') is missing. See docs/build.md 1-2."
  }
}

Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

# 3. Publish the Windows GUI project self-contained (unless framework-dependent).
$publishDir = Join-Path $root 'out' 'publish-tmp' 'win-x64'
if (Test-Path $publishDir) { Remove-Item $publishDir -Recurse -Force }
$sc = if ($FrameworkDependent) { "false" } else { "true" }
dotnet publish (Join-Path $root 'converter' 'Neo3dsConverter') `
  -c $Configuration -r win-x64 --self-contained $sc -o $publishDir
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed (code $LASTEXITCODE)" }
$binary = 'Neo3dsConverter.exe'
if (-not (Test-Path (Join-Path $publishDir $binary) -PathType Leaf)) {
  throw "$binary missing from the publish output"
}
foreach ($name in @('makerom.exe', 'bannertool.exe', 'engine.elf', 'neo3ds.rsf')) {
  if (-not (Test-Path (Join-Path $publishDir 'tools' $name) -PathType Leaf)) {
    throw "tools/$name missing from the publish output"
  }
}

# 4. Stage the Windows layout: exe + tools\ + docs.
$stage = Join-Path $root $OutDir 'stage' 'neo3ds-converter'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item $stage -ItemType Directory -Force | Out-Null
Copy-Item (Join-Path $publishDir $binary) $stage
Copy-Item (Join-Path $publishDir 'tools') (Join-Path $stage 'tools') -Recurse
$readmeTemplate = Join-Path $root 'converter' 'assets' 'README.txt'
$readme = (Get-Content $readmeTemplate -Raw -Encoding UTF8).Replace('{VERSION}', $version)
Set-Content (Join-Path $stage 'README.txt') $readme -Encoding UTF8
Copy-Item (Join-Path $root 'LICENSE') (Join-Path $stage 'LICENSE.txt') -Force
Copy-Item (Join-Path $root 'THIRD_PARTY_NOTICES.md') $stage -Force

# 5. Optionally build the launcher CIA with the staged exe.
if ($WithLauncher) {
  $exe = Join-Path $stage $binary
  $p = Start-Process $exe -ArgumentList '--launcher', "`"$stage`"" -Wait -PassThru -WindowStyle Hidden
  $cia = Join-Path $stage 'neo3ds-launcher.cia'
  if ($p.ExitCode -ne 0 -or -not (Test-Path $cia)) { throw "launcher CIA build failed (code $($p.ExitCode))" }
  Copy-Item $cia (Join-Path $root $OutDir 'neo3ds-launcher.cia') -Force
}

# 6. Zip with slash-separated entries (asset name keeps latest/download links stable).
$zip = Join-Path $root $OutDir 'neo3ds-converter.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
$base = Split-Path $stage -Parent
$z = [IO.Compression.ZipFile]::Open($zip, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($f in Get-ChildItem $stage -Recurse -File) {
    $name = $f.FullName.Substring($base.Length + 1).Replace('\', '/')
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, $f.FullName, $name, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
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
Write-Host "OK v$version win-x64 self-contained=$(-not $FrameworkDependent) launcher=$WithLauncher -> $zip ($mb MB)"
