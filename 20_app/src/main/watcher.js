/**
 * watcher.js
 * 30_data/tasks/ のファイル変更を監視
 * キャッシュを更新 → インデックス再構築 → レンダラーに通知
 */

const path = require('path');
const chokidar = require('chokidar');
const taskService = require('./taskService');
const indexService = require('./indexService');

let watcher = null;
let mainWindow = null;

/**
 * ファイルウォッチャー起動
 */
async function startWatcher(win) {
  if (watcher) {
    console.log('[Watcher] Already started');
    return;
  }

  mainWindow = win;

  try {
    const searchRoots = taskService.getTaskSearchRoots();

    // chokidar でタスクディレクトリを監視
    watcher = chokidar.watch(searchRoots, {
      ignored: (filePath) => {
        const base = path.basename(filePath);
        return base === '_index.yaml' || base.startsWith('.');
      },
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100
      }
    });

    // ファイル追加
    watcher.on('add', (filePath) => {
      console.log(`[Watcher] File added: ${filePath}`);
      if (path.basename(filePath) !== '_index.yaml') {
        handleFileChange('add', filePath);
      }
    });

    // ファイル変更
    watcher.on('change', (filePath) => {
      console.log(`[Watcher] File changed: ${filePath}`);
      if (path.basename(filePath) !== '_index.yaml') {
        handleFileChange('change', filePath);
      }
    });

    // ファイル削除
    watcher.on('unlink', (filePath) => {
      console.log(`[Watcher] File deleted: ${filePath}`);
      handleFileChange('unlink', filePath);
    });

    watcher.on('error', (error) => {
      console.error('[Watcher] Error:', error);
    });

    console.log('[Watcher] Started monitoring roots:', searchRoots.join(', '));
    return { success: true };
  } catch (error) {
    console.error('[Watcher] Error starting:', error);
    return { success: false, error: error.message };
  }
}

/**
 * ファイル変更ハンドラ
 * 流れ: ファイル検出 → キャッシュ更新 → インデックス再構築 → レンダラーに通知
 */
async function handleFileChange(action, filePath) {
  try {
    // ステップ 1: キャッシュ再構築
    const rebuildResult = taskService.rebuildCache();
    if (!rebuildResult.success) {
      console.error('[Watcher] Failed to rebuild cache:', rebuildResult.error);
      return;
    }

    // ステップ 2: インデックス再構築
    const cache = taskService.getCache();
    const indexResult = indexService.rebuildIndex(cache, taskService.getTaskFileRoots());
    if (!indexResult.success) {
      console.error('[Watcher] Failed to rebuild index:', indexResult.error);
      return;
    }

    // ステップ 3: レンダラーに tasks:changed イベントを送信
    if (mainWindow && !mainWindow.isDestroyed()) {
      const allTasks = taskService.getAllTasks();
      mainWindow.webContents.send('tasks:changed', {
        action,
        filePath,
        tasks: allTasks,
        timestamp: new Date().toISOString()
      });

      console.log('[Watcher] Notified renderer about tasks change');
    }

    // ステップ 4: キャッシュの最新状態をログ
    console.log(`[Watcher] Processed ${action} - Cache now has ${Object.keys(cache).length} tasks`);
  } catch (error) {
    console.error('[Watcher] Error handling file change:', error);
  }
}

/**
 * ウォッチャー停止
 */
async function stopWatcher() {
  if (watcher) {
    await watcher.close();
    watcher = null;
    console.log('[Watcher] Stopped');
  }
}

module.exports = {
  startWatcher,
  stopWatcher
};
