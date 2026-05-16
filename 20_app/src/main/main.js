const { app, BrowserWindow, ipcMain, Menu, dialog, globalShortcut, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const fs = require("fs");
const AdmZip = require("adm-zip");
const taskService = require("./taskService");
const listService = require("./listService");
const watcher = require("./watcher");
const reminderService = require("./reminderService");
const settingsService = require("./settingsService");
const logger     = require("./logger");
const appLogger  = require("./appLogger");
const { createBackupService } = require("./backupService");
const packageInfo = require("../../package.json");

let mainWindow = null;
let hasShownCloudSyncWarning = false;
let hasShownLaunchFailedGuidance = false;
let updaterState = {
  status: "idle",
  message: "更新確認を待機しています。",
  hasUpdate: false,
  downloaded: false,
  progress: null,
  version: null,
  releaseUrl: null,
  assetName: null,
  assetUrl: null,
  assetSize: null,
  checksumAssetUrl: null,
  downloadPath: null,
  checksum: null,
};
const APP_DISPLAY_NAME = "CotaskaCore";
const APP_USER_MODEL_ID_BASE = "com.cotaska.app";
const APP_USER_MODEL_ID_REVISION = "v3";

const CLOUD_SYNC_PATH_MARKERS = [
  { token: "\\\\box\\\\", provider: "Box" },
  { token: "\\\\onedrive\\\\", provider: "OneDrive" },
  { token: "\\\\dropbox\\\\", provider: "Dropbox" },
  { token: "\\\\google drive\\\\", provider: "Google Drive" },
  { token: "\\\\googledrive\\\\", provider: "Google Drive" },
  { token: "\\\\icloud drive\\\\", provider: "iCloud Drive" },
  { token: "\\\\icloud\\\\", provider: "iCloud" },
];

function normalizePathForCompare(targetPath) {
  return String(targetPath || "")
    .replace(/\//g, "\\\\")
    .toLowerCase();
}

function detectCloudSyncProvider(targetPath) {
  const normalized = normalizePathForCompare(targetPath);
  const marker = CLOUD_SYNC_PATH_MARKERS.find((x) => normalized.includes(x.token));
  return marker ? marker.provider : null;
}

function getRuntimeRootPath() {
  if (app.isPackaged) {
    return path.dirname(process.execPath);
  }
  return path.resolve(__dirname, "../..");
}

function getPortableRootPath() {
  const execDir = path.dirname(process.execPath);
  if (path.basename(execDir).toLowerCase() === "_app") {
    return path.dirname(execDir);
  }
  return execDir;
}

function isCotaskaPortableRuntime() {
  if (!app.isPackaged) return false;
  if (process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_FILE) return true;
  return path.basename(path.dirname(process.execPath)).toLowerCase() === "_app";
}

function getDefaultBackupDir() {
  return path.join(getRuntimeRootPath(), "backup");
}

const backupService = createBackupService({
  appVersion: packageInfo.version,
  appDisplayName: APP_DISPLAY_NAME,
  getDefaultBackupDir,
  getMainWindow: () => mainWindow,
  settingsService,
  taskService,
  watcher,
});

function getAppInfo() {
  const settingsResult = settingsService.getSettings();
  const settings = settingsResult.settings;
  const distributionFolder = app.isPackaged
    ? path.basename(getRuntimeRootPath())
    : "Cotaska-Portable";

  return {
    productName: settings.displayName || "Cotaska",
    currentVersion: `Cotaska ${packageInfo.version}`,
    version: packageInfo.version,
    distributionFolder,
    updateGuidance: "利用者確認付きの手動ダウンロード案内",
    settingsPath: settingsResult.path,
    downloadPageUrl: settings.update.downloadPageUrl,
    backupDefaultDir: getDefaultBackupDir(),
  };
}

function normalizeVersion(value) {
  return String(value || "").trim().replace(/^v/i, "").replace(/^Cotaska\s+/i, "");
}

function compareVersions(a, b) {
  const left = normalizeVersion(a).split(/[.-]/).map((part) => Number.parseInt(part, 10));
  const right = normalizeVersion(b).split(/[.-]/).map((part) => Number.parseInt(part, 10));
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i += 1) {
    const l = Number.isFinite(left[i]) ? left[i] : 0;
    const r = Number.isFinite(right[i]) ? right[i] : 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

function getAutoUpdateUnsupportedReason() {
  if (!app.isPackaged) {
    return "開発実行中のため、自動更新は利用できません。";
  }
  if (isCotaskaPortableRuntime()) {
    return null;
  }
  if (process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_FILE) {
    return "portable版では自動更新は利用できません。インストール版を使用してください。";
  }
  if (path.basename(path.dirname(process.execPath)).toLowerCase() === "_app") {
    return "Cotaska-Portable版では自動更新は利用できません。インストール版を使用するか、手動で新版をダウンロードしてください。";
  }
  const appUpdateConfigPath = path.join(process.resourcesPath || "", "app-update.yml");
  if (!fs.existsSync(appUpdateConfigPath)) {
    return "自動更新の設定ファイル app-update.yml が見つかりません。インストール版で再起動してください。";
  }
  return null;
}

function getUpdateSettings() {
  return settingsService.getSettings().settings.update || {};
}

function findReleaseAsset(release, assetName) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  return assets.find((asset) => String(asset.name || "").toLowerCase() === assetName.toLowerCase()) || null;
}

function getPortableUpdateWorkDir(version) {
  const safeVersion = normalizeVersion(version || "unknown").replace(/[^0-9A-Za-z._-]/g, "_") || "unknown";
  return path.join(app.getPath("temp"), "Cotaska-updates", safeVersion);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function parseSha256Text(text) {
  const match = String(text || "").match(/[a-fA-F0-9]{64}/);
  return match ? match[0].toLowerCase() : null;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest("hex");
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json, application/json",
      "User-Agent": "Cotaska",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub Releases API の取得に失敗しました。HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/octet-stream, text/plain, */*",
      "User-Agent": "Cotaska",
    },
  });
  if (!response.ok) {
    throw new Error(`チェックサムの取得に失敗しました。HTTP ${response.status}`);
  }
  return response.text();
}

async function downloadFile(url, destinationPath, expectedSize = null) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "Cotaska",
    },
  });
  if (!response.ok) {
    throw new Error(`更新ファイルのダウンロードに失敗しました。HTTP ${response.status}`);
  }

  const total = Number(response.headers.get("content-length") || expectedSize || 0);
  const chunks = [];
  let transferred = 0;
  const reader = response.body?.getReader?.();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(destinationPath, buffer);
    return { transferred: buffer.length, total: buffer.length };
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    chunks.push(chunk);
    transferred += chunk.length;
    publishUpdaterState({
      status: "downloading",
      message: `更新ファイルをダウンロードしています... ${total ? Math.round((transferred / total) * 100) : ""}%`,
      progress: {
        percent: total ? (transferred / total) * 100 : 0,
        transferred,
        total,
      },
    });
  }
  fs.writeFileSync(destinationPath, Buffer.concat(chunks));
  return { transferred, total };
}

function verifyPortableZip(zipPath) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries().map((entry) => entry.entryName.replace(/\\/g, "/"));
  const required = [
    "Cotaska-Portable/Cotaska.exe",
    "Cotaska-Portable/_app/CotaskaCore.exe",
    "Cotaska-Portable/_app/resources/app.asar",
  ];
  const missing = required.filter((entry) => !entries.includes(entry));
  if (missing.length > 0) {
    throw new Error(`更新zipの構成が不正です。不足: ${missing.join(", ")}`);
  }
}

function escapePowerShellSingleQuoted(value) {
  return String(value || "").replace(/'/g, "''");
}

function createPortableUpdaterScript({ zipPath, portableRoot, version }) {
  const workDir = getPortableUpdateWorkDir(version);
  ensureDir(workDir);
  const scriptPath = path.join(workDir, "apply-portable-update.ps1");
  const q = (value) => `'${escapePowerShellSingleQuoted(value)}'`;
  const script = `
$ErrorActionPreference = "Stop"
$ZipPath = ${q(zipPath)}
$PortableRoot = ${q(portableRoot)}
$Version = ${q(version || "")}
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$LogDir = Join-Path $PortableRoot "logs"
$BackupDir = Join-Path $PortableRoot "backup"
$ExtractRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("Cotaska-update-extract-" + $Timestamp)
$LogPath = Join-Path $LogDir ("portable-update-" + $Timestamp + ".log")

function Write-UpdateLog {
    param([string]$Message)
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    $line = "[" + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "] " + $Message
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Copy-IfExists {
    param([string]$Source, [string]$Destination)
    if (Test-Path -LiteralPath $Source) {
        Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
    }
}

function Restore-FromBackup {
    param([string]$BackupPath)
    if (-not (Test-Path -LiteralPath $BackupPath)) { return }
    Write-UpdateLog ("Restoring from backup: " + $BackupPath)
    Copy-IfExists (Join-Path $BackupPath "Cotaska.exe") (Join-Path $PortableRoot "Cotaska.exe")
    Copy-IfExists (Join-Path $BackupPath "_app") (Join-Path $PortableRoot "_app")
    Copy-IfExists (Join-Path $BackupPath "tools") (Join-Path $PortableRoot "tools")
    Get-ChildItem -LiteralPath $BackupPath -Filter "Cotaska_AI*.md" -File -ErrorAction SilentlyContinue | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $PortableRoot $_.Name) -Force
    }
    Copy-IfExists (Join-Path $BackupPath "README.md") (Join-Path $PortableRoot "README.md")
}

try {
    Write-UpdateLog ("Portable update started. Version=" + $Version)
    New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

    for ($i = 0; $i -lt 60; $i++) {
        $running = Get-Process -Name "Cotaska","CotaskaCore" -ErrorAction SilentlyContinue
        if (-not $running) { break }
        Start-Sleep -Seconds 1
    }
    $running = Get-Process -Name "Cotaska","CotaskaCore" -ErrorAction SilentlyContinue
    if ($running) {
        throw "Cotaska process is still running. Close Cotaska and retry."
    }

    if (Test-Path -LiteralPath $ExtractRoot) {
        Remove-Item -LiteralPath $ExtractRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $ExtractRoot | Out-Null
    Expand-Archive -LiteralPath $ZipPath -DestinationPath $ExtractRoot -Force

    $SourceRoot = Join-Path $ExtractRoot "Cotaska-Portable"
    if (-not (Test-Path -LiteralPath $SourceRoot)) {
        throw "Cotaska-Portable root was not found in update zip."
    }
    foreach ($required in @("Cotaska.exe", "_app", "_app\\resources\\app.asar")) {
        if (-not (Test-Path -LiteralPath (Join-Path $SourceRoot $required))) {
            throw ("Required update item was not found: " + $required)
        }
    }

    $BackupPath = Join-Path $BackupDir ("portable-update-before-" + $Timestamp)
    New-Item -ItemType Directory -Force -Path $BackupPath | Out-Null
    Write-UpdateLog ("Creating backup: " + $BackupPath)
    Copy-IfExists (Join-Path $PortableRoot "Cotaska.exe") (Join-Path $BackupPath "Cotaska.exe")
    Copy-IfExists (Join-Path $PortableRoot "_app") (Join-Path $BackupPath "_app")
    Copy-IfExists (Join-Path $PortableRoot "tools") (Join-Path $BackupPath "tools")
    Get-ChildItem -LiteralPath $PortableRoot -Filter "Cotaska_AI*.md" -File -ErrorAction SilentlyContinue | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $BackupPath $_.Name) -Force
    }
    Copy-IfExists (Join-Path $PortableRoot "README.md") (Join-Path $BackupPath "README.md")

    Write-UpdateLog "Replacing application files"
    Copy-Item -LiteralPath (Join-Path $SourceRoot "Cotaska.exe") -Destination (Join-Path $PortableRoot "Cotaska.exe") -Force
    if (Test-Path -LiteralPath (Join-Path $PortableRoot "_app")) {
        Remove-Item -LiteralPath (Join-Path $PortableRoot "_app") -Recurse -Force
    }
    Copy-Item -LiteralPath (Join-Path $SourceRoot "_app") -Destination (Join-Path $PortableRoot "_app") -Recurse -Force
    if (Test-Path -LiteralPath (Join-Path $SourceRoot "tools")) {
        if (Test-Path -LiteralPath (Join-Path $PortableRoot "tools")) {
            Remove-Item -LiteralPath (Join-Path $PortableRoot "tools") -Recurse -Force
        }
        Copy-Item -LiteralPath (Join-Path $SourceRoot "tools") -Destination (Join-Path $PortableRoot "tools") -Recurse -Force
    }
    Get-ChildItem -LiteralPath $SourceRoot -Filter "Cotaska_AI*.md" -File -ErrorAction SilentlyContinue | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $PortableRoot $_.Name) -Force
    }
    Copy-IfExists (Join-Path $SourceRoot "README.md") (Join-Path $PortableRoot "README.md")

    Write-UpdateLog "Portable update completed"
    Start-Process -FilePath (Join-Path $PortableRoot "Cotaska.exe") -WorkingDirectory $PortableRoot
}
catch {
    Write-UpdateLog ("Portable update failed: " + $_.Exception.Message)
    if ($BackupPath) {
        try { Restore-FromBackup -BackupPath $BackupPath } catch { Write-UpdateLog ("Restore failed: " + $_.Exception.Message) }
    }
    throw
}
finally {
    if (Test-Path -LiteralPath $ExtractRoot) {
        Remove-Item -LiteralPath $ExtractRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
`;
  fs.writeFileSync(scriptPath, script.trimStart(), "utf8");
  return scriptPath;
}

async function checkPortableUpdate() {
  const settings = getUpdateSettings();
  const latestVersionUrl = String(settings.latestVersionUrl || "").trim();
  if (!latestVersionUrl) {
    return publishUpdaterState({
      status: "error",
      message: "更新確認URLが未設定です。",
      hasUpdate: false,
      downloaded: false,
      progress: null,
    });
  }

  try {
    publishUpdaterState({
      status: "checking",
      message: "GitHub Releases の Portable版更新を確認しています...",
      progress: null,
      downloaded: false,
    });
    const release = await fetchJson(latestVersionUrl);
    const latestVersion = normalizeVersion(release.tag_name || release.name || "");
    if (!latestVersion) {
      throw new Error("最新リリースのバージョンを取得できませんでした。");
    }
    const asset = findReleaseAsset(release, "Cotaska-Portable.zip");
    if (!asset?.browser_download_url) {
      throw new Error("最新リリースに Cotaska-Portable.zip が見つかりません。");
    }
    const checksumAsset = findReleaseAsset(release, "Cotaska-Portable.zip.sha256");
    const hasUpdate = compareVersions(latestVersion, packageInfo.version) > 0;
    return publishUpdaterState({
      status: hasUpdate ? "available" : "not-available",
      message: hasUpdate
        ? `新しいPortable版 ${latestVersion} があります。`
        : "現在のバージョンは最新です。",
      hasUpdate,
      downloaded: false,
      progress: null,
      version: latestVersion,
      releaseUrl: release.html_url || settings.downloadPageUrl || null,
      assetName: asset.name,
      assetUrl: asset.browser_download_url,
      assetSize: asset.size || null,
      checksumAssetUrl: checksumAsset?.browser_download_url || null,
      downloadPath: null,
      checksum: null,
    });
  } catch (err) {
    logger.warn("portable updates:check failed", { error: err.message });
    return publishUpdaterState({
      status: "error",
      message: err.message || "Portable版の更新確認に失敗しました。",
      hasUpdate: false,
      downloaded: false,
      progress: null,
    });
  }
}

async function downloadPortableUpdate() {
  if (!updaterState.hasUpdate || !updaterState.assetUrl) {
    return publishUpdaterState({
      status: "not-available",
      message: "ダウンロードできるPortable版更新はありません。",
      progress: null,
    });
  }

  try {
    const workDir = getPortableUpdateWorkDir(updaterState.version);
    ensureDir(workDir);
    const zipPath = path.join(workDir, "Cotaska-Portable.zip");
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }
    publishUpdaterState({
      status: "downloading",
      message: "Portable版更新ファイルをダウンロードしています...",
      downloaded: false,
      progress: null,
    });
    await downloadFile(updaterState.assetUrl, zipPath, updaterState.assetSize);

    let expectedSha = null;
    if (updaterState.checksumAssetUrl) {
      expectedSha = parseSha256Text(await fetchText(updaterState.checksumAssetUrl));
      if (!expectedSha) {
        throw new Error("Cotaska-Portable.zip.sha256 からSHA-256値を読み取れませんでした。");
      }
      const actualSha = sha256File(zipPath);
      if (actualSha !== expectedSha) {
        throw new Error("更新zipのSHA-256検証に失敗しました。");
      }
    } else if (updaterState.assetSize) {
      const size = fs.statSync(zipPath).size;
      if (size !== updaterState.assetSize) {
        throw new Error(`更新zipのサイズ検証に失敗しました。expected=${updaterState.assetSize}, actual=${size}`);
      }
    }

    verifyPortableZip(zipPath);
    return publishUpdaterState({
      status: "downloaded",
      message: "Portable版更新ファイルの準備ができました。再起動して更新できます。",
      downloaded: true,
      progress: null,
      downloadPath: zipPath,
      checksum: expectedSha,
    });
  } catch (err) {
    logger.warn("portable updates:download failed", { error: err.message });
    return publishUpdaterState({
      status: "error",
      message: err.message || "Portable版更新ファイルのダウンロードに失敗しました。",
      progress: null,
      downloaded: false,
    });
  }
}

function installPortableUpdate() {
  if (!updaterState.downloaded || !updaterState.downloadPath) {
    return publishUpdaterState({
      status: "available",
      message: "更新を適用する前にPortable版更新ファイルをダウンロードしてください。",
      hasUpdate: true,
    });
  }

  const portableRoot = getPortableRootPath();
  const scriptPath = createPortableUpdaterScript({
    zipPath: updaterState.downloadPath,
    portableRoot,
    version: updaterState.version,
  });
  publishUpdaterState({
    status: "installing",
    message: "Cotaskaを終了してPortable版更新を適用します。",
  });
  const child = spawn("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
  ], {
    cwd: portableRoot,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  setTimeout(() => app.quit(), 500);
  return updaterState;
}

function publishUpdaterState(patch) {
  updaterState = {
    ...updaterState,
    ...patch,
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("updates:status", updaterState);
  }
  return updaterState;
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("checking-for-update", () => {
    publishUpdaterState({
      status: "checking",
      message: "更新を確認しています...",
      progress: null,
      downloaded: false,
    });
  });

  autoUpdater.on("update-available", (info) => {
    publishUpdaterState({
      status: "available",
      message: `新しいバージョン ${info.version || ""} があります。`,
      hasUpdate: true,
      downloaded: false,
      progress: null,
      version: info.version || null,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    publishUpdaterState({
      status: "not-available",
      message: "現在のバージョンは最新版です。",
      hasUpdate: false,
      downloaded: false,
      progress: null,
      version: info.version || null,
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    publishUpdaterState({
      status: "downloading",
      message: `更新をダウンロードしています... ${Math.round(progress.percent || 0)}%`,
      progress: {
        percent: progress.percent || 0,
        transferred: progress.transferred || 0,
        total: progress.total || 0,
      },
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    publishUpdaterState({
      status: "downloaded",
      message: "更新の準備ができました。再起動すると適用されます。",
      downloaded: true,
      hasUpdate: true,
      progress: null,
      version: info.version || updaterState.version,
    });
  });

  autoUpdater.on("error", (err) => {
    logger.warn("autoUpdater error", { error: err.message });
    publishUpdaterState({
      status: "error",
      message: err.message || "自動更新でエラーが発生しました。",
      progress: null,
    });
  });
}

async function checkAutoUpdate() {
  if (isCotaskaPortableRuntime()) {
    return checkPortableUpdate();
  }
  const unsupportedReason = getAutoUpdateUnsupportedReason();
  if (unsupportedReason) {
    return publishUpdaterState({
      status: "unsupported",
      message: unsupportedReason,
      hasUpdate: false,
      downloaded: false,
      progress: null,
    });
  }

  try {
    await autoUpdater.checkForUpdates();
    return updaterState;
  } catch (err) {
    logger.warn("updates:check failed", { error: err.message });
    return publishUpdaterState({
      status: "error",
      message: err.message || "更新確認に失敗しました。",
      progress: null,
    });
  }
}

async function downloadAutoUpdate() {
  if (isCotaskaPortableRuntime()) {
    return downloadPortableUpdate();
  }
  const unsupportedReason = getAutoUpdateUnsupportedReason();
  if (unsupportedReason) {
    return publishUpdaterState({
      status: "unsupported",
      message: unsupportedReason,
      hasUpdate: false,
      downloaded: false,
      progress: null,
    });
  }
  if (!updaterState.hasUpdate) {
    return publishUpdaterState({
      status: "not-available",
      message: "ダウンロードできる更新はありません。",
      progress: null,
    });
  }

  try {
    await autoUpdater.downloadUpdate();
    return updaterState;
  } catch (err) {
    logger.warn("updates:download failed", { error: err.message });
    return publishUpdaterState({
      status: "error",
      message: err.message || "更新のダウンロードに失敗しました。",
      progress: null,
    });
  }
}

function installAutoUpdate() {
  if (isCotaskaPortableRuntime()) {
    return installPortableUpdate();
  }
  if (!updaterState.downloaded) {
    return publishUpdaterState({
      status: "available",
      message: "更新を適用する前にダウンロードしてください。",
      hasUpdate: true,
    });
  }

  publishUpdaterState({
    status: "installing",
    message: "再起動して更新を適用します。",
  });
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return updaterState;
}

async function checkForUpdates() {
  const pkg = require("../../package.json");
  const settings = settingsService.getSettings().settings;
  const latestVersionUrl = String(settings.update?.latestVersionUrl || "").trim();
  if (!latestVersionUrl) {
    return { ok: true, currentVersion: pkg.version, latestVersion: null, hasUpdate: false, message: "最新版確認URLが未設定です。" };
  }

  try {
    const response = await fetch(latestVersionUrl, {
      headers: {
        Accept: "application/vnd.github+json, application/json",
        "User-Agent": "Cotaska",
      },
    });
    if (!response.ok) {
      return { ok: false, currentVersion: pkg.version, error: `更新情報を取得できませんでした。HTTP ${response.status}` };
    }
    const data = await response.json();
    const latestVersion = normalizeVersion(data.tag_name || data.version || data.name || "");
    if (!latestVersion) {
      return { ok: false, currentVersion: pkg.version, error: "更新情報にバージョンが含まれていません。" };
    }
    const hasUpdate = compareVersions(latestVersion, pkg.version) > 0;
    return {
      ok: true,
      currentVersion: pkg.version,
      latestVersion,
      hasUpdate,
      downloadPageUrl: data.html_url || settings.update.downloadPageUrl,
      message: hasUpdate ? "新しいバージョンがあります。" : "現在のバージョンは最新です。",
    };
  } catch (err) {
    logger.warn("app:checkForUpdates failed", { error: err.message });
    return { ok: false, currentVersion: pkg.version, error: err.message || "更新確認に失敗しました。" };
  }
}

async function openDownloadPage(targetUrl = null) {
  const settings = settingsService.getSettings().settings;
  const url = String(targetUrl || settings.update?.downloadPageUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: "ダウンロードページURLが未設定です。" };
  }
  try {
    await shell.openExternal(url);
    return { ok: true, url };
  } catch (err) {
    return { ok: false, error: err.message || "ダウンロードページを開けませんでした。" };
  }
}

async function maybeShowCloudSyncWarning() {
  if (hasShownCloudSyncWarning || !app.isPackaged) {
    return;
  }

  const runtimeRoot = getRuntimeRootPath();
  const provider = detectCloudSyncProvider(runtimeRoot);
  if (!provider) {
    return;
  }

  hasShownCloudSyncWarning = true;
  appLogger.logWarning("Cloud sync path detected", {
    provider,
    runtimeRoot,
    exePath: process.execPath,
  });

  await dialog.showMessageBox({
    type: "warning",
    buttons: ["OK"],
    defaultId: 0,
    noLink: true,
    title: "Cotaska 利用上の注意",
    message: `${provider} 配下で実行されています。`,
    detail:
      "クラウド同期フォルダ上では Cotaska が起動失敗する場合があります。\n\n" +
      "推奨:\n" +
      "- Cotaska-Portable をローカル固定パスへ移動して起動してください\n" +
      "- どうしてもクラウド配下で使う場合は、対象フォルダをオフライン固定にしてください",
  });
}

function showLaunchFailedGuidance(details) {
  if (hasShownLaunchFailedGuidance) {
    return;
  }

  hasShownLaunchFailedGuidance = true;

  const runtimeRoot = getRuntimeRootPath();
  const provider = detectCloudSyncProvider(runtimeRoot) || "クラウド同期";
  const reason = details?.reason || "unknown";
  const exitCode = typeof details?.exitCode === "number" ? details.exitCode : "unknown";

  appLogger.logWarning("Launch-failed guidance shown", {
    runtimeRoot,
    provider,
    reason,
    exitCode,
  });

  dialog.showMessageBox({
    type: "error",
    buttons: ["OK"],
    defaultId: 0,
    noLink: true,
    title: "Cotaska 起動エラー",
    message: "画面の起動に失敗しました。",
    detail:
      `検出: reason=${reason}, exitCode=${exitCode}\n` +
      `実行フォルダ: ${runtimeRoot}\n\n` +
      `${provider} 配下での実行が原因の可能性があります。\n\n` +
      "対応方法:\n" +
      "1. Cotaska-Portable をローカル固定パスへコピーして起動\n" +
      "2. もしくはクラウド同期フォルダでオフライン固定を設定\n" +
      "3. logs/app-YYYY-MM-DD.log と launcher.log を確認",
  });
}

process.on("uncaughtException", (err) => {
  appLogger.logError("uncaughtException in main process", err);
});

process.on("unhandledRejection", (reason) => {
  const asError = reason instanceof Error ? reason : new Error(String(reason));
  appLogger.logError("unhandledRejection in main process", asError);
});

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  bringWindowToFront(mainWindow);
}

// --- CHG-035: 起動パス別のシングルインスタンスロック ---
// 異なるパス（開発環境 / リリース環境）からの同時起動を許可し、
// 同一パスからの二重起動のみブロックする。
// app.name を変更すると named pipe 名と userData パスが自動で分離される。
const appDir = path.resolve(__dirname, "../..");
const instanceHash = crypto.createHash("md5").update(appDir).digest("hex").slice(0, 8);
app.setName(`Cotaska-${instanceHash}`);
app.disableHardwareAcceleration();

function getAppUserModelId() {
  const isDevRuntime = !app.isPackaged || process.env.NODE_ENV === "development";
  const runtimeSuffix = isDevRuntime ? "dev" : "release";
  return `${APP_USER_MODEL_ID_BASE}.${runtimeSuffix}.${APP_USER_MODEL_ID_REVISION}.${instanceHash}`;
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  appLogger.logWarning("Single instance lock not acquired. Existing instance may already be running.", {
    appName: app.getName(),
    exePath: process.execPath,
  });
  logger.info("Single instance lock not acquired, quitting duplicate process");
  app.quit();
}

app.on("second-instance", () => {
  logger.info("second-instance detected, focusing existing window");
  focusMainWindow();
});

// サービス初期化 Promise（IPC ハンドラ内で await してサービスの準備完了を待つ）
let servicesReady = null;

// 開発時に起動する Vite 子プロセス
let viteProcess = null;

// Vite dev サーバーを子プロセスとして起動し、ready になるまで待つ
function startVite() {
  return new Promise((resolve) => {
    const npmCmd = process.platform === "win32" ? "npx.cmd" : "npx";
    viteProcess = spawn(npmCmd, ["vite"], {
      cwd: path.join(__dirname, "../.."),
      env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: "0" },
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32" ? true : false,
    });

    viteProcess.stdout.on("data", (data) => {
      const out = data.toString();
      process.stdout.write(`[vite] ${out}`);
      // "ready" または "Local:" が出たら起動完了
      if (out.includes("Local:") || out.includes("ready in")) {
        resolve();
      }
    });

    viteProcess.stderr.on("data", (data) => {
      process.stderr.write(`[vite] ${data}`);
    });

    viteProcess.on("error", (err) => {
      console.error("[vite] 起動失敗:", err.message);
      resolve(); // エラーでも先に進む
    });
  });
}

// ── IPC ハンドラ登録 ──────────────────────────────────────────
ipcMain.handle("ping", () => "pong");

ipcMain.handle("app:getInfo", () => getAppInfo());

ipcMain.handle("app:checkForUpdates", async () => checkForUpdates());

ipcMain.handle("app:openDownloadPage", async (_e, url) => openDownloadPage(url));

ipcMain.handle("updates:getStatus", async () => updaterState);

ipcMain.handle("updates:check", async () => checkAutoUpdate());

ipcMain.handle("updates:download", async () => downloadAutoUpdate());

ipcMain.handle("updates:install", async () => installAutoUpdate());

ipcMain.handle("settings:get", async () => settingsService.getSettings());

ipcMain.handle("settings:update", async (_e, patch) => {
  try {
    const result = settingsService.updateSettings(patch);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(result.settings.displayName || APP_DISPLAY_NAME);
    }
    return result;
  } catch (err) {
    logger.error("settings:update failed", err);
    return { ok: false, error: err.message || "設定保存に失敗しました。" };
  }
});

ipcMain.handle("settings:chooseExternalEditor", async () => {
  const result = await dialog.showOpenDialog({
    title: "外部エディタを選択",
    properties: ["openFile"],
    filters: process.platform === "win32"
      ? [{ name: "実行ファイル", extensions: ["exe", "cmd", "bat"] }, { name: "すべてのファイル", extensions: ["*"] }]
      : [{ name: "すべてのファイル", extensions: ["*"] }],
  });
  if (result.canceled || !result.filePaths?.[0]) {
    return { ok: false, canceled: true };
  }
  return { ok: true, path: result.filePaths[0] };
});

ipcMain.handle("backup:chooseDirectory", async () => {
  const result = await dialog.showOpenDialog({
    title: "バックアップ保存先を選択",
    defaultPath: getDefaultBackupDir(),
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths?.[0]) {
    return { ok: false, canceled: true };
  }
  return { ok: true, path: result.filePaths[0] };
});

ipcMain.handle("backup:chooseRestoreDirectory", async () => {
  const result = await dialog.showOpenDialog({
    title: "復元元バックアップzipを選択",
    defaultPath: getDefaultBackupDir(),
    properties: ["openFile"],
    filters: [
      { name: "Cotaskaバックアップ", extensions: ["zip"] },
      { name: "すべてのファイル", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePaths?.[0]) {
    return { ok: false, canceled: true };
  }
  return { ok: true, path: result.filePaths[0] };
});

ipcMain.handle("backup:create", async (_e, targetDir) => {
  try {
    return backupService.createBackup(targetDir);
  } catch (err) {
    logger.error("backup:create failed", err);
    return { ok: false, error: err.message || "バックアップ作成に失敗しました。" };
  }
});

ipcMain.handle("backup:restore", async (_e, sourceDir) => {
  try {
    return await backupService.restoreBackup(sourceDir);
  } catch (err) {
    logger.error("backup:restore failed", err);
    return { ok: false, error: err.message || "バックアップ復元に失敗しました。" };
  }
});

ipcMain.handle("tasks:getAll", async () => {
  await servicesReady;
  logger.debug("IPC: tasks:getAll called");
  try {
    const rows = taskService.getAllTasks();
    logger.info("tasks:getAll success", { count: rows.length });
    return rows;
  } catch (err) {
    logger.error("tasks:getAll failed", err);
    return [];
  }
});

ipcMain.handle("tasks:add", async (_e, task) => {
  await servicesReady;
  logger.info("IPC: tasks:add", { title: task.title, list: task.list, parent: task.parent, due_date: task.due_date });
  try {
    const result = taskService.addTask(task);
    logger.debug("Task add success", { id: result.id });
    return result;
  } catch (err) {
    logger.error("tasks:add failed", err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("tasks:update", async (_e, updates) => {
  await servicesReady;
  logger.debug("IPC: tasks:update", { id: updates.id });
  try {
    const result = taskService.updateTask(updates.id, updates);
    logger.debug("Task update success", { id: updates.id });
    return result;
  } catch (err) {
    logger.error("tasks:update failed", err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("tasks:reorder", async (_e, payload) => {
  await servicesReady;
  logger.debug("IPC: tasks:reorder", {
    orderedCount: Array.isArray(payload?.ordered_ids) ? payload.ordered_ids.length : 0,
    updatedFieldCount: payload?.field_updates ? Object.keys(payload.field_updates).length : 0,
  });
  try {
    const result = taskService.reorderTasks(payload);
    logger.info("tasks:reorder success", { updatedCount: result.updated_count });
    return result;
  } catch (err) {
    logger.error("tasks:reorder failed", err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("tasks:updateContent", async (_e, id, content) => {
  await servicesReady;
  logger.debug("IPC: tasks:updateContent", { id });
  try {
    const result = taskService.updateTaskContent(id, content);
    logger.debug("Task content update success", { id });
    return result;
  } catch (err) {
    logger.error("tasks:updateContent failed", err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("tasks:completeTask", async (_e, id) => {
  await servicesReady;
  logger.debug("IPC: tasks:completeTask", { id });
  try {
    const result = taskService.completeTask(id);
    logger.info("task completed", { id });
    return result;
  } catch (err) {
    logger.error("tasks:completeTask failed", err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("tasks:reopenTask", async (_e, id) => {
  await servicesReady;
  logger.debug("IPC: tasks:reopenTask", { id });
  try {
    const result = taskService.reopenTask(id);
    logger.info("task reopened", { id });
    return result;
  } catch (err) {
    logger.error("tasks:reopenTask failed", err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("tasks:trashTask", async (_e, id) => {
  await servicesReady;
  logger.debug("IPC: tasks:trashTask", { id });
  try {
    const result = taskService.trashTask(id);
    logger.info("task trashed", { id });
    return result;
  } catch (err) {
    logger.error("tasks:trashTask failed", err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("tasks:restoreTask", async (_e, id) => {
  await servicesReady;
  logger.debug("IPC: tasks:restoreTask", { id });
  try {
    const result = taskService.restoreTask(id);
    logger.info("task restored", { id });
    return result;
  } catch (err) {
    logger.error("tasks:restoreTask failed", err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("tasks:deleteTask", async (_e, id) => {
  await servicesReady;
  logger.debug("IPC: tasks:deleteTask", { id });
  try {
    const result = taskService.deleteTask(id);
    logger.info("task deleted", { id });
    return result;
  } catch (err) {
    logger.error("tasks:deleteTask failed", err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("tasks:duplicateTask", async (_e, id) => {
  await servicesReady;
  logger.debug("IPC: tasks:duplicateTask", { id });
  try {
    const result = taskService.duplicateTask(id);
    logger.info("task duplicated", { id, newId: result.id });
    return result;
  } catch (err) {
    logger.error("tasks:duplicateTask failed", err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("tasks:getTrashed", async () => {
  await servicesReady;
  logger.debug("IPC: tasks:getTrashed called");
  try {
    const rows = taskService.getTrashedTasks();
    logger.info("getTrashed success", { count: rows.length });
    return rows;
  } catch (err) {
    logger.error("tasks:getTrashed failed", err);
    return [];
  }
});

ipcMain.handle("tasks:getCompleted", async () => {
  await servicesReady;
  logger.debug("IPC: tasks:getCompleted called");
  try {
    const rows = taskService.getCompletedTasks();
    logger.info("getCompleted success", { count: rows.length });
    return rows;
  } catch (err) {
    logger.error("tasks:getCompleted failed", err);
    return [];
  }
});

ipcMain.handle("lists:getAll", async () => {
  await servicesReady;
  logger.debug("IPC: lists:getAll called");
  try {
    const rows = listService.getAllLists();
    logger.info("lists:getAll success", { count: rows.length });
    return rows;
  } catch (err) {
    logger.error("lists:getAll failed", err);
    return [];
  }
});

ipcMain.handle("lists:add", async (_e, list) => {
  await servicesReady;
  logger.info("IPC: lists:add", { name: list.name });
  try {
    const result = listService.addList(list);
    logger.debug("list added", { name: result.name });
    return result;
  } catch (err) {
    logger.error("lists:add failed", err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("lists:update", async (_e, listName, updates) => {
  await servicesReady;
  logger.debug("IPC: lists:update", { name: listName });
  try {
    const result = listService.updateList(listName, updates);
    logger.info("list updated", { name: listName });
    return result;
  } catch (err) {
    logger.error("lists:update failed", err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("lists:delete", async (_e, listName) => {
  await servicesReady;
  logger.debug("IPC: lists:delete", { name: listName });
  try {
    const result = listService.deleteList(listName);
    logger.info("list deleted", { name: listName });
    return result;
  } catch (err) {
    logger.error("lists:delete failed", err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("tags:getAll", async () => {
  await servicesReady;
  logger.debug("IPC: tags:getAll called");
  try {
    const tags = listService.getAllTags();
    logger.info("tags:getAll success", { count: tags.length });
    return tags;
  } catch (err) {
    logger.error("tags:getAll failed", err);
    return [];
  }
});

ipcMain.handle("tags:add", async (_e, tagName) => {
  await servicesReady;
  logger.debug("IPC: tags:add", { name: tagName });
  try {
    const result = listService.addTag(tagName);
    logger.info("tag added", { name: result.name });
    return result;
  } catch (err) {
    logger.error("tags:add failed", err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("tags:delete", async (_e, tagName) => {
  await servicesReady;
  logger.debug("IPC: tags:delete", { name: tagName });
  try {
    const result = listService.removeTag(tagName);
    logger.info("tag deleted", { name: tagName });
    return result;
  } catch (err) {
    logger.error("tags:delete failed", err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("taskTags:set", async (_e, taskId, tags) => {
  await servicesReady;
  logger.debug("IPC: taskTags:set", { taskId, tagCount: Array.isArray(tags) ? tags.length : 0 });
  try {
    const result = taskService.updateTaskTags(taskId, tags);
    logger.info("task tags updated", { taskId, tagCount: result.tags.length });
    return result;
  } catch (err) {
    logger.error("taskTags:set failed", err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("shell:openPath", async (_e, targetPath) => {
  await servicesReady;
  const rawPath = String(targetPath || "").trim();
  if (!rawPath) {
    return { ok: false, error: "ファイルパスが未指定です。" };
  }

  const normalizedPath = path.normalize(rawPath);
  if (!fs.existsSync(normalizedPath)) {
    logger.warn("shell:openPath target not found", { path: normalizedPath });
    return { ok: false, error: "対象ファイルが見つかりません。" };
  }

  try {
    const openResult = await shell.openPath(normalizedPath);
    if (openResult) {
      logger.error("shell:openPath failed", { path: normalizedPath, detail: openResult });
      return { ok: false, error: `既定アプリで開けませんでした: ${openResult}` };
    }

    logger.info("shell:openPath success", { path: normalizedPath });
    return { ok: true };
  } catch (err) {
    logger.error("shell:openPath exception", err);
    return { ok: false, error: err.message || "既定アプリ起動に失敗しました。" };
  }
});

async function openShellTarget(target, baseDir) {
  const rawTarget = String(target || "").trim();
  const rawBaseDir = String(baseDir || "").trim();
  if (!rawTarget) {
    return { ok: false, error: "リンク先が未指定です。" };
  }

  // URL は既定ブラウザで開く
  if (/^https?:\/\//i.test(rawTarget)) {
    try {
      const result = await shell.openExternal(rawTarget);
      if (!result) {
        logger.info("shell:openTarget url success", { target: rawTarget });
        return { ok: true, targetType: "url", opened: rawTarget };
      }
      logger.error("shell:openTarget url failed", { target: rawTarget, detail: result });
      return { ok: false, error: `既定ブラウザで開けませんでした: ${result}` };
    } catch (err) {
      logger.error("shell:openTarget url exception", err);
      return { ok: false, error: err.message || "既定ブラウザ起動に失敗しました。" };
    }
  }

  // file:// はローカルパスへ変換
  let candidatePath = rawTarget;
  if (/^file:\/\//i.test(rawTarget)) {
    try {
      candidatePath = decodeURIComponent(new URL(rawTarget).pathname);
      if (/^\/[a-zA-Z]:/.test(candidatePath)) {
        candidatePath = candidatePath.slice(1);
      }
    } catch {
      return { ok: false, error: "file URL の解析に失敗しました。" };
    }
  } else if (/%[0-9a-fA-F]{2}/.test(candidatePath)) {
    // MarkdownIt がローカルパスを % エンコードするため復元する
    try {
      candidatePath = decodeURIComponent(candidatePath);
    } catch {
      // decode 失敗時は元文字列のまま評価する
    }
  }

  if (!path.isAbsolute(candidatePath)) {
    const base = rawBaseDir && fs.existsSync(rawBaseDir) ? rawBaseDir : process.cwd();
    candidatePath = path.resolve(base, candidatePath);
  }

  const normalizedPath = path.normalize(candidatePath);
  if (!fs.existsSync(normalizedPath)) {
    logger.warn("shell:openTarget target not found", { path: normalizedPath, baseDir: rawBaseDir || null });
    return { ok: false, error: "対象のファイルまたはフォルダが見つかりません。" };
  }

  try {
    const stat = fs.statSync(normalizedPath);
    const targetType = stat.isDirectory() ? "folder" : "file";
    const openResult = await shell.openPath(normalizedPath);
    if (openResult) {
      logger.error("shell:openTarget path failed", { path: normalizedPath, detail: openResult });
      return { ok: false, error: `既定アプリで開けませんでした: ${openResult}` };
    }

    logger.info("shell:openTarget path success", { path: normalizedPath, targetType });
    return { ok: true, targetType, opened: normalizedPath };
  } catch (err) {
    logger.error("shell:openTarget path exception", err);
    return { ok: false, error: err.message || "リンク先の起動に失敗しました。" };
  }
}

ipcMain.handle("shell:openTaskFile", async (_e, taskId) => {
  await servicesReady;

  try {
    const filePath = taskService.getTaskFilePath(taskId);
    if (!fs.existsSync(filePath)) {
      logger.warn("shell:openTaskFile target not found", { taskId, path: filePath });
      return { ok: false, error: "対象ファイルが見つかりません。" };
    }

    const settings = settingsService.getSettings().settings;
    const editorPath = String(settings.externalEditorPath || "").trim();
    if (editorPath) {
      if (!fs.existsSync(editorPath)) {
        logger.warn("shell:openTaskFile external editor not found", { taskId, editorPath });
        return { ok: false, error: "外部エディタが見つかりません。設定画面でパスを確認してください。" };
      }

      const child = spawn(editorPath, [filePath], {
        detached: true,
        stdio: "ignore",
        shell: false,
      });
      child.unref();
      logger.info("shell:openTaskFile external editor success", { taskId, editorPath });
      return { ok: true };
    }

    const openResult = await shell.openPath(filePath);
    if (openResult) {
      logger.error("shell:openTaskFile failed", { taskId, path: filePath, detail: openResult });
      return { ok: false, error: `既定アプリで開けませんでした: ${openResult}` };
    }

    logger.info("shell:openTaskFile success", { taskId });
    return { ok: true };
  } catch (err) {
    logger.error("shell:openTaskFile failed", err);
    return { ok: false, error: err.message || "タスクファイルを開けませんでした。" };
  }
});

ipcMain.handle("shell:openTarget", async (_e, target, baseDir) => {
  await servicesReady;
  return openShellTarget(target, baseDir);
});

ipcMain.handle("shell:openTaskTarget", async (_e, taskId, target) => {
  await servicesReady;

  try {
    const baseDir = taskService.getTaskBaseDir(taskId);
    return openShellTarget(target, baseDir);
  } catch (err) {
    logger.error("shell:openTaskTarget failed", err);
    return { ok: false, error: err.message || "リンク先の起動に失敗しました。" };
  }
});
// ──────────────────────────────────────────────────────────────
// Windows フォアグラウンドロック回避：setAlwaysOnTop を一時的に使って
// 別プロセスから起動された場合でも確実にウィンドウを前面に持ってくる
function bringWindowToFront(win) {
  if (!win || win.isDestroyed()) return;

  win.setAlwaysOnTop(true);
  win.show();
  win.focus();

  appLogger.logWarning("Window brought to front", {
    isVisible: win.isVisible(),
    bounds: win.getBounds(),
  });

  setTimeout(() => {
    if (win && !win.isDestroyed()) {
      win.setAlwaysOnTop(false);
      appLogger.logWarning("Window after settle", {
        isVisible: win.isVisible(),
        isFocused: win.isFocused(),
        bounds: win.getBounds(),
      });
    }
  }, 500);
}

// ──────────────────────────────────────────────────────────────
// データディレクトリ初期化関数（T-048-02）
// ──────────────────────────────────────────────────────────────

async function ensureDataDirectories() {
  const dataDir = path.join(process.cwd(), '../data');
  const tasksDir = path.join(dataDir, 'tasks');
  const archiveDir = path.join(dataDir, 'archive');
  const logsDir = path.join(process.cwd(), '../logs');

  // ディレクトリ存在確認・作成
  [dataDir, tasksDir, archiveDir, logsDir].forEach(dir => {
    if (!require('fs').existsSync(dir)) {
      logger.debug(`Creating directory: ${dir}`);
      require('fs').mkdirSync(dir, { recursive: true });
    }
  });

  // デフォルト lists.yaml 作成（存在しない場合）
  const listsPath = path.join(dataDir, 'lists.yaml');
  if (!require('fs').existsSync(listsPath)) {
    const defaultLists = { lists: [], tags: [] };
    const yaml = require('js-yaml');
    const listsContent = yaml.dump(defaultLists, { indent: 2 });
    logger.debug(`Creating default lists.yaml at ${listsPath}`);
    require('fs').writeFileSync(listsPath, listsContent, 'utf8');
    appLogger.logInfo('Default lists.yaml created');
  }

  // デフォルト _index.yaml 作成（存在しない場合）
  const indexPath = path.join(tasksDir, '_index.yaml');
  if (!require('fs').existsSync(indexPath)) {
    const defaultIndex = { tasks: [], next_task_id: 1 };
    const yaml = require('js-yaml');
    const indexContent = yaml.dump(defaultIndex, { indent: 2 });
    logger.debug(`Creating default _index.yaml at ${indexPath}`);
    require('fs').writeFileSync(indexPath, indexContent, 'utf8');
    appLogger.logInfo('Default _index.yaml created');
  }

  logger.info('Data directories ensured', {
    dataDir,
    tasksDir,
    archiveDir,
    logsDir,
  });
}

// ──────────────────────────────────────────────────────────────

function createWindow() {
  appLogger.logWarning("createWindow invoked", {
    nodeEnv: process.env.NODE_ENV,
    execPath: process.execPath,
  });

  Menu.setApplicationMenu(null);

  const windowIconPath = app.isPackaged
    ? path.join(process.resourcesPath, "icon.ico")
    : path.join(__dirname, "../../setup/launcher/icon.ico");

  const win = new BrowserWindow({
    title: settingsService.getSettings().settings.displayName || APP_DISPLAY_NAME,
    show: true,
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#1c1c1c",
    icon: windowIconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  let didShowWindow = false;
  win.setTitle(settingsService.getSettings().settings.displayName || APP_DISPLAY_NAME);

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    appLogger.logError(
      `Renderer load failed: code=${errorCode}, desc=${errorDescription}, url=${validatedURL || "(empty)"}`
    );
  });

  win.webContents.on("did-finish-load", () => {
    appLogger.logWarning("Renderer did-finish-load", {
      url: win.webContents.getURL(),
    });
  });

  win.webContents.on("render-process-gone", (_event, details) => {
    appLogger.logError(`Renderer process gone: reason=${details.reason}, exitCode=${details.exitCode}`);
    if (details?.reason === "launch-failed") {
      showLaunchFailedGuidance(details);
    }
  });

  win.webContents.on("zoom-changed", (event, zoomDirection) => {
    event.preventDefault();
    win.webContents.setZoomFactor(1);
    win.webContents.send("detail-content-font:adjust", zoomDirection === "in" ? 1 : -1);
  });

  // 開発時は Vite dev server、ビルド後は dist/renderer/index.html を読み込む
  if (process.env.NODE_ENV === "development") {
    const port = process.env.VITE_PORT || "5173";
    win.loadURL(`http://localhost:${port}`);
    if (process.env.COTASKA_NO_DEVTOOLS !== "1") {
      win.webContents.openDevTools();
    }
  } else {
    const rendererPath = path.join(__dirname, "../../dist/renderer/index.html");
    if (!require("fs").existsSync(rendererPath)) {
      const msg = `Renderer entry not found: ${rendererPath}`;
      appLogger.logError(msg);
      dialog.showErrorBox("Cotaska 起動エラー", msg);
    }
    win.loadFile(rendererPath);
  }

  win.once("ready-to-show", () => {
    // show: true で先に表示済みのため、ready-to-show ではフォーカスのみ行う
    // setAlwaysOnTop で Windows フォアグラウンドロックを回避
    didShowWindow = true;
    appLogger.logWarning("Window ready-to-show", {
      url: win.webContents.getURL(),
    });
    bringWindowToFront(win);
  });

  // Developer Tools を開くショートカット（Ctrl+Shift+I / F12）を登録
  win.webContents.on("before-input-event", (event, input) => {
    const key = String(input.key || "").toLowerCase();
    const code = String(input.code || "");
    const isCtrlShiftI = input.control && input.shift && key === "i";
    const isF12 = key === "f12";
    const isDetailFontIncrease =
      input.control && !input.alt && !input.meta &&
      (input.key === "+" ||
        input.key === "=" ||
        key === "+" ||
        key === "=" ||
        key === "add" ||
        key === "plus" ||
        key === "numadd" ||
        key === "num+" ||
        code === "Equal" ||
        code === "Semicolon" ||
        code === "NumpadAdd");
    const isDetailFontDecrease =
      input.control && !input.alt && !input.meta &&
      (input.key === "-" ||
        input.key === "_" ||
        key === "-" ||
        key === "_" ||
        key === "subtract" ||
        key === "minus" ||
        key === "numsubtract" ||
        key === "num-" ||
        code === "Minus" ||
        code === "NumpadSubtract");

    if (isCtrlShiftI || isF12) {
      if (win.webContents.isDevToolsOpened()) {
        win.webContents.closeDevTools();
      } else {
        win.webContents.openDevTools();
      }
      event.preventDefault();
      return;
    }

    if (isDetailFontIncrease || isDetailFontDecrease) {
      win.webContents.send("detail-content-font:adjust", isDetailFontIncrease ? 1 : -1);
      event.preventDefault();
    }
  });

  win.on("closed", () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  return win;
}

async function initializeServicesAfterWindowReady() {
  await new Promise((resolve) => setImmediate(resolve));
  logger.info("Initializing task/list services...");
  const svcStartTime = Date.now();

  await taskService.openTaskService();
  await listService.openListService();

  const svcDuration = Date.now() - svcStartTime;
  logger.info("Services initialized");
  appLogger.logServiceInitialization({
    taskCount: Object.keys(taskService.getCache()).length,
    listCount: listService.getAllLists().length,
    duration: svcDuration,
  });

  reminderService.start(
    () => taskService.getAllTasks(),
    () => settingsService.getSettings().settings,
  );

  if (mainWindow && !mainWindow.isDestroyed()) {
    watcher.startWatcher(mainWindow).catch(err => {
      logger.error("Failed to start watcher:", err);
    });
  }
}

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) {
    return;
  }

  app.setName(APP_DISPLAY_NAME);
  const appUserModelId = getAppUserModelId();
  app.setAppUserModelId(appUserModelId);
  logger.info("AppUserModelID configured", { appUserModelId, appName: app.getName(), instanceHash });
  appLogger.logInfo("AppUserModelID configured", { appUserModelId, appName: app.getName(), instanceHash });

  const pkg = require("../../package.json");
  appLogger.logStartup({
    version: pkg.version,
    electronVersion: process.versions.electron,
  });
  setupAutoUpdater();

  logger.info("App startup initiated", {
    nodeVersion: process.versions.node,
    electronVersion: process.versions.electron,
    platform: process.platform,
  });

  // データディレクトリの初期化（T-048-02）
  logger.info("Ensuring data directories...");
  await ensureDataDirectories();
  appLogger.logInfo("Data directories ensured");

  // 恒久対策: クラウド同期配下実行の検知と事前警告
  await maybeShowCloudSyncWarning();

  // 開発時は Vite を子プロセスで起動してから BrowserWindow を開く
  if (process.env.NODE_ENV === "development") {
    logger.info("Starting Vite dev server...");
    appLogger.logViteServerStart(5173);
    await startVite();
    logger.info("Vite dev server started");
  }

  // サービスを初期化
  servicesReady = initializeServicesAfterWindowReady().catch((err) => {
    logger.error("Services initialization failed", err);
    appLogger.logError("Services initialization failed", err);
    throw err;
  });
  mainWindow = createWindow();
  logger.info("Main window created");

  // 起動後の簡易自己診断: ウィンドウ状態と読み込みURLを遅延評価して記録する
  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      appLogger.logWarning("Startup self-check: mainWindow is not available");
      return;
    }
    appLogger.logWarning("Startup self-check", {
      isVisible: mainWindow.isVisible(),
      isFocused: mainWindow.isFocused(),
      isMinimized: mainWindow.isMinimized(),
      bounds: mainWindow.getBounds(),
      url: mainWindow.webContents.getURL(),
    });
  }, 8000);
});

app.on("window-all-closed", () => {
  logger.info("App closing...");
  appLogger.logShutdown();
  
  // ウォッチャーを停止
  watcher.stopWatcher().catch(err => {
    logger.error("Failed to stop watcher:", err);
  });

  reminderService.stop();
  
  // Vite 子プロセスを終了してから app を終了する
  if (viteProcess) {
    viteProcess.kill();
    viteProcess = null;
  }
  logger.destroy();
  appLogger.destroy();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createWindow();
  } else {
    focusMainWindow();
  }
});
