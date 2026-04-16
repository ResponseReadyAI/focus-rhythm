# Focus Rhythm — Project Context for Claude Code Agents

A calm, coach-like focus timer PWA for a solo founder/live-in caregiver. No backend. Pure vanilla JS/HTML/CSS, runs entirely in the browser.

---

## File Map

| File | Purpose |
|------|---------|
| `index.html` | All screens, modals, bottom sheet markup |
| `styles.css` | All styling; CSS variable theming system |
| `app.js` | All application logic |
| `manifest.json` | PWA manifest (icons, display mode) |
| `service-worker.js` | Offline caching; cache-first assets, network-first HTML |
| `icon.svg` | Clock icon with rounded-rect background |

---

## Screens & Layout (index.html)

The app has a single `#app` div containing 4 screens (only one `.active` at a time):

| Screen ID | When shown |
|-----------|-----------|
| `#screen-start` | Initial — track selection |
| `#screen-active` | Timer running — task list + ring timer + controls |
| `#screen-refresh` | After session ends — refresh picker |
| `#screen-return` | After refresh — "how are you feeling?" |

**Outside `#app`** (important for CSS scoping):
- `#modal-frustration` — full-screen overlay modal
- `#modal-reset` — full-screen overlay modal
- `#sheet-switch-stay` — fixed-position bottom sheet

---

## CSS Variable System (styles.css)

Track-specific theming is applied via `#app[data-track="deep|light|gaming"]`.

**Critical:** The bottom sheet (`#sheet-switch-stay`) lives *outside* `#app`, so its track-specific CSS uses `body[data-track="..."]` instead.

### Root variables
```css
--deep-bg, --deep-border, --deep-text
--light-bg, --light-border, --light-text
--gaming-bg, --gaming-border, --gaming-text
--frustration-bg, --frustration-border, --frustration-text
--timer-bg, --timer-border, --timer-text
--text-primary, --text-secondary, --text-muted
--surface-1, --surface-2, --surface-3
--radius-sm, --radius-md, --radius-lg
```

### Track theming selectors
- `#app[data-track="deep"] ...` — applies indigo/blue theme
- `#app[data-track="light"] ...` — applies teal/green theme
- `#app[data-track="gaming"] ...` — applies purple theme
- `body[data-track="light"] .btn-sheet-switch` — sheet buttons (outside #app)

### Key interactive task styles
```
.task-item-interactive    — row container (flex, with hover)
.task-checkbox            — custom-styled checkbox
.task-emoji-ce            — contenteditable emoji span
.task-text-ce             — contenteditable task description span
.task-duration-badge      — contenteditable duration pill
.task-delete-btn          — × delete button (hidden until hover)
.task-add-btn             — "+ Add task" button at list bottom
.task-item-checked        — checked row (adds strikethrough)
```

### Bottom sheet animation
```css
.switch-stay-sheet                       — default: translateY(110%) hidden
.switch-stay-sheet.visible               — translateY(0) shown
.sheet-progress-fill.draining            — 7s drain animation (scaleX 1→0)
```

---

## App Logic (app.js)

### CONFIG object
All timer durations and nudge messages. Edit here; no digging elsewhere.
```js
CONFIG.timers.deepWork      // 90 * 60 seconds
CONFIG.timers.lightTrack    // 60 * 60 seconds
CONFIG.timers.gaming        // 20 * 60 seconds
CONFIG.timers.refreshWalk   // 12 * 60 seconds
CONFIG.timers.refreshFrench // 17 * 60 seconds
CONFIG.timers.refreshGaming // 20 * 60 seconds
CONFIG.nudges.firstWarning  // 20 * 60 — fires "20 min to go" nudge
CONFIG.nudges.secondWarning //  5 * 60 — fires "5 min" nudge
CONFIG.nudges.firstMessage, .secondMessage, .endMessage, .gamingMessage
CONFIG.speech.rate, .pitch, .volume, .lang
```

### Data Structures

**Task object:**
```js
{ id: string, emoji: string, text: string, duration: string, checked: boolean }
```

**TRACKS object:**
```js
TRACKS['deep'   ] = { name, emoji, duration, durationLabel }
TRACKS['light'  ] = { name, emoji, duration, durationLabel }
TRACKS['gaming' ] = { name, emoji, duration, durationLabel }
```

**DEFAULT_TASKS:** pre-populated deep (5 tasks, 90 min) and light (5 tasks, 60 min) task lists.

**GAMING_TASKS:** static array (2 items) — never stored, never editable.

### localStorage Keys

| Key | Stores |
|-----|--------|
| `focusRhythm_session` | Timer state: track, timerState, sessionStartTime, pausedRemaining, nudgesFired, savedAt |
| `focusRhythm_tasks` | `{ deep: [...tasks], light: [...tasks] }` — user's editable task lists |

Session is cleared on reset, break, or after 3 hours.
Tasks persist indefinitely (user's personal list).

### Key Function Reference

**Task persistence:**
- `loadTasks()` — load from localStorage or copy DEFAULT_TASKS
- `saveTasks()` — write `taskData` to localStorage
- `getTaskById(id, trackKey)` — find task in taskData
- `updateTaskField(id, trackKey, field, value)` — mutate + save

**Task rendering:**
- `renderTaskList(trackKey)` — rebuild #task-list DOM; gaming gets static list
- `buildTaskElement(task, trackKey)` — creates interactive row DOM node
- `buildAddTaskButton(trackKey)` — creates "+ Add task" button
- `blockEnterKey(e, el)` — prevent Enter newlines in contenteditable

**Task CRUD:**
- `handleTaskCheck(id, trackKey, checked, rowEl)` — update data, toggle CSS, show sheet
- `deleteTask(id, trackKey, rowEl)` — remove from data, animate collapse via rAF
- `addTask(trackKey)` — append new task, slide-in animation, auto-focus text field

**Switch-or-stay sheet:**
- `showSwitchOrStay(taskText)` — show sheet, restart drain animation, 7-sec auto-dismiss
- `dismissSwitchStay()` — hide sheet, clear timeout
- `keepGoingFromPrompt()` — dismiss only
- `switchModesFromPrompt()` — stop timer, clear session, go to start screen

**Timer core:**
- `getRemaining()` — returns seconds remaining (Date.now() math, not tick counting)
- `startTick()` / `stopTick()` — setInterval 500ms
- `tick()` — update display + ring + save session + check for end
- `updateTimerDisplay(remaining, total)` — update #timer-display text + SVG ring
- `updateRing(remaining, total)` — set strokeDashoffset on #progress-ring-fill

**Timer controls:**
- `handleStartPause()` — routes to start/pause/resume based on timerState
- `startSession()` — set timerState='running', scheduleNudges, startTick
- `pauseSession()` — capture remaining, stop tick, show paused UI
- `resumeSession()` — restore sessionStartTime, resume tick
- `doReset()` — full reset to idle state
- `onSessionEnd()` — stop, notify, speak, go to refresh after 3s

**Screen nav:**
- `showScreen(name)` — swap .active class
- `selectTrack(trackKey)` — sets track, renders tasks, shows active screen
  - Sets BOTH `document.getElementById('app').dataset.track` AND `document.body.dataset.track`

**Modals:**
- `openFrustration()` / `closeFrustration()` / `closeFrustrationOnBackdrop(event)`
- `openReset()` / `closeReset()` / `closeResetOnBackdrop(event)` / `confirmReset()`
- `takeBreakNow()` — close frustration, go to refresh

**Refresh screen:**
- `selectRefresh(type, cardEl)` — highlight card, start timed refresh if applicable
- `tickRefresh()` — update refresh ring + fire gaming nudge
- `finishRefresh()` — stop timer, go to return screen

**Return check:**
- `returnSameTrack()` — re-enter current track
- `returnSwitchTrack()` — go to start screen
- `returnDone()` — clear track, go to start screen

**Session persistence:**
- `saveSession()` — write state to localStorage
- `clearSession()` — remove from localStorage
- `restoreSession()` — on init, restore running/paused session from storage

**Speech + notifications:**
- `speak(text)` — fire Web Speech API utterance
- `showNotification(title, body)` — Web Notifications API
- `fireNudge(key)` — fire nudge once (deduped via nudgesFired Set)
- `scheduleNudges()` — set timeouts for 20-min and 5-min nudges

---

## Critical Patterns to Preserve

### Date.now() timer math
The timer uses `sessionStartTime` (a Date.now() epoch) and computes remaining as:
```js
Math.max(0, totalDuration - (Date.now() - sessionStartTime) / 1000)
```
**Do not change to tick-counting.** This survives iOS background throttling.

### body[data-track] for fixed-position elements
Both `#app.dataset.track` AND `document.body.dataset.track` are set in `selectTrack()` and `restoreSession()`. CSS for elements outside `#app` must use `body[data-track="..."]`.

### requestAnimationFrame for delete animation
The collapse animation in `deleteTask()` sets explicit height *before* rAF, then transitions *inside* rAF. This pattern must be preserved or the browser batches both changes and skips the animation.

### Drain animation restart
`showSwitchOrStay()` removes the `.draining` class, forces a reflow with `void fill.offsetWidth`, then re-adds it. This is required to restart a CSS animation.

### Gaming track is static
Gaming tasks use `GAMING_TASKS` (static array), no localStorage, no checkboxes, no editing. Keep it this way.

---

## Edit Subagent Usage Pattern

When the user asks for an app change, spawn a focused subagent like this:

```js
Agent({
  description: "Short description of the change",
  prompt: `You are editing the Focus Rhythm PWA at /Users/arianefaria/Documents/focus-rhythm/.
Read CLAUDE.md first for full context — it documents every function, CSS variable, data structure, and critical pattern.
Then read only the specific files you need to touch.

Task: [exact description of the change]

Requirements:
- [specific constraint 1]
- [specific constraint 2]

When done, report back: which files changed, what lines changed, and confirm any critical patterns were preserved.`
})
```

The subagent reads CLAUDE.md (this file) instead of all source files, makes targeted edits, and reports back a concise summary. Main agent implements from that summary if needed, or the subagent edits directly with `isolation: "worktree"` for safety.
