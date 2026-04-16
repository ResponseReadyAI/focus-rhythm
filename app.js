/* ============================================================
   Focus Rhythm — App Logic
   ============================================================ */

// ---- CONFIG ----
// All customizable values live here. Update durations and messages without
// digging through the rest of the code.

const CONFIG = {
  timers: {
    deepWork:      90 * 60,  // seconds — Deep Work session length
    lightTrack:    60 * 60,  // seconds — Light Track session length
    gaming:        20 * 60,  // seconds — Gaming eye-break session length
    refreshWalk:   12 * 60,  // seconds — Walk refresh timer
    refreshFrench: 17 * 60,  // seconds — French refresh timer
    refreshGaming: 20 * 60,  // seconds — Gaming refresh timer
  },
  nudges: {
    firstWarning:   20 * 60,  // seconds remaining when first nudge fires
    secondWarning:   5 * 60,  // seconds remaining when second nudge fires
    gamingWarning:   5 * 60,  // seconds remaining for gaming nudge
    firstMessage:  "You've been in it — 20 minutes to go. Start winding down when you're ready.",
    secondMessage: "Five minutes. You made real progress — start landing the plane.",
    endMessage:    "That's your break. You earned it. Pick a refresh and we'll go again.",
    gamingMessage: "Five minutes until your eye break. Finish up this round.",
  },
  speech: {
    rate:   0.92,
    pitch:  1.0,
    volume: 1.0,
    lang:   'en-US',
  },
};

// ---- DEFAULT TASK DATA ----
// Deep work tasks sum to 90 min, light track tasks sum to 60 min.
// Users can edit these freely; edits persist in localStorage.

const DEFAULT_TASKS = {
  deep: [
    { id: 'd1', emoji: '🤖', text: 'Building or debugging agents',          duration: '25 min', checked: false },
    { id: 'd2', emoji: '📺', text: 'Claude Code tutorial (video)',           duration: '20 min', checked: false },
    { id: 'd3', emoji: '🔧', text: 'Project work — Twilio, SMS, testing',   duration: '20 min', checked: false },
    { id: 'd4', emoji: '📝', text: 'Scheduling agent build',                 duration: '15 min', checked: false },
    { id: 'd5', emoji: '🧪', text: 'Reviewing / testing submitted projects', duration: '10 min', checked: false },
  ],
  light: [
    { id: 'l1', emoji: '📣', text: 'Marketing research — industries, leads', duration: '15 min', checked: false },
    { id: 'l2', emoji: '📋', text: 'Review course feedback',                 duration: '10 min', checked: false },
    { id: 'l3', emoji: '✍️',  text: 'Outlining, writing, not coding',        duration: '15 min', checked: false },
    { id: 'l4', emoji: '🇫🇷', text: 'French lesson',                         duration: '15 min', checked: false },
    { id: 'l5', emoji: '📖', text: 'Reading about voice AI / competition',   duration: '5 min',  checked: false },
  ],
};

// Gaming tasks are static reference items — never editable, never stored.
const GAMING_TASKS = [
  { emoji: '👁️', text: 'Every 20 min: look 20 ft away for 20 sec' },
  { emoji: '🎮', text: '20-20-20 rule — this timer makes it automatic' },
];

// ---- TRACK DEFINITIONS ----
const TRACKS = {
  deep:   { name: 'Deep Work',   emoji: '⚡', duration: CONFIG.timers.deepWork,   durationLabel: '90 min session' },
  light:  { name: 'Light Track', emoji: '🌫', duration: CONFIG.timers.lightTrack, durationLabel: '60 min session' },
  gaming: { name: 'Gaming Mode', emoji: '🎮', duration: CONFIG.timers.gaming,     durationLabel: '20 min eye-break timer' },
};

// ---- TIMER STATE ----
let currentScreen    = 'start';
let currentTrack     = null;   // 'deep' | 'light' | 'gaming'
let timerState       = 'idle'; // 'idle' | 'running' | 'paused' | 'finished'
let totalDuration    = 0;
let sessionStartTime = null;   // Date.now() adjusted for pauses
let pausedRemaining  = 0;
let nudgesFired      = new Set();
let nudgeTimeout1    = null;
let nudgeTimeout2    = null;
let tickInterval     = null;
let pendingSpeak     = [];

// ---- TASK STATE ----
let taskData = {};    // { deep: [...], light: [...] }

// ---- REFRESH STATE ----
let refreshType             = null;
let refreshStartTime        = null;
let refreshDuration         = 0;
let refreshInterval         = null;
let refreshNudgeFired       = false;
let refreshPaused           = false;
let refreshPausedRemaining  = 0;

// ---- SWITCH-OR-STAY STATE ----
let switchStayTimeout = null;

// ---- ADD-TIME STATE ----
let extraTimeAdded = 0;
let pendingAddTime = 0;

// ---- AMBIENT SOUND STATE ----
let ambientCtx   = null;
let ambientNodes = [];   // all nodes created for current sound (for cleanup)
let ambientType  = null; // current active sound type, or null

// ---- SPEECH ----
let voices = [];

// ---- RING CIRCUMFERENCES ----
const MAIN_RING_C    = 2 * Math.PI * 88;   // ≈ 552.92
const REFRESH_RING_C = 2 * Math.PI * 50;   // ≈ 314.16

// ============================================================
// INIT
// ============================================================

(function init() {
  loadTasks();
  loadVoices();
  if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = loadVoices;

  document.addEventListener('visibilitychange', onVisibilityChange);

  restoreSession();
  initCooldownUI();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
})();

// ============================================================
// TASK PERSISTENCE
// ============================================================

const TASKS_KEY = 'focusRhythm_tasks';

function loadTasks() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(TASKS_KEY)); } catch (_) {}
  taskData = {
    deep:  (saved && Array.isArray(saved.deep))  ? saved.deep  : JSON.parse(JSON.stringify(DEFAULT_TASKS.deep)),
    light: (saved && Array.isArray(saved.light)) ? saved.light : JSON.parse(JSON.stringify(DEFAULT_TASKS.light)),
  };
  // Migrate old tasks that may be missing duration or checked fields
  ['deep', 'light'].forEach(track => {
    taskData[track] = taskData[track].map(t => ({
      checked:  false,
      duration: '15 min',
      ...t,
    }));
  });
}

function saveTasks() {
  try {
    localStorage.setItem(TASKS_KEY, JSON.stringify({ deep: taskData.deep, light: taskData.light }));
  } catch (_) {}
}

function getTaskById(id, trackKey) {
  return (taskData[trackKey] || []).find(t => t.id === id);
}

function updateTaskField(id, trackKey, field, value) {
  const task = getTaskById(id, trackKey);
  if (!task) return;
  task[field] = value;
  saveTasks();
}

// ============================================================
// TASK LIST RENDERING
// ============================================================

function renderTaskList(trackKey) {
  const container = document.getElementById('task-list');
  container.innerHTML = '';

  if (trackKey === 'gaming') {
    GAMING_TASKS.forEach(task => {
      const div = document.createElement('div');
      div.className = 'task-item';
      div.setAttribute('role', 'listitem');
      const emoji = document.createElement('span');
      emoji.className = 'task-item-emoji';
      emoji.setAttribute('aria-hidden', 'true');
      emoji.textContent = task.emoji;
      const text = document.createElement('span');
      text.textContent = task.text;
      div.appendChild(emoji);
      div.appendChild(text);
      container.appendChild(div);
    });
    return; // No add button for gaming
  }

  // Deep or light — fully interactive
  const tasks = taskData[trackKey] || [];
  tasks.forEach(task => {
    container.appendChild(buildTaskElement(task, trackKey));
  });

  // "Add task" button at the bottom of the list
  container.appendChild(buildAddTaskButton(trackKey));
}

function buildTaskElement(task, trackKey) {
  const div = document.createElement('div');
  div.className = `task-item-interactive${task.checked ? ' task-item-checked' : ''}`;
  div.setAttribute('role', 'listitem');
  div.dataset.id = task.id;

  // ---- Checkbox ----
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'task-checkbox';
  checkbox.checked = task.checked;
  checkbox.setAttribute('aria-label', task.text);
  checkbox.addEventListener('change', () => {
    handleTaskCheck(task.id, trackKey, checkbox.checked, div);
  });

  // ---- Emoji (contenteditable) ----
  const emojiEl = document.createElement('span');
  emojiEl.className = 'task-emoji-ce';
  emojiEl.contentEditable = 'true';
  emojiEl.setAttribute('aria-label', 'Task emoji');
  emojiEl.setAttribute('spellcheck', 'false');
  emojiEl.textContent = task.emoji;
  emojiEl.addEventListener('keydown', e => blockEnterKey(e, emojiEl));
  emojiEl.addEventListener('blur', () => {
    const val = emojiEl.textContent.trim() || task.emoji;
    emojiEl.textContent = val; // normalize
    updateTaskField(task.id, trackKey, 'emoji', val);
  });

  // ---- Task text (contenteditable) ----
  const textEl = document.createElement('span');
  textEl.className = `task-text-ce${task.checked ? ' task-checked-text' : ''}`;
  textEl.contentEditable = 'true';
  textEl.setAttribute('aria-label', 'Task description');
  textEl.setAttribute('spellcheck', 'true');
  textEl.textContent = task.text;
  textEl.addEventListener('keydown', e => blockEnterKey(e, textEl));
  textEl.addEventListener('blur', () => {
    const val = textEl.textContent.trim() || task.text;
    textEl.textContent = val;
    updateTaskField(task.id, trackKey, 'text', val);
  });

  // ---- Duration badge (contenteditable) ----
  const durEl = document.createElement('span');
  durEl.className = 'task-duration-badge';
  durEl.contentEditable = 'true';
  durEl.setAttribute('aria-label', 'Task duration');
  durEl.setAttribute('spellcheck', 'false');
  durEl.textContent = task.duration;
  durEl.addEventListener('keydown', e => blockEnterKey(e, durEl));
  durEl.addEventListener('blur', () => {
    const val = durEl.textContent.trim() || task.duration;
    durEl.textContent = val;
    updateTaskField(task.id, trackKey, 'duration', val);
  });

  // ---- Delete button ----
  const delBtn = document.createElement('button');
  delBtn.className = 'task-delete-btn';
  delBtn.setAttribute('aria-label', 'Delete task');
  delBtn.innerHTML = '&times;';
  delBtn.addEventListener('click', () => deleteTask(task.id, trackKey, div));

  div.appendChild(checkbox);
  div.appendChild(emojiEl);
  div.appendChild(textEl);
  div.appendChild(durEl);
  div.appendChild(delBtn);

  return div;
}

function buildAddTaskButton(trackKey) {
  const btn = document.createElement('button');
  btn.className = 'task-add-btn';
  btn.textContent = '+ Add task';
  btn.addEventListener('click', () => addTask(trackKey));
  return btn;
}

// ---- Prevent Enter key from inserting newlines in contenteditable ----
function blockEnterKey(e, el) {
  if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
  if (e.key === 'Escape') { el.blur(); }
}

// ============================================================
// TASK CRUD
// ============================================================

function handleTaskCheck(id, trackKey, checked, rowEl) {
  updateTaskField(id, trackKey, 'checked', checked);
  rowEl.classList.toggle('task-item-checked', checked);

  if (checked) {
    const task = getTaskById(id, trackKey);
    showSwitchOrStay(task ? task.text : 'Task done');
  }
}

function deleteTask(id, trackKey, rowEl) {
  taskData[trackKey] = (taskData[trackKey] || []).filter(t => t.id !== id);
  saveTasks();
  // Set explicit start height first, then trigger transition on next frame
  rowEl.style.maxHeight = rowEl.offsetHeight + 'px';
  rowEl.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    rowEl.style.transition = 'opacity 0.18s ease, max-height 0.25s ease, padding 0.25s ease';
    rowEl.style.opacity = '0';
    rowEl.style.maxHeight = '0';
    rowEl.style.paddingTop = '0';
    rowEl.style.paddingBottom = '0';
    setTimeout(() => rowEl.remove(), 280);
  });
}

function addTask(trackKey) {
  const newTask = {
    id: `${trackKey}_${Date.now().toString(36)}`,
    emoji: '📌',
    text: 'New task',
    duration: '15 min',
    checked: false,
  };
  if (!taskData[trackKey]) taskData[trackKey] = [];
  taskData[trackKey].push(newTask);
  saveTasks();

  const container = document.getElementById('task-list');
  const addBtn = container.querySelector('.task-add-btn');
  const newEl = buildTaskElement(newTask, trackKey);

  // Slide in
  newEl.style.opacity = '0';
  newEl.style.transform = 'translateY(-6px)';
  container.insertBefore(newEl, addBtn);
  requestAnimationFrame(() => {
    newEl.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    newEl.style.opacity = '1';
    newEl.style.transform = 'translateY(0)';
  });

  // Auto-focus + select the text field of the new task
  const textField = newEl.querySelector('.task-text-ce');
  if (textField) {
    setTimeout(() => {
      textField.focus();
      const range = document.createRange();
      range.selectNodeContents(textField);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }, 60);
  }
}

// ============================================================
// SWITCH-OR-STAY SHEET
// ============================================================

function showSwitchOrStay(taskText) {
  const sheet = document.getElementById('sheet-switch-stay');
  const nameEl = document.getElementById('sheet-task-name');
  nameEl.textContent = taskText.length > 42 ? taskText.slice(0, 42) + '…' : taskText;

  // Restart drain animation by cycling the class
  const fill = document.getElementById('sheet-progress-fill');
  fill.classList.remove('draining');
  void fill.offsetWidth; // force reflow to restart animation
  fill.classList.add('draining');

  sheet.classList.add('visible');

  clearTimeout(switchStayTimeout);
  switchStayTimeout = setTimeout(dismissSwitchStay, 7000);
}

function dismissSwitchStay() {
  clearTimeout(switchStayTimeout);
  document.getElementById('sheet-switch-stay').classList.remove('visible');
}

function keepGoingFromPrompt() {
  dismissSwitchStay();
}

function switchModesFromPrompt() {
  dismissSwitchStay();
  stopTick();
  clearNudgeTimeouts();
  timerState = 'idle';
  clearSession();
  showScreen('start');
}

// ============================================================
// SPEECH SYNTHESIS
// ============================================================

function loadVoices() {
  if (!window.speechSynthesis) return;
  voices = window.speechSynthesis.getVoices();
}

function speak(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate   = CONFIG.speech.rate;
  utterance.pitch  = CONFIG.speech.pitch;
  utterance.volume = CONFIG.speech.volume;
  const preferred =
    voices.find(v => v.lang.startsWith('en-US') && v.localService) ||
    voices.find(v => v.lang.startsWith('en-US')) ||
    null;
  if (preferred) utterance.voice = preferred;
  window.speechSynthesis.speak(utterance);
}

// ============================================================
// NOTIFICATIONS
// ============================================================

function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') Notification.requestPermission();
}

function showNotification(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  new Notification(title, {
    body,
    icon: 'icon.svg',
    badge: 'icon.svg',
    tag: 'focus-rhythm-nudge',
    renotify: true,
  });
}

// ============================================================
// NUDGE SYSTEM
// ============================================================

function fireNudge(key) {
  if (nudgesFired.has(key) || timerState !== 'running') return;
  nudgesFired.add(key);

  const messages = {
    first:   CONFIG.nudges.firstMessage,
    second:  CONFIG.nudges.secondMessage,
    gaming5: CONFIG.nudges.gamingMessage,
  };
  const message = messages[key];
  if (!message) return;

  showNotification('Focus Rhythm', message);
  if (document.visibilityState === 'visible') {
    speak(message);
  } else {
    pendingSpeak.push(message);
  }
}

function scheduleNudges() {
  clearNudgeTimeouts();
  const remaining = getRemaining();

  if (currentTrack === 'gaming') {
    if (remaining > CONFIG.nudges.gamingWarning && !nudgesFired.has('gaming5')) {
      nudgeTimeout2 = setTimeout(() => fireNudge('gaming5'), (remaining - CONFIG.nudges.gamingWarning) * 1000);
    }
  } else {
    if (remaining > CONFIG.nudges.firstWarning && !nudgesFired.has('first')) {
      nudgeTimeout1 = setTimeout(() => fireNudge('first'), (remaining - CONFIG.nudges.firstWarning) * 1000);
    }
    if (remaining > CONFIG.nudges.secondWarning && !nudgesFired.has('second')) {
      nudgeTimeout2 = setTimeout(() => fireNudge('second'), (remaining - CONFIG.nudges.secondWarning) * 1000);
    }
  }
}

function clearNudgeTimeouts() {
  if (nudgeTimeout1) { clearTimeout(nudgeTimeout1); nudgeTimeout1 = null; }
  if (nudgeTimeout2) { clearTimeout(nudgeTimeout2); nudgeTimeout2 = null; }
}

// ============================================================
// TIMER — CORE
// ============================================================

function getRemaining() {
  if (timerState === 'paused' || timerState === 'idle') return pausedRemaining;
  if (timerState === 'finished') return 0;
  return Math.max(0, totalDuration - (Date.now() - sessionStartTime) / 1000);
}

function startTick() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(tick, 500);
}

function stopTick() {
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
}

function tick() {
  const remaining = getRemaining();
  updateTimerDisplay(remaining, totalDuration);
  saveSession();
  if (remaining <= 0 && timerState === 'running') onSessionEnd();
}

function updateTimerDisplay(remaining, total) {
  document.getElementById('timer-display').textContent = formatTime(Math.ceil(remaining));
  updateRing(remaining, total);
}

function updateRing(remaining, total) {
  const offset = MAIN_RING_C * (1 - (total > 0 ? remaining / total : 0));
  document.getElementById('progress-ring-fill').style.strokeDashoffset = offset;
}

function formatTime(totalSecs) {
  const s = Math.max(0, Math.floor(totalSecs));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// ============================================================
// TIMER — CONTROLS
// ============================================================

function handleStartPause() {
  if (timerState === 'idle')    startSession();
  else if (timerState === 'running') pauseSession();
  else if (timerState === 'paused')  resumeSession();
}

function startSession() {
  timerState = 'running';
  sessionStartTime = Date.now() - ((totalDuration - pausedRemaining) * 1000);
  requestNotificationPermission();
  scheduleNudges();
  startTick();
  updateStartPauseButton();
  setAppPausedState(false);
  saveSession();
  updateAddTimeButtons();
}

function pauseSession() {
  pausedRemaining = getRemaining();
  timerState = 'paused';
  stopTick();
  clearNudgeTimeouts();
  updateStartPauseButton();
  setAppPausedState(true);
  showPausedUI(true);
  saveSession();
  updateAddTimeButtons();
}

function resumeSession() {
  sessionStartTime = Date.now() - ((totalDuration - pausedRemaining) * 1000);
  timerState = 'running';
  scheduleNudges();
  startTick();
  updateStartPauseButton();
  setAppPausedState(false);
  showPausedUI(false);
  saveSession();
  updateAddTimeButtons();
}

function handleReset() {
  if (timerState === 'idle') return;
  openReset();
}

function confirmReset() {
  closeReset();
  doReset();
}

function doReset() {
  stopTick();
  clearNudgeTimeouts();
  timerState = 'idle';
  pausedRemaining = totalDuration;
  nudgesFired.clear();
  sessionStartTime = null;
  extraTimeAdded = 0;
  updateTimerDisplay(totalDuration, totalDuration);
  updateStartPauseButton();
  setAppPausedState(false);
  showPausedUI(false);
  clearSession();
  updateAddTimeButtons();
  stopAmbient();
  updateAmbientButtons(null);
}

function onSessionEnd() {
  timerState = 'finished';
  stopTick();
  clearNudgeTimeouts();
  updateTimerDisplay(0, totalDuration);
  updateRing(0, totalDuration);
  saveCooldown();
  logSession(currentTrack, totalDuration);
  clearSession();

  const msg = CONFIG.nudges.endMessage;
  showNotification('Focus Rhythm', msg);
  if (document.visibilityState === 'visible') {
    speak(msg);
  } else {
    pendingSpeak.push(msg);
  }

  setTimeout(() => showScreen('refresh'), 3000);
}

function updateStartPauseButton() {
  const btn = document.getElementById('btn-start-pause');
  if (timerState === 'idle')    btn.textContent = '▶ Start';
  if (timerState === 'running') btn.textContent = '⏸ Pause';
  if (timerState === 'paused')  btn.textContent = '▶ Resume';
}

function setAppPausedState(paused) {
  document.getElementById('app').classList.toggle('is-paused', paused);
}

function showPausedUI(paused) {
  document.getElementById('paused-badge').classList.toggle('hidden', !paused);
  document.getElementById('paused-hint').classList.toggle('hidden', !paused);
}

// ============================================================
// SCREEN NAVIGATION
// ============================================================

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
  currentScreen = name;
  window.scrollTo(0, 0);
}

function selectTrack(trackKey) {
  if (trackKey !== 'gaming') {
    const cd = getCooldown();
    if (cd) { initCooldownUI(); return; }
  }

  const track = TRACKS[trackKey];
  if (!track) return;

  currentTrack    = trackKey;
  totalDuration   = track.duration;
  pausedRemaining = totalDuration;
  timerState      = 'idle';
  nudgesFired.clear();
  pendingSpeak = [];
  extraTimeAdded  = 0;
  dismissSwitchStay();
  stopAmbient();
  updateAmbientButtons(null);

  document.getElementById('app').dataset.track = trackKey;
  document.body.dataset.track = trackKey;
  document.getElementById('track-emoji-display').textContent  = track.emoji;
  document.getElementById('track-name-display').textContent   = track.name;
  document.getElementById('track-duration-label').textContent = track.durationLabel;

  renderTaskList(trackKey);

  updateTimerDisplay(totalDuration, totalDuration);
  updateStartPauseButton();
  setAppPausedState(false);
  showPausedUI(false);
  updateAddTimeButtons();

  showScreen('active');
}

// ============================================================
// FRUSTRATION PROTOCOL
// ============================================================

function openFrustration() {
  if (timerState === 'running') pauseSession();
  logFrustration();
  document.getElementById('modal-frustration').classList.remove('hidden');
}

function closeFrustration() {
  document.getElementById('modal-frustration').classList.add('hidden');
}

function closeFrustrationOnBackdrop(event) {
  if (event.target === document.getElementById('modal-frustration')) closeFrustration();
}

function takeBreakNow() {
  closeFrustration();
  stopTick();
  clearNudgeTimeouts();
  timerState = 'finished';
  clearSession();
  showScreen('refresh');
}

// ============================================================
// RESET MODAL
// ============================================================

function openReset() {
  document.getElementById('modal-reset').classList.remove('hidden');
}

function closeReset() {
  document.getElementById('modal-reset').classList.add('hidden');
}

function closeResetOnBackdrop(event) {
  if (event.target === document.getElementById('modal-reset')) closeReset();
}

// ============================================================
// BACK MODAL
// ============================================================

function handleBack() {
  if (timerState === 'idle') {
    showScreen('start');
  } else {
    openBack();
  }
}
function openBack() { document.getElementById('modal-back').classList.remove('hidden'); }
function closeBack() { document.getElementById('modal-back').classList.add('hidden'); }
function closeBackOnBackdrop(event) { if (event.target === document.getElementById('modal-back')) closeBack(); }
function confirmBack() { closeBack(); doReset(); showScreen('start'); }

// ============================================================
// ADD TIME
// ============================================================

function handleAddTime(seconds) {
  if (extraTimeAdded + seconds > 1800) {
    const msgEl = document.getElementById('add-time-msg');
    msgEl.textContent = '30 min max per session';
    msgEl.classList.add('visible');
    setTimeout(() => msgEl.classList.remove('visible'), 2500);
    return;
  }
  pendingAddTime = seconds;
  const label = seconds === 900 ? '15' : '30';
  document.getElementById('add-time-body').textContent = `Add ${label} minutes to this session?`;
  document.getElementById('btn-confirm-add-time').textContent = `Add ${label} min`;
  document.getElementById('modal-add-time').classList.remove('hidden');
}
function closeAddTime() { document.getElementById('modal-add-time').classList.add('hidden'); }
function closeAddTimeOnBackdrop(event) { if (event.target === document.getElementById('modal-add-time')) closeAddTime(); }
function confirmAddTime() {
  totalDuration += pendingAddTime;
  extraTimeAdded += pendingAddTime;
  pendingAddTime = 0;
  closeAddTime();
  updateTimerDisplay(getRemaining(), totalDuration);
  updateRing(getRemaining(), totalDuration);
  saveSession();
  scheduleNudges();
  updateAddTimeButtons();
}
function updateAddTimeButtons() {
  const active = timerState === 'running' || timerState === 'paused';
  const btn15 = document.getElementById('btn-add-15');
  const btn30 = document.getElementById('btn-add-30');
  if (!btn15 || !btn30) return;
  btn15.disabled = !active || extraTimeAdded > 900;
  btn30.disabled = !active || extraTimeAdded > 0;
}

// ============================================================
// COOLDOWN
// ============================================================

const COOLDOWN_KEY = 'focusRhythm_cooldown';

function getCooldown() {
  try {
    const raw = JSON.parse(localStorage.getItem(COOLDOWN_KEY));
    if (!raw || !raw.until) return null;
    if (Date.now() >= raw.until) { localStorage.removeItem(COOLDOWN_KEY); return null; }
    return raw;
  } catch (_) { return null; }
}

function saveCooldown() {
  const cooldownMs = extraTimeAdded >= 1800 ? 30 * 60 * 1000 : 15 * 60 * 1000;
  try { localStorage.setItem(COOLDOWN_KEY, JSON.stringify({ until: Date.now() + cooldownMs })); } catch (_) {}
}

function initCooldownUI() {
  const cd = getCooldown();
  const notice = document.getElementById('cooldown-notice');
  const deepCard = document.querySelector('.deep-card');
  const lightCard = document.querySelector('.light-card');
  if (cd) {
    const unlockTime = new Date(cd.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    notice.textContent = 'Rest period active — sessions available at ' + unlockTime + '.';
    notice.classList.remove('hidden');
    deepCard.classList.add('cooldown-active');
    lightCard.classList.add('cooldown-active');
    const msLeft = cd.until - Date.now();
    setTimeout(() => {
      notice.classList.add('hidden');
      deepCard.classList.remove('cooldown-active');
      lightCard.classList.remove('cooldown-active');
    }, msLeft);
  } else {
    notice.classList.add('hidden');
    deepCard.classList.remove('cooldown-active');
    lightCard.classList.remove('cooldown-active');
  }
}

// ============================================================
// SESSION LOG
// ============================================================

const LOG_KEY = 'focusRhythm_log';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getLog() {
  try {
    const raw = JSON.parse(localStorage.getItem(LOG_KEY));
    if (raw && raw.date === todayStr()) return raw;
  } catch (_) {}
  return { date: todayStr(), sessions: [], breaks: [], frustrationCount: 0 };
}

function saveLog(log) {
  try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch (_) {}
}

function logSession(track, duration) {
  const log = getLog();
  log.sessions.push({ track, duration, timestamp: Date.now() });
  saveLog(log);
}

function logBreak(type, duration) {
  if (!type) return;
  const log = getLog();
  log.breaks.push({ type, duration: Math.round(duration), timestamp: Date.now() });
  saveLog(log);
}

function logFrustration() {
  const log = getLog();
  log.frustrationCount = (log.frustrationCount || 0) + 1;
  saveLog(log);
}

function formatLogDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function renderSessionLog() {
  const log = getLog();
  const el  = document.getElementById('log-summary');
  if (!el) return;

  if (!log.sessions.length && !log.breaks.length && !log.frustrationCount) {
    el.innerHTML = '<p class="log-empty">Nothing logged yet today.<br>Start a session to see your summary here.</p>';
    return;
  }

  const deepSessions   = log.sessions.filter(s => s.track === 'deep');
  const lightSessions  = log.sessions.filter(s => s.track === 'light');
  const gamingSessions = log.sessions.filter(s => s.track === 'gaming');

  const totalWorkSec = [...deepSessions, ...lightSessions]
    .reduce((sum, s) => sum + s.duration, 0);
  const totalHours = totalWorkSec / 3600;

  const rows = [];
  if (deepSessions.length)   rows.push(`${deepSessions.length} Deep Work session${deepSessions.length > 1 ? 's' : ''} &nbsp;<span class="log-dur">(${formatLogDuration(deepSessions.reduce((s, x) => s + x.duration, 0))})</span>`);
  if (lightSessions.length)  rows.push(`${lightSessions.length} Light Track session${lightSessions.length > 1 ? 's' : ''} &nbsp;<span class="log-dur">(${formatLogDuration(lightSessions.reduce((s, x) => s + x.duration, 0))})</span>`);
  if (gamingSessions.length) rows.push(`${gamingSessions.length} Gaming session${gamingSessions.length > 1 ? 's' : ''}`);
  if (log.breaks.length)     rows.push(`${log.breaks.length} break${log.breaks.length > 1 ? 's' : ''} taken`);
  if (log.frustrationCount)  rows.push(`Frustration protocol opened ${log.frustrationCount}&times;`);

  let msg;
  if (totalHours < 1)      msg = 'Even a little counts. You showed up.';
  else if (totalHours < 2) msg = 'Solid. More than most people managed today.';
  else if (totalHours < 4) msg = "That's a real day's work.";
  else                     msg = "That's a lot. Make sure tomorrow has some breathing room.";

  el.innerHTML = `
    <div class="log-card">
      <h2 class="log-title">Today</h2>
      <div class="log-divider"></div>
      <ul class="log-rows">${rows.map(r => `<li>${r}</li>`).join('')}</ul>
      <div class="log-divider"></div>
      <p class="log-message">${msg}</p>
    </div>`;
}

function showLog() {
  renderSessionLog();
  showScreen('log');
}

// ============================================================
// REFRESH SCREEN
// ============================================================

const REFRESH_OPTIONS = {
  walk:   { label: 'Quick Walk', duration: CONFIG.timers.refreshWalk,   hasTimer: true,  gaming: false,
            endMessage: "Walk's done. Hope you got some air. Ready when you are." },
  eat:    { label: 'Eating',     duration: 0,                            hasTimer: false, gaming: false,
            endMessage: null },
  french: { label: 'French',     duration: CONFIG.timers.refreshFrench,  hasTimer: true,  gaming: false,
            endMessage: "Good work. Different kind of brain, same you." },
  gaming: { label: 'Gaming',     duration: CONFIG.timers.refreshGaming,  hasTimer: true,  gaming: true,
            endMessage: "Time for your eye break — look at something far away for 20 seconds." },
};

function selectRefresh(type, cardEl) {
  refreshType = type;
  const option = REFRESH_OPTIONS[type];

  document.querySelectorAll('.refresh-card').forEach(c => c.classList.remove('selected'));
  if (cardEl) cardEl.classList.add('selected');

  // Always hide replay prompt on new selection
  document.getElementById('gaming-replay-prompt').classList.add('hidden');

  if (!option.hasTimer) {
    document.getElementById('refresh-active-timer').classList.add('hidden');
    document.getElementById('eat-message').classList.remove('hidden');
    return;
  }

  document.getElementById('eat-message').classList.add('hidden');
  stopRefreshTimer();
  refreshDuration        = option.duration;
  refreshStartTime       = Date.now();
  refreshNudgeFired      = false;
  refreshPaused          = false;
  refreshPausedRemaining = 0;

  document.getElementById('refresh-timer-label').textContent = option.label;
  document.getElementById('gaming-eye-note').classList.toggle('hidden', !option.gaming);
  document.getElementById('refresh-active-timer').classList.remove('hidden');
  const pauseBtn = document.getElementById('btn-refresh-pause');
  if (pauseBtn) pauseBtn.textContent = '⏸ Pause';

  updateRefreshDisplay(refreshDuration, refreshDuration);
  refreshInterval = setInterval(tickRefresh, 500);
}

function tickRefresh() {
  const elapsed    = (Date.now() - refreshStartTime) / 1000;
  const remaining  = Math.max(0, refreshDuration - elapsed);

  updateRefreshDisplay(remaining, refreshDuration);

  if (refreshType === 'gaming' && !refreshNudgeFired && remaining <= 5 * 60) {
    refreshNudgeFired = true;
    const msg = CONFIG.nudges.gamingMessage;
    showNotification('Focus Rhythm', msg);
    if (document.visibilityState === 'visible') speak(msg);
  }

  if (remaining <= 0) {
    stopRefreshTimer();
    const option = REFRESH_OPTIONS[refreshType];
    if (option && option.endMessage) speak(option.endMessage);

    if (refreshType === 'gaming') {
      // Show replay prompt instead of auto-transitioning
      document.getElementById('gaming-replay-prompt').classList.remove('hidden');
    } else {
      setTimeout(() => finishRefresh(), 3000);
    }
  }
}

function handleRefreshPause() {
  const pauseBtn = document.getElementById('btn-refresh-pause');
  if (!refreshPaused) {
    // Pause
    const elapsed = (Date.now() - refreshStartTime) / 1000;
    refreshPausedRemaining = Math.max(0, refreshDuration - elapsed);
    stopRefreshTimer();
    refreshPaused = true;
    if (pauseBtn) pauseBtn.textContent = '▶ Resume';
  } else {
    // Resume
    refreshStartTime = Date.now() - (refreshDuration - refreshPausedRemaining) * 1000;
    refreshInterval  = setInterval(tickRefresh, 500);
    refreshPaused    = false;
    if (pauseBtn) pauseBtn.textContent = '⏸ Pause';
  }
}

function handleGamingReplay(wantMore) {
  document.getElementById('gaming-replay-prompt').classList.add('hidden');
  if (wantMore) {
    selectRefresh('gaming', null);
  } else {
    finishRefresh();
  }
}

function updateRefreshDisplay(remaining, total) {
  document.getElementById('refresh-timer-display').textContent = formatTime(remaining);
  const offset = REFRESH_RING_C * (1 - (total > 0 ? remaining / total : 0));
  document.getElementById('refresh-ring-fill').style.strokeDashoffset = offset;
}

function stopRefreshTimer() {
  if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
}

function finishRefresh() {
  stopRefreshTimer();
  if (refreshType) {
    const elapsed = refreshStartTime
      ? Math.min(refreshDuration || 0, (Date.now() - refreshStartTime) / 1000)
      : 0;
    logBreak(refreshType, elapsed);
  }
  showScreen('return');
}

// ============================================================
// RETURN CHECK
// ============================================================

function returnSameTrack() {
  if (!currentTrack) { showScreen('start'); return; }
  selectTrack(currentTrack);
}

function returnSwitchTrack() {
  showScreen('start');
}

function returnDone() {
  currentTrack = null;
  showScreen('start');
}

// ============================================================
// AMBIENT SOUND
// ============================================================

function createNoiseBuffer(ctx, type) {
  const bufLen = ctx.sampleRate * 3;
  const buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data   = buf.getChannelData(0);
  if (type === 'brown') {
    let last = 0;
    for (let i = 0; i < bufLen; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 8;
    }
  } else {
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
  }
  return buf;
}

function stopAmbient() {
  ambientNodes.forEach(n => {
    try { if (n.stop) n.stop(); } catch (_) {}
    try { n.disconnect(); }       catch (_) {}
  });
  ambientNodes = [];
  ambientType  = null;
}

function updateAmbientButtons(type) {
  document.querySelectorAll('.ambient-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sound === (type || 'off'));
  });
}

function selectAmbient(type) {
  if (ambientType === type) { stopAmbient(); updateAmbientButtons(null); return; }
  stopAmbient();
  if (type === 'off') { updateAmbientButtons(null); return; }

  if (!ambientCtx) ambientCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (ambientCtx.state === 'suspended') ambientCtx.resume();

  ambientType = type;
  updateAmbientButtons(type);

  const master = ambientCtx.createGain();
  master.gain.value = 0.28;
  master.connect(ambientCtx.destination);
  ambientNodes.push(master);

  switch (type) {
    case 'rain':   buildRain(ambientCtx, master);   break;
    case 'cafe':   buildCafe(ambientCtx, master);   break;
    case 'waves':  buildWaves(ambientCtx, master);  break;
    case 'forest': buildForest(ambientCtx, master); break;
  }
}

function buildRain(ctx, dest) {
  const src = ctx.createBufferSource();
  src.buffer = createNoiseBuffer(ctx, 'white');
  src.loop   = true;

  const filter = ctx.createBiquadFilter();
  filter.type            = 'lowpass';
  filter.frequency.value = 1800;
  filter.Q.value         = 0.5;

  const gain = ctx.createGain();
  gain.gain.value = 0.65;

  const lfo     = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.05;
  lfoGain.gain.value  = 0.14;
  lfo.connect(lfoGain);
  lfoGain.connect(gain.gain);

  src.connect(filter); filter.connect(gain); gain.connect(dest);
  lfo.start(); src.start();
  ambientNodes.push(src, filter, gain, lfo, lfoGain);
}

function buildCafe(ctx, dest) {
  const src = ctx.createBufferSource();
  src.buffer = createNoiseBuffer(ctx, 'brown');
  src.loop   = true;

  const filter = ctx.createBiquadFilter();
  filter.type            = 'bandpass';
  filter.frequency.value = 700;
  filter.Q.value         = 0.7;

  const gain = ctx.createGain();
  gain.gain.value = 1.6;

  src.connect(filter); filter.connect(gain); gain.connect(dest);
  src.start();
  ambientNodes.push(src, filter, gain);
}

function buildWaves(ctx, dest) {
  const src = ctx.createBufferSource();
  src.buffer = createNoiseBuffer(ctx, 'white');
  src.loop   = true;

  const filter = ctx.createBiquadFilter();
  filter.type            = 'lowpass';
  filter.frequency.value = 650;
  filter.Q.value         = 1.2;

  const gain = ctx.createGain();
  gain.gain.value = 0.45;

  const lfo     = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.12;
  lfoGain.gain.value  = 0.38;
  lfo.connect(lfoGain);
  lfoGain.connect(gain.gain);

  src.connect(filter); filter.connect(gain); gain.connect(dest);
  lfo.start(); src.start();
  ambientNodes.push(src, filter, gain, lfo, lfoGain);
}

function buildForest(ctx, dest) {
  // Base: brown noise through lowpass
  const base = ctx.createBufferSource();
  base.buffer = createNoiseBuffer(ctx, 'brown');
  base.loop   = true;

  const baseFilter = ctx.createBiquadFilter();
  baseFilter.type            = 'lowpass';
  baseFilter.frequency.value = 1400;

  const baseGain = ctx.createGain();
  baseGain.gain.value = 1.1;

  base.connect(baseFilter); baseFilter.connect(baseGain); baseGain.connect(dest);

  // Shimmer: high-pass white noise for bird-like texture
  const shimmer = ctx.createBufferSource();
  shimmer.buffer = createNoiseBuffer(ctx, 'white');
  shimmer.loop   = true;

  const shimFilter = ctx.createBiquadFilter();
  shimFilter.type            = 'highpass';
  shimFilter.frequency.value = 4500;

  const shimGain = ctx.createGain();
  shimGain.gain.value = 0.07;

  const lfo     = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.04;
  lfoGain.gain.value  = 0.05;
  lfo.connect(lfoGain);
  lfoGain.connect(shimGain.gain);

  shimmer.connect(shimFilter); shimFilter.connect(shimGain); shimGain.connect(dest);

  lfo.start(); base.start(); shimmer.start();
  ambientNodes.push(base, baseFilter, baseGain, shimmer, shimFilter, shimGain, lfo, lfoGain);
}

// ============================================================
// BACKGROUND / VISIBILITY
// ============================================================

function onVisibilityChange() {
  if (document.visibilityState !== 'visible') return;

  if (pendingSpeak.length > 0) {
    setTimeout(() => {
      pendingSpeak.forEach(msg => speak(msg));
      pendingSpeak = [];
    }, 300);
  }

  if (timerState === 'running') {
    const remaining = getRemaining();
    if (remaining <= 0) onSessionEnd();
    else updateTimerDisplay(remaining, totalDuration);
  }
}

// ============================================================
// SESSION PERSISTENCE (localStorage)
// ============================================================

const SESSION_KEY = 'focusRhythm_session';

function saveSession() {
  if (!currentTrack) return;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      screen:           currentScreen,
      track:            currentTrack,
      timerState:       timerState,
      totalDuration:    totalDuration,
      sessionStartTime: sessionStartTime,
      pausedRemaining:  pausedRemaining,
      nudgesFired:      [...nudgesFired],
      savedAt:          Date.now(),
    }));
  } catch (_) {}
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
}

function restoreSession() {
  let state;
  try { state = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (_) { return; }
  if (!state || !state.track || !TRACKS[state.track]) return;
  if (Date.now() - state.savedAt > 3 * 60 * 60 * 1000) { clearSession(); return; }
  if (state.timerState !== 'running' && state.timerState !== 'paused') return;

  extraTimeAdded = 0;
  currentTrack  = state.track;
  totalDuration = state.totalDuration;
  nudgesFired   = new Set(state.nudgesFired || []);

  const track = TRACKS[currentTrack];
  document.getElementById('app').dataset.track = currentTrack;
  document.body.dataset.track = currentTrack;
  document.getElementById('track-emoji-display').textContent  = track.emoji;
  document.getElementById('track-name-display').textContent   = track.name;
  document.getElementById('track-duration-label').textContent = track.durationLabel;

  renderTaskList(currentTrack);

  if (state.timerState === 'running') {
    sessionStartTime = state.sessionStartTime;
    const remaining = getRemaining();

    if (remaining <= 0) {
      timerState = 'finished';
      updateTimerDisplay(0, totalDuration);
      showScreen('refresh');
      setTimeout(() => speak(CONFIG.nudges.endMessage), 400);
      clearSession();
      return;
    }

    timerState = 'running';
    pausedRemaining = remaining;
    scheduleNudges();
    startTick();
    updateTimerDisplay(remaining, totalDuration);
    updateStartPauseButton();

  } else if (state.timerState === 'paused') {
    pausedRemaining = state.pausedRemaining;
    timerState = 'paused';
    updateTimerDisplay(pausedRemaining, totalDuration);
    updateStartPauseButton();
    setAppPausedState(true);
    showPausedUI(true);
  }

  updateAddTimeButtons();
  showScreen('active');
}
