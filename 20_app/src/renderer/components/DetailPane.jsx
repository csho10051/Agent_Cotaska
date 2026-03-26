import React, { useEffect, useState, useRef } from "react";
import MarkdownIt from "markdown-it";
import DueDatePopover from "./DueDatePopover";

const PRIORITY_LABEL = { normal: "低", medium: "中", high: "高" };
const PRIORITY_COLOR = { normal: "#aaa", medium: "#f39c12", high: "#e74c3c" };
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });

function formatCompletedAt(value) {
  if (!value) return "";

  const raw = String(value);
  const parsed = new Date(raw);
  const fallbackParsed = Number.isNaN(parsed.getTime()) ? new Date(raw.replace(" ", "T")) : parsed;
  if (Number.isNaN(fallbackParsed.getTime())) {
    return raw.replace("T", " ").slice(0, 16);
  }

  const y = fallbackParsed.getFullYear();
  const m = String(fallbackParsed.getMonth() + 1).padStart(2, "0");
  const d = String(fallbackParsed.getDate()).padStart(2, "0");
  const hh = String(fallbackParsed.getHours()).padStart(2, "0");
  const mm = String(fallbackParsed.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function useDebounce(fn, delay) {
  const timer = useRef(null);
  return (...args) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fn(...args), delay);
  };
}

function DetailPane({
  task,
  onClose,
  onSaved,
  onToggleComplete,
  onSetTaskDue,
  lists = [],
  tags = [],
  onSetTaskTags,
  onAddTag,
}) {
  if (!task) {
    return (
      <div className="detail-pane detail-pane--empty">
        <span className="detail-empty-msg">タスクを選択してください</span>
      </div>
    );
  }

  return (
    <DetailPaneBody
      task={task}
      onClose={onClose}
      onSaved={onSaved}
      onToggleComplete={onToggleComplete}
      onSetTaskDue={onSetTaskDue}
      lists={lists}
      tags={tags}
      onSetTaskTags={onSetTaskTags}
      onAddTag={onAddTag}
    />
  );
}

function DetailPaneBody({
  task,
  onSaved,
  onToggleComplete,
  onSetTaskDue,
  lists = [],
  tags = [],
  onSetTaskTags,
  onAddTag,
}) {
  const [priority, setPriority] = useState(task.priority ?? "normal");
  const [status, setStatus] = useState(task.status);
  const [completed, setCompleted] = useState(task.status === "done");
  const [progressStatus, setProgressStatus] = useState(
    task.progressStatus || (task.status === "done" ? "完了" : "未着")
  );
  const [titleText, setTitleText] = useState(task.title || "");
  const [contentText, setContentText] = useState(task.content || "");
  const [listName, setListName] = useState(task.list ?? "");
  const [taskTags, setTaskTags] = useState(task.tags || []);
  const [newTagName, setNewTagName] = useState("");
  const [previewMode, setPreviewMode] = useState(false);
  const [dueEditorOpen, setDueEditorOpen] = useState(false);
  const [completedAt, setCompletedAt] = useState(task.completed_at || null);
  const dueAnchorRef = useRef(null);

  const persist = async (patch) => {
    await window.cotaskaAPI?.tasks?.update({
      id: task.id,
      title: titleText,
      content: contentText,
      status,
      progress_status: progressStatus,
      priority,
      list: listName || null,
      parent: task.parent ?? null,
      tags: taskTags,
      due_date: task.due_date || null,
      ...patch,
    });
    onSaved?.();
  };

  const debouncedSave = useDebounce(async (nextTitle, nextContent) => {
    await persist({ title: nextTitle, content: nextContent });
  }, 500);

  const handlePriorityChange = async (e) => {
    const nextPriority = e.target.value;
    setPriority(nextPriority);
    await persist({ priority: nextPriority });
  };

  const handleComplete = async (e) => {
    const done = e.target.checked;
    const nextStatus = done ? "done" : "todo";
    const nextCompletedAt = done ? (completedAt || new Date().toISOString()) : null;
    setCompleted(done);
    setCompletedAt(nextCompletedAt);
    const nextProgressStatus = done ? "完了" : "仕掛";
    setProgressStatus(nextProgressStatus);
    setStatus(nextStatus);

    if (onToggleComplete) {
      await onToggleComplete(task);
      return;
    }

    await persist({ status: nextStatus, progress_status: nextProgressStatus });
  };

  const handleProgressStatusChange = async (e) => {
    const next = e.target.value;
    setProgressStatus(next);
    const nextStatus = next === "完了" ? "done" : "todo";
    const nextCompletedAt = nextStatus === "done" ? (completedAt || new Date().toISOString()) : null;
    setCompleted(nextStatus === "done");
    setCompletedAt(nextCompletedAt);
    setStatus(nextStatus);
    await persist({ progress_status: next, status: nextStatus });
  };

  const isDone = status === "done" || progressStatus === "完了";
  const completedAtText = isDone ? formatCompletedAt(completedAt || task.completed_at) : "";

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

  const handleListChange = async (e) => {
    const newListName = e.target.value;
    setListName(newListName);
    await persist({ list: newListName || null });
  };

  const handleAddTagToTask = async (name) => {
    const tag = String(name || "").trim();
    if (!tag || taskTags.includes(tag)) return;

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
      <div className="detail-header">
        <input type="checkbox" className="d-check" checked={completed} onChange={handleComplete} />

        <span className="detail-due-anchor" ref={dueAnchorRef} onClick={(e) => e.stopPropagation()}>
          <span
            className={`d-due${task.overdue ? " overdue" : ""}`}
            onClick={() => setDueEditorOpen((prev) => !prev)}
          >
            期限: {task.due || "未設定"}
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

        <span className="d-priority-group">
          <span className="d-priority-label">優先度：</span>
          <select
            className="d-priority-select"
            value={priority}
            onChange={handlePriorityChange}
            style={{ color: PRIORITY_COLOR[priority] }}
            title="優先度を変更"
          >
            <option value="normal">{PRIORITY_LABEL.normal}</option>
            <option value="medium">{PRIORITY_LABEL.medium}</option>
            <option value="high">{PRIORITY_LABEL.high}</option>
          </select>
        </span>

        <button type="button" className="preview-toggle-btn" onClick={() => setPreviewMode((prev) => !prev)}>
          {previewMode ? "編集" : "プレビュー"}
        </button>
      </div>

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
            dangerouslySetInnerHTML={{
              __html: contentText ? markdown.render(contentText) : "<p>プレビューはありません。</p>",
            }}
          />
        ) : (
          <textarea
            className="detail-content"
            value={contentText}
            placeholder="メモを入力..."
            onChange={(e) => {
              const nextContent = e.target.value;
              setContentText(nextContent);
              debouncedSave(titleText, nextContent);
            }}
          />
        )}
      </div>

      <div className="tag-area">
        <div className="tag-chips">
          {taskTags.map((tag) => (
            <span key={tag} className="tag">
              #{tag}
              <button className="tag-remove-btn" onClick={() => handleRemoveTagFromTask(tag)} title="タグを削除">
                x
              </button>
            </span>
          ))}
          {taskTags.length === 0 && <span className="tag-empty">タグを追加してください</span>}
        </div>

        <div className="tag-editor-row">
          <select
            className="tag-select"
            value=""
            onChange={(e) => {
              if (e.target.value) handleAddTagToTask(e.target.value);
            }}
          >
            <option value="">タグ選択...</option>
            {tags
              .filter((t) => !taskTags.includes(t))
              .map((tag) => (
                <option key={tag} value={tag}>
                  #{tag}
                </option>
              ))}
          </select>

          <input
            className="tag-input"
            type="text"
            placeholder="新しいタグ"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddTagToTask(newTagName);
            }}
          />

          <button className="tag-add-btn" onClick={() => handleAddTagToTask(newTagName)}>
            追加
          </button>
        </div>
      </div>

      <div className="progress-status-row">
        <span className="progress-status-label">進捗ステータス</span>
        <select className="progress-status-select" value={progressStatus} onChange={handleProgressStatusChange}>
          <option value="未着">未着</option>
          <option value="仕掛">仕掛</option>
          <option value="完了">完了</option>
        </select>
        {completedAtText && <span className="completed-at-label">完了日時: {completedAtText}</span>}
      </div>

      <div className="detail-footer">
        <select className="df-list-select" value={listName} onChange={handleListChange} title="リストを設定">
          <option value="">リストなし</option>
          {lists.map((l) => (
            <option key={l.name} value={l.name}>
              {l.name}
            </option>
          ))}
        </select>
        <span className="d-task-id">ID: {task.id}</span>
      </div>
    </div>
  );
}

export default DetailPane;
