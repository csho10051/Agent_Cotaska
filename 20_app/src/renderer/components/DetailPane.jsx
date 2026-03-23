import React, { useEffect, useState, useRef } from "react";
import MarkdownIt from "markdown-it";
import DueDatePopover from "./DueDatePopover";

const PRIORITIES = ["normal", "medium", "high"];
const PRIORITY_ICON = { normal: "N", medium: "M", high: "H" };
const PRIORITY_COLOR = { normal: "#aaa", medium: "#f39c12", high: "#e74c3c" };
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });

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
        <span className="detail-empty-msg">Select a task</span>
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
  onClose,
  onSaved,
  onToggleComplete,
  onSetTaskDue,
  lists = [],
  tags = [],
  onSetTaskTags,
  onAddTag,
}) {
  const [progress, setProgress] = useState(task.progress ?? 0);
  const [priority, setPriority] = useState(task.priority ?? "normal");
  const [status, setStatus] = useState(task.status);
  const [completed, setCompleted] = useState(task.status === "done");
  const [progressStatus, setProgressStatus] = useState(
    task.progressStatus || (task.status === "done" ? "完亁E" : "未着")
  );
  const [titleText, setTitleText] = useState(task.title || "");
  const [contentText, setContentText] = useState(task.content || "");
  const [listName, setListName] = useState(task.list ?? "");
  const [taskTags, setTaskTags] = useState(task.tags || []);
  const [newTagName, setNewTagName] = useState("");
  const [saveState, setSaveState] = useState("idle");
  const [previewMode, setPreviewMode] = useState(false);
  const [dueEditorOpen, setDueEditorOpen] = useState(false);
  const dueAnchorRef = useRef(null);

  const showSaved = (delay = 1200) => {
    setSaveState("saving");
    setTimeout(() => setSaveState("saved"), 300);
    setTimeout(() => setSaveState("idle"), delay);
  };

  const persist = async (patch) => {
    await window.CotaskaAPI?.tasks?.update({
      id: task.id,
      title: titleText,
      content: contentText,
      status,
      progress_status: progressStatus,
      is_manual_progress: task.parent == null ? 1 : (task.isManualProgress ? 1 : 0),
      priority,
      progress,
      list: listName || null,
      parent: task.parent ?? null,
      tags: taskTags,
      due_date: task.due_date || null,
      ...patch,
    });
    onSaved?.();
    showSaved();
  };

  const debouncedSave = useDebounce(async (nextTitle, nextContent) => {
    await persist({ title: nextTitle, content: nextContent });
  }, 500);

  const handleProgressClick = async (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.round(((e.clientX - rect.left) / rect.width) * 100);
    const newPct = Math.max(0, Math.min(100, pct));
    setProgress(newPct);
    await persist({ progress: newPct });
  };

  const cyclePriority = async () => {
    const idx = PRIORITIES.indexOf(priority);
    const newPrio = PRIORITIES[(idx + 1) % PRIORITIES.length];
    setPriority(newPrio);
    await persist({ priority: newPrio });
  };

  const handleComplete = async (e) => {
    const done = e.target.checked;
    const nextStatus = done ? "done" : "todo";
    setCompleted(done);
    const nextProgressStatus = done ? "完亁E" : "仕掛";
    setProgressStatus(nextProgressStatus);
    setStatus(nextStatus);

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
    const nextStatus = next === "完亁E" ? "done" : "todo";
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
            Due: {task.due || "No due date"}
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
          title="Change priority"
          style={{ color: PRIORITY_COLOR[priority], cursor: "pointer" }}
          onClick={cyclePriority}
        >
          {PRIORITY_ICON[priority]}
        </span>

        <button type="button" className="preview-toggle-btn" onClick={() => setPreviewMode((prev) => !prev)}>
          {previewMode ? "Edit" : "Preview"}
        </button>

        {saveState === "saving" && <span className="save-indicator">Saving...</span>}
        {saveState === "saved" && <span className="save-indicator saved">Saved</span>}

        <button className="close-btn" onClick={onClose}>x</button>
      </div>

      <div
        className="progress-bar-track"
        onClick={handleProgressClick}
        title={`Progress: ${progress}% (click to set)`}
        style={{ cursor: "pointer" }}
      >
        <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="progress-labels">
        <span>0%</span>
        <span style={{ color: progress > 0 ? "#4772fa" : undefined }}>{progress}%</span>
        <span>100%</span>
      </div>

      <div className="detail-body">
        <input
          className={`detail-title${completed ? " completed" : ""}`}
          value={titleText}
          placeholder="Task title"
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
              __html: contentText ? markdown.render(contentText) : "<p>No preview content.</p>",
            }}
          />
        ) : (
          <textarea
            className="detail-content"
            value={contentText}
            placeholder="Write notes..."
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
              <button className="tag-remove-btn" onClick={() => handleRemoveTagFromTask(tag)} title="Remove tag">
                x
              </button>
            </span>
          ))}
          {taskTags.length === 0 && <span className="tag-empty">No tags</span>}
        </div>

        <div className="tag-editor-row">
          <select
            className="tag-select"
            value=""
            onChange={(e) => {
              if (e.target.value) handleAddTagToTask(e.target.value);
            }}
          >
            <option value="">Select tag...</option>
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
            placeholder="New tag"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddTagToTask(newTagName);
            }}
          />

          <button className="tag-add-btn" onClick={() => handleAddTagToTask(newTagName)}>
            Add
          </button>
        </div>
      </div>

      <div className="progress-status-row">
        <span className="progress-status-label">Progress status</span>
        <select className="progress-status-select" value={progressStatus} onChange={handleProgressStatusChange}>
          <option value="未着">未着</option>
          <option value="仕掛">仕掛</option>
          <option value="完亁E">完亁E</option>
        </select>
      </div>

      <div className="detail-footer">
        <select className="df-list-select" value={listName} onChange={handleListChange} title="Set list">
          <option value="">No list</option>
          {lists.map((l) => (
            <option key={l.name} value={l.name}>
              {l.name}
            </option>
          ))}
        </select>

        <div className="df-actions">
          <span className="df-icon">L</span>
          <span className="df-icon">M</span>
        </div>
      </div>
    </div>
  );
}

export default DetailPane;
