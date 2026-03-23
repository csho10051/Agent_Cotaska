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

# goversioninfo のインスト�Eル�E�アイコン埋め込み用�E�E
Write-Host "Installing goversioninfo..." -ForegroundColor Cyan
& $goExe install github.com/josephspurrier/goversioninfo/cmd/goversioninfo@latest

$gopath = & $goExe env GOPATH
$goversioninfo = Join-Path $gopath "bin\goversioninfo.exe"

# icon.ico が存在するか確誁E
if (-not (Test-Path "$scriptDir\icon.ico")) {
    Write-Host "WARN: icon.ico not found. Building without icon." -ForegroundColor Yellow
    # versioninfo.json の IconPath を空にして一時ビルチE
    $json = Get-Content "$scriptDir\versioninfo.json" -Raw | ConvertFrom-Json
    $json.IconPath = ""
    $tmpJsonPath = Join-Path $scriptDir "versioninfo_tmp.json"
    $tmpJson = $json | ConvertTo-Json -Depth 10
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($tmpJsonPath, $tmpJson, $utf8NoBom)
    & $goversioninfo -o resource.syso versioninfo_tmp.json
    Remove-Item $tmpJsonPath
} else {
    Write-Host "Using icon: $scriptDir\icon.ico" -ForegroundColor Green
    & $goversioninfo -o resource.syso versioninfo.json
}

# ビルド（コンソールウィンドウなぁE -ldflags "-H windowsgui"�E�E
Write-Host "Building Cotaska.exe..." -ForegroundColor Cyan
& $goExe build -ldflags "-H windowsgui -s -w" -o Cotaska.exe .

if (Test-Path "$scriptDir\Cotaska.exe") {
    $size = [math]::Round((Get-Item "$scriptDir\Cotaska.exe").Length / 1KB, 1)
    Write-Host "Build SUCCESS: Cotaska.exe ($size KB)" -ForegroundColor Green
} else {
    Write-Host "Build FAILED" -ForegroundColor Red
    exit 1
}

# resource.syso をクリーンアチE�E
Remove-Item "$scriptDir\resource.syso" -ErrorAction SilentlyContinue

Write-Host "`nCopy Cotaska.exe to your dist folder:" -ForegroundColor Cyan
Write-Host "  Copy-Item '$scriptDir\Cotaska.exe' '<dist-root>\Cotaska.exe'"

