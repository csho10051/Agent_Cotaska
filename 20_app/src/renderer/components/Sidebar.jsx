import React from "react";

/**
 * Sidebar — 左端のアイコンナビゲーション（50px固定）
 *
 * Props:
 *   activeIcon  : string  — アクティブなアイコンの title 値
 *   onIconClick : (title: string) => void
 */
function Sidebar({ activeIcon, onIconClick }) {
  const icons = [
    { title: "リスト",     emoji: "📋" },
    { title: "カレンダー", emoji: "📅" },
    { title: "検索",       emoji: "🔍" },
  ];

  return (
    <div className="sidebar">
      <div className="avatar">👤</div>

      {icons.map(({ title, emoji }) => (
        <div
          key={title}
          className={`sb-icon${activeIcon === title ? " active" : ""}`}
          title={title}
          onClick={() => onIconClick?.(title)}
        >
          {emoji}
        </div>
      ))}

      <div className="sb-spacer" />
      <div className="sb-bottom">
        <div className="sb-icon" title="設定">⚙️</div>
      </div>
    </div>
  );
}

export default Sidebar;
