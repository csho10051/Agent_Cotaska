import React, { useEffect, useState, useRef } from "react";
import MarkdownIt from "markdown-it";
import DueDatePopover from "./DueDatePopover";

const PRIORITY_LABEL = { normal: "低", medium: "中", high: "高" };
const PRIORITY_COLOR = { normal: "#aaa", medium: "#f39c12", high: "#e74c3c" };
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });

function formatDatetime(value) {
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
  return `${y}/${m}/${d}`;
}

// 後方互換のためエイリアスを維持
const formatCompletedAt = formatDatetime;

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
  const [metaOpen, setMetaOpen] = useState(true);
  const [openExternalError, setOpenExternalError] = useState("");

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

  const handleOpenInExternalApp = async () => {
    setOpenExternalError("");

    const taskFilePath = String(task.task_file_path || "").trim();

    if (!taskFilePath) {
      setOpenExternalError("対象ファイルパスが見つかりません。");
      return;
    }

    try {
      const result = await window.cotaskaAPI?.shell?.openPath?.(taskFilePath);
      if (!result?.ok) {
        setOpenExternalError(result?.error || "既定アプリで開けませんでした。");
      }
    } catch (error) {
      setOpenExternalError(error?.message || "既定アプリ起動に失敗しました。");
    }
  };

  return (
    <div className="detail-pane">
      {/* === detail-header: チェック + タイトル + 右上アクション === */}
      <div className="detail-header">
        <input type="checkbox" className="d-check" checked={completed} onChange={handleComplete} />

        <input
          className={`header-title${completed ? " completed" : ""}`}
          value={titleText}
          placeholder="タスク名"
          onChange={(e) => {
            const nextTitle = e.target.value;
            setTitleText(nextTitle);
            debouncedSave(nextTitle, contentText);
          }}
        />

        <div className="detail-actions">
          <button
            type="button"
            className="icon-action-btn"
            onClick={() => setPreviewMode((prev) => !prev)}
            title={previewMode ? "編集モードへ切替" : "プレビュー表示へ切替"}
            aria-label={previewMode ? "編集モードへ切替" : "プレビュー表示へ切替"}
          >
            {previewMode ? "✏" : "🔍"}
          </button>
          <button
            type="button"
            className="icon-action-btn external"
            onClick={handleOpenInExternalApp}
            title="新しいアプリで開く"
            aria-label="新しいアプリで開く"
          >
            ↗
          </button>
        </div>
      </div>
      {openExternalError && <div className="detail-open-error">{openExternalError}</div>}

      {/* === detail-meta: メタ情報集約セクション === */}
      <div className="detail-meta">
        <span className="meta-section-header" onClick={() => setMetaOpen((prev) => !prev)}>
          {metaOpen ? "▼" : "▶"} メタ情報
        </span>

        {metaOpen && (
          <>
            {/* Row 1: 進捗 + 期限 + 優先度 */}
            <div className="meta-row">
              <div className="meta-item">
                <span className="meta-item-label">進捗:</span>
                <select className="meta-select" value={progressStatus} onChange={handleProgressStatusChange}>
                  <option value="未着">未着</option>
                  <option value="仕掛">仕掛</option>
                  <option value="完了">完了</option>
                </select>
              </div>
              <span className="meta-due-anchor" onClick={(e) => e.stopPropagation()}>
                <span className="meta-item-label">期限:</span>
                <span
                  className={`meta-due${task.overdue ? " overdue" : ""}`}
                  onClick={() => setDueEditorOpen(true)}
                >
                  {task.due || "未設定"}
                </span>
                {dueEditorOpen && (
                  <DueDatePopover
                    className="due-dialog--detail"
                    value={task.due_date}
                    onChange={handleDueDateChange}
                    onClear={() => handleDueDateChange(null)}
                    onClose={() => setDueEditorOpen(false)}
                  />
                )}
              </span>
              <div className="meta-item">
                <span className="meta-item-label">優先度:</span>
                <select
                  className="meta-select"
                  value={priority}
                  onChange={handlePriorityChange}
                  style={{ color: PRIORITY_COLOR[priority] }}
                  title="優先度を変更"
                >
                  <option value="normal">{PRIORITY_LABEL.normal}</option>
                  <option value="medium">{PRIORITY_LABEL.medium}</option>
                  <option value="high">{PRIORITY_LABEL.high}</option>
                </select>
              </div>
            </div>

            {/* Row 2: リスト + タグ選択 + タグ入力 */}
            <div className="meta-row">
              <select className="meta-select" value={listName} onChange={handleListChange} title="リストを設定" style={{ minWidth: 90 }}>
                <option value="">リストなし</option>
                {lists.map((l) => (
                  <option key={l.name} value={l.name}>
                    {l.name}
                  </option>
                ))}
              </select>

              <select
                className="meta-tag-select"
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
                className="meta-tag-input"
                type="text"
                placeholder="新タグ"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddTagToTask(newTagName);
                }}
              />

              <button className="meta-tag-add-btn" onClick={() => handleAddTagToTask(newTagName)}>
                追加
              </button>
            </div>

            {/* Row 3: タグチップス */}
            <div className="meta-tag-row">
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
          </>
        )}
      </div>

      {/* === detail-body: メモ本文 === */}
      <div className="detail-body">
        <div className="body-section-header">▼ タスク詳細</div>

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

      {/* === detail-footer: 登録日時・完了日時・ID === */}
      <div className="detail-footer">
        {task.created_at && (
          <span className="d-task-id" style={{ marginRight: "auto" }}>登録日時：{formatDatetime(task.created_at)}</span>
        )}
        {completedAtText && (
          <span className="d-task-id" style={{ marginRight: 12 }}>完了日時：{completedAtText}</span>
        )}
        <span className="d-task-id">ID: {task.id}</span>
      </div>
    </div>
  );
}

export default DetailPane;
