const { contextBridge, ipcRenderer } = require("electron");

// Renderer プロセスに公開する API を最小限に制限する
// ホワイトリスト方式: ipcRenderer を直接渡さず、呼べるチャンネルを限定する
contextBridge.exposeInMainWorld("cotaskerAPI", {
  // 疎通確認
  ping: () => ipcRenderer.invoke("ping"),

  // タスク操作（ファイルベース）
  tasks: {
    getAll:           ()                                => ipcRenderer.invoke("tasks:getAll"),
    add:              (task)                            => ipcRenderer.invoke("tasks:add",               task),
    update:           (updates)                         => ipcRenderer.invoke("tasks:update",            updates),
    updateContent:    (id, content)                     => ipcRenderer.invoke("tasks:updateContent",     id, content),
    completeTask:     (id)                              => ipcRenderer.invoke("tasks:completeTask",      id),
    reopenTask:       (id)                              => ipcRenderer.invoke("tasks:reopenTask",        id),
    trashTask:        (id)                              => ipcRenderer.invoke("tasks:trashTask",         id),
    restoreTask:      (id)                              => ipcRenderer.invoke("tasks:restoreTask",       id),
    deleteTask:       (id)                              => ipcRenderer.invoke("tasks:deleteTask",        id),
    duplicateTask:    (id)                              => ipcRenderer.invoke("tasks:duplicateTask",     id),
    getTrashed:       ()                                => ipcRenderer.invoke("tasks:getTrashed"),
    getCompleted:     ()                                => ipcRenderer.invoke("tasks:getCompleted"),
  },

  // リスト操作（YAML ベース）
  lists: {
    getAll:  ()                       => ipcRenderer.invoke("lists:getAll"),
    add:     (list)                   => ipcRenderer.invoke("lists:add",     list),
    update:  (listName, updates)      => ipcRenderer.invoke("lists:update",  listName, updates),
    delete:  (listName)               => ipcRenderer.invoke("lists:delete",  listName),
  },

  // タグ操作（グローバルタグマスタ）
  tags: {
    getAll: ()            => ipcRenderer.invoke("tags:getAll"),
    add:    (name)        => ipcRenderer.invoke("tags:add", name),
    delete: (name)        => ipcRenderer.invoke("tags:delete", name),
  },

  // タスクへのタグ紐付け
  taskTags: {
    set: (taskId, tags) => ipcRenderer.invoke("taskTags:set", taskId, tags),
  },

  // イベントリスナー（ファイルウォッチャーから通知）
  onTasksChanged: (callback) => {
    ipcRenderer.on("tasks:changed", (_event, data) => {
      callback(data);
    });
  },

  // リスナー削除
  removeTasksChangedListener: () => {
    ipcRenderer.removeAllListeners("tasks:changed");
  },
});
