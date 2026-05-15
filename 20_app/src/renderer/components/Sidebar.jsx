import React from "react";

function Sidebar({ activeIcon, onIconClick }) {
  const primaryIcons = [
    { title: "リスト", emoji: "📋" },
    { title: "検索", emoji: "🔍" },
  ];

  return (
    <div className="sidebar">
      <div className="avatar">C</div>

      {primaryIcons.map(({ title, emoji }) => (
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
        <div
          className={`sb-icon${activeIcon === "設定" ? " active" : ""}`}
          title="設定"
          onClick={() => onIconClick?.("設定")}
        >
          ⚙
        </div>
      </div>
    </div>
  );
}

export default Sidebar;
