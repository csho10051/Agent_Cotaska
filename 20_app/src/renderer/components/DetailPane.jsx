import React, { useEffect, useState, useRef } from "react";
import MarkdownIt from "markdown-it";
import DueDatePopover from "./DueDatePopover";

const PRIORITY_LABEL = { normal: "低", medium: "中", high: "高" };
const PRIORITY_COLOR = { normal: "#aaa", medium: "#f39c12", high: "#e74c3c" };
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });
const SUBTASK_PANEL_MIN_HEIGHT = 120;
const SUBTASK_PANEL_MAX_HEIGHT = 520;
const SUBTASK_PANEL_DEFAULT_HEIGHT = 260;
const SUBTASK_PANEL_STORAGE_KEY = "cotaska.detailSubtasksHeight";
const DETAIL_CONTENT_FONT_MIN = 12;
const DETAIL_CONTENT_FONT_MAX = 22;
const DETAIL_CONTENT_FONT_DEFAULT = 14;
const DETAIL_CONTENT_FONT_STORAGE_KEY = "cotaska.detailContentFontSize";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function highlightInlineMarkdown(value) {
  const source = String(value || "");
  const tokenPattern = /(`[^`]+`|\*\*[^*\n]+?\*\*|\*[^*\s][^*\n]*?\*|\[[^\]\n]+\]\([^)]+\))/g;
  let cursor = 0;
  let html = "";

  source.replace(tokenPattern, (match, _token, offset) => {
    html += escapeHtml(source.slice(cursor, offset));
    const className = match.startsWith("`")
      ? "md-token-code"
      : match.startsWith("**")
        ? "md-token-strong"
        : match.startsWith("[")
          ? "md-token-link"
          : "md-token-em";
    html += `<span class="${className}">${escapeHtml(match)}</span>`;
    cursor = offset + match.length;
    return match;
  });

  html += escapeHtml(source.slice(cursor));
  return html;
}

function renderMarkdownEditorLine(line) {
  if (!line) return "&nbsp;";

  const heading = line.match(/^(#{1,6})(\s+.*)?$/);
  if (heading) {
    const level = Math.min(heading[1].length, 6);
    return `<span class="md-heading md-heading-${level}"><span class="md-marker">${escapeHtml(heading[1])}</span>${highlightInlineMarkdown(heading[2] || "")}</span>`;
  }

  const quote = line.match(/^(\s*>+\s?)(.*)$/);
  if (quote) {
    return `<span class="md-quote"><span class="md-marker">${escapeHtml(quote[1])}</span>${highlightInlineMarkdown(quote[2])}</span>`;
  }

  const unordered = line.match(/^(\s*)([-+*]\s+)(.*)$/);
  if (unordered) {
    return `${escapeHtml(unordered[1])}<span class="md-list-marker">${escapeHtml(unordered[2])}</span>${highlightInlineMarkdown(unordered[3])}`;
  }

  const ordered = line.match(/^(\s*)(\d+\.\s+)(.*)$/);
  if (ordered) {
    return `${escapeHtml(ordered[1])}<span class="md-list-marker">${escapeHtml(ordered[2])}</span>${highlightInlineMarkdown(ordered[3])}`;
  }

  return highlightInlineMarkdown(line);
}

function renderMarkdownEditorHtml(value) {
  const lines = String(value || "").split("\n");
  return lines
    .map((line) => `<div class="markdown-editor-line">${renderMarkdownEditorLine(line)}</div>`)
    .join("");
}

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
  tasks = [],
  onClose,
  onSelectTask,
  onSaved,
  onToggleComplete,
  onSetTaskDue,
  lists = [],
  tags = [],
  onSetTaskTags,
  onAddTag,
  expanded = false,
  onToggleExpanded,
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
      tasks={tasks}
      onClose={onClose}
      onSelectTask={onSelectTask}
      onSaved={onSaved}
      onToggleComplete={onToggleComplete}
      onSetTaskDue={onSetTaskDue}
      lists={lists}
      tags={tags}
      onSetTaskTags={onSetTaskTags}
      onAddTag={onAddTag}
      expanded={expanded}
      onToggleExpanded={onToggleExpanded}
    />
  );
}

function DetailPaneBody({
  task,
  tasks = [],
  onSelectTask,
  onSaved,
  onToggleComplete,
  onSetTaskDue,
  lists = [],
  tags = [],
  onSetTaskTags,
  onAddTag,
  expanded = false,
  onToggleExpanded,
}) {
  const isInvalid = Boolean(task.is_invalid);
  const hierarchyWarning = !isInvalid ? String(task.hierarchyWarning || "") : "";
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
  const [subtasksOpen, setSubtasksOpen] = useState(true);
  const [subtaskPanelHeight, setSubtaskPanelHeight] = useState(() => {
    if (typeof window === "undefined") return SUBTASK_PANEL_DEFAULT_HEIGHT;
    const saved = Number(window.localStorage?.getItem(SUBTASK_PANEL_STORAGE_KEY));
    if (!Number.isFinite(saved)) return SUBTASK_PANEL_DEFAULT_HEIGHT;
    return clamp(saved, SUBTASK_PANEL_MIN_HEIGHT, SUBTASK_PANEL_MAX_HEIGHT);
  });
  const [detailContentFontSize, setDetailContentFontSize] = useState(() => {
    if (typeof window === "undefined") return DETAIL_CONTENT_FONT_DEFAULT;
    const saved = Number(window.localStorage?.getItem(DETAIL_CONTENT_FONT_STORAGE_KEY));
    if (!Number.isFinite(saved)) return DETAIL_CONTENT_FONT_DEFAULT;
    return clamp(saved, DETAIL_CONTENT_FONT_MIN, DETAIL_CONTENT_FONT_MAX);
  });
  const [subtaskNodeExpanded, setSubtaskNodeExpanded] = useState({});
  const subtaskResizeRef = useRef(null);
  const detailPaneRef = useRef(null);
  const markdownHighlightRef = useRef(null);
  const [openExternalError, setOpenExternalError] = useState("");

  const parentTask = tasks.find((candidate) =>
    candidate.id === task.parent && !candidate.is_invalid
  );
  const sortedTasks = [...tasks].sort((a, b) =>
    (a.sort_order || 0) - (b.sort_order || 0) || String(a.id).localeCompare(String(b.id))
  );
  const relatedTasksByParent = sortedTasks.reduce((acc, candidate) => {
    if (!candidate.parent || candidate.is_invalid || candidate.hierarchyOverLimit || candidate.hierarchyCycle) return acc;
    if (!acc[candidate.parent]) acc[candidate.parent] = [];
    acc[candidate.parent].push(candidate);
    return acc;
  }, {});

  const collectRelatedSubtasks = (parentId, depth = 1, seen = new Set()) => {
    if (depth > 5 || seen.has(parentId)) return [];
    const nextSeen = new Set(seen);
    nextSeen.add(parentId);
    return (relatedTasksByParent[parentId] || []).flatMap((child) => [
      { task: child, depth },
      ...collectRelatedSubtasks(child.id, depth + 1, nextSeen),
    ]);
  };

  const relatedSubtasks = collectRelatedSubtasks(task.id);

  useEffect(() => {
    window.localStorage?.setItem(SUBTASK_PANEL_STORAGE_KEY, String(subtaskPanelHeight));
  }, [subtaskPanelHeight]);

  useEffect(() => {
    window.localStorage?.setItem(DETAIL_CONTENT_FONT_STORAGE_KEY, String(detailContentFontSize));
  }, [detailContentFontSize]);

  useEffect(() => {
    const handleResizeMove = (event) => {
      const drag = subtaskResizeRef.current;
      if (!drag) return;
      const deltaY = event.clientY - drag.startY;
      const viewportMax = Math.max(
        SUBTASK_PANEL_MIN_HEIGHT,
        Math.min(SUBTASK_PANEL_MAX_HEIGHT, window.innerHeight - 260)
      );
      setSubtaskPanelHeight(clamp(drag.startHeight - deltaY, SUBTASK_PANEL_MIN_HEIGHT, viewportMax));
    };

    const handleResizeEnd = () => {
      subtaskResizeRef.current = null;
      document.body.classList.remove("is-resizing-detail-sections");
    };

    window.addEventListener("mousemove", handleResizeMove);
    window.addEventListener("mouseup", handleResizeEnd);

    return () => {
      window.removeEventListener("mousemove", handleResizeMove);
      window.removeEventListener("mouseup", handleResizeEnd);
      document.body.classList.remove("is-resizing-detail-sections");
    };
  }, []);

  const handleSubtaskPanelResizeStart = (event) => {
    event.preventDefault();
    subtaskResizeRef.current = {
      startY: event.clientY,
      startHeight: subtaskPanelHeight,
    };
    document.body.classList.add("is-resizing-detail-sections");
  };

  const adjustDetailContentFontSize = (delta) => {
    setDetailContentFontSize((current) =>
      clamp(current + delta, DETAIL_CONTENT_FONT_MIN, DETAIL_CONTENT_FONT_MAX)
    );
  };

  useEffect(() => {
    const isTextZoomShortcut = (event) => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return 0;
      const key = String(event.key || "").toLowerCase();
      const code = String(event.code || "");
      if (
        event.key === "+" ||
        event.key === "=" ||
        key === "+" ||
        key === "=" ||
        key === "add" ||
        key === "plus" ||
        code === "Equal" ||
        code === "Semicolon" ||
        code === "NumpadAdd"
      ) {
        return 1;
      }
      if (
        event.key === "-" ||
        event.key === "_" ||
        key === "-" ||
        key === "_" ||
        key === "subtract" ||
        key === "minus" ||
        code === "Minus" ||
        code === "NumpadSubtract"
      ) {
        return -1;
      }
      return 0;
    };

    const handleDetailShortcutKeyDown = (event) => {
      const delta = isTextZoomShortcut(event);
      if (delta === 0) return;
      event.preventDefault();
      event.stopPropagation();
      adjustDetailContentFontSize(delta);
    };

    const handleDetailShortcutWheel = (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      adjustDetailContentFontSize(event.deltaY < 0 ? 1 : -1);
    };

    const removeMainShortcutListener = window.cotaskaAPI?.onDetailContentFontAdjust?.((delta) => {
      adjustDetailContentFontSize(Number(delta) > 0 ? 1 : -1);
    });

    const pane = detailPaneRef.current;
    window.addEventListener("keydown", handleDetailShortcutKeyDown, true);
    document.addEventListener("keydown", handleDetailShortcutKeyDown, true);
    document.addEventListener("wheel", handleDetailShortcutWheel, { capture: true, passive: false });
    window.addEventListener("wheel", handleDetailShortcutWheel, { capture: true, passive: false });
    pane?.addEventListener("wheel", handleDetailShortcutWheel, { capture: true, passive: false });

    return () => {
      removeMainShortcutListener?.();
      window.removeEventListener("keydown", handleDetailShortcutKeyDown, true);
      document.removeEventListener("keydown", handleDetailShortcutKeyDown, true);
      document.removeEventListener("wheel", handleDetailShortcutWheel, { capture: true });
      window.removeEventListener("wheel", handleDetailShortcutWheel, { capture: true });
      pane?.removeEventListener("wheel", handleDetailShortcutWheel, { capture: true });
    };
  }, []);

  const progressBadgeClass = (targetTask) => {
    if (targetTask.is_invalid) return "invalid";
    if (targetTask.status === "done" || targetTask.progressStatus === "完了") return "done";
    if (targetTask.progressStatus === "仕掛") return "in-progress";
    if (targetTask.progressStatus === "保留") return "on-hold";
    return "not-started";
  };

  const handleSelectRelatedTask = (targetTask) => {
    if (!targetTask || targetTask.is_invalid) return;
    onSelectTask?.(targetTask);
  };

  const renderRelatedSubtaskRows = (parentId, depth = 1, seen = new Set()) => {
    if (depth > 5 || seen.has(parentId)) return null;
    const nextSeen = new Set(seen);
    nextSeen.add(parentId);

    return (relatedTasksByParent[parentId] || []).map((subtask) => {
      const children = depth < 5 ? (relatedTasksByParent[subtask.id] || []) : [];
      const isExpanded = subtaskNodeExpanded[subtask.id] !== false;
      return (
        <React.Fragment key={subtask.id}>
          <div
            className={`detail-subtask-row${subtask.status === "done" ? " detail-subtask-row--done" : ""}`}
            style={{ "--task-depth": depth }}
            onClick={() => handleSelectRelatedTask(subtask)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleSelectRelatedTask(subtask);
              }
            }}
          >
            <button
              type="button"
              className={`detail-subtask-expand${children.length === 0 ? " detail-subtask-expand--hidden" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setSubtaskNodeExpanded((prev) => ({ ...prev, [subtask.id]: !isExpanded }));
              }}
              title="展開/折りたたみ"
            >
              {isExpanded ? "▼" : "▶"}
            </button>
            <input
              type="checkbox"
              checked={subtask.status === "done"}
              onChange={async (e) => {
                e.stopPropagation();
                await onToggleComplete?.(subtask);
              }}
              onClick={(e) => e.stopPropagation()}
            />
            <span className={`progress-status-badge ${progressBadgeClass(subtask)}`}>
              {subtask.progressStatus || (subtask.status === "done" ? "完了" : "未着")}
            </span>
            <span className="detail-subtask-title">{subtask.title}</span>
            {subtask.due && <span className={`detail-subtask-due${subtask.overdue ? " overdue" : ""}`}>{subtask.due}</span>}
            <span className="detail-subtask-meta">{subtask.id}</span>
          </div>
          {isExpanded && renderRelatedSubtaskRows(subtask.id, depth + 1, nextSeen)}
        </React.Fragment>
      );
    });
  };

  const persist = async (patch) => {
    if (isInvalid) return;
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
    if (isInvalid) return;
    const nextPriority = e.target.value;
    setPriority(nextPriority);
    await persist({ priority: nextPriority });
  };

  const handleComplete = async (e) => {
    if (isInvalid) return;
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
    if (isInvalid) return;
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
  const validationLocation = [
    task.validation_error_line ? `行 ${task.validation_error_line}` : "",
    task.validation_error_column ? `列 ${task.validation_error_column}` : "",
  ].filter(Boolean).join(" / ");

  const handleDueDateChange = async (nextDue) => {
    if (isInvalid) return;
    if (onSetTaskDue) {
      await onSetTaskDue(task, nextDue);
    } else {
      await persist({ due_date: nextDue || null });
    }
    setDueEditorOpen(false);
  };

  const handleListChange = async (e) => {
    if (isInvalid) return;
    const newListName = e.target.value;
    setListName(newListName);
    await persist({ list: newListName || null });
  };

  const handleAddTagToTask = async (name) => {
    if (isInvalid) return;
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
    if (isInvalid) return;
    const next = taskTags.filter((t) => t !== tag);
    setTaskTags(next);
    await onSetTaskTags?.(task, next);
  };

  const handleOpenInExternalApp = async () => {
    setOpenExternalError("");

    try {
      const result = await window.cotaskaAPI?.shell?.openTaskFile?.(task.id);
      if (!result?.ok) {
        setOpenExternalError(result?.error || "既定アプリで開けませんでした。");
      }
    } catch (error) {
      setOpenExternalError(error?.message || "既定アプリ起動に失敗しました。");
    }
  };

  const handlePreviewLinkClick = async (event) => {
    if (isInvalid) return;
    const anchor = event.target?.closest?.("a");
    if (!anchor) return;

    event.preventDefault();
    event.stopPropagation();

    const href = String(anchor.getAttribute("href") || "").trim();
    if (!href) return;

    setOpenExternalError("");
    try {
      const result = await window.cotaskaAPI?.shell?.openTaskTarget?.(task.id, href);
      if (!result?.ok) {
        setOpenExternalError(result?.error || "リンク先を開けませんでした。");
      }
    } catch (error) {
      setOpenExternalError(error?.message || "リンク先の起動に失敗しました。");
    }
  };

  const highlightedContentHtml = renderMarkdownEditorHtml(contentText);
  const detailContentFontStyle = { fontSize: `${detailContentFontSize}px` };
  const handleEditorScroll = (event) => {
    if (markdownHighlightRef.current) {
      markdownHighlightRef.current.scrollTop = event.currentTarget.scrollTop;
      markdownHighlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
    }
  };

  return (
    <div
      ref={detailPaneRef}
      className="detail-pane"
      style={{ "--detail-content-font-size": `${detailContentFontSize}px` }}
    >
      {/* === detail-header: チェック + タイトル + 右上アクション === */}
      <div className="detail-header">
        <input type="checkbox" className="d-check" checked={completed} onChange={handleComplete} disabled={isInvalid} />

        <input
          className={`header-title${completed ? " completed" : ""}${isInvalid ? " invalid" : ""}`}
          value={titleText}
          placeholder="タスク名"
          readOnly={isInvalid}
          onChange={(e) => {
            if (isInvalid) return;
            const nextTitle = e.target.value;
            setTitleText(nextTitle);
            debouncedSave(nextTitle, contentText);
          }}
        />

        <div className="detail-actions">
          <button
            type="button"
            className={`icon-action-btn detail-expand-btn${expanded ? " is-active" : ""}`}
            onClick={onToggleExpanded}
            title={expanded ? "元のサイズに戻す" : "タスク詳細を拡大"}
            aria-label={expanded ? "タスク詳細を元のサイズに戻す" : "タスク詳細を拡大"}
            aria-pressed={expanded}
          >
            {expanded ? "↙" : "⛶"}
          </button>
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
      {hierarchyWarning && (
        <div className="detail-validation-error detail-validation-error--warning">
          <div className="detail-validation-title">
            <span className="detail-validation-mark">!</span>
            階層の確認が必要です
          </div>
          <div className="detail-validation-body">
            <div>{hierarchyWarning}</div>
            <div>このタスクは一覧上では1階層目相当として表示されます。</div>
          </div>
        </div>
      )}
      {isInvalid && (
        <div className="detail-validation-error">
          <div className="detail-validation-title">
            <span className="detail-validation-mark">!</span>
            タスクファイルの読み込みに失敗しました
          </div>
          <div className="detail-validation-body">
            <div>対象ファイル: {task.validation_file_path || "不明"}</div>
            {task.validation_error_name && <div>種類: {task.validation_error_name}</div>}
            {validationLocation && <div>位置: {validationLocation}</div>}
            {task.validation_error && <div>内容: {task.validation_error}</div>}
          </div>
        </div>
      )}

      {/* === detail-meta: メタ情報集約セクション === */}
      <div className="detail-meta">
        <span className="meta-section-header" onClick={() => setMetaOpen((prev) => !prev)}>
          {metaOpen ? "▼" : "▶"} メタ情報
        </span>

        {metaOpen && (
          <>
            {/* Row 1: 進捗 + 日付 + 優先度 */}
            <div className="meta-row">
              <div className="meta-item">
                <span className="meta-item-label">進捗:</span>
                <select className="meta-select" value={progressStatus} onChange={handleProgressStatusChange} disabled={isInvalid}>
                  {isInvalid && <option value="要確認">要確認</option>}
                  <option value="未着">未着</option>
                  <option value="仕掛">仕掛</option>
                  <option value="保留">保留</option>
                  <option value="完了">完了</option>
                </select>
              </div>
              <span className="meta-due-anchor" onClick={(e) => e.stopPropagation()}>
                <span className="meta-item-label">日付:</span>
                <span
                  className={`meta-due${task.overdue ? " overdue" : ""}`}
                  onClick={() => {
                    if (!isInvalid) setDueEditorOpen(true);
                  }}
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
                  disabled={isInvalid}
                >
                  <option value="normal">{PRIORITY_LABEL.normal}</option>
                  <option value="medium">{PRIORITY_LABEL.medium}</option>
                  <option value="high">{PRIORITY_LABEL.high}</option>
                </select>
              </div>
            </div>

            {/* Row 2: リスト + タグ選択 + タグ入力 */}
            <div className="meta-row">
              <select className="meta-select" value={listName} onChange={handleListChange} title="リストを設定" style={{ minWidth: 90 }} disabled={isInvalid}>
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
                disabled={isInvalid}
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
                disabled={isInvalid}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddTagToTask(newTagName);
                }}
              />

              <button className="meta-tag-add-btn" onClick={() => handleAddTagToTask(newTagName)} disabled={isInvalid}>
                追加
              </button>
            </div>

            {/* Row 3: タグチップス */}
            <div className="meta-tag-row">
              {taskTags.map((tag) => (
                <span key={tag} className="tag">
                  #{tag}
                  <button className="tag-remove-btn" onClick={() => handleRemoveTagFromTask(tag)} title="タグを削除" disabled={isInvalid}>
                    x
                  </button>
                </span>
              ))}
              {taskTags.length === 0 && <span className="tag-empty">タグを追加してください</span>}
            </div>
          </>
        )}
      </div>

      {parentTask && (
        <div className="detail-parent-link-wrap">
          <button
            type="button"
            className="detail-parent-link"
            onClick={() => handleSelectRelatedTask(parentTask)}
            title={`親タスクへ移動: ${parentTask.title}`}
          >
            <span className="detail-parent-label">親タスク</span>
            <span className="detail-parent-title">{parentTask.title}</span>
            <span className="detail-parent-id">{parentTask.id}</span>
            <span className="detail-parent-arrow">›</span>
          </button>
        </div>
      )}

      {/* === detail-body: メモ本文 === */}
      <div className="detail-body">
        <div className="body-section-header">▼ タスク詳細</div>

        {previewMode ? (
          <div
            className={`detail-preview${contentText ? "" : " detail-preview--empty"}`}
            style={detailContentFontStyle}
            onClick={handlePreviewLinkClick}
            dangerouslySetInnerHTML={{
              __html: contentText ? markdown.render(contentText) : "<p>プレビューはありません。</p>",
            }}
          />
        ) : (
          <div className={`markdown-editor-shell${isInvalid ? " markdown-editor-shell--readonly" : ""}`}>
            <div
              ref={markdownHighlightRef}
              className="markdown-editor-highlight"
              style={detailContentFontStyle}
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: highlightedContentHtml }}
            />
            <textarea
              className="detail-content markdown-editor-input"
              style={detailContentFontStyle}
              value={contentText}
              placeholder="メモを入力..."
              readOnly={isInvalid}
              spellCheck={false}
              onScroll={handleEditorScroll}
              onChange={(e) => {
                if (isInvalid) return;
                const nextContent = e.target.value;
                setContentText(nextContent);
                debouncedSave(titleText, nextContent);
              }}
            />
          </div>
        )}
      </div>

      {relatedSubtasks.length > 0 && subtasksOpen && (
        <div
          className="detail-section-resize-handle"
          onMouseDown={handleSubtaskPanelResizeStart}
          title="Resize task detail and related subtasks"
          role="separator"
          aria-orientation="horizontal"
        />
      )}

      {relatedSubtasks.length > 0 && (
        <div
          className={`detail-subtasks${subtasksOpen ? " detail-subtasks--open" : " detail-subtasks--collapsed"}`}
          style={subtasksOpen ? { height: subtaskPanelHeight } : undefined}
        >
          <button
            type="button"
            className="detail-subtasks-header"
            onClick={() => setSubtasksOpen((prev) => !prev)}
            aria-expanded={subtasksOpen}
          >
            <span>{subtasksOpen ? "▼" : "▶"}関連サブタスク</span>
            <span className="detail-subtasks-count">{relatedSubtasks.length}</span>
          </button>
          {subtasksOpen && (
            <div className="detail-subtask-list">
              {renderRelatedSubtaskRows(task.id)}
            </div>
          )}
        </div>
      )}

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
