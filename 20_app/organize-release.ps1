# T-048-04: リリース配布フォルダ構成整理スクリプト
# 目的: ビルド後の Cotaska-0.1.0-dist を新しい構成に整理
# 用途: npm run dist:dir 後に実行し、_app の外へ data/, logs/ を抽出
#
# 使い方: .\organize-release.ps1 -BuildDir "release" -Version "0.1.0"

param(
  [string]$BuildDir = "release",
  [string]$Version = "0.1.0"
)

$distDir = Join-Path $BuildDir "Cotaska-$Version-dist"
$appDir = Join-Path $distDir "_app"
$dataDir = Join-Path $distDir "data"
$logsDir = Join-Path $distDir "logs"

Write-Host "=== Cotaska Release Structure Organization ===" -ForegroundColor Green
Write-Host "Distribution Dir: $distDir" -ForegroundColor Gray
Write-Host "App Dir: $appDir" -ForegroundColor Gray

# 1. data/, logs/ ディレクトリを作成
Write-Host "`n[Step 1] Creating data/ and logs/ directories..."
if (-not (Test-Path $dataDir)) {
  New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
  Write-Host "  Created: $dataDir"
}

if (-not (Test-Path $logsDir)) {
  New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
  Write-Host "  Created: $logsDir"
}

# 2. $appDir/resources/30_data を data/ へ移動
Write-Host "`n[Step 2] Migrating task data from _app/resources/30_data to data/..."
$resourcesDataDir = Join-Path $appDir "resources\30_data"
if (Test-Path $resourcesDataDir) {
  # tasks/ をコピー
  $tasksSource = Join-Path $resourcesDataDir "tasks"
  $tasksTarget = Join-Path $dataDir "tasks"
  if (Test-Path $tasksSource) {
    if (Test-Path $tasksTarget) {
      Remove-Item $tasksTarget -Recurse -Force
    }
    Copy-Item $tasksSource -Destination $tasksTarget -Recurse
    Write-Host "  Copied: tasks/ → data/tasks/"
  }

  # archive/ をコピー
  $archiveSource = Join-Path $resourcesDataDir "archive"
  $archiveTarget = Join-Path $dataDir "archive"
  if (Test-Path $archiveSource) {
    if (Test-Path $archiveTarget) {
      Remove-Item $archiveTarget -Recurse -Force
    }
    Copy-Item $archiveSource -Destination $archiveTarget -Recurse
    Write-Host "  Copied: archive/ → data/archive/"
  }

  # lists.yaml をコピー
  $listsSource = Join-Path $resourcesDataDir "lists.yaml"
  $listsTarget = Join-Path $dataDir "lists.yaml"
  if (Test-Path $listsSource) {
    Copy-Item $listsSource -Destination $listsTarget -Force
    Write-Host "  Copied: lists.yaml → data/lists.yaml"
  }
}

# 3. $appDir/workspace/logs を logs/ へ移動
Write-Host "`n[Step 3] Migrating logs from _app/workspace/logs to logs/..."
$workspaceLogsDir = Join-Path $appDir "workspace\logs"
if (Test-Path $workspaceLogsDir) {
  Try {
    Copy-Item -Path "$workspaceLogsDir\*" -Destination $logsDir -Recurse -Force -ErrorAction Continue
    Write-Host "  Copied: workspace/logs/* → logs/"
  } Catch {
    Write-Host "  Warning: Some log files could not be copied (non-critical)" -ForegroundColor Yellow
  }
}

# 4. resources/ と workspace/ を削除
Write-Host "`n[Step 4] Cleaning up old directories from _app/..."
$resourcesDir = Join-Path $appDir "resources"
$workspaceDir = Join-Path $appDir "workspace"

if (Test-Path $resourcesDir) {
  Remove-Item $resourcesDir -Recurse -Force
  Write-Host "  Removed: _app/resources/"
}

if (Test-Path $workspaceDir) {
  Remove-Item $workspaceDir -Recurse -Force
  Write-Host "  Removed: _app/workspace/"
}

# 5. 最終構成をツリー表示
Write-Host "`n[Step 5] Final distribution structure:"`
$finalStructure = @"
$distDir/
  ├── _app/          (実行バイナリのみ)
  │   ├── locales/
  │   ├── app.asar
  │   ├── Cotaska.exe
  │   └── [DLL群]
  ├── data/          (ユーザーデータ)
  │   ├── tasks/
  │   ├── archive/
  │   └── lists.yaml
  ├── logs/          (アプリログ)
  ├── Cotaska.exe    (ランチャー)
  ├── launcher.log
  └── README.txt
"@
Write-Host $finalStructure -ForegroundColor Cyan

# 6. ディレクトリ構成の検証
Write-Host "`n[Verification] Checking directory structure..."
$checkList = @(
  "_app",
  "data",
  "data/tasks",
  "logs"
)

foreach ($item in $checkList) {
  $itemPath = Join-Path $distDir $item
  if (Test-Path $itemPath) {
    Write-Host "  ✓ $item" -ForegroundColor Green
  } else {
    Write-Host "  ✗ $item (NOT FOUND)" -ForegroundColor Red
  }
}

Write-Host "`n=== Organization Complete ==="  -ForegroundColor Green
