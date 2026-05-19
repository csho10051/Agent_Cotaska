$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = (Resolve-Path (Join-Path $scriptDir "..\..")).Path
$outputDir = Join-Path $appDir "scripts"
$outputExe = Join-Path $outputDir "CotaskaUpdater.exe"
$sourcePath = Join-Path $scriptDir "UpdaterFallback.cs"

$cscCandidates = @(
    (Get-Command "csc.exe" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source),
    "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
) | Where-Object { $_ -and (Test-Path $_) }

$cscExe = $cscCandidates | Select-Object -First 1
if (-not $cscExe) {
    Write-Host "Build FAILED: csc.exe was not found." -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $sourcePath)) {
    Write-Host "Build FAILED: $sourcePath not found." -ForegroundColor Red
    exit 1
}

New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$args = @(
    "/nologo",
    "/target:winexe",
    "/out:$outputExe",
    "/reference:System.Drawing.dll",
    "/reference:System.IO.Compression.dll",
    "/reference:System.IO.Compression.FileSystem.dll",
    "/reference:System.Windows.Forms.dll",
    $sourcePath
)

& $cscExe $args
if (($LASTEXITCODE -eq 0) -and (Test-Path $outputExe)) {
    $size = [math]::Round((Get-Item $outputExe).Length / 1KB, 1)
    Write-Host "Build SUCCESS: CotaskaUpdater.exe ($size KB)" -ForegroundColor Green
    exit 0
}

Write-Host "Build FAILED: CotaskaUpdater.exe" -ForegroundColor Red
exit 1
