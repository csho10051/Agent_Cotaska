const { app, BrowserWindow, ipcMain, Menu, dialog, globalShortcut, shell } = require("electron");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const fs = require("fs");
const taskService = require("./taskService");
const listService = require("./listService");
const watcher = require("./watcher");
const reminderService = require("./reminderService");
const logger     = require("./logger");
const appLogger  = require("./appLogger");

let mainWindow = null;
let hasShownCloudSyncWarning = false;
let hasShownLaunchFailedGuidance = false;

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
      "- Cotaska-0.1.0-dist をローカル固定パスへ移動して起動してください\n" +
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
      "1. Cotaska-0.1.0-dist をローカル固定パスへコピーして起動\n" +
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
app.name = `Cotaska-${instanceHash}`;
app.disableHardwareAcceleration();

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

ipcMain.handle("shell:openTarget", async (_e, target, baseDir) => {
  await servicesReady;

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

  // 開発時は Vite dev server、ビルド後は dist/renderer/index.html を読み込む
  if (process.env.NODE_ENV === "development") {
    const port = process.env.VITE_PORT || "5173";
    win.loadURL(`http://localhost:${port}`);
    win.webContents.openDevTools();
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
    const isCtrlShiftI = input.control && input.shift && key === "i";
    const isF12 = key === "f12";

    if (isCtrlShiftI || isF12) {
      if (win.webContents.isDevToolsOpened()) {
        win.webContents.closeDevTools();
      } else {
        win.webContents.openDevTools();
      }
      event.preventDefault();
    }
  });

  win.on("closed", () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  // ウォッチャーを起動（ファイル変更検出 → tasks:changed 通知）
  watcher.startWatcher(win).catch(err => {
    logger.error("Failed to start watcher:", err);
  });

  return win;
}

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) {
    return;
  }

  app.setName("Cotaska");
  const baseAppUserModelId = "com.cotaska.app";
  const isDevRuntime = !app.isPackaged || process.env.NODE_ENV === "development";
  const appUserModelId = isDevRuntime ? `${baseAppUserModelId}.dev` : baseAppUserModelId;
  app.setAppUserModelId(appUserModelId);
  logger.info("AppUserModelID configured", { appUserModelId, isDevRuntime });

  const pkg = require("../../package.json");
  appLogger.logStartup({
    version: pkg.version,
    electronVersion: process.versions.electron,
  });

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
  logger.info("Initializing task/list services...");
  const svcStartTime = Date.now();
  servicesReady = (async () => {
    await taskService.openTaskService();
    await listService.openListService();
  })();
  await servicesReady;
  const svcDuration = Date.now() - svcStartTime;
  logger.info("Services initialized");
  appLogger.logServiceInitialization({
    taskCount: Object.keys(taskService.getCache()).length,
    listCount: listService.getAllLists().length,
    duration: svcDuration,
  });

  // T-0065: due_date に時刻がある未完了タスクを5分前に通知
  reminderService.start(() => taskService.getAllTasks());

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
