/**
 * indexService.js
 * _index.yaml 自動生成（タスクキャッシュから）
 */

const fs = require('fs');
const path = require('path');
const YAML = require('js-yaml');

const INDEX_PATH = path.join(__dirname, '../../..', '30_data/tasks/_index.yaml');

function normalizeRelativePath(relPath) {
  return String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .trim();
}

function deriveRootsFromTasks(taskList) {
  const roots = taskList
    .map((task) => {
      const relPath = normalizeRelativePath(task.task_file_path);
      const dir = path.posix.dirname(relPath || '.');
      return dir && dir !== '/' ? dir : '.';
    })
    .filter(Boolean);
  return Array.from(new Set(['.', ...roots])).sort();
}

/**
 * キャッシュからインデックスを再構築して _index.yaml に書き込み
 */
function rebuildIndex(taskCache, taskFileRoots = ['.']) {
  try {
    // キャッシュからタスク一覧を生成（delete_flag = 0 のみ）
    const taskList = Object.values(taskCache)
      .filter(t => t.delete_flag === 0)
      .map(t => ({
        id: t.id,
        title: t.title,
        list: t.list,
        status: t.status,
        priority: t.priority,
        progress: t.progress,
        sort_order: t.sort_order,
        tags: t.tags || [],
        due_date: t.due_date,
        task_file_path: normalizeRelativePath(t.task_file_path),
        updated_at: t.updated_at
      }))
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    const normalizedRoots = Array.isArray(taskFileRoots) && taskFileRoots.length
      ? Array.from(new Set(taskFileRoots.map((root) => normalizeRelativePath(root || '.')).filter(Boolean))).sort()
      : deriveRootsFromTasks(taskList);

    // インデックスデータ作成
    const indexData = {
      tasks: taskList,
      task_file_roots: normalizedRoots,
      next_task_id: Math.max(...Object.values(taskCache).map(t => {
        const match = t.id.match(/T-(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      }), 0) + 1,
      last_updated: new Date().toISOString()
    };

    // _index.yaml に書き込み
    const yaml = YAML.dump(indexData, { lineWidth: -1 });
    fs.writeFileSync(INDEX_PATH, yaml, 'utf-8');

    console.log(`[IndexService] Rebuilt index: ${taskList.length} tasks`);
    return { success: true, taskCount: taskList.length, last_updated: indexData.last_updated };
  } catch (error) {
    console.error('[IndexService] Error rebuilding index:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  rebuildIndex
};
