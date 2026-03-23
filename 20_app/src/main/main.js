const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const taskService = require("./taskService");
const listService = require("./listService");
const watcher = require("./watcher");
const logger     = require("./logger");
const appLogger  = require("./appLogger");

let mainWindow = null;

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
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
// ──────────────────────────────────────────────────────────────

function createWindow() {
  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // 開発時は Vite dev server、ビルド後は dist/renderer/index.html を読み込む
  if (process.env.NODE_ENV === "development") {
    const port = process.env.VITE_PORT || "5173";
    win.loadURL(`http://localhost:${port}`);
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, "../../dist/renderer/index.html"));
  }

  win.once("ready-to-show", () => {
    win.show();
    win.focus();
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

  mainWindow = createWindow();
  logger.info("Main window created");
});

app.on("window-all-closed", () => {
  logger.info("App closing...");
  appLogger.logShutdown();
  
  // ウォッチャーを停止
  watcher.stopWatcher().catch(err => {
    logger.error("Failed to stop watcher:", err);
  });
  
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
