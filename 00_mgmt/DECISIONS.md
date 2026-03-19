# DECISIONS.md

## Purpose

This document records **important architectural and design decisions**.

Recording decisions helps both humans and AI agents understand why the system was designed a certain way.

---

## 2026-03-16

### Local-First Architecture

Decision:

The task management system will operate **fully locally**.

Reasons:

* corporate network restrictions
* data privacy
* simplified deployment

Result:

* SQLite database
* local desktop application
* no external cloud dependency

---

## 2026-03-16

### Database as Source of Truth

Decision:

The SQLite database will be the **authoritative source of task information**.

Markdown files are used only for visibility and collaboration.

Reasons:

* prevents state inconsistency
* allows structured queries
* enables future automation

---

## 2026-03-16

### Frontend Framework: React

Decision:

フロントエンドフレームワークに **React** を採用する。

Reasons:

* AIエージェント（Copilot/Claude）の学習データが最も多く、コード生成品質が安定する
* Electronとの組み合わせ実績が最も多い（VS Code 等）
* npmエコシステムのライブラリが最大
* 4カラムUIのコンポーネント分割が自然
* 状態管理（useState/useReducer）がタスクCRUDに適合

Alternatives considered:

* Vue: 学習コストが低いが、AI協業・エコシステムでReactが優位
* Vanilla JS: 追加学習不要だが、規模が大きくなると保守性が低下

---

## 2026-03-16

### Markdown for Agent Context

Decision:

Markdown files such as `CURRENT_SPRINT.md` will provide **quick context for AI agents**.

Reasons:

* easy for humans to edit
* easy for AI agents to parse
* useful for sprint overview

---

## Future Decisions

Major architectural changes should be recorded here.

---

## 2026-03-17

### Remove History And Comments From Detail Pane

Decision:

詳細ペイン右下の「履歴」と「コメント」を画面から削除する。

Reasons:

* 操作対象を絞って UI の複雑さを下げる
* 詳細編集の主要導線（タイトル・内容・属性編集）を優先する

Result:

* 仕様変更として CHG-007 を追加
* 実装タスクは CURRENT_SPRINT の T-016 で管理

---

## 2026-03-17

### Remove Progress Status From Detail Pane

Decision:

詳細ペイン（画面右）の「進捗ステータス」UIを削除する。

Reasons:

* 詳細ペインの編集項目を絞って認知負荷を下げる
* 進捗ステータス操作を中央リスト側へ集約し、導線を単純化する

Result:

* 仕様変更として CHG-008 を追加
* 実装タスクは CURRENT_SPRINT の T-023 で管理

---

## 2026-03-18

### Markdown Task Files as Source of Truth（ファイルファースト設計への移行）

Decision:

SQLiteデータベースを廃止し、**個別Markdownファイル（`30_data/tasks/T-XXX.md`）をタスク情報の正本**とする設計に全面移行する。

Reasons:

* AIエージェントがDBを介さずタスクファイルを直接読み書きできる
* `fs.watch`（chokidar）でファイル変更を検知し、UIがリアルタイムに自動更新される
* Markdownファイルはそのままバージョン管理・差分確認・素読みが可能
* SQLiteはネイティブバインディングが必要で、プロキシ環境でのセットアップが複雑だった
* 設計思想（AIと人間がファイルを直接共有）と実装が一致する

Result:

* `30_data/tasks/` 配下にタスクごとの `.md` ファイルを配置（YAMLフロントマター + 本文）
* `30_data/tasks/_index.yaml` にサマリーを自動生成（AI・人間ともに読み書き可能）
* `30_data/lists.yaml` にリストマスタを管理
* `20_app/db/cotasker.sqlite3` を削除（テストデータのみのため移行不要）
* `20_app/src/main/db.js` を `taskService.js` / `listService.js` / `indexService.js` に置換
* 実装タスクは CURRENT_SPRINT の T-025〜T-033 で管理

Previous decision ("Database as Source of Truth", 2026-03-16) is superseded by this decision.

---

## 2026-03-19

### Keep Task File Location In _index.yaml

Decision:

`_index.yaml` に各タスクの実ファイル格納先パス（`task_file_path`）を保持する。

Reasons:

* タスクファイルが複数フォルダへ分散した場合でも、参照先を一意に特定するため
* UI・AI・監視処理の参照元を `_index.yaml` で統一し、再構築時の曖昧さを減らすため

Result:

* 仕様変更として CHG-016 を追加
* 実装タスクは CURRENT_SPRINT の T-042 で管理
