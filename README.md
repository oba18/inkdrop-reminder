# reminder

Adds due dates and reminders to Inkdrop tasks and sends desktop notifications. It also gives you a task list, Kanban, Gantt and calendar views, subtasks, and a board of notes by status.

## Installation

Search for `reminder` in Inkdrop's Preferences → Plugins, or run:

```sh
ipm install reminder
```

Works with the Inkdrop 6+ desktop app. The keyboard shortcuts are for macOS (on Windows / Linux, use the Plugins menu or the commands).

The plugin's UI text is currently in Japanese. The main labels are: リスト (List), カンバン (Kanban), ノート (Notes), ガント (Gantt), カレンダー (Calendar), 期限 (due date), 未着手 / 進行中 / 完了 (To do / In progress / Done).

### Features that edit your notes automatically

The following features rewrite notes automatically. Each can be turned off in Preferences → Plugins → reminder.

| Feature | Default | What it does |
| --- | --- | --- |
| Link parent and subtask checks (親タスクと小タスクのチェックを連動させる) | On | Checking a parent checks its subtasks, finishing all subtasks checks the parent, etc. (see [Subtasks](#subtasks)) |
| Mark the note Completed when all tasks are done (タスクがすべて完了したらノートを Completed にする) | On | When every task with a due date is checked |
| Set the note back to Active when a done task is unchecked (完了済みのタスクのチェックを外したらノートを Active に戻す) | On | The reverse of the above |

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
- Click a checkbox to toggle a task. Click a row to open the note at that task's line
- Selecting another sidebar item or opening a note returns to the normal view
- The number in the sidebar is the count of open tasks
- Exclude notebooks such as templates with the "notebooks to hide from the task list and Kanban" setting (タスク一覧・カンバンに出さないノートブック, comma-separated)
- Click the ☆ on a row or card to change the priority (click the same star again to clear it)

### Note status

- **Status filter**: Choose which note statuses' tasks to show with None / Active / On Hold / Completed / Dropped in the header (applies to every view and is remembered). Completed / Dropped are hidden by default
- **On Hold**: Tasks in On Hold notes are dimmed and **their notifications stop**. They resume when you set the note back to Active, etc. (anything that came due while on hold is notified once at that point, if it was within the last 12 hours)
- **List grouping**: Switch between due date / status / note. When grouped by note, each heading shows the note title, status and notebook; click it to open the note

### Note board (the "ノート" tab)

A board with one card per note and one column per status.

- Each card shows tags, the number of done tasks (☑ 5/12) with a progress bar, the highest priority among open tasks, the number of 🏃 tasks, and the nearest due date
- Drag a card to another column (or use the buttons shown on hover) to change the note's status. Click a card to open the note
- The None / Active / On Hold columns only show notes with open tasks (or a due date) left. The Completed / Dropped columns are sorted by most recently updated, with "show more" (さらに表示) for the rest
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

### Gantt

Switch to Gantt at the top of Tasks to see tasks (and notes) with a due date or period on a daily timeline.

- Periods are bars and single due dates are ◆ (to do: blue / in progress: orange / overdue: red / done: green)
- ‹ › move one week; "today" (今日) jumps back to this week. Today's column is highlighted in blue
- Click a row or bar to open the task or note
- **Drag bars to reschedule** (by day; the note's line is rewritten when you release)
  - Middle of a bar: move the whole period (length and times are kept)
  - Left / right edge of a bar: change the start / end date
  - ◆ (due date only): drag to move it, or stretch its right edge to make it a period
  - A period shrunk to one day with no time turns back into a due date (◆)
  - 🔔 settings are kept
- "Show done" (完了も表示) also shows finished items
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

## Development

```sh
npm install
npm run dev   # watch-build into lib/
```

## License

MIT
