import React from "react";

function DueDatePopover({ value, onChange, onClear, onClose, className = "" }) {
  return (
    <div
      className={`due-popover ${className}`.trim()}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        className="due-popover-input"
        type="date"
        value={value || ""}
        onChange={(e) => onChange?.(e.target.value || null)}
      />
      <div className="due-popover-actions">
        <button type="button" className="due-popover-btn" onClick={() => onClear?.()}>
          クリア
        </button>
        <button type="button" className="due-popover-btn" onClick={() => onClose?.()}>
          閉じる
        </button>
      </div>
    </div>
  );
}

export default DueDatePopover;