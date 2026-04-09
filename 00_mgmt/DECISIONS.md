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
* `20_app/db/Cotaska.sqlite3` を削除（テストデータのみのため移行不要）
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

---

## 2026-03-19

### Hide Trash Icon On Task Row Hover In Main Pane

Decision:

メインパネルのタスク行でホバー時に表示される「ごみ箱アイコン」を非表示にする。

Reasons:

* ホバー操作だけで削除導線が現れるため誤操作リスクがある
* 削除操作を右クリックメニュー等の明示操作に寄せ、意図しない削除を減らす

Result:

* 仕様変更として CHG-017 を追加
* 実装タスクは CURRENT_SPRINT の T-043 で管理

---

## 2026-03-19

### Include Subtasks In Today View When Parent Is Due Today

Decision:

「今日」ビューで、親タスクの期限日が今日の場合は、配下のサブタスクを期限日に関係なく表示対象に含める。

Reasons:

* 親タスク単位で今日対応すべき作業を一覧で把握しやすくするため
* 子タスクの期限日だけを基準にすると、実務上の作業塊が分断されるため

Result:

* 仕様変更として CHG-018 を追加
* 実装タスクは CURRENT_SPRINT の T-044 で管理

---

## 2026-03-19

### Unify Left Pane Input Text Color To White While Editing

Decision:

左ペインのリスト入力・タグ入力において、入力途中（フォーカス中）の文字色を白に統一する。

Reasons:

* 入力完了後は白文字だが、入力途中が黒文字で視認性が低下しているため
* 入力状態ごとに文字色が異なると操作時の一貫性が損なわれるため

Result:

* 仕様変更として CHG-019 を追加
* 実装タスクは CURRENT_SPRINT の T-045 で管理

---

## 2026-03-19

### Expand Top-Left Views To All Today Tomorrow Next7Days

Decision:

画面左上の固定ビューを「今日、次の7日間」から「すべて、今日、明日、次の7日間」に変更する。

Reasons:

* 期限未設定を含む全体把握の導線が必要なため
* 「明日」タスクのみを素早く確認できる導線が必要なため

Result:

* 仕様変更として CHG-020 を追加

---

## 2026-03-19

### Drag Reorder With Section-Semantic Auto Update

Decision:

メインパネルのドラッグ操作では、`sort_order` を正規の並び順キーとして扱い、セクション間移動時は移動先セクション意味に合わせて `due_date` / `progress_status` を自動更新する。

Reasons:

* 運用上の優先順位を手動で並び替えて保持する必要があるため
* ビュー間移動時の手入力（二重更新）をなくし、更新漏れを減らすため
* 逆方向遷移（明日→今日、仕掛→未着）も一貫ルールで扱うため

Result:

* 仕様変更として CHG-021 を追加
* 実装タスクは CURRENT_SPRINT の T-047 で管理
* 保存は「並び順更新 + 属性更新」を同一操作として扱い、部分反映を禁止
* 実装タスクは CURRENT_SPRINT の T-046 で管理

---

## 2026-03-24

### Unify UI Labels To Japanese (CHG-022)

Decision:

画面上のユーザー向け表示文言（UIラベル、プレースホルダ、補助文言）を日本語に統一する。

Reasons:

* 日本語UIの運用前提に合わせ、可読性と学習コストを改善するため
* 英語と日本語が混在すると操作理解コストが高まるため

Result:

* 仕様変更として CHG-022 を追加
* 変数名・内部ID・保存データキーは変更せず、表示文言のみ対象とする

---

## 2026-03-25

### Priority Display: Japanese Labels With Dropdown (CHG-023)

Decision:

右詳細ペインの優先度表示・操作を「N/M/Hアルファベット略字のクリック循環」から「低/中/高のプルダウン選択」に変更する。

Reasons:

* N/M/H の表記はユーザーにとって直感的でなく、意味が伝わりにくい
* クリック循環方式は誤操作が起きやすく、目的の値へ到達するまで複数回クリックが必要
* タスク管理ツールの実績（Todoist・TickTickなど）でも文字ラベルのプルダウンが標準的

Result:

* 仕様変更として CHG-023 を追加
* 内部データキー（`normal` / `medium` / `high`）・ソート順は変更しない
* 表示ラベルのみ変更: `normal` → 低, `medium` → 中, `high` → 高

---

## 2026-03-26

### CURRENT_SPRINT.md の廃止（タスク管理一本化）

Decision:

`CURRENT_SPRINT.md` をタスク状態管理ツールとして廃止し、過去ログとして凍結する。

Reasons:

* タスクファイルとの二重管理により実際に不整合が発生したため
* タスク状態の正本は `data/tasks/*.md` で完全に代替できるため
* AI にとって単一正本の方が判断誤りが起きにくいため

Result:

* `CURRENT_SPRINT.md` を廃止済みアーカイブとして凍結（以後更新しない）
* AI 作業前確認: `AGENTS.md` → `data/tasks/_index.yaml` + 対象タスクファイル
* 個別ルール（バグ/仕様変更/リリース）から CURRENT_SPRINT 更新要件を削除済み
* AI 運用ルール正本の Section 9（CURRENT_SPRINT 役割と更新ルール）を削除済み
* `AGENTS.md` の Required Workflow / Spec Change Protocol / Editing Rules を更新済み

---

## 2026-03-26

### メインペインのセクション折りたたみ機能（CHG-034）

Decision:

MainPane のタスクリストにおけるセクション見出し（未着・仕掛、遅延・今日・次の7日間等）にクリックで折りたたみ／展開するトグル機能を追加する。

Reasons:

* タスク数が増えた際の一覧性向上
* 完了セクションのみ折りたたみ可能な現状は一貫性に欠ける

Result:

* 仕様変更として CHG-034 を追加
* 実装タスク T-0040、ユーザ確認タスク T-0041（親: T-0027）

## 2026-03-27

### 異なるパスからの多重起動許可（CHG-035）

Decision:

Electron のシングルインスタンスロックを起動パス単位にスコープし、異なるパスからの同時起動を許可する。同一パスからの二重起動は引き続きブロックする。

Reasons:

* 開発環境とリリース環境は異なる data/ を参照しておりファイル競合は発生しない
* デバッグ中にリリース版を参照したい場面があり、排他制御が作業効率を阻害している

Result:

* 仕様変更として CHG-035 を追加
* 実装タスク T-0042、ユーザ確認タスク T-0043

## 2026-03-30

### Electron 本体 EXE 名変更（CHG-036）

Decision:

`_app/Cotaska.exe`（Electron 本体）を `CotaskaCore.exe` にリネームする。ルートの `Cotaska.exe`（Go ランチャー）は変更しない。

Reasons:

* 同名 EXE が2箇所に存在し、AI エージェントが誤って _app 内の EXE を直接起動してしまう
* ランチャー経由の正規起動フローがバイパスされる問題を解消する

Result:

* 仕様変更として CHG-036 を追加
* 実装タスク T-0051、ユーザ確認タスク T-0052

## 2026-04-09

### タスク詳細を別アプリでプレビュー（CHG-040）

Decision:

詳細ペイン右上のプレビュー導線をアイコン中心に見直し、Cotaska 内プレビューとは別に、対象 Markdown ファイルを OS 既定アプリで開く導線を追加する。

Reasons:

* 詳細ペイン右上の操作を省スペース化したい
* タスク本文を外部エディタや Markdown ビューアでも確認したい要望がある
* Cotaska 外での参照手段を用意することで運用の自由度が上がる

Result:

* 仕様変更として CHG-040 を追加
* 設計確認タスク T-0067、実装タスク T-0068、ユーザ確認タスク T-0069 を作成

