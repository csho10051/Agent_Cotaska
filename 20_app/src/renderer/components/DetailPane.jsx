import React, { useEffect, useState, useRef } from "react";
import MarkdownIt from "markdown-it";
import DueDatePopover from "./DueDatePopover";

const PRIORITIES = ["normal", "medium", "high"];
const PRIORITY_ICON  = { normal: "⚐", medium: "⚑", high: "⚑" };
const PRIORITY_COLOR = { normal: "#aaa", medium: "#f39c12", high: "#e74c3c" };
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });

// debounce ユーティリティ
function useDebounce(fn, delay) {
  const timer = useRef(null);
  return (...args) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fn(...args), delay);
  };
}

/**
 * DetailPane — タスク詳細・編集エリア（36%幅）
 *
 * Props:
 *   task      : Task | null — 現在選択中のタスク（key={task.id} でリセット）
 *   onClose   : () => void
 *   onSaved   : () => void  — 保存後にリスト再取得させるコールバック
 *   lists     : { id, name, color }[] — リスト選択用
 */
function DetailPane({ task, onClose, onSaved, onToggleComplete, onSetTaskDue, lists = [], tags = [], onSetTaskTags, onAddTag }) {
  if (!task) {
    return (
      <div className="detail-pane detail-pane--empty">
        <span className="detail-empty-msg">タスクを選択してください</span>
      </div>
    );
  }

  return <DetailPaneBody task={task} onClose={onClose} onSaved={onSaved} onToggleComplete={onToggleComplete} onSetTaskDue={onSetTaskDue} lists={lists} tags={tags} onSetTaskTags={onSetTaskTags} onAddTag={onAddTag} />;
}

/**
 * 内部コンポーネント。task 変更時に key によりリマウントされる。
 */
function DetailPaneBody({ task, onClose, onSaved, onToggleComplete, onSetTaskDue, lists = [], tags = [], onSetTaskTags, onAddTag }) {
  const [progress,   setProgress]   = useState(task.progress ?? 0);
  const [priority,   setPriority]   = useState(task.priority ?? "normal");
  const [status,     setStatus]     = useState(task.status);
  const [completed,  setCompleted]  = useState(task.status === "done");
  const [progressStatus, setProgressStatus] = useState(task.progressStatus || (task.status === "done" ? "完了" : "未着"));
  const [titleText,  setTitleText]  = useState(task.title || "");
  const [contentText, setContentText] = useState(task.content || "");
  const [listName,   setListName]   = useState(task.list ?? "");
  const [taskTags,   setTaskTags]   = useState(task.tags || []);
  const [newTagName, setNewTagName] = useState("");
  const [saveState,  setSaveState]  = useState("idle"); // "idle" | "saving" | "saved"
  const [previewMode, setPreviewMode] = useState(false);
  const [dueEditorOpen, setDueEditorOpen] = useState(false);
  const dueAnchorRef = useRef(null);

  // 保存中フラグ管理
  const showSaved = (delay = 1200) => {
    setSaveState("saving");
    setTimeout(() => setSaveState("saved"), 300);
    setTimeout(() => setSaveState("idle"), delay);
  };

  // DB に保存する共通関数
  const persist = async (patch, action = null, actionDetails = null) => {
    await window.cotaskerAPI?.tasks?.update({
      id:       task.id,
      title:    titleText,
      content:  contentText,
      status,
      progress_status: progressStatus,
      is_manual_progress: task.parent == null ? 1 : (task.isManualProgress ? 1 : 0),
      priority,
      progress,
      list:     listName || null,
      parent:   task.parent ?? null,
      tags:     taskTags,
      due_date: task.due_date || null,
      ...patch,
    });
    onSaved?.();
    showSaved();
  };

  // タイトル / メモの debounce 自動保存（500ms）
  const debouncedSave = useDebounce(async (nextTitle, nextContent) => {
    await persist({
      title: nextTitle,
      content: nextContent,
    });
  }, 500);

  // プログレスバークリック → 即時保存
  const handleProgressClick = async (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct  = Math.round(((e.clientX - rect.left) / rect.width) * 100);
    const newPct = Math.max(0, Math.min(100, pct));
    setProgress(newPct);
    await persist({ progress: newPct }, 'progress_changed', `${progress}% → ${newPct}%`);
  };

  // 優先度クリック → 即時保存
  const cyclePriority = async () => {
    const idx     = PRIORITIES.indexOf(priority);
    const newPrio = PRIORITIES[(idx + 1) % PRIORITIES.length];
    const oldPrio = priority;
    setPriority(newPrio);
    await persist({ priority: newPrio }, 'priority_changed', `${oldPrio} → ${newPrio}`);
  };

  // 完了チェック → 即時保存
  const handleComplete = async (e) => {
    const done = e.target.checked;
    const nextStatus = done ? "done" : "todo";
    setCompleted(done);
    const nextProgressStatus = done ? "完了" : "仕掛";
    setProgressStatus(nextProgressStatus);
    setStatus(nextStatus);

    // 完了操作は App.jsx の共通ハンドラに委譲し、MainPane と同一ロジック（カスケード完了）を通す
    if (onToggleComplete) {
      await onToggleComplete(task);
      showSaved();
      return;
    }

    await persist({ status: nextStatus, progress_status: nextProgressStatus });
  };

  const handleProgressStatusChange = async (e) => {
    const next = e.target.value;
    setProgressStatus(next);
    const nextStatus = next === "完了" ? "done" : "todo";
    setCompleted(nextStatus === "done");
    setStatus(nextStatus);
    await persist({ progress_status: next, status: nextStatus });
  };

  const handleDueDateChange = async (nextDue) => {
    if (onSetTaskDue) {
      await onSetTaskDue(task, nextDue);
    } else {
      await persist({ due_date: nextDue || null });
    }
    setDueEditorOpen(false);
  };

  useEffect(() => {
    if (!dueEditorOpen) return undefined;

    const handleMouseDown = (e) => {
      if (!dueAnchorRef.current) return;
      if (!dueAnchorRef.current.contains(e.target)) setDueEditorOpen(false);
    };

    const handleKeyDown = (e) => {
      if (e.key === "Escape") setDueEditorOpen(false);
    };

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [dueEditorOpen]);

  // リスト変更 → 即時保存
  const handleListChange = async (e) => {
    const newListName = e.target.value;
    setListName(newListName);
    await persist({ list: newListName || null });
  };

  const handleAddTagToTask = async (name) => {
    const tag = String(name || "").trim();
    if (!tag) return;
    if (taskTags.includes(tag)) return;

    if (onAddTag) {
      await onAddTag(tag);
    }

    const next = [...taskTags, tag].slice(0, 10);
    setTaskTags(next);
    await onSetTaskTags?.(task, next);
    setNewTagName("");
  };

  const handleRemoveTagFromTask = async (tag) => {
    const next = taskTags.filter((t) => t !== tag);
    setTaskTags(next);
    await onSetTaskTags?.(task, next);
  };

  return (
    <div className="detail-pane">
      {/* ヘッダーバー */}
      <div className="detail-header">
        <input
          type="checkbox"
          className="d-check"
          checked={completed}
          onChange={handleComplete}
        />
        <span className="detail-due-anchor" ref={dueAnchorRef} onClick={(e) => e.stopPropagation()}>
          <span
            className={`d-due${task.overdue ? " overdue" : ""}`}
            onClick={() => setDueEditorOpen((prev) => !prev)}
          >
            📅&nbsp;{task.due || "期限未設定"}
          </span>
          {dueEditorOpen && (
            <DueDatePopover
              className="due-popover--detail"
              value={task.due_date}
              onChange={handleDueDateChange}
              onClear={() => handleDueDateChange(null)}
              onClose={() => setDueEditorOpen(false)}
            />
          )}
        </span>
        <span
          className="d-priority"
          title="優先度を切り替え"
          style={{ color: PRIORITY_COLOR[priority], cursor: "pointer" }}
          onClick={cyclePriority}
        >
          {PRIORITY_ICON[priority]}
        </span>
        <button
          type="button"
          className="preview-toggle-btn"
          onClick={() => setPreviewMode((prev) => !prev)}
        >
          {previewMode ? "編集" : "プレビュー"}
        </button>
        {saveState === "saving" && <span className="save-indicator">保存中…</span>}
        {saveState === "saved"  && <span className="save-indicator saved">✓ 保存</span>}
        <button className="close-btn" onClick={onClose}>×</button>
      </div>

      {/* プログレスバー（クリックで進捗設定） */}
      <div
        className="progress-bar-track"
        onClick={handleProgressClick}
        title={`進捗: ${progress}%（クリックで設定）`}
        style={{ cursor: "pointer" }}
      >
        <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="progress-labels">
        <span>0%</span>
        <span style={{ color: progress > 0 ? "#4772fa" : undefined }}>{progress}%</span>
        <span>100%</span>
      </div>

      {/* 本文エリア */}
      <div className="detail-body">
        <input
          className={`detail-title${completed ? " completed" : ""}`}
          value={titleText}
          placeholder="タスク名"
          onChange={(e) => {
            const nextTitle = e.target.value;
            setTitleText(nextTitle);
            debouncedSave(nextTitle, contentText);
          }}
        />
        {previewMode ? (
          <div
            className={`detail-preview${contentText ? "" : " detail-preview--empty"}`}
            dangerouslySetInnerHTML={{ __html: contentText ? markdown.render(contentText) : "<p>プレビュー対象のメモはありません。</p>" }}
          />
        ) : (
          <textarea
            className="detail-content"
            value={contentText}
            placeholder="メモを追加..."
            onChange={(e) => {
              const nextContent = e.target.value;
              setContentText(nextContent);
              debouncedSave(titleText, nextContent);
            }}
          />
        )}
      </div>

      {/* タグエリア */}
      <div className="tag-area">
        <div className="tag-chips">
          {taskTags.map((tag) => (
            <span key={tag} className="tag">
              #{tag}
              <button className="tag-remove-btn" onClick={() => handleRemoveTagFromTask(tag)} title="タグ解除">×</button>
            </span>
          ))}
          {taskTags.length === 0 && <span className="tag-empty">タグなし</span>}
        </div>
        <div className="tag-editor-row">
          <select
            className="tag-select"
            value=""
            onChange={(e) => {
              if (e.target.value) handleAddTagToTask(e.target.value);
            }}
          >
            <option value="">タグを選択...</option>
            {tags.filter((t) => !taskTags.includes(t)).map((tag) => (
              <option key={tag} value={tag}>#{tag}</option>
            ))}
          </select>
          <input
            className="tag-input"
            type="text"
            placeholder="新規タグ"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddTagToTask(newTagName);
            }}
          />
          <button className="tag-add-btn" onClick={() => handleAddTagToTask(newTagName)}>追加</button>
        </div>
      </div>

      <div className="progress-status-row">
        <span className="progress-status-label">進捗ステータス</span>
        <select
          className="progress-status-select"
          value={progressStatus}
          onChange={handleProgressStatusChange}
        >
          <option value="未着">未着</option>
          <option value="仕掛">仕掛</option>
          <option value="完了">完了</option>
        </select>
      </div>

      {/* フッター */}
      <div className="detail-footer">
        <select
          className="df-list-select"
          value={listName}
          onChange={handleListChange}
          title="リストを変更"
        >
          <option value="">📥 リストなし</option>
          {lists.map((l) => (
            <option key={l.name} value={l.name}>
              {l.name}
            </option>
          ))}
        </select>
        <div className="df-actions">
          <span className="df-icon">🔗</span>
          <span className="df-icon">⋯</span>
        </div>
      </div>
    </div>
  );
}

export default DetailPane;
