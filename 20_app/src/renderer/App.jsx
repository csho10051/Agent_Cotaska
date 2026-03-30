import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import "./App.css";
import Sidebar    from "./components/Sidebar";
import NavPanel   from "./components/NavPanel";
import MainPane   from "./components/MainPane";
import DetailPane from "./components/DetailPane";

const TAG_NAV_PREFIX = "tag:";

// ── Markdownファイル → UI オブジェクトの変換 ────────────────────────────────────
function formatDue(due_date) {
  if (!due_date) return "";
  const [, m, d] = due_date.split("-");
  return `${parseInt(m)}/${parseInt(d)}`;
}

// T-031: frontmatterフィールドに対応（file-first architecture）
function mapFileTask(taskData) {
  const today = localDateString();
  const progressStatus = taskData.progress_status || (taskData.status === "done" ? "完了" : "未着");
  return {
    id:        taskData.id,
    title:     taskData.title,
    content:   taskData.content || "",
    status:    taskData.status,
    progressStatus,
    priority:  taskData.priority || "normal",
    progress:  taskData.progress || 0,
    parent:    taskData.parent ?? null,           // parent_idではなくparent
    list:      taskData.list ?? null,             // list_idではなくlist（文字列）
    tags:      taskData.tags || [],               // frontmatterの新フィールド
    sort_order: taskData.sort_order ?? 0,
    completed_at: taskData.completed_at || null,
    due_date:  taskData.due_date || null,
    due:       formatDue(taskData.due_date),
    overdue:   taskData.due_date ? taskData.due_date < today && taskData.status !== "done" : false,
  };
}

function calcParentProgress(subtasks) {
  const statuses = subtasks.map((t) => t.progressStatus || (t.status === "done" ? "完了" : "未着"));
  if (statuses.length > 0 && statuses.every((status) => status === "完了")) return "完了";
  if (statuses.some((status) => status === "仕掛" || status === "完了")) return "仕掛";
  return "未着";
}

// T-031: frontmatter形式でのペイロード作成
function toFileTaskPayload(task, patch = {}) {
  return {
    id: task.id,
    title: task.title,
    content: task.content || "",
    status: task.status,
    progress_status: task.progressStatus || (task.status === "done" ? "完了" : "未着"),
    priority: task.priority || "normal",
    progress: task.progress ?? 0,
    parent: task.parent ?? null,         // parent_idではなくparent
    list: task.list ?? null,             // list_idではなくlist（文字列）
    tags: task.tags || [],
    due_date: task.due_date || null,
    ...patch,
  };
}
// ─────────────────────────────────────────────────────────────────

// ── ビュー別セクション構築ユーティリティ ────────────────────────────────
const PRIORITY_ORDER = { high: 0, medium: 1, normal: 2 };

// BUG-20260319-01 修正: ローカルタイムゾーン基準で日付文字列を返す
function localDateString(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(base, n) {
  const d = new Date(base + "T00:00:00");
  d.setDate(d.getDate() + n);
  return localDateString(d);  // toISOString() はUTC変換でタイムゾーンがずれるため使用しない
}

function sortByPriority(arr) {
  return [...arr].sort((a, b) =>
    (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2)
  );
}

const FIXED_VIEWS = new Set(["すべて", "今日", "明日", "次の7日間", "完了", "ゴミ箱", "受信トレイ", "リストなし"]);

/**
 * 今日 / 次の7日間ビューでセクション配列を返す。它以外は null。
 * @returns {{ label: string, tasks: object[] }[] | null}
 */
function buildSections(allTasks, view) {
  const today = localDateString();
  if (view === "今日") {
    const filtered = allTasks.filter(
      (t) => t.due_date && t.due_date <= today && t.status !== "done"
    );
    const sections = [];
    const overdue    = sortByPriority(filtered.filter((t) => t.due_date < today));
    const todayTasks = sortByPriority(filtered.filter((t) => t.due_date === today));
    if (overdue.length)    sections.push({ label: "⚠️ 遅延", tasks: overdue });
    if (todayTasks.length) sections.push({ label: "☀️ 今日",   tasks: todayTasks });
    return sections;
  }
  if (view === "次の7日間") {
    const today7 = addDays(today, 7);
    const day1   = addDays(today, 1);
    const day2   = addDays(today, 2);
    const filtered = allTasks.filter(
      (t) => t.due_date && t.due_date <= today7 && t.status !== "done"
    );
    
    const sections  = [];
    const overdue    = sortByPriority(filtered.filter((t) => t.due_date <  today));
    const todayTasks = sortByPriority(filtered.filter((t) => t.due_date === today));
    const tomorrows  = sortByPriority(filtered.filter((t) => t.due_date === day1));
    const later      = sortByPriority(filtered.filter((t) => t.due_date >= day2 && t.due_date <= today7));
    if (overdue.length)    sections.push({ label: "⚠️ 遅延",   tasks: overdue });
    if (todayTasks.length) sections.push({ label: "☀️ 今日",   tasks: todayTasks });
    if (tomorrows.length)  sections.push({ label: "📅 明日",   tasks: tomorrows });
    if (later.length)      sections.push({ label: "📆 以降",   tasks: later });
    return sections;
  }
  return null;
}
// ─────────────────────────────────────────────────────────────────

function App() {
  const [tasks,         setTasks]         = useState([]);
  const [selectedTask,  setSelectedTask]  = useState(null);
  const [activeNav,     setActiveNav]     = useState("今日");
  const [activeIcon,    setActiveIcon]    = useState("リスト");
  const [loading,       setLoading]       = useState(true);
  const [allCount,      setAllCount]      = useState(0);
  const [todayCount,    setTodayCount]    = useState(0);
  const [tomorrowCount, setTomorrowCount] = useState(0);
  const [next7DaysCount, setNext7DaysCount] = useState(0);
  const [lists,         setLists]         = useState([]);
  const [trashedTasks,   setTrashedTasks]   = useState([]);
  const [completedTasks, setCompletedTasks] = useState([]);
  const [searchKeyword,  setSearchKeyword]  = useState("");
  const [tags, setTags] = useState([]);

  // CHG-032: ペイン幅リサイズ
  const [navWidth,    setNavWidth]    = useState(240);
  const [detailWidth, setDetailWidth] = useState(380);
  const resizeDragRef = useRef(null);

  // T-005-02: DB からタスク一覧を読み込む
  // T-031: tasks:changed イベントリスナー登録（リアルタイム同期）
  useEffect(() => {
    const handleTasksChanged = (data) => {
      console.log('[App] tasks:changed event received', data);
      loadTasks();
    };
    window.cotaskaAPI?.onTasksChanged?.(handleTasksChanged);
    return () => {
      // アンマウント時にリスナーを削除
      window.cotaskaAPI?.removeTasksChangedListener?.();
    };
  }, []);

  // CHG-032: ペイン幅ドラッグリサイズ
  useEffect(() => {
    const onMove = (e) => {
      const drag = resizeDragRef.current;
      if (!drag) return;
      const delta = e.clientX - drag.startX;
      if (drag.type === "nav") {
        setNavWidth(Math.max(160, Math.min(480, drag.startWidth + delta)));
      } else {
        setDetailWidth(Math.max(280, Math.min(640, drag.startWidth - delta)));
      }
    };
    const onUp = () => { resizeDragRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      let rows   = await window.cotaskaAPI?.tasks?.getAll() ?? [];
      let mapped = rows.map(mapFileTask);

      // T-015-03: 親タスクの進捗ステータスを最悪値ストラテジで自動推定
      // 子タスクを持つ親は常に子タスク連動で進捗を再計算する。
      const byParent = {};
      mapped.forEach((task) => {
        const pid = task.parent;
        if (pid === null || pid === undefined) return;
        if (!byParent[pid]) byParent[pid] = [];
        byParent[pid].push(task);
      });

      let parentStatusUpdated = false;
      for (const parent of mapped) {
        const children = byParent[parent.id] || [];
        if (children.length === 0) continue;
        const estimated = calcParentProgress(children);
        const estimatedTaskStatus = estimated === "完了" ? "done" : "todo";
        if (parent.progressStatus !== estimated || parent.status !== estimatedTaskStatus) {
          await window.cotaskaAPI?.tasks?.update(
            toFileTaskPayload(parent, {
              progress_status: estimated,
              status: estimatedTaskStatus,
            })
          );
          parentStatusUpdated = true;
        }
      }

      if (parentStatusUpdated) {
        rows = await window.cotaskaAPI?.tasks?.getAll() ?? [];
        mapped = rows.map(mapFileTask);
      }

      setTasks(mapped);

      // 固定ビューのバッジ件数
      const today = localDateString();
      const tomorrow = addDays(today, 1);
      const next7 = addDays(today, 7);
      setAllCount(mapped.filter((t) => t.status !== "done").length);
      setTodayCount(mapped.filter(t => t.due_date && t.due_date <= today && t.status !== "done").length);
      setTomorrowCount(mapped.filter((t) => t.due_date === tomorrow && t.status !== "done").length);
      setNext7DaysCount(mapped.filter((t) => t.due_date && t.due_date <= next7 && t.status !== "done").length);

      // 選択中タスクがまだ存在する場合は最新データで上書き
      setSelectedTask(prev =>
        prev ? (mapped.find(t => t.id === prev.id) ?? null) : null
      );
    } catch (err) {
      console.error("[loadTasks]", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTags = useCallback(async () => {
    const rows = await window.cotaskaAPI?.tags?.getAll() ?? [];
    setTags(Array.isArray(rows) ? rows : []);
  }, []);

  useEffect(() => {
    // IPC 疎通確認
    window.cotaskaAPI?.ping().then(res => console.log("[IPC] ping →", res));
    loadTasks(); // ← 他の useEffect に移動しました
    // リスト一覧を起動時に取得
    (async () => {
      const rows = await window.cotaskaAPI?.lists?.getAll() ?? [];
      setLists(rows);
      const tagRows = await window.cotaskaAPI?.tags?.getAll() ?? [];
      setTags(Array.isArray(tagRows) ? tagRows : []);
    })();
  }, [loadTasks]);

  // T-005-03: クイック追加
  // BUG-20260317-01 修正: 「今日」「次の7日間」ビューでは due_date=null のタスクが
  // buildSections のフィルタで除外されるため、当日日付を自動設定する
  const handleAddTask = useCallback(async (title) => {
    if (!title.trim()) return;
    const today = localDateString();
    const tomorrow = addDays(today, 1);
    const due_date = activeNav === "明日"
      ? tomorrow
      : (activeNav === "今日" || activeNav === "次の7日間")
        ? today
        : null;
    // T-031: list_id ではなく list（文字列）を使用
    const list = FIXED_VIEWS.has(activeNav) || activeNav.startsWith(TAG_NAV_PREFIX) ? null : activeNav;
    const defaultTags = activeNav.startsWith(TAG_NAV_PREFIX) ? [activeNav.slice(TAG_NAV_PREFIX.length)] : [];
    await window.cotaskaAPI?.tasks?.add({
      title:    title.trim(),
      status:   "todo",
      progress_status: "未着",
      priority: "normal",
      progress: 0,
      due_date,
      list,  // list_id ではなく list（リスト名）
      tags: defaultTags,
    });
    await loadTasks();
  }, [loadTasks, activeNav]);

  // T-014-02: サブタスク追加
  const handleAddSubtask = useCallback(async (parentTask, title) => {
    if (!title.trim()) return;
    await window.cotaskaAPI?.tasks?.add({
      title:     title.trim(),
      status:    "todo",
      progress_status: "未着",
      priority:  "normal",
      progress:  0,
      parent:    parentTask.id,      // parent_id ではなく parent
      list:      parentTask.list,     // list_id ではなく list
      due_date:  parentTask.due_date || null,
    });
    await loadTasks();
  }, [loadTasks]);

  // T-005-04: 完了 / 完了取消
  const handleToggleComplete = useCallback(async (task) => {
    const newStatus = task.status === "done" ? "todo" : "done";
    const newProgressStatus = newStatus === "done" ? "完了" : "仕掛";
    await window.cotaskaAPI?.tasks?.update(
      toFileTaskPayload(task, {
        status: newStatus,
        progress_status: newProgressStatus,
      })
    );

    // CHG-009: 親タスク完了時はサブタスクも自動完了（カスケード）
    if (newStatus === "done" && task.parent == null) {
      const children = tasks.filter(t => t.parent === task.id && t.status !== "done");
      for (const child of children) {
        await window.cotaskaAPI?.tasks?.update(
          toFileTaskPayload(child, {
            status: "done",
            progress_status: "完了",
          })
        );
      }
    }

    await loadTasks();
  }, [loadTasks, tasks]);

  // T-005-05: 詳細ペイン保存後にリスト再取得
  const handleSaved = useCallback(() => loadTasks(), [loadTasks]);

  // T-014-03: タスク複製
  const handleDuplicateTask = useCallback(async (task) => {
    await window.cotaskaAPI?.tasks?.add({
      title:     `${task.title}（コピー）`,
      content:   task.content || "",
      status:    "todo",
      progress_status: "未着",
      priority:  task.priority || "normal",
      progress:  0,
      parent:    task.parent ?? null,
      list:      task.list ?? null,
      due_date:  task.due_date || null,
    });
    await loadTasks();
  }, [loadTasks]);

  // T-014-03: リスト設定
  const handleSetTaskList = useCallback(async (task, newList) => {
    await window.cotaskaAPI?.tasks?.update(toFileTaskPayload(task, { list: newList }));
    await loadTasks();
  }, [loadTasks]);

  const handleSetTaskDue = useCallback(async (task, dueDate) => {
    await window.cotaskaAPI?.tasks?.update(
      toFileTaskPayload(task, { due_date: dueDate || null })
    );
    await loadTasks();
  }, [loadTasks]);

  const handleReorderTask = useCallback(async ({ draggedTaskId, targetTaskId = null, toSectionType = null, toSectionLabel = null }) => {
    const dragged = tasks.find((t) => t.id === draggedTaskId);
    if (!dragged) return;
    if (dragged.status === "done") return;

    const today = localDateString();
    const tomorrow = addDays(today, 1);
    const fieldUpdates = {};

    if (toSectionType === "date") {
      if (String(toSectionLabel || "").includes("明日") && dragged.due_date !== tomorrow) {
        fieldUpdates[dragged.id] = { ...(fieldUpdates[dragged.id] || {}), due_date: tomorrow };
      }
      if (String(toSectionLabel || "").includes("今日") && dragged.due_date !== today) {
        fieldUpdates[dragged.id] = { ...(fieldUpdates[dragged.id] || {}), due_date: today };
      }
    }

    if (toSectionType === "progress") {
      if (dragged.status === "done") return;
      if (toSectionLabel === "完了" && dragged.progressStatus !== "完了") {
        fieldUpdates[dragged.id] = { ...(fieldUpdates[dragged.id] || {}), progress_status: "完了" };
      }
      // 「未着・仕掛」セクションへのドラッグは progress_status を変更しない
    }

    const reorderable = tasks
      .filter((t) => t.status !== "done")
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.id).localeCompare(String(b.id)));

    const ids = reorderable.map((t) => t.id).filter((id) => id !== draggedTaskId);
    if (targetTaskId && ids.includes(targetTaskId)) {
      const target = tasks.find((t) => t.id === targetTaskId);
      if (target && dragged.parent !== target.parent) return;

      const insertAt = ids.indexOf(targetTaskId);
      ids.splice(insertAt, 0, draggedTaskId);
    } else {
      ids.push(draggedTaskId);
    }

    await window.cotaskaAPI?.tasks?.reorder({
      ordered_ids: ids,
      field_updates: fieldUpdates,
    });
    await loadTasks();
  }, [loadTasks, tasks]);

  // T-006: リスト操作
  const loadLists = useCallback(async () => {
    const rows = await window.cotaskaAPI?.lists?.getAll() ?? [];
    setLists(rows);
  }, []);

  const handleAddList = useCallback(async (name, color) => {
    await window.cotaskaAPI?.lists?.add({ name, color });
    await loadLists();
  }, [loadLists]);

  const handleUpdateList = useCallback(async (listName, updates) => {
    await window.cotaskaAPI?.lists?.update(listName, updates);
    await loadLists();
  }, [loadLists]);

  const handleDeleteList = useCallback(async (name) => {
    // T-031: list_id ではなく name（文字列）を渡す
    await window.cotaskaAPI?.lists?.delete(name);
    await loadLists();
    await loadTasks(); // 所属タスクの list を null に変更するため再取得
  }, [loadLists, loadTasks]);

  const handleAddTag = useCallback(async (name) => {
    await window.cotaskaAPI?.tags?.add(name);
    await loadTags();
  }, [loadTags]);

  const handleDeleteTag = useCallback(async (name) => {
    await window.cotaskaAPI?.tags?.delete(name);
    await loadTags();
    await loadTasks();
    if (activeNav === `${TAG_NAV_PREFIX}${name}`) {
      setActiveNav("今日");
    }
  }, [activeNav, loadTags, loadTasks]);

  const handleSetTaskTags = useCallback(async (task, nextTags) => {
    await window.cotaskaAPI?.taskTags?.set(task.id, nextTags);
    await loadTasks();
    await loadTags();
  }, [loadTasks, loadTags]);

  // T-005-06: ゴミ箱移動
  const handleTrashTask = useCallback(async (task) => {
    await window.cotaskaAPI?.tasks?.trashTask(task.id);
    if (selectedTask?.id === task.id) setSelectedTask(null);
    await loadTasks();
  }, [loadTasks, selectedTask]);

  // T-005-06: ゴミ箱内タスク一覧（activeNav === "ゴミ箱" のとき使用）
  useEffect(() => {
    if (activeNav !== "ゴミ箱") return;
    (async () => {
      const rows = await window.cotaskaAPI?.tasks?.getTrashed() ?? [];
      setTrashedTasks(rows.map(mapFileTask));
    })();
  }, [activeNav, tasks]); // tasks 変化時も再取得

  // T-007-03: 完了ビュー
  useEffect(() => {
    if (activeNav !== "完了") return;
    (async () => {
      const rows = await window.cotaskaAPI?.tasks?.getCompleted() ?? [];
      setCompletedTasks(rows.map(mapFileTask));
    })();
  }, [activeNav, tasks]); // tasks 変化時も再取得

  // T-007-04: 検索モードを離れたときにキーワードをリセット
  const isSearchMode = activeIcon === "検索";
  useEffect(() => {
    if (!isSearchMode) setSearchKeyword("");
  }, [isSearchMode]);

  // T-005-06: 復元
  const handleRestoreTask = useCallback(async (task) => {
    await window.cotaskaAPI?.tasks?.restoreTask(task.id);
    await loadTasks();
  }, [loadTasks]);

  // T-005-06: 完全削除
  const handleDeleteTask = useCallback(async (task) => {
    await window.cotaskaAPI?.tasks?.deleteTask(task.id);
    await loadTasks();
  }, [loadTasks]);

  // T-004-05: サイドバーアイコンに応じてナビパネルの表示を制御
  const navVisible = activeIcon === "リスト";

  const tagCounts = useMemo(() => {
    const counts = {};
    tasks.forEach((task) => {
      (task.tags || []).forEach((tag) => {
        counts[tag] = (counts[tag] || 0) + 1;
      });
    });
    return counts;
  }, [tasks]);

  // ビュー別タスクフィルタとセクション構築
  // T-031: list_id ではなく list（文字列）でフィルタ
  let visibleTasks;
  let visibleSections = null;
  let progressSections = null;

  if (isSearchMode) {
    // T-007-04: 検索モード — delete_flag=0 の全タスクをキーワードでフィルタ
    if (!searchKeyword.trim()) {
      visibleTasks = [];
    } else {
      const kw = searchKeyword.toLowerCase();
      visibleTasks = tasks.filter((t) =>
        t.title.toLowerCase().includes(kw) ||
        (t.content && t.content.toLowerCase().includes(kw))
      );
    }
  } else if (activeNav === "ゴミ箱") {
    visibleTasks = trashedTasks;
  } else if (activeNav === "完了") {
    visibleTasks = completedTasks;
  } else if (loading) {
    visibleTasks = [];
  } else if (activeNav === "すべて") {
    visibleTasks = tasks.filter((t) => t.status !== "done");
  } else if (activeNav === "明日") {
    const tomorrow = addDays(localDateString(), 1);
    visibleTasks = tasks.filter((t) => t.due_date === tomorrow && t.status !== "done");
  } else if (activeNav === "今日" || activeNav === "次の7日間") {
    visibleSections = buildSections(tasks, activeNav);
    visibleTasks    = visibleSections.flatMap((s) => s.tasks);
  } else if (activeNav === "受信トレイ" || activeNav === "リストなし") {
    // T-007-05: 完了済みタスクは完了ビューへ
    // T-031: list_id を list に変更
    visibleTasks = tasks.filter((t) =>
      (t.list === null || t.list === undefined) && t.status !== "done"
    );
  } else {
    if (activeNav.startsWith(TAG_NAV_PREFIX)) {
      const activeTag = activeNav.slice(TAG_NAV_PREFIX.length);
      // CHG-011: 完了タスクは完了セクションへ移動するため status フィルタを追加
      visibleTasks = tasks.filter((t) => (t.tags || []).includes(activeTag) && t.status !== "done");
    } else {
      // T-031: list_id ではなく list（文字列）でフィルタ
      // CHG-011: 完了タスクは完了セクションへ移動するため status フィルタを追加
      visibleTasks = tasks.filter((t) => t.list === activeNav && t.status !== "done");
    }
  }

  // CHG-011: 完了セクション（各ビューのリスト下部に表示する完了タスク）
  let completedSectionTasks = [];
  if (!isSearchMode && activeNav !== "ゴミ箱" && activeNav !== "完了" && !loading) {
    const today = localDateString();
    if (activeNav === "すべて") {
      completedSectionTasks = tasks.filter((t) => t.status === "done");
    } else if (activeNav === "今日") {
      // BUG-20260330-01: 「今日」完了セクションは今日期限の完了タスクのみ表示する
      completedSectionTasks = tasks.filter((t) => t.status === "done" && t.due_date === today);
    } else if (activeNav === "明日") {
      const tomorrow = addDays(today, 1);
      completedSectionTasks = tasks.filter((t) => t.status === "done" && t.due_date === tomorrow);
    } else if (activeNav === "次の7日間") {
      const today7 = addDays(today, 7);
      completedSectionTasks = tasks.filter((t) => t.status === "done" && t.due_date && t.due_date <= today7);
    } else if (activeNav === "受信トレイ" || activeNav === "リストなし") {
      completedSectionTasks = tasks.filter((t) => t.status === "done" && (t.list === null || t.list === undefined));
    } else if (activeNav.startsWith(TAG_NAV_PREFIX)) {
      const activeTag = activeNav.slice(TAG_NAV_PREFIX.length);
      completedSectionTasks = tasks.filter((t) => t.status === "done" && (t.tags || []).includes(activeTag));
    } else {
      completedSectionTasks = tasks.filter((t) => t.status === "done" && t.list === activeNav);
    }
  }

  const useProgressSections = !isSearchMode && activeNav !== "ゴミ箱";

  if (useProgressSections) {
    const merged = visibleTasks.filter((t) => t.progressStatus === "未着" || t.progressStatus === "仕掛");
    const completedProg = visibleTasks.filter((t) => t.progressStatus === "完了");
    progressSections = [];
    if (merged.length > 0) progressSections.push({ label: "未着・仕掛", tasks: merged });
    if (completedProg.length > 0) progressSections.push({ label: "完了", tasks: completedProg });
  }

  return (
    <div className="app-container">
      <Sidebar
        activeIcon={activeIcon}
        onIconClick={setActiveIcon}
      />
      {navVisible && (
        <>
          <div style={{ width: navWidth, flexShrink: 0, overflow: "hidden", display: "flex", alignSelf: "stretch" }}>
            <NavPanel
              activeNav={activeNav}
              onNavClick={setActiveNav}
              allBadge={allCount}
              todayBadge={todayCount}
              tomorrowBadge={tomorrowCount}
              next7DaysBadge={next7DaysCount}
              lists={lists}
              onAddList={handleAddList}
              onUpdateList={handleUpdateList}
              onDeleteList={handleDeleteList}
              tags={tags}
              tagCounts={tagCounts}
              onAddTag={handleAddTag}
              onDeleteTag={handleDeleteTag}
              tagNavPrefix={TAG_NAV_PREFIX}
            />
          </div>
          <div
            className="resize-handle"
            onMouseDown={(e) => {
              e.preventDefault();
              resizeDragRef.current = { type: "nav", startX: e.clientX, startWidth: navWidth };
            }}
          />
        </>
      )}
      <MainPane
        viewTitle={isSearchMode ? "検索" : (activeNav.startsWith(TAG_NAV_PREFIX) ? `タグ: #${activeNav.slice(TAG_NAV_PREFIX.length)}` : activeNav)}
        tasks={visibleTasks}
        sections={visibleSections}
        progressSections={progressSections}
        completedSectionTasks={completedSectionTasks}
        selectedTaskId={selectedTask?.id}
        onTaskClick={setSelectedTask}
        onAddTask={!isSearchMode && activeNav !== "ゴミ箱" && activeNav !== "完了" ? handleAddTask : null}
        onAddSubtask={!isSearchMode && activeNav !== "ゴミ箱" && activeNav !== "完了" ? handleAddSubtask : null}
        onToggleComplete={!isSearchMode && activeNav !== "ゴミ箱" ? handleToggleComplete : null}
        onTrashTask={!isSearchMode && activeNav !== "ゴミ箱" && activeNav !== "完了" ? handleTrashTask : null}
        onRestoreTask={activeNav === "ゴミ箱" ? handleRestoreTask : null}
        onDeleteTask={activeNav === "ゴミ箱" ? handleDeleteTask : null}
        onDuplicateTask={!isSearchMode && activeNav !== "ゴミ箱" && activeNav !== "完了" ? handleDuplicateTask : null}
        onSetTaskList={!isSearchMode && activeNav !== "ゴミ箱" && activeNav !== "完了" ? handleSetTaskList : null}
        onSetTaskDue={!isSearchMode && activeNav !== "ゴミ箱" ? handleSetTaskDue : null}
        onReorderTask={!isSearchMode && activeNav !== "ゴミ箱" && activeNav !== "完了" ? handleReorderTask : null}
        onSetTaskTags={!isSearchMode && activeNav !== "ゴミ箱" ? handleSetTaskTags : null}
        lists={lists}
        tags={tags}
        isTrashed={activeNav === "ゴミ箱"}
        isCompleted={activeNav === "完了"}
        isSearchMode={isSearchMode}
        searchKeyword={searchKeyword}
        onSearchChange={setSearchKeyword}
      />
      <div
        className="resize-handle"
        onMouseDown={(e) => {
          e.preventDefault();
          resizeDragRef.current = { type: "detail", startX: e.clientX, startWidth: detailWidth };
        }}
      />
      <div style={{ width: detailWidth, flexShrink: 0, overflow: "hidden", display: "flex", alignSelf: "stretch" }}>
        <DetailPane
          key={selectedTask?.id ?? "none"}
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onSaved={handleSaved}
          onToggleComplete={handleToggleComplete}
          onSetTaskDue={handleSetTaskDue}
          lists={lists}
          tags={tags}
          onSetTaskTags={handleSetTaskTags}
          onAddTag={handleAddTag}
        />
      </div>
    </div>
  );
}

export default App;
