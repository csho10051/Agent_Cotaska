/**
 * taskService.js
 * タスクファイルのCRUD操作とメモリキャッシュ管理
 * gray-matter で frontmatter と本文を分離・結合
 */

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const YAML = require('js-yaml');

const TASKS_DIR = path.join(process.cwd(), '../data/tasks');
const INDEX_PATH = path.join(TASKS_DIR, '_index.yaml');
const ARCHIVE_DIR = path.join(process.cwd(), '../data/archive');
const DEFAULT_TASK_FILE_ROOTS = ['.'];

let taskCache = {};  // メモリキャッシュ
let nextTaskId = 1;
let taskFileRoots = [...DEFAULT_TASK_FILE_ROOTS];

function normalizeRelativePath(relPath) {
  return String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .trim();
}

function normalizeTaskFilePath(filePath) {
  return String(filePath || '')
    .replace(/\\/g, '/')
    .trim();
}

function toIndexAbsolutePath(absPath) {
  return path.resolve(absPath).replace(/\\/g, '/');
}

function normalizeRootPath(rootPath) {
  const normalized = normalizeTaskFilePath(rootPath);
  if (!normalized) return '.';

  if (path.isAbsolute(normalized)) {
    const relativeFromTasks = normalizeRelativePath(path.relative(TASKS_DIR, normalized));
    if (!relativeFromTasks || relativeFromTasks.startsWith('..')) return '.';
    return relativeFromTasks;
  }

  return normalizeRelativePath(normalized) || '.';
}

function toIndexRelativePath(absPath) {
  return path.relative(TASKS_DIR, absPath).replace(/\\/g, '/');
}

function resolveTaskFilePath(taskFilePath, fallbackTaskId = null) {
  const normalized = normalizeTaskFilePath(taskFilePath);
  if (normalized) {
    if (path.isAbsolute(normalized)) return path.normalize(normalized);
    return path.join(TASKS_DIR, normalizeRelativePath(normalized));
  }
  if (fallbackTaskId) return path.join(TASKS_DIR, `${fallbackTaskId}.md`);
  throw new Error('task_file_path or fallbackTaskId is required');
}

function ensureParentDir(filePath) {
  const parentDir = path.dirname(filePath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }
}

function readIndexData() {
  if (!fs.existsSync(INDEX_PATH)) {
    return { next_task_id: 1, task_file_roots: [...DEFAULT_TASK_FILE_ROOTS] };
  }

  try {
    const indexContent = fs.readFileSync(INDEX_PATH, 'utf-8');
    const indexData = YAML.load(indexContent) || {};
    return {
      next_task_id: indexData.next_task_id || 1,
      task_file_roots: Array.isArray(indexData.task_file_roots) && indexData.task_file_roots.length
        ? Array.from(new Set(indexData.task_file_roots.map((root) => normalizeRootPath(root || '.')).filter(Boolean)))
        : [...DEFAULT_TASK_FILE_ROOTS]
    };
  } catch (error) {
    console.warn('[TaskService] Failed to parse _index.yaml, fallback to default roots:', error.message);
    return { next_task_id: 1, task_file_roots: [...DEFAULT_TASK_FILE_ROOTS] };
  }
}

function collectTaskFilesFromRoots(roots) {
  const files = [];
  const visited = new Set();

  const walk = (dirPath) => {
    if (!fs.existsSync(dirPath)) return;
    const resolvedDir = path.resolve(dirPath);
    if (visited.has(resolvedDir)) return;
    visited.add(resolvedDir);

    fs.readdirSync(dirPath, { withFileTypes: true }).forEach((entry) => {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
        return;
      }

      if (!entry.isFile()) return;
      if (!entry.name.endsWith('.md')) return;
      if (entry.name === '_index.yaml') return;
      files.push(entryPath);
    });
  };

  roots.forEach((rootRel) => {
    const normalizedRoot = normalizeRelativePath(rootRel || '.');
    const absRoot = path.join(TASKS_DIR, normalizedRoot || '.');
    walk(absRoot);
  });

  // 既存運用との互換性のため、ルート直下スキャンは常に含める
  walk(TASKS_DIR);

  return Array.from(new Set(files));
}

function loadTaskFromFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const parsed = matter(content);
  const task = {
    ...parsed.data,
    content: parsed.content,
    task_file_path: normalizeTaskFilePath(parsed.data.task_file_path || toIndexAbsolutePath(filePath)),
    _filePath: filePath
  };
  return task;
}

function deriveTaskFileRootsFromCache(cache) {
  const roots = Object.values(cache)
    .map((task) => {
      const filePath = task._filePath || resolveTaskFilePath(task.task_file_path, task.id);
      const relPath = normalizeRelativePath(toIndexRelativePath(filePath));
      const dir = path.posix.dirname(relPath || '.');
      return dir && dir !== '/' ? dir : '.';
    })
    .filter(Boolean);
  return Array.from(new Set([ ...DEFAULT_TASK_FILE_ROOTS, ...roots ])).sort();
}

function sanitizeTaskForRenderer(task) {
  const output = { ...task };
  delete output._filePath;
  return output;
}

function refreshNextTaskIdFromCache() {
  const maxTaskNo = Math.max(
    ...Object.values(taskCache).map((task) => {
      const match = String(task.id || '').match(/T-(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    }),
    0
  );
  nextTaskId = Math.max(nextTaskId, maxTaskNo + 1);
}

function loadAllTasksAndMigratePath() {
  const taskFiles = collectTaskFilesFromRoots(taskFileRoots);
  taskCache = {};

  taskFiles.forEach((filePath) => {
    const task = loadTaskFromFile(filePath);
    if (!task.id) return;

    taskCache[task.id] = task;

    // 移行: task_file_path が未設定/不一致なら補完して書き戻し
    const expectedPath = normalizeTaskFilePath(toIndexAbsolutePath(filePath));
    if (!task.task_file_path || normalizeTaskFilePath(task.task_file_path) !== expectedPath) {
      task.task_file_path = expectedPath;
      task._filePath = filePath;
      writeTaskFile(task);
    }
  });

  refreshNextTaskIdFromCache();
  taskFileRoots = deriveTaskFileRootsFromCache(taskCache);
}

function normalizeProgressStatus(task) {
  return task.progress_status || (task.status === 'done' ? '完了' : '未着');
}

function estimateParentState(children) {
  const statuses = children.map((child) => normalizeProgressStatus(child));
  if (statuses.length > 0 && statuses.every((status) => status === '完了')) {
    return { progress_status: '完了', status: 'done' };
  }
  if (statuses.some((status) => status === '仕掛' || status === '完了')) {
    return { progress_status: '仕掛', status: 'todo' };
  }
  return { progress_status: '未着', status: 'todo' };
}

function recomputeParentFromChildren(parentId, now) {
  if (!parentId) return;
  const parent = taskCache[parentId];
  if (!parent || parent.delete_flag === 1 || parent.is_manual_progress === 1) return;

  const siblings = Object.values(taskCache)
    .filter((child) => child.parent === parentId && child.delete_flag === 0);
  const estimatedParent = estimateParentState(siblings);

  parent.progress_status = estimatedParent.progress_status;
  parent.status = estimatedParent.status;
  parent.completed_at = estimatedParent.status === 'done' ? (parent.completed_at || now) : null;
  parent.updated_at = now;
  taskCache[parent.id] = parent;
  writeTaskFile(parent);
}

/**
 * 起動時に全タスクファイルを読み込みキャッシュを構築
 */
async function openTaskService() {
  try {
    // 30_data/tasks/ が存在しない場合は作成
    if (!fs.existsSync(TASKS_DIR)) {
      fs.mkdirSync(TASKS_DIR, { recursive: true });
    }

    // _index.yaml から next_task_id / task_file_roots を読み込む
    const indexData = readIndexData();
    nextTaskId = indexData.next_task_id;
    taskFileRoots = indexData.task_file_roots;

    // ルート群から全タスクファイルを読み込み（移行補完含む）
    loadAllTasksAndMigratePath();

    // _index.yaml を最新スキーマで再生成（task_file_path を確実に保持）
    const indexService = require('./indexService');
    indexService.rebuildIndex(taskCache, taskFileRoots);

    console.log(`[TaskService] Loaded ${Object.keys(taskCache).length} tasks from disk`);
    return { success: true, taskCount: Object.keys(taskCache).length };
  } catch (error) {
    console.error('[TaskService] Error opening service:', error);
    throw error;
  }
}

/**
 * delete_flag = 0 のタスクを返す
 */
function getAllTasks() {
  return Object.values(taskCache)
    .filter((t) => t.delete_flag === 0)
    .map((t) => sanitizeTaskForRenderer(t));
}

/**
 * status = done のタスクを返す
 */
function getCompletedTasks() {
  return Object.values(taskCache)
    .filter(t => t.status === 'done' && t.delete_flag === 0)
    .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))
    .map((t) => sanitizeTaskForRenderer(t));
}

/**
 * delete_flag = 1 のタスクを返す
 */
function getTrashedTasks() {
  return Object.values(taskCache)
    .filter((t) => t.delete_flag === 1)
    .map((t) => sanitizeTaskForRenderer(t));
}

/**
 * ID でタスク取得
 */
function getTaskById(id) {
  const task = taskCache[id];
  return task ? sanitizeTaskForRenderer(task) : null;
}

/**
 * リスト別タスク取得
 */
function getTasksByList(listName) {
  return Object.values(taskCache)
    .filter((t) => t.list === listName && t.delete_flag === 0)
    .map((t) => sanitizeTaskForRenderer(t));
}

/**
 * 親タスク配下のサブタスク取得
 */
function getTasksByParent(parentId) {
  return Object.values(taskCache)
    .filter((t) => t.parent === parentId && t.delete_flag === 0)
    .map((t) => sanitizeTaskForRenderer(t));
}

/**
 * 新規タスク作成
 */
function addTask(taskData) {
  // ID 自動採番
  const newId = `T-${String(nextTaskId).padStart(4, '0')}`;
  nextTaskId++;

  const explicitPath = normalizeTaskFilePath(taskData.task_file_path || '');
  const taskFilePath = resolveTaskFilePath(explicitPath, newId);

  const now = new Date().toISOString();
  const newTask = {
    id: newId,
    title: taskData.title || 'Untitled',
    status: 'todo',
    priority: taskData.priority || 'medium',
    progress_status: '未着',
    is_manual_progress: 0,
    due_date: taskData.due_date || null,
    list: taskData.list || null,
    parent: taskData.parent || null,
    tags: taskData.tags || [],
    sort_order: Object.keys(taskCache).length + 1,
    delete_flag: 0,
    task_file_path: normalizeTaskFilePath(toIndexAbsolutePath(taskFilePath)),
    created_at: now,
    updated_at: now,
    completed_at: null,
    deleted_at: null,
    content: '',
    _filePath: taskFilePath
  };

  // キャッシュに追加
  taskCache[newId] = newTask;

  // ファイルに書き込み
  writeTaskFile(newTask);
  taskFileRoots = deriveTaskFileRootsFromCache(taskCache);

  return sanitizeTaskForRenderer(newTask);
}

/**
 * タスク更新（frontmatter フィールド）
 */
function updateTask(id, updates) {
  if (!taskCache[id]) {
    throw new Error(`Task ${id} not found`);
  }

  const task = taskCache[id];
  const oldFilePath = task._filePath || resolveTaskFilePath(task.task_file_path, id);
  const prevStatus = task.status;
  const prevProgressStatus = task.progress_status;
  const now = new Date().toISOString();

  // 全フィールドを更新（content を含む）
  Object.keys(updates).forEach(key => {
    task[key] = updates[key];
  });

  // status/progress_status の不整合を補正
  if (task.status === 'done') {
    task.progress_status = '完了';
    task.completed_at = task.completed_at || now;
  } else {
    if (task.progress_status === '完了') {
      task.progress_status = '仕掛';
    }
    task.completed_at = null;
  }

  task.updated_at = now;

  // path が変更された場合は対象ファイルを移動
  const targetFilePath = resolveTaskFilePath(task.task_file_path, id);
  if (path.resolve(oldFilePath) !== path.resolve(targetFilePath)) {
    ensureParentDir(targetFilePath);
    if (fs.existsSync(oldFilePath)) {
      fs.renameSync(oldFilePath, targetFilePath);
    }
    task._filePath = targetFilePath;
    task.task_file_path = normalizeTaskFilePath(toIndexAbsolutePath(targetFilePath));
  } else {
    task._filePath = oldFilePath;
    task.task_file_path = normalizeTaskFilePath(task.task_file_path || toIndexAbsolutePath(oldFilePath));
  }

  // 親タスクが todo/doing/blocked -> done に遷移した場合、直下サブタスクを自動完了
  const isParentTask = task.parent === null || task.parent === undefined;
  if (isParentTask && prevStatus !== 'done' && task.status === 'done') {
    Object.values(taskCache).forEach((child) => {
      if (child.parent !== id) return;
      if (child.status === 'done' && child.progress_status === '完了') return;

      child.status = 'done';
      child.progress_status = '完了';
      child.completed_at = child.completed_at || now;
      child.updated_at = now;
      taskCache[child.id] = child;
      writeTaskFile(child);
    });
  }

  // CHG-010: 親タスクの進捗ステータスが 完了 -> 非完了 に戻った場合、直下サブタスクも同方向へ戻す
  if (isParentTask && prevProgressStatus === '完了' && task.progress_status !== '完了') {
    Object.values(taskCache).forEach((child) => {
      if (child.parent !== id) return;

      child.progress_status = task.progress_status;
      child.status = 'todo';
      child.completed_at = null;
      child.updated_at = now;
      taskCache[child.id] = child;
      writeTaskFile(child);
    });
  }

  // CHG-012: 子タスク更新時に親タスクの progress_status / status を再推定
  if (task.parent) recomputeParentFromChildren(task.parent, now);

  // キャッシュ更新
  taskCache[id] = task;

  // ファイルに書き込み
  writeTaskFile(task);
  taskFileRoots = deriveTaskFileRootsFromCache(taskCache);

  return { success: true, updated_at: now, task_file_path: task.task_file_path };
}

/**
 * 本文編集（content は別途管理）
 */
function updateTaskContent(id, content) {
  if (!taskCache[id]) {
    throw new Error(`Task ${id} not found`);
  }

  const task = taskCache[id];
  const now = new Date().toISOString();

  task.content = content;
  task.updated_at = now;
  task.task_file_path = normalizeTaskFilePath(task.task_file_path || toIndexAbsolutePath(task._filePath || resolveTaskFilePath(null, id)));
  task._filePath = task._filePath || resolveTaskFilePath(task.task_file_path, id);

  taskCache[id] = task;
  writeTaskFile(task);

  return { success: true, updated_at: now };
}

/**
 * タスクのタグ配列を更新
 */
function updateTaskTags(id, tags) {
  if (!taskCache[id]) {
    throw new Error(`Task ${id} not found`);
  }

  const normalizedTags = Array.isArray(tags)
    ? Array.from(new Set(tags.map((t) => String(t || '').trim()).filter(Boolean))).slice(0, 10)
    : [];

  const now = new Date().toISOString();
  const task = taskCache[id];

  task.tags = normalizedTags;
  task.updated_at = now;
  task.task_file_path = normalizeTaskFilePath(task.task_file_path || toIndexAbsolutePath(task._filePath || resolveTaskFilePath(null, id)));
  task._filePath = task._filePath || resolveTaskFilePath(task.task_file_path, id);

  taskCache[id] = task;
  writeTaskFile(task);

  return { success: true, updated_at: now, tags: normalizedTags };
}

/**
 * タスク完了
 */
function completeTask(id) {
  if (!taskCache[id]) {
    throw new Error(`Task ${id} not found`);
  }

  const now = new Date().toISOString();
  const task = taskCache[id];

  task.status = 'done';
  task.completed_at = now;
  task.progress_status = '完了';
  task.updated_at = now;
  task.task_file_path = normalizeTaskFilePath(task.task_file_path || toIndexAbsolutePath(task._filePath || resolveTaskFilePath(null, id)));
  task._filePath = task._filePath || resolveTaskFilePath(task.task_file_path, id);

  taskCache[id] = task;
  writeTaskFile(task);

  return { success: true, completed_at: now };
}

/**
 * タスク再開
 */
function reopenTask(id) {
  if (!taskCache[id]) {
    throw new Error(`Task ${id} not found`);
  }

  const now = new Date().toISOString();
  const task = taskCache[id];

  task.status = 'todo';
  task.completed_at = null;
  task.updated_at = now;
  task.task_file_path = normalizeTaskFilePath(task.task_file_path || toIndexAbsolutePath(task._filePath || resolveTaskFilePath(null, id)));
  task._filePath = task._filePath || resolveTaskFilePath(task.task_file_path, id);

  taskCache[id] = task;
  writeTaskFile(task);

  return { success: true };
}

/**
 * タスク削除（ゴミ箱移動）
 */
function trashTask(id) {
  if (!taskCache[id]) {
    throw new Error(`Task ${id} not found`);
  }

  const now = new Date().toISOString();
  const task = taskCache[id];

  task.delete_flag = 1;
  task.deleted_at = now;
  task.updated_at = now;
  task.task_file_path = normalizeTaskFilePath(task.task_file_path || toIndexAbsolutePath(task._filePath || resolveTaskFilePath(null, id)));
  task._filePath = task._filePath || resolveTaskFilePath(task.task_file_path, id);

  taskCache[id] = task;
  writeTaskFile(task);

  return { success: true, deleted_at: now };
}

/**
 * タスク復元
 */
function restoreTask(id) {
  if (!taskCache[id]) {
    throw new Error(`Task ${id} not found`);
  }

  const now = new Date().toISOString();
  const task = taskCache[id];

  task.delete_flag = 0;
  task.deleted_at = null;
  task.updated_at = now;
  task.task_file_path = normalizeTaskFilePath(task.task_file_path || toIndexAbsolutePath(task._filePath || resolveTaskFilePath(null, id)));
  task._filePath = task._filePath || resolveTaskFilePath(task.task_file_path, id);

  taskCache[id] = task;
  writeTaskFile(task);

  return { success: true };
}

/**
 * タスク完全削除（archive へ移動）
 */
function deleteTask(id) {
  if (!taskCache[id]) {
    throw new Error(`Task ${id} not found`);
  }

  const task = taskCache[id];
  const filePath = task._filePath || resolveTaskFilePath(task.task_file_path, id);
  const archivePath = path.join(ARCHIVE_DIR, `${id}-archived.md`);

  // archive ディレクトリが無ければ作成
  if (!fs.existsSync(ARCHIVE_DIR)) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  }

  // ファイルを archive へ移動
  if (fs.existsSync(filePath)) {
    fs.renameSync(filePath, archivePath);
  }

  // キャッシュから削除
  delete taskCache[id];

  const now = new Date().toISOString();
  return { success: true, archived_at: now };
}

/**
 * タスク複製
 */
function duplicateTask(id) {
  if (!taskCache[id]) {
    throw new Error(`Task ${id} not found`);
  }

  const original = taskCache[id];

  const duplicated = addTask({
    title: original.title + '（コピー）',
    priority: original.priority,
    due_date: original.due_date,
    list: original.list,
    parent: original.parent,
    tags: [...(original.tags || [])]
  });

  return duplicated;
}

/**
 * タスク並び順一括更新（CHG-021）
 * payload: {
 *   ordered_ids: string[],
 *   field_updates?: { [taskId]: { due_date?, progress_status? } }
 * }
 */
function reorderTasks(payload = {}) {
  const orderedIdsInput = Array.isArray(payload.ordered_ids) ? payload.ordered_ids : [];
  const fieldUpdates = payload.field_updates && typeof payload.field_updates === 'object'
    ? payload.field_updates
    : {};

  if (orderedIdsInput.length === 0) {
    throw new Error('ordered_ids is required');
  }

  const now = new Date().toISOString();
  const activeTasks = Object.values(taskCache)
    .filter((t) => t.delete_flag === 0)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const activeIds = activeTasks.map((t) => t.id);

  const dedupedOrderedIds = Array.from(new Set(orderedIdsInput.filter((id) => activeIds.includes(id))));
  const missingIds = activeIds.filter((id) => !dedupedOrderedIds.includes(id));
  const finalIds = [...dedupedOrderedIds, ...missingIds];

  const changedIds = new Set();
  const touchedParentIds = new Set();

  Object.entries(fieldUpdates).forEach(([taskId, patch]) => {
    const task = taskCache[taskId];
    if (!task || task.delete_flag === 1) return;

    const nextPatch = { ...patch };

    if (task.status === 'done' && nextPatch.progress_status && nextPatch.progress_status !== '完了') {
      throw new Error(`Task ${taskId} is done and cannot change progress_status`);
    }

    if (Object.prototype.hasOwnProperty.call(nextPatch, 'due_date')) {
      task.due_date = nextPatch.due_date || null;
    }
    if (Object.prototype.hasOwnProperty.call(nextPatch, 'progress_status')) {
      task.progress_status = nextPatch.progress_status;
    }

    if (task.status === 'done') {
      task.progress_status = '完了';
      task.completed_at = task.completed_at || now;
    } else if (task.progress_status === '完了') {
      task.progress_status = '仕掛';
      task.completed_at = null;
    }

    task.updated_at = now;
    taskCache[taskId] = task;
    writeTaskFile(task);
    changedIds.add(taskId);
    if (task.parent) touchedParentIds.add(task.parent);
  });

  finalIds.forEach((taskId, idx) => {
    const task = taskCache[taskId];
    if (!task || task.delete_flag === 1) return;
    const nextOrder = idx + 1;
    if (task.sort_order !== nextOrder) {
      task.sort_order = nextOrder;
      task.updated_at = now;
      taskCache[taskId] = task;
      writeTaskFile(task);
      changedIds.add(taskId);
      if (task.parent) touchedParentIds.add(task.parent);
    }
  });

  touchedParentIds.forEach((parentId) => recomputeParentFromChildren(parentId, now));

  taskFileRoots = deriveTaskFileRootsFromCache(taskCache);

  return {
    success: true,
    updated_count: changedIds.size,
    updated_at: now
  };
}

/**
 * キャッシュ再構築（watcher 経由で呼び出される）
 */
function rebuildCache() {
  try {
    loadAllTasksAndMigratePath();

    console.log(`[TaskService] Rebuilt cache: ${Object.keys(taskCache).length} tasks`);
    return { success: true, taskCount: Object.keys(taskCache).length };
  } catch (error) {
    console.error('[TaskService] Error rebuilding cache:', error);
    return { success: false, error: error.message };
  }
}

/**
 * キャッシュを返す（indexService 用）
 */
function getCache() {
  return taskCache;
}

function getTaskFileRoots() {
  return [...taskFileRoots];
}

function getTaskSearchRoots() {
  return taskFileRoots.map((root) => path.join(TASKS_DIR, normalizeRootPath(root || '.')));
}

/**
 * ファイルに書き込み
 */
function writeTaskFile(task) {
  const filePath = task._filePath || resolveTaskFilePath(task.task_file_path, task.id);
  ensureParentDir(filePath);
  task._filePath = filePath;
  task.task_file_path = normalizeTaskFilePath(toIndexAbsolutePath(filePath));

  // frontmatter 用オブジェクト（content は除く）
  const frontmatter = { ...task };
  delete frontmatter.content;
  delete frontmatter._filePath;

  // gray-matter で frontmatter + content を生成
  const markdown = matter.stringify(task.content || '', frontmatter);

  fs.writeFileSync(filePath, markdown, 'utf-8');
}

module.exports = {
  openTaskService,
  getAllTasks,
  getCompletedTasks,
  getTrashedTasks,
  getTaskById,
  getTasksByList,
  getTasksByParent,
  addTask,
  updateTask,
  updateTaskContent,
  updateTaskTags,
  completeTask,
  reopenTask,
  trashTask,
  restoreTask,
  deleteTask,
  duplicateTask,
  reorderTasks,
  rebuildCache,
  getCache,
  getTaskFileRoots,
  getTaskSearchRoots
};
