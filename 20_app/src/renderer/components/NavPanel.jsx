import React, { useState, useRef, useEffect } from "react";

// 固定項目の定義（badge は props から渡す）
const SMART_ITEMS = [
  { label: "すべて",     emoji: "🗂️", badgeKey: "allBadge" },
  { label: "今日",       emoji: "☀️", badgeKey: "todayBadge" },
  { label: "明日",       emoji: "📅", badgeKey: "tomorrowBadge" },
  { label: "次の7日間",  emoji: "📆", badgeKey: "next7DaysBadge" },
];

// リスト用カラーパレット
const COLORS = ["#4772fa","#e67e22","#2ecc71","#e74c3c","#9b59b6","#1abc9c","#f1c40f","#e91e63"];

/**
 * NavPanel — リスト・フィルター・タグの切り替えナビゲーション（240px固定）
 *
 * Props:
 *   activeNav    : string — 現在選択中の項目ラベル
 *   onNavClick   : (label: string) => void
 *   allBadge     : number — 「すべて」バッジに表示する件数
 *   todayBadge   : number — 「今日」バッジに表示する件数
 *   tomorrowBadge: number — 「明日」バッジに表示する件数
 *   next7DaysBadge: number — 「次の7日間」バッジに表示する件数
 *   lists        : { name, color }[] — YAMLから取得したリスト一覧
 *   onAddList    : (name: string, color: string) => Promise<void>
 *   onUpdateList : (listName: string, updates: { name, color }) => Promise<void>
 *   onDeleteList : (name: string) => Promise<void>
 */
function NavPanel({ activeNav, onNavClick, allBadge = 0, todayBadge = 0, tomorrowBadge = 0, next7DaysBadge = 0, noListBadge = 0, lists = [],
                    onAddList, onUpdateList, onDeleteList,
                    tags = [], tagCounts = {}, onAddTag, onDeleteTag, tagNavPrefix = "tag:" }) {
  // 各セクションの折りたたみ状態
  const [listCollapsed,   setListCollapsed]   = useState(false);
  const [tagCollapsed,    setTagCollapsed]    = useState(false);

  // リスト作成フォーム
  const [adding,    setAdding]    = useState(false);
  const [newName,   setNewName]   = useState("");
  const [newColor,  setNewColor]  = useState(COLORS[0]);
  const addInputRef = useRef(null);

  // リスト編集（インライン）
  const [editingId,   setEditingId]   = useState(null);
  const [editName,    setEditName]    = useState("");
  const [editColor,   setEditColor]   = useState("");
  const editInputRef = useRef(null);

  // タグ作成フォーム
  const [addingTag, setAddingTag] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const tagInputRef = useRef(null);

  // ホバー中のリストID
  const [hoveredId, setHoveredId] = useState(null);

  const smartItemBadges = {
    allBadge,
    todayBadge,
    tomorrowBadge,
    next7DaysBadge,
  };

  // 作成入力欄が表示されたらフォーカス
  useEffect(() => {
    if (adding) addInputRef.current?.focus();
  }, [adding]);

  // 編集入力欄が表示されたらフォーカス
  useEffect(() => {
    if (editingId !== null) editInputRef.current?.focus();
  }, [editingId]);

  useEffect(() => {
    if (addingTag) tagInputRef.current?.focus();
  }, [addingTag]);

  // リスト作成確定
  const commitAdd = async () => {
    const name = newName.trim();
    if (name) await onAddList?.(name, newColor);
    setAdding(false);
    setNewName("");
    setNewColor(COLORS[0]);
  };

  // リスト編集確定
  const commitEdit = async () => {
    const name = editName.trim();
    if (name && editingId !== null) {
      await onUpdateList?.(editingId, { name, color: editColor });
    }
    setEditingId(null);
  };

  const commitAddTag = async () => {
    const name = newTagName.trim();
    if (name) await onAddTag?.(name);
    setAddingTag(false);
    setNewTagName("");
  };

  // リスト削除
  const handleDelete = async (e, list) => {
    e.stopPropagation();
    if (window.confirm(`「${list.name}」を削除しますか？\n所属タスクはリストなしに移動します。`)) {
      await onDeleteList?.(list.name);
      if (activeNav === list.name) onNavClick?.("すべて");
    }
  };

  // 編集開始
  const startEdit = (e, list) => {
    e.stopPropagation();
    setEditingId(list.name);
    setEditName(list.name);
    setEditColor(list.color || COLORS[0]);
  };

  return (
    <div className="nav-panel">
      <div style={{ paddingTop: 8 }} />

      {/* スマートリスト */}
      {SMART_ITEMS.map(({ label, emoji, badgeKey }) => (
        <div
          key={label}
          className={`nav-item${activeNav === label ? " active" : ""}`}
          onClick={() => onNavClick?.(label)}
        >
          <span className="icon">{emoji}</span>
          {label}
          {smartItemBadges[badgeKey] > 0 && (
            <span className="badge">{smartItemBadges[badgeKey]}</span>
          )}
        </div>
      ))}

      {/* リストセクション（折りたたみ対応） */}
      <div className="divider" />
      <div className="section-label" onClick={() => setListCollapsed((v) => !v)} style={{ cursor: "pointer" }}>
        <span className={`section-chevron${listCollapsed ? " collapsed" : ""}`}>▼</span>
        リスト
        <span
          className="add-btn"
          title="リストを追加"
          onClick={(e) => { e.stopPropagation(); setAdding(true); setListCollapsed(false); }}
        >＋</span>
      </div>

      {!listCollapsed && (
        <>
          {/* リストなし（固定） */}
          <div
            className={`nav-item nav-item--list${activeNav === "リストなし" ? " active" : ""}`}
            onClick={() => onNavClick?.("リストなし")}
          >
            <span className="icon">📂</span>
            <span className="list-name">リストなし</span>
            {noListBadge > 0 && <span className="badge">{noListBadge}</span>}
          </div>

          {/* 既存リスト */}
          {lists.map((list) => (
            <div
              key={list.name}
              className={`nav-item nav-item--list${activeNav === list.name ? " active" : ""}`}
              onClick={() => editingId !== list.name && onNavClick?.(list.name)}
              onMouseEnter={() => setHoveredId(list.name)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {editingId === list.name ? (
                /* インライン編集モード */
                <div className="list-edit-row" onClick={(e) => e.stopPropagation()}>
                  <input
                    ref={editInputRef}
                    className="list-inline-input"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter")  commitEdit();
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    onBlur={commitEdit}
                  />
                  <div className="list-color-row">
                    {COLORS.map((c) => (
                      <span
                        key={c}
                        className={`color-dot${editColor === c ? " selected" : ""}`}
                        style={{ background: c }}
                        onMouseDown={(e) => { e.preventDefault(); setEditColor(c); }}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                /* 通常表示 */
                <>
                  <span className="list-dot" style={{ background: list.color || "#aaa" }} />
                  <span className="list-name">{list.name}</span>
                  {hoveredId === list.name && (
                    <span className="list-menu">
                      <span className="list-menu-btn" title="編集" onClick={(e) => startEdit(e, list)}>✎</span>
                      <span className="list-menu-btn list-menu-btn--del" title="削除" onClick={(e) => handleDelete(e, list)}>✕</span>
                    </span>
                  )}
                </>
              )}
            </div>
          ))}

          {/* インライン作成フォーム */}
          {adding && (
            <div className="list-add-form" onClick={(e) => e.stopPropagation()}>
              <input
                ref={addInputRef}
                className="list-inline-input"
                placeholder="リスト名を入力..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter")  commitAdd();
                  if (e.key === "Escape") { setAdding(false); setNewName(""); }
                }}
                onBlur={commitAdd}
              />
              <div className="list-color-row">
                {COLORS.map((c) => (
                  <span
                    key={c}
                    className={`color-dot${newColor === c ? " selected" : ""}`}
                    style={{ background: c }}
                    onMouseDown={(e) => { e.preventDefault(); setNewColor(c); }}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* タグセクション（折りたたみ対応） */}
      <div className="divider" />
      <div className="section-label" onClick={() => setTagCollapsed((v) => !v)} style={{ cursor: "pointer" }}>
        <span className={`section-chevron${tagCollapsed ? " collapsed" : ""}`}>▼</span>
        タグ
        <span className="add-btn" onClick={(e) => { e.stopPropagation(); setAddingTag(true); setTagCollapsed(false); }}>＋</span>
      </div>
      {!tagCollapsed && (
        <>
          {tags.map((tag) => (
            <div
              key={tag}
              className={`nav-item${activeNav === `${tagNavPrefix}${tag}` ? " active" : ""}`}
              onClick={() => onNavClick?.(`${tagNavPrefix}${tag}`)}
            >
              <span className="icon">🏷️</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>#{tag}</span>
              <span className="badge">{tagCounts[tag] || 0}</span>
              <span
                className="list-menu-btn list-menu-btn--del"
                title="タグ削除"
                onClick={async (e) => {
                  e.stopPropagation();
                  if (window.confirm(`タグ「${tag}」を削除しますか？`)) {
                    await onDeleteTag?.(tag);
                  }
                }}
              >
                ✕
              </span>
            </div>
          ))}

          {addingTag && (
            <div className="list-add-form" onClick={(e) => e.stopPropagation()}>
              <input
                ref={tagInputRef}
                className="list-inline-input"
                placeholder="タグ名を入力..."
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitAddTag();
                  if (e.key === "Escape") { setAddingTag(false); setNewTagName(""); }
                }}
                onBlur={commitAddTag}
              />
            </div>
          )}

          {!addingTag && tags.length === 0 && (
            <div className="hint-text">タグがありません</div>
          )}
        </>
      )}

      {/* 仕掛 / 完了 / ゴミ箱 */}
      <div className="divider" />
      <div
        className={`nav-item${activeNav === "仕掛" ? " active" : ""}`}
        onClick={() => onNavClick?.("仕掛")}
      >
        <span className="icon">🛠️</span> 仕掛
      </div>
      <div
        className={`nav-item${activeNav === "完了" ? " active" : ""}`}
        onClick={() => onNavClick?.("完了")}
      >
        <span className="icon">✅</span> 完了
      </div>
      <div
        className={`nav-item${activeNav === "ゴミ箱" ? " active" : ""}`}
        onClick={() => onNavClick?.("ゴミ箱")}
      >
        <span className="icon">🗑️</span> ゴミ箱
      </div>
    </div>
  );
}

export default NavPanel;
