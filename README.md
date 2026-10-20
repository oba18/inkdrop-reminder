# reminder

**English** | [日本語](#日本語)

Adds due dates and reminders to Inkdrop tasks and sends desktop notifications. It also gives you a task list, Kanban, Eisenhower matrix, Gantt and calendar views, subtasks, and a board of notes by status.

## Installation

Search for `reminder` in Inkdrop's Preferences → Plugins, or run:

```sh
ipm install reminder
```

Works with the Inkdrop 6+ desktop app. The keyboard shortcuts are for macOS (on Windows / Linux, use the Plugins menu or the commands).

The UI is shown in English, or in Japanese when Japanese is one of your system languages (change it with the Language setting).

### Features that edit your notes automatically

The following features rewrite notes automatically. Each can be turned off in Preferences → Plugins → reminder.

| Feature | Default | What it does |
| --- | --- | --- |
| Link parent and subtask checkboxes | On | Checking a parent checks its subtasks, finishing all subtasks checks the parent, etc. (see [Subtasks](#subtasks)) |
| Mark the note Completed when all its tasks are done | On | When every task with a due date is checked |
| Set the note back to Active when a task is unchecked | On | The reverse of the above |

These run only for edits made on that device: in the editor or preview while the Inkdrop window is focused, or through this plugin's views. They ignore changes that arrive via sync from other devices, so using several devices doesn't apply the same rewrite twice.

## Usage

### Setting a due date

All of these open the same picker. Use **☑️ Task / 📒 Note** at the top to choose which due date to set.

| Action | Opens for |
| --- | --- |
| `Cmd+Shift+R` | The task on the cursor line (a plain line becomes a task). On an empty line, a heading, or the note's due-date line: the note |
| `Cmd+Shift+E`, or the 📅 / ⏰ button at the top of the editor | The note |
| The ⏰ / ⏰+ button at the end of a task line in the editor (shown on hover) | That task |
| Click a due-date badge in the preview, or hover a task without a due date and click ⏰+ | That task (a note's badge opens the note) |
| Context menu | The task / the note |

It also works in preview mode (`Cmd+Shift+R` opens it with the note selected).

The picker appends something like this to the line (you can also type it by hand):

```markdown
- [ ] Send the quote ⭐⭐ ⏰2026-10-20 15:00 🔔30m
- [ ] Prepare for the trade show ⏰2026-10-20〜2026-10-23 18:00
```

The picker also lets you choose:

- **⭐ Priority** (tasks only): none / ★ / ★★ / ★★★
- **No due date / Due date / Period**
  - Due date: a single deadline day
  - Period: from one day to another. Click the start date, then the end date in the calendar. Each end can have a time
  - No due date: removes the due date (useful when you only want a priority)

| Syntax | Meaning |
| --- | --- |
| `⏰2026-10-20` | Due date (all day; uses the "time for due dates without a time" setting) |
| `⏰2026-10-20 15:00` | Due date with a time |
| `⏰2026-10-20〜2026-10-23` | Period (Oct 20 to Oct 23; times also work, as in `⏰2026-10-20 09:00〜2026-10-23 18:00`) |
| `⭐` / `⭐⭐` / `⭐⭐⭐` | Priority |
| `🔔30m` / `🔔1h` / `🔔1d` | Notify 30 minutes / 1 hour / 1 day before the due date (or the start of a period) |
| `🔔0m` | Notify exactly at the due time |
| `🔔off` | Don't notify |
| `🏃` | In progress (the middle column of the Kanban) |
| (no 🔔) | Notify at the default timing in the settings (15 minutes before) |

### A note's own due date

A note's due date goes at the top of the body as a line containing only the syntax:

```markdown
⏰2026-10-20 15:00 🔔30m

The note body…
```

- Once set, the header button shows `⏰ 10/20 15:00` (red when overdue)
- When the note's status becomes Completed / Dropped, its due date is no longer notified

Picker tips and other behavior:

- In the picker, double-click a date or Shift+click a quick button to confirm right away. Enter confirms
- Clicking a notification opens the note
- When all tasks in a note are done, the note's status becomes **Completed** (unchecking one sets it back to Active)

### Subtasks

A task indented under another task becomes its subtask (even with plain list items in between).

```markdown
- [ ] Prepare for the trade show ⭐⭐ ⏰2026-10-20
  - [x] Book the venue
  - [ ] Make the poster ⏰2026-10-18
    - [ ] Design drafts
  - [ ] Print the handouts
```

- **List / Gantt**: Subtasks are indented under their parent and can be collapsed with ▾ / ▸. A subtask goes into its parent's group regardless of its own due date. When the parent is filtered out, the subtask is shown on its own with "↳ parent task name"
- **Kanban**: Subtasks become a checklist inside the parent's card, and can be checked there
- A parent shows how many of its subtasks are done (☑ 1/3)
- When a search matches a parent task, its subtasks are shown too

**Linked completion** (setting "Link parent and subtask checks", on by default). Checking a task anywhere — the editor, the preview, or the task list — propagates like this:

- Checking a parent checks all of its unfinished subtasks
- When all subtasks are done, the parent is checked too (grandchild → child → parent, all the way up)
- Unchecking a subtask unchecks its checked parent
- Unchecking a parent leaves its subtasks as they are

### Task list

**Tasks** in the sidebar (below All Notes and Templates) lists every checkbox task across your notes, plus notes' own due dates (marked "📒").

- Grouped by due date: overdue / today / tomorrow / within 7 days / later / no due date (no due date is sorted by most recently updated note)
- Switch between open / done / all, and search by task or note name
- Click a checkbox to toggle a task. Click a row to open the note at that task's line (the note list switches to the note's notebook)
- Selecting another sidebar item or opening a note returns to the normal view. Back (⌘← or the ← button) from a note opened here returns to Tasks, and Back from Tasks returns to what was showing before it
- The number in the sidebar is the count of open tasks
- Exclude notebooks such as templates with the "Notebooks to exclude from the task views" setting (comma-separated)
- Click the ☆ on a row or card to change the priority (click the same star again to clear it)
- Click the ⏰ due date on a row or card (list, Kanban, matrix) to change it in the due date picker: date, time, period, reminder and priority, or remove it. On an open task without one, "⏰＋" appears on hover to add one

### Note status

- **Status filter**: Choose which note statuses' tasks to show with None / Active / On Hold / Completed / Dropped in the header (applies to every view and is remembered). Completed / Dropped are hidden by default
- **On Hold**: Tasks in On Hold notes are dimmed and **their notifications stop**. They resume when you set the note back to Active, etc. (anything that came due while on hold is notified once at that point, if it was within the last 12 hours)
- **List grouping**: Switch between due date / status / note. When grouped by note, each heading shows the note title, status and notebook; click it to open the note

### Note board (the "Notes" tab)

A board with one card per note and one column per status.

- Each card shows tags, the number of done tasks (☑ 5/12) with a progress bar, the highest priority among open tasks, the number of 🏃 tasks, and the nearest due date
- Drag a card to another column (or use the buttons shown on hover) to change the note's status. Click a card to open the note
- The None / Active / On Hold columns only show notes with open tasks (or a due date) left. The Completed / Dropped columns are sorted by most recently updated, with "Show more" for the rest
- Only notes with tasks or a due date are included

### Kanban

Switch to Kanban at the top of Tasks to see three columns: **To do / In progress / Done**.

- Dragging a card to another column rewrites the task line in the note
  - To do: `- [ ] Send the quote`
  - In progress: `- [ ] Send the quote 🏃` (you can type `🏃` by hand too)
  - Done: `- [x] Send the quote` (the `🏃` is removed)
- You can also move cards with the buttons shown on hover
- Click a card to go to the task's line; click the note name below the card to open the note
- The Done column shows 30 items at a time, starting from the most recently updated notes
- The To do and In progress columns are sorted by priority, highest first

### Eisenhower matrix

Switch to Matrix at the top of Tasks to sort open tasks into four quadrants, judged from the markers they already have (no new syntax):

| | Urgent: overdue or due within N days | Not urgent: no due date or later |
|---|---|---|
| **Important: ⭐⭐ or more** | Do now | Schedule |
| **Not important: fewer ⭐** | Delegate / do quickly | Drop / later |

- Set the thresholds in the settings: "Matrix: ⭐ count that makes a task important" (default 2) and "Matrix: due within this many days counts as urgent" (default 2; 0 = today only). A period counts by its end date
- Dragging a card to another quadrant rewrites the task line:
  - becoming important raises the ⭐ to the threshold; losing it lowers them to one below
  - becoming urgent moves the due date to today (an all-day one is added if there was none); losing it moves the due date to the first day after the urgent window. A period keeps its length
- Subtasks are a checklist on the parent's card, as on the Kanban. A note's own due date (which has no ⭐) is not shown
- ✓ Done on hover completes the task. Also available as the command `reminder:show-matrix`

### Gantt

Switch to Gantt at the top of Tasks to see tasks (and notes) with a due date or period on a daily timeline.

- Periods are bars and single due dates are ◆ (to do: blue / in progress: orange / overdue: red / done: green)
- ‹ › move one week; "Today" jumps back to this week. Today's column is highlighted in blue
- Click a row or bar to open the task or note
- **Drag bars to reschedule** (by day; the note's line is rewritten when you release)
  - Middle of a bar: move the whole period (length and times are kept)
  - Left / right edge of a bar: change the start / end date
  - ◆ (due date only): drag to move it, or stretch its right edge to make it a period
  - A period shrunk to one day with no time turns back into a due date (◆)
  - 🔔 settings are kept
- "Show done" also shows finished items
- For a note's due-date card, moving it to in progress adds `🏃` to the due-date line, and moving it to done sets the note's status to Completed (moving it back to to do / in progress sets it to Active)

### Calendar

Switch to Calendar at the top of Tasks (or press `⌘⌥Y`) to see tasks in a day, week, month or year calendar. Only tasks matching the search box are shown.

| Key | Action |
| --- | --- |
| `D` / `W` / `M` / `Y` | Day / week / month / year view |
| `T` | Today |
| `J` `N` `→` / `K` `P` `←` | Next / previous |

- Tasks and notes with a due date appear on that day (no time = all day; periods are multi-day bars)
- Toggle tasks with the checkbox; click to open the task's line
- Drag to change the date (and the time in week / day views). `🔔` settings are kept. Periods move as a whole, by day
- "Show completed tasks" on the left also shows finished ones

## Notes

- Tasks in notes whose status is Completed / Dropped / On Hold are not notified
- Notifications only fire while Inkdrop is running (reminders missed while it was closed are notified at startup if they were due within the last 12 hours)
- Desktop app only
- **Language** setting: `auto` (default) shows the UI in Japanese if it is one of your system languages, otherwise in English; `en` / `ja` force one. The note markers (`⏰`, `🔔30m`, `⭐`, `🏃`) are the same in both languages

## Development

```sh
npm install
npm run dev   # watch-build into lib/
```

## License

MIT

---

# 日本語

[English](#reminder) | **日本語**

Inkdrop のタスクに期限とリマインダーを付けて、デスクトップに通知するプラグインです。タスクの一覧・カンバン・アイゼンハワーマトリクス・ガント・カレンダー、小タスク、ノートのステータス別のボードもあります。

## インストール

Inkdrop の「設定 → Plugins」で `reminder` を検索してインストールするか、ターミナルで:

```sh
ipm install reminder
```

Inkdrop 6 以降のデスクトップ版で動きます。ショートカットは macOS 用です（Windows / Linux ではメニュー「Plugins」やコマンドから使えます）。

### ノートを自動で書き換える機能について

次の機能はノートを自動で書き換えます。どれも設定（設定 → Plugins → reminder）でオフにできます。

| 機能 | 既定 | 内容 |
| --- | --- | --- |
| 親タスクと小タスクのチェックを連動 | オン | 親をチェックすると小タスクもチェック、小タスクがすべて完了すると親もチェック、など（「小タスク」参照） |
| タスクがすべて完了したらノートを Completed にする | オン | 期限のあるタスクがすべて完了したとき |
| 完了済みのタスクのチェックを外したらノートを Active に戻す | オン | 上の逆 |

これらは、その端末で編集したとき（Inkdrop のウィンドウが前面にあるときのエディタ・プレビューでの編集、またはこのプラグインの画面での操作）だけ動きます。別の端末から同期で届いた変更には反応しないので、複数の端末で使っても同じ書き換えが重なりません。

## 使い方

### 期限を設定する

どれでも同じピッカーが開きます。上部の **☑️ タスク / 📒 ノート** で、どちらの期限を設定するか切り替えられます。

| 操作 | 開くもの |
| --- | --- |
| `Cmd+Shift+R` | カーソルの行のタスク（普通の行ならその行をタスクにする）。空行・見出し・ノートの期限の行ではノート |
| `Cmd+Shift+E`、エディタ上部の 📅 / ⏰ ボタン | ノート |
| エディタのタスク行の末尾の ⏰ / ⏰+ ボタン（行にマウスを乗せると表示） | そのタスク |
| プレビューの期限バッジをクリック、期限のないタスクにマウスを乗せて出る ⏰+ | そのタスク（ノートのバッジならノート） |
| 右クリックメニュー | タスク / ノート |

プレビューモードでも使えます（`Cmd+Shift+R` はノートが選ばれた状態で開きます）。

設定すると行末に次のように書き込まれます（手で書いても OK）:

```markdown
- [ ] 見積書を送る ⭐⭐ ⏰2026-10-20 15:00 🔔30m
- [ ] 展示会の準備 ⏰2026-10-20〜2026-10-23 18:00
```

ピッカーでは次も選べます:

- **⭐ 優先度**（タスクのみ）: なし / ★ / ★★ / ★★★
- **期限なし / 期限 / 期間**
  - 期限: いつまでに（1日）
  - 期間: いつからいつまで。カレンダーで開始日 → 終了日の順にクリック。開始・終了それぞれに時刻も付けられます
  - 期限なし: 期限を外す（優先度だけ付けたいとき）

| 記法 | 意味 |
| --- | --- |
| `⏰2026-10-20` | 期限（終日。設定の「時刻なしの期限の時刻」を使う） |
| `⏰2026-10-20 15:00` | 期限（時刻付き） |
| `⏰2026-10-20〜2026-10-23` | 期間（10/20から10/23まで。`⏰2026-10-20 09:00〜2026-10-23 18:00` のように時刻も可） |
| `⭐` / `⭐⭐` / `⭐⭐⭐` | 優先度 |
| `🔔30m` / `🔔1h` / `🔔1d` | 期限（期間なら開始）の 30分 / 1時間 / 1日 前に通知 |
| `🔔0m` | 期限の時刻ちょうどに通知 |
| `🔔off` | 通知しない |
| `🏃` | 進行中（カンバンの真ん中の列） |
| （🔔 なし） | 設定の既定値（15分前）で通知 |

### ノートそのものの期限

ノートの期限は、本文の先頭に記法だけの行として入ります:

```markdown
⏰2026-10-20 15:00 🔔30m

ノートの本文…
```

- 設定するとヘッダーのボタンが `⏰ 10/20 15:00` 表示になります（期限切れは赤）
- ノートのステータスが Completed / Dropped になると、そのノートの期限は通知されません

- ピッカー: 日付をダブルクリック、またはクイックボタンを Shift+クリックで即決定。Enter で OK
- 通知をクリックするとそのノートを開きます
- ノート内のタスクがすべて完了すると、ノートのステータスが **Completed** になります（チェックを外すと Active に戻ります）

### 小タスク

タスクの下にインデントして書いたタスクは、その小タスクになります（間に普通の箇条書きがあっても、その下のタスクは小タスク）。

```markdown
- [ ] 展示会の準備 ⭐⭐ ⏰2026-10-20
  - [x] 会場予約
  - [ ] ポスター作成 ⏰2026-10-18
    - [ ] デザイン案
  - [ ] 配布物の印刷
```

- **リスト・ガント**: 親タスクの下に字下げして並び、▾ / ▸ で折りたためます。小タスクは自分の期限に関係なく親と同じグループに入ります。親が絞り込みで表示されないときは「↳ 親タスク名」付きで単独表示
- **カンバン**: 小タスクは親カードの中のチェックリストになり、カード上でチェックできます
- 親タスクには完了した小タスクの数（☑ 1/3）が表示されます
- 検索で親タスクが一致すると、その小タスクも表示されます

**完了の連動**（設定「親タスクと小タスクのチェックを連動させる」、既定でオン）: エディタ・プレビュー・タスク一覧のどこでチェックしても次のように連動します。

- 親をチェックすると、未完了の小タスクもすべてチェック
- 小タスクがすべて完了すると、親もチェック（孫 → 子 → 親と上まで）
- 小タスクのチェックを外すと、チェック済みの親も外す
- 親のチェックを外しても、小タスクはそのまま

### タスクの一覧

サイドバーの **Tasks**（All Notes・Templates の下）で、すべてのノートのチェックボックス付きタスクと、ノートの期限（「📒 ノート」の印）を一覧できます。

- 期限で「期限切れ / 今日 / 明日 / 7日以内 / それ以降 / 期限なし」に分けて表示（期限なしは更新が新しいノートから）
- 未完了 / 完了 / すべて の切り替えと、タスク名・ノート名での検索
- チェックボックスで完了・未完了を切り替え。行をクリックするとそのノートを開いてタスクの行へ移動（ノート一覧もそのノートのノートブックに切り替わります）
- 他のサイドバー項目を選ぶか、ノートを開くと通常の表示に戻ります。ここから開いたノートで「戻る」（⌘← や ← ボタン）を押すと Tasks に戻り、Tasks で「戻る」を押すと開く前の表示に戻ります
- サイドバーの数字は未完了のタスク数です
- 設定の「タスク一覧・カンバンに出さないノートブック」で、テンプレート用などのノートブックを除外できます（カンマ区切り）

- 行や カードの ☆ をクリックすると優先度を変えられます（同じ星をもう一度で解除）
- 行やカードの ⏰ 期限（リスト・カンバン・マトリクス）をクリックすると、期限の設定画面で日付・時刻・期間・通知・優先度を変更したり、期限を削除したりできます。期限のない未完了タスクには、マウスを乗せると「⏰＋」が出て期限を付けられます

### ノートのステータス

- **ステータスの絞り込み**: ヘッダーの None / Active / On Hold / Completed / Dropped で、どのステータスのノートのタスクを表示するかを選べます（全ビュー共通、選択は保存されます）。既定では Completed / Dropped を隠します
- **On Hold**: On Hold のノートのタスクは薄く表示され、**通知は止まります**。Active などに戻すと再び通知されます（保留中に期限が来たものは、直近12時間以内なら戻した時点で一度だけ通知）
- **リストのグループ**: 「期限 / ステータス / ノート」で切り替えられます。ノートごとにすると、見出しにノート名・ステータス・ノートブックが出て、クリックでノートを開けます

### ノートのボード（「ノート」タブ）

カード＝ノート、列＝ステータスのボードです。

- カードにはタグ、タスクの完了数（☑ 5/12）と進捗バー、未完了タスクの最高の優先度、🏃 の数、一番近い期限が出ます
- カードを別の列にドラッグする（またはカードにマウスを乗せて出るボタン）と、ノートのステータスが変わります。クリックでノートを開きます
- None / Active / On Hold の列には、未完了のタスク（または期限）が残っているノートだけを表示します。Completed / Dropped の列は更新日の新しい順で、多い場合は「さらに表示」で続きを出せます
- タスクか期限のあるノートだけが対象です

### カンバン

Tasks の上部で「カンバン」に切り替えると、**未着手 / 進行中 / 完了** の3列で表示します。

- カードをドラッグして別の列に移すと、ノートのタスク行が書き換わります
  - 未着手: `- [ ] 見積書を送る`
  - 進行中: `- [ ] 見積書を送る 🏃`（`🏃` は手で書いても OK）
  - 完了: `- [x] 見積書を送る`（`🏃` は外れます）
- カードにマウスを乗せると出るボタンでも移動できます
- カードをクリックするとタスクの行へ、カード下のノート名をクリックするとノートを開きます
- 完了の列は、更新が新しいノートのものから30件ずつ表示します
- 未着手・進行中の列は優先度の高い順です

### アイゼンハワーマトリクス

Tasks の上部で「マトリクス」に切り替えると、未完了のタスクを4つの象限に分けて表示します。判定は今ある記法だけで行います（新しい記法は不要です）。

| | 緊急: 期限切れ・N日以内 | 緊急でない: 期限なし・それより先 |
|---|---|---|
| **重要: ⭐⭐ 以上** | 今すぐやる | 計画する |
| **重要でない: それ未満** | 任せる・手早く済ませる | やめる・後回し |

- しきい値は設定の「マトリクス: 「重要」とみなす ⭐ の数」（既定 2）と「マトリクス: 「緊急」とみなす期限」（今日から何日以内、既定 2、0 で今日まで）で変えられます。期間は終わりの日で判定します
- カードを別の象限にドラッグすると、タスク行が書き換わります
  - 重要へ: ⭐ をしきい値まで上げる / 重要でないへ: しきい値より1つ少なくする
  - 緊急へ: 期限を今日にする（期限がなければ終日の期限を付ける）/ 緊急でないへ: 期限を緊急の範囲の翌日にずらす。期間は長さを保ったまま動きます
- 小タスクはカンバンと同じく親カードの中のチェックリストになります。⭐ を持たないノートの期限は出ません
- カードにマウスを乗せると出る「✓ 完了」で完了にできます。コマンド `reminder:show-matrix` でも開けます

### ガント

Tasks の上部で「ガント」に切り替えると、期限・期間のあるタスク（とノート）を日単位のタイムラインで表示します。

- 期間はバー、期限だけのものは ◆ で表示（未着手: 青 / 進行中: 橙 / 期限切れ: 赤 / 完了: 緑）
- ‹ › で1週間ずつ移動、「今日」で今週に戻ります。今日の列は青く表示されます
- 行やバーをクリックするとタスク・ノートを開きます
- **バーをドラッグして日程を変更できます**（日単位。離すとノートの行が書き換わります）
  - バーの真ん中: 期間ごと移動（長さ・時刻はそのまま）
  - バーの左端 / 右端: 開始日 / 終了日を変更
  - ◆（期限だけ）: ドラッグで期限を移動、右端を引き伸ばすと期間になります
  - 1日・時刻なしまで縮めた期間は期限（◆）に戻ります
  - 🔔 の設定はそのまま残ります
- 「完了も表示」で完了したものも出せます
- ノートの期限のカードは、進行中にすると期限の行に `🏃`、完了にするとノートのステータスが Completed になります（未着手・進行中に戻すと Active）

### カレンダー

Tasks の上部で「カレンダー」に切り替える（または `⌘⌥Y`）と、タスクを日・週・月・年のカレンダーで表示します。検索欄で絞り込んだタスクだけが表示されます。

| キー | 動作 |
| --- | --- |
| `D` / `W` / `M` / `Y` | 日 / 週 / 月 / 年 表示 |
| `T` | 今日へ |
| `J` `N` `→` / `K` `P` `←` | 次へ / 前へ |

- 期限のあるタスク・ノートを期限の日に表示（時刻なしは終日、期間は複数日のバー）
- チェックボックスで完了・未完了を切り替え、クリックでタスクの行を開く
- ドラッグで日付（週・日表示では時刻も）を変更。`🔔` の設定はそのまま。期間は日単位で期間ごと移動
- 左側の「完了したタスクも表示」で完了したものも表示

## 注意

- ステータスが Completed / Dropped / On Hold のノートでは、タスクの期限も通知されません
- 通知は Inkdrop が起動している間だけ届きます（閉じていた間の分は、起動時に直近12時間以内のものを通知）
- デスクトップ版専用です
- **Language** 設定: 既定の `auto` はシステムの言語に日本語が含まれていれば日本語、それ以外は英語で表示します。`en` / `ja` で固定できます。ノートに書く記号（`⏰`・`🔔30m`・`⭐`・`🏃`）はどちらの言語でも同じです

## 開発

```sh
npm install
npm run dev   # lib/ をウォッチビルド
```

## ライセンス

MIT
