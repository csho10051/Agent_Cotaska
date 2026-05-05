# Cotaska ランチャー EXE ビルドスクリプト
# 使用方況E 20_app\setup\launcher\ で実衁E
#
# 前提: Go 1.21+ インスト�Eル済み
# アイコン埋め込みには goversioninfo が忁E��E���E回�Eみ自動取得！E

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

$goExe = "go"
if (-not (Get-Command $goExe -ErrorAction SilentlyContinue)) {
    $goExe = "C:\Program Files\Go\bin\go.exe"
}
$iconPath = Join-Path $scriptDir "icon.ico"

function Build-FallbackLauncher {
    $cscCandidates = @(
        (Get-Command "csc.exe" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source),
        "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
        "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
    ) | Where-Object { $_ -and (Test-Path $_) }

    $cscExe = $cscCandidates | Select-Object -First 1
    if (-not $cscExe) {
        Write-Host "Build FAILED: Go and csc.exe were not found." -ForegroundColor Red
        exit 1
    }

    $launcherSource = Join-Path $scriptDir "LauncherFallback.cs"
    if (-not (Test-Path $launcherSource)) {
        Write-Host "Build FAILED: $launcherSource not found." -ForegroundColor Red
        exit 1
    }

    Write-Host "Go was not found. Building C# fallback launcher..." -ForegroundColor Yellow
    $iconArg = if (Test-Path $iconPath) { "/win32icon:$iconPath" } else { $null }
    $args = @(
        "/nologo",
        "/target:winexe",
        "/out:$scriptDir\Cotaska.exe",
        "/reference:System.Windows.Forms.dll"
    )
    if ($iconArg) {
        $args += $iconArg
    }
    $args += $launcherSource

    & $cscExe $args
    if (($LASTEXITCODE -eq 0) -and (Test-Path "$scriptDir\Cotaska.exe")) {
        $size = [math]::Round((Get-Item "$scriptDir\Cotaska.exe").Length / 1KB, 1)
        Write-Host "Build SUCCESS: Cotaska.exe ($size KB)" -ForegroundColor Green
        exit 0
    }

    Write-Host "Build FAILED: C# fallback launcher failed." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $goExe) -and -not (Get-Command $goExe -ErrorAction SilentlyContinue)) {
    Build-FallbackLauncher
}

# goversioninfo のインストール（アイコン/バージョン情報埋め込み用）
Write-Host "Installing goversioninfo..." -ForegroundColor Cyan
& $goExe install github.com/josephspurrier/goversioninfo/cmd/goversioninfo@latest

$gopath = & $goExe env GOPATH
$goversioninfo = Join-Path $gopath "bin\goversioninfo.exe"
$rsrcExe = Join-Path $gopath "bin\rsrc.exe"
$resourceSysoPath = Join-Path $scriptDir "resource.syso"
$tmpJsonPath = Join-Path $scriptDir "versioninfo_tmp.json"

Remove-Item $resourceSysoPath -ErrorAction SilentlyContinue
Remove-Item $tmpJsonPath -ErrorAction SilentlyContinue

# icon.ico がない場合は IconPath を空にした一時JSONでリソース生成
if (Test-Path $goversioninfo) {
    if (-not (Test-Path $iconPath)) {
        Write-Host "WARN: icon.ico not found. Building without icon." -ForegroundColor Yellow
        $json = Get-Content "$scriptDir\versioninfo.json" -Raw | ConvertFrom-Json
        $json.IconPath = ""
        $tmpJson = $json | ConvertTo-Json -Depth 10
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($tmpJsonPath, $tmpJson, $utf8NoBom)
        & $goversioninfo -o resource.syso versioninfo_tmp.json
        Remove-Item $tmpJsonPath -ErrorAction SilentlyContinue
    } else {
        Write-Host "Using icon: $scriptDir\icon.ico" -ForegroundColor Green
        & $goversioninfo -o resource.syso versioninfo.json
    }
} else {
    Write-Host "WARN: goversioninfo not found. Building without resource.syso." -ForegroundColor Yellow
}

function Build-Launcher {
    & $goExe build -ldflags "-H windowsgui -s -w" -o Cotaska.exe .
    return $LASTEXITCODE
}

# ビルド（コンソールウィンドウなし）
Write-Host "Building Cotaska.exe..." -ForegroundColor Cyan
$buildExit = Build-Launcher

# resource.syso が原因で失敗する場合は rsrc で再生成して再ビルド
if (($buildExit -ne 0) -and (Test-Path $resourceSysoPath) -and (Test-Path $iconPath)) {
    Write-Host "WARN: build failed with resource.syso. Retrying with rsrc-generated syso..." -ForegroundColor Yellow
    & $goExe install github.com/akavel/rsrc@latest
    if (Test-Path $rsrcExe) {
        Remove-Item $resourceSysoPath -ErrorAction SilentlyContinue
        & $rsrcExe -arch amd64 -ico $iconPath -o $resourceSysoPath
        if ($LASTEXITCODE -eq 0 -and (Test-Path $resourceSysoPath)) {
            $buildExit = Build-Launcher
        }
    }
}

# それでも失敗する場合は、最後の手段としてアイコンなしでビルド
if (($buildExit -ne 0) -and (Test-Path $resourceSysoPath)) {
    Write-Host "WARN: build still failed with syso. Retrying without resource.syso..." -ForegroundColor Yellow
    Remove-Item $resourceSysoPath -ErrorAction SilentlyContinue
    $buildExit = Build-Launcher
}

if (($buildExit -eq 0) -and (Test-Path "$scriptDir\Cotaska.exe")) {
    $size = [math]::Round((Get-Item "$scriptDir\Cotaska.exe").Length / 1KB, 1)
    Write-Host "Build SUCCESS: Cotaska.exe ($size KB)" -ForegroundColor Green
} else {
    Write-Host "Build FAILED" -ForegroundColor Red
    Write-Host "go exit code: $buildExit" -ForegroundColor Red
    exit 1
}

# resource.syso をクリーンアチE�E
Remove-Item $resourceSysoPath -ErrorAction SilentlyContinue
Remove-Item $tmpJsonPath -ErrorAction SilentlyContinue

Write-Host "`nCopy Cotaska.exe to your dist folder:" -ForegroundColor Cyan
Write-Host "  Copy-Item '$scriptDir\Cotaska.exe' '<dist-root>\Cotaska.exe'"

