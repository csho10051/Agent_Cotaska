# AGENTS.md

## Purpose

This repository contains a **local desktop task management system** designed to work with AI agents and human developers.

Agents must follow the operational rules defined in this document before modifying code, tasks, or configuration.

The goal is to ensure safe and predictable collaboration between humans and AI agents.

---

## System Overview

Components:

* Desktop application (Electron + React)
* Markdown task files (`30_data/tasks/T-XXX.md`) — source of truth
* YAML index (`30_data/tasks/_index.yaml`) — auto-generated summary
* List master (`30_data/lists.yaml`)
* Markdown management documents (`00_mgmt/`)

**The task files in `30_data/tasks/` are the source of truth.**

The YAML index is a read-only mirror for quick lookup. Never edit it manually.

---

## Task Workflow

Agents must follow this workflow:

1. Read `CURRENT_SPRINT.md`
2. Identify tasks assigned or available
3. Verify task state by reading the relevant `.md` file in `30_data/tasks/`
4. Work only on tasks with frontmatter `status: todo` or `status: doing`
5. After completing work, update the task file's frontmatter and `CURRENT_SPRINT.md`

---

## Editing Rules

Allowed actions:

* Modify application source code
* Improve documentation
* Update `CURRENT_SPRINT.md`
* Read and write task files in `30_data/tasks/`
* Edit `30_data/lists.yaml`

Not allowed:

* Manually edit `30_data/tasks/_index.yaml` (auto-generated, overwritten by the app)
* Create task files with duplicate IDs
* Break YAML frontmatter syntax in task files
* Remove task files without archiving them to `30_data/archive/`
* Remove historical logs or management documents

---

## Task Update Rules

When completing a task:

1. Update the task file's frontmatter: `status: done`, `completed_at`, `updated_at`
2. Update `CURRENT_SPRINT.md` (mark the task `[完了]`)
3. Document major decisions in `DECISIONS.md`

## Task File Format

Each task is stored as `30_data/tasks/T-XXX.md` with YAML frontmatter:

```yaml
---
id: T-001
title: タスク名
status: todo|doing|blocked|done
priority: high|medium|normal
progress_status: 未着|仕掛|完了
is_manual_progress: 0|1
progress: 0
due_date: 2026-03-20        # null可
list: リスト名              # null = リストなし
parent: null                # サブタスクの場合は T-XXX
tags: []
sort_order: 10
delete_flag: 0
created_at: 2026-03-18T10:00:00
updated_at: 2026-03-18T10:00:00
completed_at: null
deleted_at: null
---
タスク本文（Markdown自由記述）
```

---

## タスクステータスラベルルール

CURRENT_SPRINT.mdの全タスク（親タスク・サブタスク両方）には、必ず以下のステータスラベルを付ける。

| ラベル | 意味 | 使用場面 |
|--------|------|----------|
| `[未着]` | 未着手 | まだ作業を開始していない |
| `[仕掛]` | 仕掛中 | 作業中（部分的に完了している場合も含む） |
| `[完了]` | 完了 | 全ての作業が完了した |

### 記載フォーマット

親タスク（###）：
```
### T-004　［仕掛］ 4カラムUI実装
```

サブタスク（####）：
```
#### T-004-01　［完了］ Electronプロジェクト初期化
```

### 運用ルール

* タスク作成時：必ず `[未着]` を付ける
* 作業開始時： `[未着]` → `[仕掛]` に変更する
* 作業完了時： `[仕掛]` → `[完了]` に変更し、完了タスクセクションに移動する
* 親タスクのステータスはサブタスクの状況に応じて更新する
  * サブタスクが1つでも仕掛中 → 親は `[仕掛]`
  * 全サブタスクが完了 → 親は `[完了]`

---

## 不具合対応ワークフロー（必須）

ユーザーから不具合・異常動作の報告を受けた場合、**以下の順序を厳守**すること。
調査・修正を先行させてはならない。

### ステップ1：バグレポート起票（最初に行う）

1. `10_docs/20_実装準備/10_運用ルール/バグレポート管理ルール.md` を参照する
2. `10_docs/30_実装・検証/10_不具合対応/` にバグレポートファイルを作成する
   - 命名規則：`YYYYMMDD_連番_タイトル.md`
   - 状態は起票時点では `調査中` とする
3. `CURRENT_SPRINT.md` の「不具合対応タスク」セクションにエントリを追加する

### ステップ2：調査・修正

バグレポート起票完了後に調査・修正を行う。

### ステップ3：バグレポート・CURRENT_SPRINT.md の更新

修正完了後にバグレポートと CURRENT_SPRINT.md の状態を `解決済み` に更新する。

> **⚠️ 注意**：ステップ1（起票）を省略して調査・修正を先行させることは禁止。

---

## Coding Standards

General guidelines:

* Prefer simple solutions
* Avoid introducing unnecessary dependencies
* Keep functions small and readable
* Use meaningful variable names
* Add comments for complex logic

---

## Safety Rules

Agents must never:

* delete the database
* overwrite configuration files
* remove historical records
* perform destructive migrations

---

## IPC通信チャンネル仕様（Main ↔ Renderer）

本セクションはアプリケーション開発時の参考資料です。All チャンネル通信はセキュリティ（contextIsolation=true, nodeIntegration=false）ルールを遵守します。

### タスク関連

#### tasks:getAll

取得：未削除（delete_flag=0）の全タスク

**Request**：
```javascript
window.cotaskerAPI.tasks.getAll()
```

**Response**：
```javascript
[
  {
    id: "T-001",
    title: "タスク名",
    status: "todo",
    priority: "high",
    progress_status: "未着",
    progress: 0,
    due_date: "2026-03-20",
    list: "リスト名",
    parent: null,
    tags: [],
    delete_flag: 0,
    created_at: "2026-03-18T10:00:00",
    updated_at: "2026-03-18T10:00:00",
    completed_at: null,
    deleted_at: null
  },
  ...
]
```

#### tasks:add

新規タスク作成

**Request**：
```javascript
window.cotaskerAPI.tasks.add({
  title: "タスク名",
  priority: "medium",      // optional
  due_date: "2026-03-20",  // optional
  list: "リスト名",         // optional
  parent: null             // optional: T-XXX
})
```

**Response**：
```javascript
{
  id: "T-001",
  title: "タスク名",
  status: "todo",
  ...（全frontmatterフィールド）
}
```

#### tasks:update

タスク更新（frontmatterフィールドのみ）

**Request**：
```javascript
window.cotaskerAPI.tasks.update({
  id: "T-001",
  title: "新しいタイトル",  // optional
  status: "doing",        // optional
  priority: "high",       // optional
  progress: 50,           // optional
  progress_status: "仕掛", // optional
  due_date: "2026-03-25", // optional
  list: "新しいリスト",    // optional
  tags: ["urgent"]        // optional
})
```

**Response**：
```javascript
{
  success: true,
  updated_at: "2026-03-18T15:30:00"
}
```

#### tasks:getCompleted

完了タスク取得（status=done、delete_flag=0）

**Request**：
```javascript
window.cotaskerAPI.tasks.getCompleted()
```

**Response**：
```javascript
[
  { id: "T-010", title: "完了済みタスク", status: "done", ... },
  ...
]
```

#### tasks:getTrashed

ゴミ箱タスク取得（delete_flag=1）

**Request**：
```javascript
window.cotaskerAPI.tasks.getTrashed()
```

**Response**：
```javascript
[
  { id: "T-999", title: "削除済みタスク", delete_flag: 1, ... },
  ...
]
```

#### tasks:completeTask

タスク完了（status→done, completed_at設定）

**Request**：
```javascript
window.cotaskerAPI.tasks.completeTask("T-001")
```

**Response**：
```javascript
{ success: true, completed_at: "2026-03-18T15:32:00" }
```

#### tasks:reopenTask

タスク再開（done→todo, completed_at→null）

**Request**：
```javascript
window.cotaskerAPI.tasks.reopenTask("T-001")
```

**Response**：
```javascript
{ success: true }
```

#### tasks:trashTask

タスク削除（delete_flag→1）

**Request**：
```javascript
window.cotaskerAPI.tasks.trashTask("T-001")
```

**Response**：
```javascript
{ success: true, deleted_at: "2026-03-18T15:33:00" }
```

#### tasks:restoreTask

タスク復元（delete_flag→0, deleted_at→null）

**Request**：
```javascript
window.cotaskerAPI.tasks.restoreTask("T-001")
```

**Response**：
```javascript
{ success: true }
```

#### tasks:deleteTask

タスク完全削除（archive/へ移動）

**Request**：
```javascript
window.cotaskerAPI.tasks.deleteTask("T-001")
```

**Response**：
```javascript
{ success: true, archived_at: "2026-03-18T15:34:00" }
```

### リスト関連

#### lists:getAll

全リスト取得

**Request**：
```javascript
window.cotaskerAPI.lists.getAll()
```

**Response**：
```javascript
[
  { name: "仕事", color: "blue", created_at: "..." },
  { name: "個人", color: "green", created_at: "..." }
]
```

#### lists:add

新規リスト作成

**Request**：
```javascript
window.cotaskerAPI.lists.add({ name: "新規リスト", color: "red" })
```

**Response**：
```javascript
{ success: true, name: "新規リスト" }
```

#### lists:update

リスト名または色を更新

**Request**：
```javascript
window.cotaskerAPI.lists.update({ name: "古い名前", newName: "新しい名前" })
```

**Response**：
```javascript
{ success: true }
```

#### lists:delete

リスト削除（所属タスク変数 listの null に）

**Request**：
```javascript
window.cotaskerAPI.lists.delete("リスト名")
```

**Response**：
```javascript
{ success: true, relinked_tasks: 5 }  // 移動したタスク数
```

### 双方向同期（watcher）

#### tasks:changed

AIやエディタ（VSCode）がファイルを編集した場合、watcher が自動的に renderer に通知

**発火条件**：
- `30_data/tasks/` 内のファイル追加・変更・削除
- watcher が chokidar で検知（最大1秒遅延）

**Renderer での受信**：
```javascript
window.cotaskerAPI.onTasksChanged((event) => {
  console.log("Tasks have changed - reloading...");
  // tasks:getAll を 呼び出してUI更新
})
```

---

## Definition of Done

A task is complete when:

* functionality works
* code compiles or runs successfully
* task status is updated
* logs are recorded
* documentation updated if necessary

---

## バグレポート管理ルール

詳細は `10_docs/20_実装準備/10_運用ルール/バグレポート管理ルール.md` を参照すること。

バグ発見時に行うこと：

1. `10_docs/30_実装・検証/10_不具合対応/` に `YYYYMMDD_連番_タイトル.md` を作成する
2. `CURRENT_SPRINT.md` の「不具合対応タスク」セクションに `BUG-YYYYMMDD-XX` 形式で追記する
3. ステータスは `[調査中]` → `[対応中]` → `[解決済]` の順に更新する
