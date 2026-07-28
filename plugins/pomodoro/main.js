const { invoke } = window.__TAURI__.core;

const PLUGIN_ID = 'pomodoro';
const STATS_KEY = 'stats';
const SETTINGS_KEY = 'settings';

const RING_CIRCUMFERENCE = 326.7; // 2 * PI * r(52), debe coincidir con style.css

const modeLabel = document.getElementById('mode-label');
const ringProgress = document.getElementById('ring-progress');
const timeDisplay = document.getElementById('time-display');
const workInput = document.getElementById('work-input');
const breakInput = document.getElementById('break-input');
const startPauseBtn = document.getElementById('start-pause-btn');
const resetBtn = document.getElementById('reset-btn');
const statsFooter = document.getElementById('stats-footer');
const closeBtn = document.getElementById('close-btn');

// Duraciones en segundos, configurables por el usuario (por defecto 25/5, clásico).
let durations = { work: 25 * 60, break: 5 * 60 };

let mode = 'work';
let remaining = durations.work;
let running = false;
let intervalId = null;
let completedToday = 0;

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

async function loadSettings() {
  try {
    const raw = await invoke('db_get', { pluginId: PLUGIN_ID, key: SETTINGS_KEY });
    if (raw) {
      const s = JSON.parse(raw);
      durations = { work: s.workMinutes * 60, break: s.breakMinutes * 60 };
    }
  } catch {
    // sin configuración guardada todavía — se quedan los valores por defecto
  }
  workInput.value = durations.work / 60;
  breakInput.value = durations.break / 60;
  remaining = durations[mode];
}

async function saveSettings() {
  await invoke('db_set', {
    pluginId: PLUGIN_ID,
    key: SETTINGS_KEY,
    value: JSON.stringify({
      workMinutes: durations.work / 60,
      breakMinutes: durations.break / 60,
    }),
  });
}

async function loadStats() {
  try {
    const raw = await invoke('db_get', { pluginId: PLUGIN_ID, key: STATS_KEY });
    const stats = raw ? JSON.parse(raw) : null;
    completedToday = stats && stats.date === todayKey() ? stats.completed : 0;
  } catch {
    completedToday = 0;
  }
}

async function saveStats() {
  await invoke('db_set', {
    pluginId: PLUGIN_ID,
    key: STATS_KEY,
    value: JSON.stringify({ date: todayKey(), completed: completedToday }),
  });
}

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function renderTime() {
  timeDisplay.textContent = formatTime(remaining);
  const fraction = remaining / durations[mode];
  ringProgress.style.strokeDashoffset = `${RING_CIRCUMFERENCE * (1 - fraction)}`;
}

function renderMode() {
  const isBreak = mode === 'break';
  modeLabel.textContent = isBreak ? 'DESCANSO' : 'ENFOQUE';
  modeLabel.classList.toggle('break', isBreak);
  ringProgress.classList.toggle('break', isBreak);
}

function renderStats() {
  statsFooter.textContent = `${completedToday} pomodoro${completedToday === 1 ? '' : 's'} hoy`;
}

function renderAll() {
  renderTime();
  renderMode();
  renderStats();
}

function tick() {
  remaining -= 1;
  if (remaining <= 0) {
    onCycleComplete();
    return;
  }
  renderTime();
}

async function onCycleComplete() {
  if (mode === 'work') {
    completedToday += 1;
    await saveStats();
    mode = 'break';
  } else {
    mode = 'work';
  }
  remaining = durations[mode];
  renderAll();
  // Se detiene al terminar cada bloque en vez de encadenar solo — así decides cuándo seguir.
  pause();
}

function start() {
  if (running) return;
  running = true;
  startPauseBtn.textContent = 'Pausar';
  workInput.disabled = true;
  breakInput.disabled = true;
  document.querySelectorAll('.step-btn').forEach((b) => (b.disabled = true));
  intervalId = setInterval(tick, 1000);
}

function pause() {
  running = false;
  startPauseBtn.textContent = 'Iniciar';
  workInput.disabled = false;
  breakInput.disabled = false;
  document.querySelectorAll('.step-btn').forEach((b) => (b.disabled = false));
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
}

function reset() {
  pause();
  remaining = durations[mode];
  renderTime();
}

function onDurationInputChange() {
  const workMinutes = Math.max(1, Math.min(600, Number(workInput.value) || 25));
  const breakMinutes = Math.max(1, Math.min(120, Number(breakInput.value) || 5));
  durations = { work: workMinutes * 60, break: breakMinutes * 60 };
  workInput.value = workMinutes;
  breakInput.value = breakMinutes;

  // Solo reflejamos el cambio en el cronómetro si no está corriendo ahora mismo.
  if (!running) {
    remaining = durations[mode];
    renderTime();
  }

  saveSettings();
}

workInput.addEventListener('change', onDurationInputChange);
breakInput.addEventListener('change', onDurationInputChange);

document.querySelectorAll('.step-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = document.getElementById(btn.dataset.target);
    const delta = btn.classList.contains('step-up') ? 1 : -1;
    target.value = Number(target.value) + delta;
    target.dispatchEvent(new Event('change'));
  });
});

startPauseBtn.addEventListener('click', () => (running ? pause() : start()));
resetBtn.addEventListener('click', reset);

closeBtn.addEventListener('click', async (event) => {
  event.stopPropagation();
  try {
    await invoke('hide_window');
  } catch (err) {
    console.error('no se pudo ocultar la ventana:', err);
  }
});

(async () => {
  await loadSettings();
  await loadStats();
  renderAll();
})();
