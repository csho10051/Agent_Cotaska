# Cotaska release-all.ps1
# Step 1: npm run dist:dir (renderer build + Electron packaging)
# Step 2: Go launcher build (setup/launcher/build.ps1)
# Step 3: organize-release.ps1 (restructure dist folder)
# Step 4: Copy launcher EXE to dist root
# Step 5: Pre-ship verification
#
# Usage:  cd 20_app  ;  .\release-all.ps1
#         .\release-all.ps1 -Version "0.2.0"

param(
    [string]$Version = "0.1.0"
)

$ErrorActionPreference = "Stop"

$scriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeDir     = Resolve-Path (Join-Path $scriptDir "..\..\v22.14.0")
$launcherDir = Join-Path $scriptDir "setup\launcher"
$distRoot    = Join-Path $scriptDir "release\Cotaska-$Version-dist"

$env:PATH = "$nodeDir;$env:PATH"

Write-Host ""
Write-Host "=======================================" -ForegroundColor Green
Write-Host " Cotaska Release All  v$Version" -ForegroundColor Green
Write-Host "=======================================" -ForegroundColor Green

# -------------------------------------------------------
# Step 1: Renderer build + Electron packaging
# -------------------------------------------------------
Write-Host "`n[Step 1/4] npm run dist:dir ..." -ForegroundColor Cyan
Set-Location $scriptDir
npm run dist:dir
if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAILED] npm run dist:dir" -ForegroundColor Red
    exit 1
}
$winUnpacked = Join-Path $scriptDir "release\win-unpacked\Cotaska.exe"
if (-not (Test-Path $winUnpacked)) {
    Write-Host "[FAILED] win-unpacked\Cotaska.exe not found" -ForegroundColor Red
    exit 1
}
Write-Host "  OK: Electron packaging complete" -ForegroundColor Green

# -------------------------------------------------------
# Step 2: Go launcher build
# -------------------------------------------------------
Write-Host "`n[Step 2/4] Building Go launcher ..." -ForegroundColor Cyan
$buildPs1 = Join-Path $launcherDir "build.ps1"
if (-not (Test-Path $buildPs1)) {
    Write-Host "  [WARN] $buildPs1 not found. Skipping launcher build." -ForegroundColor Yellow
} else {
    & powershell -ExecutionPolicy Bypass -File $buildPs1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[FAILED] Launcher build failed" -ForegroundColor Red
        exit 1
    }
    Write-Host "  OK: Launcher build complete" -ForegroundColor Green
}

# -------------------------------------------------------
# Step 3: Reorganize dist folder
# -------------------------------------------------------
Write-Host "`n[Step 3/4] Organizing release folder ..." -ForegroundColor Cyan
Set-Location $scriptDir
& ".\organize-release.ps1" -Version $Version
if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAILED] organize-release.ps1 failed" -ForegroundColor Red
    exit 1
}
Write-Host "  OK: Release folder organized" -ForegroundColor Green

# -------------------------------------------------------
# Step 4: Copy launcher EXE to dist root
# -------------------------------------------------------
Write-Host "`n[Step 4/4] Copying launcher to dist root ..." -ForegroundColor Cyan
$launcherExe  = Join-Path $launcherDir "Cotaska.exe"
$distLauncher = Join-Path $distRoot    "Cotaska.exe"
if (Test-Path $launcherExe) {
    Copy-Item $launcherExe -Destination $distLauncher -Force
    $sizeKB = [math]::Round((Get-Item $distLauncher).Length / 1KB, 1)
    Write-Host "  OK: Launcher copied -> $distLauncher ($sizeKB KB)" -ForegroundColor Green
} else {
    Write-Host "  [WARN] $launcherExe not found. Using existing launcher." -ForegroundColor Yellow
}

# -------------------------------------------------------
# Step 5: Pre-ship verification
# -------------------------------------------------------
Write-Host "`n[Step 5] Pre-ship verification ..." -ForegroundColor Cyan

$checks = @(
    @{ Path = $distRoot;                                       Label = "dist root" },
    @{ Path = (Join-Path $distRoot "Cotaska.exe");             Label = "Cotaska.exe (launcher)" },
    @{ Path = (Join-Path $distRoot "_app");                    Label = "_app/" },
    @{ Path = (Join-Path $distRoot "_app\resources\app.asar"); Label = "_app/resources/app.asar" },
    @{ Path = (Join-Path $distRoot "data");                    Label = "data/" },
    @{ Path = (Join-Path $distRoot "data\tasks");              Label = "data/tasks/" },
    @{ Path = (Join-Path $distRoot "logs");                    Label = "logs/" }
)

$allOk = $true
foreach ($c in $checks) {
    if (Test-Path $c.Path) {
        Write-Host ("  OK  " + $c.Label) -ForegroundColor Green
    } else {
        Write-Host ("  NG  " + $c.Label) -ForegroundColor Red
        $allOk = $false
    }
}

Write-Host ""
if ($allOk) {
    Write-Host "=======================================" -ForegroundColor Green
    Write-Host " Release v$Version Complete!" -ForegroundColor Green
    Write-Host "=======================================" -ForegroundColor Green
    Write-Host "  Dist: $distRoot" -ForegroundColor Cyan
    Write-Host "  Next: Launch $distRoot\Cotaska.exe and verify." -ForegroundColor Cyan
} else {
    Write-Host "=======================================" -ForegroundColor Red
    Write-Host " Release v$Version INCOMPLETE" -ForegroundColor Red
    Write-Host "=======================================" -ForegroundColor Red
    exit 1
}