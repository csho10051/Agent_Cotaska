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

# goversioninfo のインストール（アイコン/バージョン情報埋め込み用）
Write-Host "Installing goversioninfo..." -ForegroundColor Cyan
& $goExe install github.com/josephspurrier/goversioninfo/cmd/goversioninfo@latest

$gopath = & $goExe env GOPATH
$goversioninfo = Join-Path $gopath "bin\goversioninfo.exe"
$resourceSysoPath = Join-Path $scriptDir "resource.syso"
$tmpJsonPath = Join-Path $scriptDir "versioninfo_tmp.json"

Remove-Item $resourceSysoPath -ErrorAction SilentlyContinue
Remove-Item $tmpJsonPath -ErrorAction SilentlyContinue

# icon.ico がない場合は IconPath を空にした一時JSONでリソース生成
if (Test-Path $goversioninfo) {
    if (-not (Test-Path "$scriptDir\icon.ico")) {
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

# ビルド（コンソールウィンドウなし）
Write-Host "Building Cotaska.exe..." -ForegroundColor Cyan
& $goExe build -ldflags "-H windowsgui -s -w" -o Cotaska.exe .
$buildExit = $LASTEXITCODE

# resource.syso が原因で失敗する場合は、syso を除去して再ビルド
if (($buildExit -ne 0) -and (Test-Path $resourceSysoPath)) {
    Write-Host "WARN: build failed with resource.syso. Retrying without resource.syso..." -ForegroundColor Yellow
    Remove-Item $resourceSysoPath -ErrorAction SilentlyContinue
    & $goExe build -ldflags "-H windowsgui -s -w" -o Cotaska.exe .
    $buildExit = $LASTEXITCODE
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

