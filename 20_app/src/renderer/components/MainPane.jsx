import React, { useEffect, useMemo, useRef, useState } from "react";
import DueDatePopover from "./DueDatePopover";

// 優先度アイコン定義
const PRIORITY = {
  high:   { label: "!!", cls: "priority-high"   },
  medium: { label: "!",  cls: "priority-medium" },
};

/**
 * MainPane — ヘッダー・クイック追加バー・タスクリスト表示（flex: 1）
 *
 * Props:
 *   viewTitle        : string
 *   tasks            : Task[]               — 表示するタスク（フラット）
 *   sections         : { label, tasks }[] | null — セクション表示（今日・次の7日間）
 *   selectedTaskId   : number | null
 *   isTrashed        : boolean          — ゴミ箱ビューかどうか
 *   isCompleted      : boolean          — 完了ビューかどうか
 *   onTaskClick      : (task) => void
 *   onAddTask        : (title) => void  — null のとき入力欄を非表示
 *   onAddSubtask     : (parentTask, title) => void
 *   onToggleComplete : (task) => void
 *   onTrashTask      : (task) => void   — ゴミ箱移動
 *   onDuplicateTask  : (task) => void   — タスク複製
 *   onSetTaskList    : (task, listId) => void   — リスト変更
 *   onRestoreTask    : (task) => void   — ゴミ箱から復元
 *   onDeleteTask     : (task) => void   — 完全削除
 *   lists            : List[]           — リスト一覧
 */
function MainPane({
  viewTitle, tasks, sections, progressSections, completedSectionTasks = [], selectedTaskId, isTrashed, isCompleted,
  isSearchMode, onSearchChange,
  onTaskClick, onAddTask, onAddSubtask, onToggleComplete,
  onTrashTask, onRestoreTask, onDeleteTask, onDuplicateTask, onSetTaskList, onSetTaskDue,
  onReorderTask,
  lists,
  tags = [],
  onSetTaskTags,
}) {
  const inputRef    = useRef(null);
  const inlineInputRef = useRef(null);
  const contextMenuRef = useRef(null);
  const searchTimer = useRef(null);
  const [localSearch, setLocalSearch] = useState("");
  const [contextMenu, setContextMenu] = useState(null);
  const [contextMenuPos, setContextMenuPos] = useState(null);
  const [inlineInput, setInlineInput] = useState(null); // { parentId, value }
  const [expanded, setExpanded] = useState({});
  const [completedSectionExpanded, setCompletedSectionExpanded] = useState(true);
  const [sectionCollapsed, setSectionCollapsed] = useState({});
  const [dueEditorTaskId, setDueEditorTaskId] = useState(null);
  const [draggingTaskId, setDraggingTaskId] = useState(null);
  const [hoveredSectionKey, setHoveredSectionKey] = useState(null);
  const dragEnabled = Boolean(onReorderTask) && !isTrashed && !isCompleted && !isSearchMode;

  const handleKeyDown = (e) => {
    if (e.key !== "Enter") return;
    const val = inputRef.current?.value ?? "";
    if (val.trim()) {
      onAddTask?.(val.trim());
      if (inputRef.current) inputRef.current.value = "";
    }
    inputRef.current?.blur();
  };

  // 検索インプット「debounce 300ms
  const handleSearchInput = (e) => {
    const val = e.target.value;
    setLocalSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => onSearchChange?.(val), 300);
  };
  const handleSearchClear = () => {
    setLocalSearch("");
    clearTimeout(searchTimer.current);
    onSearchChange?.("");
  };

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    setContextMenuPos({ top: contextMenu.y, left: contextMenu.x });
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;
    const MARGIN = 8;
    const rect = contextMenuRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top = contextMenu.y;
    let left = contextMenu.x;

    if (rect.bottom > viewportHeight - MARGIN) {
      top = Math.max(MARGIN, top - (rect.bottom - (viewportHeight - MARGIN)));
    }
    if (rect.right > viewportWidth - MARGIN) {
      left = Math.max(MARGIN, left - (rect.right - (viewportWidth - MARGIN)));
    }

    if (top !== contextMenu.y || left !== contextMenu.x) {
      setContextMenuPos({ top, left });
    }
  }, [contextMenu]);

  useEffect(() => {
    if (!inlineInput) return;
    inlineInputRef.current?.focus();
  }, [inlineInput]);

  const buildTaskTree = useMemo(() => {
    return (list) => {
      const byParent = {};
      const idSet = new Set(list.map((t) => t.id));
      list.forEach((task) => {
        const pid = task.parent;
        if (pid === null || pid === undefined || !idSet.has(pid)) return;
        if (!byParent[pid]) byParent[pid] = [];
        byParent[pid].push(task);
      });
      const roots = list.filter((t) => {
        const pid = t.parent;
        return pid === null || pid === undefined || !idSet.has(pid);
      });
      return { roots, byParent };
    };
  }, []);

  const renderInlineInput = (parentTask) => {
    if (!inlineInput || inlineInput.parentId !== parentTask.id) return null;
    return (
      <div className="inline-add-row">
        <span className="subtask-indent" />
        <input
          ref={inlineInputRef}
          className="inline-add-input"
          type="text"
          placeholder="サブタスクを追加（確定キーで保存）"
          value={inlineInput.value}
          onChange={(e) => setInlineInput((prev) => ({ ...prev, value: e.target.value }))}
          onKeyDown={async (e) => {
            if (e.key === "Escape") {
              setInlineInput(null);
              return;
            }
            if (e.key !== "Enter") return;
            const title = inlineInput.value.trim();
            if (!title) {
              setInlineInput(null);
              return;
            }
            await onAddSubtask?.(parentTask, title);
            setInlineInput(null);
          }}
          onBlur={() => setInlineInput(null)}
        />
      </div>
    );
  };

  // タスク行を描画する関数
  const renderTaskRow = (task, showSep, isSubtask = false, childCount = 0, sectionMeta = null) => {
    const isInvalid = Boolean(task.is_invalid);
    const rowClassName = [
      "task-row",
      selectedTaskId === task.id ? "selected" : "",
      task.status === "done" ? "task-row--done" : "",
      isSubtask ? "task-row--subtask" : "",
      draggingTaskId === task.id ? "task-row--dragging" : "",
      isInvalid ? "task-row--invalid" : "",
    ].filter(Boolean).join(" ");
    const canDragTask = dragEnabled && !isSubtask && task.status !== "done" && !isInvalid;

    return (
    <React.Fragment key={task.id}>
      <div
        className={rowClassName}
        onClick={() => onTaskClick?.(task)}
        draggable={canDragTask}
        onDragStart={(e) => {
          if (!canDragTask) return;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(task.id));
          setDraggingTaskId(task.id);
        }}
        onDragEnd={() => setDraggingTaskId(null)}
        onDragOver={(e) => {
          if (isInvalid || !dragEnabled || !draggingTaskId || draggingTaskId === task.id) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={(e) => {
          if (isInvalid || !dragEnabled) return;
          e.preventDefault();
          e.stopPropagation();
          const draggedTaskId = e.dataTransfer.getData("text/plain") || draggingTaskId;
          if (!draggedTaskId || draggedTaskId === task.id) {
            setDraggingTaskId(null);
            setHoveredSectionKey(null);
            return;
          }
          onReorderTask?.({
            draggedTaskId,
            targetTaskId: task.id,
            toSectionType: sectionMeta?.type || null,
            toSectionLabel: sectionMeta?.label || null,
          });
          setDraggingTaskId(null);
          setHoveredSectionKey(null);
        }}
        onContextMenu={(e) => {
          if (!isInvalid && !isTrashed && !isCompleted && !isSearchMode) {
            e.preventDefault();
            setContextMenu({ x: e.clientX, y: e.clientY, task });
          }
        }}
      >
        {!isSubtask && (
          <button
            className={`expand-btn${childCount === 0 && !(inlineInput && inlineInput.parentId === task.id) ? " expand-btn--hidden" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((prev) => ({ ...prev, [task.id]: !prev[task.id] }));
            }}
            title="展開/折りたたみ"
          >
            {expanded[task.id] ? "▾" : "▸"}
          </button>
        )}
        {isSubtask && <span className="subtask-indent" />}
        <span className="drag-handle">⠇</span>
        {!isTrashed && (
          <input
            type="checkbox"
            checked={task.status === "done"}
            disabled={isInvalid}
            onChange={(e) => { e.stopPropagation(); onToggleComplete?.(task); }}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        {!isTrashed && (
          <span className={`progress-status-badge ${isInvalid ? "invalid" : task.progressStatus === "完了" ? "done" : task.progressStatus === "仕掛" ? "in-progress" : "not-started"}`}>
            {task.progressStatus || "未着"}
          </span>
        )}
        {isInvalid && <span className="task-warning-mark" title="タスクファイルの読み込みエラー">!</span>}
        <span className="task-title">{task.title}</span>
        {!isTrashed && PRIORITY[task.priority] && (
          <span className={`priority-icon ${PRIORITY[task.priority].cls}`}>
            {PRIORITY[task.priority].label}
          </span>
        )}
        {!isTrashed && (
          <span
            className="task-due-anchor"
            onClick={(e) => {
              e.stopPropagation();
              if (!isInvalid && onSetTaskDue) setDueEditorTaskId(task.id);
            }}
          >
            <span className={`task-due${task.overdue ? " overdue" : ""}${task.due ? "" : " task-due--empty"}`}>
              {task.due || "未設定"}
            </span>
            {onSetTaskDue && dueEditorTaskId === task.id && (
              <DueDatePopover
                className="due-dialog--floating"
                placementMode="main-auto"
                value={task.due_date}
                onChange={async (nextDue) => {
                  await onSetTaskDue(task, nextDue);
                  setDueEditorTaskId(null);
                }}
                onClear={async () => {
                  await onSetTaskDue(task, null);
                  setDueEditorTaskId(null);
                }}
                onClose={() => setDueEditorTaskId(null)}
              />
            )}
          </span>
        )}
        {/* ゴミ箱ビュー: 復元・完全削除ボタン */}
        {isTrashed && (
          <span className="task-actions">
            <button
              className="task-action-btn restore"
              title="復元"
              onClick={(e) => { e.stopPropagation(); onRestoreTask?.(task); }}
            >↩</button>
            <button
              className="task-action-btn delete"
              title="完全削除"
              onClick={(e) => { e.stopPropagation(); onDeleteTask?.(task); }}
            >✕</button>
          </span>
        )}
      </div>
      {showSep && <div className="task-separator" />}
    </React.Fragment>
    );
  };

  const renderTaskTree = (list, sectionMeta = null) => {
    const { roots, byParent } = buildTaskTree(list);
    const items = [];

    roots.forEach((parent, idx) => {
      const children = byParent[parent.id] || [];
      const parentExpanded = expanded[parent.id] || inlineInput?.parentId === parent.id;
      items.push(renderTaskRow(parent, idx < roots.length - 1, false, children.length, sectionMeta));
      if (parentExpanded) {
        children.forEach((child) => {
          items.push(renderTaskRow(child, false, true, 0, sectionMeta));
        });
        items.push(renderInlineInput(parent));
      }
    });

    return items;
  };

  // フラットリスト（ゴミ箱・完了・リスト・受信トレイ・検索）
  const renderFlatList = () => (
    <>
      {isSearchMode && localSearch && (
        <div className="search-results-count">
          {tasks.length > 0 ? `${tasks.length} 件見つかりました` : ""}
        </div>
      )}
      {tasks.length === 0 && (
        <div className="task-empty">
          {isTrashed    ? "ゴミ箱は空です"                    :
           isSearchMode ? (localSearch ? "一致するタスクがありません" : "キーワードを入力してください") :
           "タスクがありません"}
        </div>
      )}
      {isTrashed && tasks.length > 0 && (
        <div className="section-header">🗑️ ゴミ箱</div>
      )}
      {renderTaskTree(tasks, { type: "flat", label: viewTitle })}
    </>
  );

  const renderProgressSections = () => {
    const totalCount = progressSections.reduce((s, sec) => s + sec.tasks.length, 0);
    return (
      <>
        {totalCount === 0 && (
          <div className="task-empty">タスクがありません</div>
        )}
        {progressSections.map((section) => (
          <div
            key={section.label}
            className={`drop-section${hoveredSectionKey === `progress:${section.label}` ? " drop-section--hover" : ""}`}
            onDragOver={(e) => {
              if (!dragEnabled || !draggingTaskId) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setHoveredSectionKey(`progress:${section.label}`);
            }}
            onDragLeave={() => {
              if (hoveredSectionKey === `progress:${section.label}`) setHoveredSectionKey(null);
            }}
            onDrop={(e) => {
              if (!dragEnabled) return;
              e.preventDefault();
              e.stopPropagation();
              const draggedTaskId = e.dataTransfer.getData("text/plain") || draggingTaskId;
              if (!draggedTaskId) return;
              onReorderTask?.({
                draggedTaskId,
                toSectionType: "progress",
                toSectionLabel: section.label,
              });
              setDraggingTaskId(null);
              setHoveredSectionKey(null);
            }}
          >
            <div
              className="section-header section-header--collapsible"
              onClick={() => setSectionCollapsed((prev) => ({ ...prev, [`progress:${section.label}`]: !prev[`progress:${section.label}`] }))}
            >
              {sectionCollapsed[`progress:${section.label}`] ? "▸" : "▾"} {section.label} ({section.tasks.length})
            </div>
            {!sectionCollapsed[`progress:${section.label}`] && renderTaskTree(section.tasks, { type: "progress", label: section.label })}
          </div>
        ))}
      </>
    );
  };

  // セクション別リスト（今日・次の7日間）
  const renderSections = () => {
    const totalCount = sections.reduce((s, sec) => s + sec.tasks.length, 0);
    return (
      <>
        {totalCount === 0 && (
          <div className="task-empty">タスクがありません</div>
        )}
        {sections.map((section) => (
          <div
            key={section.label}
            className={`drop-section${hoveredSectionKey === `date:${section.label}` ? " drop-section--hover" : ""}`}
            onDragOver={(e) => {
              if (!dragEnabled || !draggingTaskId) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setHoveredSectionKey(`date:${section.label}`);
            }}
            onDragLeave={() => {
              if (hoveredSectionKey === `date:${section.label}`) setHoveredSectionKey(null);
            }}
            onDrop={(e) => {
              if (!dragEnabled) return;
              e.preventDefault();
              e.stopPropagation();
              const draggedTaskId = e.dataTransfer.getData("text/plain") || draggingTaskId;
              if (!draggedTaskId) return;
              onReorderTask?.({
                draggedTaskId,
                toSectionType: "date",
                toSectionLabel: section.label,
              });
              setDraggingTaskId(null);
              setHoveredSectionKey(null);
            }}
          >
            <div
              className={`section-header section-header--collapsible${section.label.includes("遅延") ? " overdue" : ""}`}
              onClick={() => setSectionCollapsed((prev) => ({ ...prev, [`date:${section.label}`]: !prev[`date:${section.label}`] }))}
            >
              {sectionCollapsed[`date:${section.label}`] ? "▸" : "▾"} {section.label} ({section.tasks.length})
            </div>
            {!sectionCollapsed[`date:${section.label}`] && renderTaskTree(section.tasks, { type: "date", label: section.label })}
          </div>
        ))}
      </>
    );
  };

  return (
    <div className="main-pane">
      {/* ヘッダー */}
      <div className="main-header">
        {isSearchMode ? (
          /* 検索バー */
          <div className="search-bar">
            <span className="search-icon">🔍</span>
            <input
              className="search-input"
              type="text"
              placeholder="タスクを検索..."
              value={localSearch}
              onChange={handleSearchInput}
              autoFocus
              onKeyDown={(e) => e.key === "Escape" && handleSearchClear()}
            />
            {localSearch && (
              <button className="search-clear-btn" onClick={handleSearchClear}>✕</button>
            )}
          </div>
        ) : (
          /* 通常ヘッダー */
          <>
            <div className="view-title">{viewTitle}</div>
            <div className="header-actions">
              <div className="h-icon" title="ソート">⇅</div>
              <div className="h-icon" title="メニュー">⋯</div>
            </div>
          </>
        )}
      </div>

      {/* クイック追加バー（ゴミ箱・完了ビューでは非表示） */}
      {onAddTask && (
        <div className="quick-add">
          <span className="qa-icon">＋</span>
          <input
            ref={inputRef}
            type="text"
            placeholder="タスクを追加（確定キーで保存）"
            onKeyDown={handleKeyDown}
          />
        </div>
      )}

      {/* タスクリスト */}
      <div className="task-list">
        {sections ? renderSections() : (progressSections ? renderProgressSections() : renderFlatList())}
        {/* CHG-011: 完了セクション */}
        {!isTrashed && !isCompleted && completedSectionTasks.length > 0 && (
          <>
            <div
              className="section-header section-header--completed"
              onClick={() => setCompletedSectionExpanded((prev) => !prev)}
            >
              {completedSectionExpanded ? "▾" : "▸"} ✅ 完了 ({completedSectionTasks.length})
            </div>
            {completedSectionExpanded && renderTaskTree(completedSectionTasks, { type: "completed", label: "完了" })}
          </>
        )}
      </div>

      {/* T-014-04: コンテキストメニュー */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{ top: contextMenuPos?.top ?? contextMenu.y, left: contextMenuPos?.left ?? contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* サブタスクの追加 */}
          <button
            className={`ctx-item${contextMenu.task.parent != null ? " ctx-item--disabled" : ""}`}
            onClick={() => {
              if (contextMenu.task.parent != null) return;
              setExpanded((prev) => ({ ...prev, [contextMenu.task.id]: true }));
              setInlineInput({ parentId: contextMenu.task.id, value: "", mode: "subtask" });
              setContextMenu(null);
            }}
          >
            ➕ サブタスクの追加
          </button>
          <div className="ctx-separator"></div>

          {/* リスト設定（サブメニュー） */}
          <div className="ctx-item ctx-item--has-sub">
            <span>📁 リスト設定</span>
            <div className="ctx-submenu">
              <button
                className="ctx-item"
                onClick={() => {
                  onSetTaskList?.(contextMenu.task, null);
                  setContextMenu(null);
                }}
              >
                リストなし
              </button>
              {lists?.map((list) => (
                <button
                  key={list.name}
                  className="ctx-item"
                  onClick={() => {
                    onSetTaskList?.(contextMenu.task, list.name);
                    setContextMenu(null);
                  }}
                >
                  {list.name}
                </button>
              ))}
            </div>
          </div>

          {/* タグ設定（サブメニュー） */}
          <div className="ctx-item ctx-item--has-sub">
            <span>🏷️ タグ設定</span>
            <div className="ctx-submenu">
              {tags.length === 0 && (
                <button className="ctx-item ctx-item--disabled">タグなし</button>
              )}
              {tags.map((tag) => {
                const hasTag = (contextMenu.task.tags || []).includes(tag);
                return (
                  <button
                    key={tag}
                    className="ctx-item"
                    onClick={() => {
                      const current = contextMenu.task.tags || [];
                      const next = hasTag ? current.filter((t) => t !== tag) : [...current, tag];
                      onSetTaskTags?.(contextMenu.task, next);
                      setContextMenu(null);
                    }}
                  >
                    {hasTag ? "✓ " : "   "}{tag}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="ctx-separator"></div>

          {/* 複製する */}
          <button
            className="ctx-item"
            onClick={() => {
              onDuplicateTask?.(contextMenu.task);
              setContextMenu(null);
            }}
          >
            📋 複製する
          </button>

          {/* ごみ箱に移動 */}
          <button
            className="ctx-item ctx-item--danger"
            onClick={() => {
              onTrashTask?.(contextMenu.task);
              setContextMenu(null);
            }}
          >
            🗑️ ごみ箱に移動
          </button>
        </div>
      )}

    </div>
  );
}

export default MainPane;
