# Electron × Markdown ローカルファイルリンク対応まとめ

## 概要
Electron（Chromiumベース）でMarkdownを使ったタスク管理アプリを作る場合、  
Markdownのリンク記法を使ってローカルファイルをクリックで開くことは可能。

ただし、Markdownは「リンクを表示するだけ」であり、  
実際の挙動（どのアプリで開くか）はElectron側で制御する必要がある。

---

## Markdownでの書き方

### 基本
```markdown
[表示テキスト](URL or パス)
```

### ローカルファイル（絶対パス）
```markdown
[設計書](file:///C:/work/docs/spec.md)
```

### ローカルファイル（相対パス）
```markdown
[設計書](./docs/spec.md)
```

👉 推奨：相対パス

---

## 実装方針（重要）

### ❌ NG（そのままブラウザに任せる）
- アプリ内で開いてしまう
- セキュリティ的に危険
- OS既定アプリで開けない

---

### ✅ 推奨：クリックイベントをElectronで制御

#### 方針
- Markdownは普通に書く
- クリックを横取り
- ElectronのAPIで開く

---

## 実装例

### Renderer側（クリック検知）
```javascript
document.addEventListener("click", async (e) => {
  const a = e.target.closest("a");
  if (!a) return;

  const href = a.getAttribute("href");
  if (!href) return;

  e.preventDefault();

  await window.electronAPI.openLink(href);
});
```

---

### preload.js
```javascript
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  openLink: (href) => ipcRenderer.invoke("open-link", href)
});
```

---

### main.js
```javascript
const { ipcMain, shell, app } = require("electron");
const path = require("path");

ipcMain.handle("open-link", async (_, href) => {
  if (/^https?:\/\//i.test(href)) {
    await shell.openExternal(href);
    return;
  }

  let filePath = href;

  if (/^file:\/\//i.test(href)) {
    filePath = new URL(href).pathname;

    if (process.platform === "win32" && filePath.startsWith("/")) {
      filePath = filePath.slice(1);
    }
  } else {
    filePath = path.resolve(app.getAppPath(), href);
  }

  const result = await shell.openPath(filePath);
  if (result) {
    console.error("開けません:", result);
  }
});
```

---

## 推奨仕様（タスク管理アプリ向け）

| リンク種別 | 動作 |
|-----------|------|
| `.md` | アプリ内表示 |
| `.pdf / .xlsx / .docx` | OS既定アプリ |
| `http / https` | 外部ブラウザ |

---

## ベストプラクティス

### 相対パスを使う
```markdown
[設計書](./docs/spec.md)
```

メリット:
- 環境依存しない
- 配布しやすい

---

### セキュリティ対策

最低限チェックすること:

```javascript
if (/^javascript:/i.test(href)) return;
```

推奨:
- 許可するスキームのみ通す
- 開けるディレクトリ制限

---

## よくあるハマりポイント

- リンクは表示されるがクリックできない
  → イベント未処理

- URLがリンク化されない
  → Markdownレンダラー設定

- Windowsパスが壊れる
  → file:// or 相対パスを使う

---

## まとめ

- Markdownでローカルリンクは書ける
- 実際の挙動はElectronで制御する
- `shell.openPath()` が最適解
- 相対パス＋クリック制御がベスト

---

## 発展アイデア

- [[内部リンク]]（Obsidian風）
- タグリンク (#task)
- URLプレビュー
