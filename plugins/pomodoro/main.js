const { invoke } = window.__TAURI__.core;

const PLUGIN_ID = 'pomodoro';
const STATS_KEY = 'stats';
const SETTINGS_KEY = 'settings';
const SYNC_CONFIG_ID = 'sync-config'; // compartido con Notas Rápidas
const LAST_SYNC_KEY = 'last_synced_at';

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
const syncConfigBtn = document.getElementById('sync-config-btn');
const syncSetup = document.getElementById('sync-setup');
const mainContent = document.getElementById('main-content');
const sbUrlInput = document.getElementById('sb-url');
const sbKeyInput = document.getElementById('sb-key');
const syncSaveBtn = document.getElementById('sync-save');
const syncSkipBtn = document.getElementById('sync-skip');
const syncSetupStatus = document.getElementById('sync-setup-status');

// Duraciones en segundos, configurables por el usuario (por defecto 25/5, clásico).
let durations = { work: 25 * 60, break: 5 * 60 };

let mode = 'work';
let remaining = durations.work;
let running = false;
let intervalId = null;
let completedToday = 0;
let sbUrl = null;
let sbKey = null;

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// Misma normalización que en Notas Rápidas: acepta la URL completa del
// endpoint REST pegada por accidente y siempre devuelve solo la base.
function normalizeSupabaseUrl(raw) {
  return raw.trim().replace(/\/rest\/v1\/?$/i, '').replace(/\/$/, '');
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
    pushState().catch((err) => console.error('no se pudo sincronizar el pomodoro completado:', err));
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
  pushState().catch((err) => console.error('no se pudo sincronizar la configuración:', err));
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

// --- Sincronización ---
// A diferencia de Notas Rápidas, esto no es aditivo: los minutos son una
// preferencia (gana el cambio más reciente) y el conteo diario se fusiona
// por el máximo entre ambas máquinas, para nunca perder un pomodoro ganado.

async function loadSyncConfig() {
  sbUrl = await invoke('db_get', { pluginId: SYNC_CONFIG_ID, key: 'supabase_url' }).catch(() => null);
  sbKey = await invoke('db_get', { pluginId: SYNC_CONFIG_ID, key: 'supabase_anon_key' }).catch(() => null);
  return Boolean(sbUrl && sbKey);
}

function showSyncSetup() {
  sbUrlInput.value = sbUrl || '';
  sbKeyInput.value = sbKey || '';
  syncSetupStatus.textContent = '';
  mainContent.style.display = 'none';
  syncSetup.style.display = 'flex';
}

function hideSyncSetup() {
  syncSetup.style.display = 'none';
  mainContent.style.display = 'flex';
}

syncConfigBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  showSyncSetup();
});

syncSkipBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  hideSyncSetup();
});

syncSaveBtn.addEventListener('click', async (event) => {
  event.stopPropagation();
  const url = normalizeSupabaseUrl(sbUrlInput.value);
  const key = sbKeyInput.value.trim();

  if (!url || !key) {
    syncSetupStatus.textContent = 'Completa ambos campos.';
    return;
  }

  try {
    await invoke('db_set', { pluginId: SYNC_CONFIG_ID, key: 'supabase_url', value: url });
    await invoke('db_set', { pluginId: SYNC_CONFIG_ID, key: 'supabase_anon_key', value: key });
    sbUrl = url;
    sbKey = key;
    hideSyncSetup();
    await pullState();
  } catch (err) {
    syncSetupStatus.textContent = 'No se pudo guardar: ' + err;
  }
});

async function pushState() {
  if (!sbUrl || !sbKey) return; // sin configurar todavía

  await fetch(`${sbUrl}/rest/v1/synced_pomodoro?on_conflict=id`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: sbKey,
      Authorization: `Bearer ${sbKey}`,
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      id: 'shared',
      focus_minutes: durations.work / 60,
      break_minutes: durations.break / 60,
      completed_today: completedToday,
      count_date: todayKey(),
      updated_at: new Date().toISOString(),
    }),
  });
}

// Trae el estado compartido: los minutos aplican por "el más reciente gana",
// el conteo diario se fusiona por el máximo (solo si es del mismo día).
async function pullState() {
  if (!sbUrl || !sbKey) return;

  try {
    const resp = await fetch(`${sbUrl}/rest/v1/synced_pomodoro?id=eq.shared&select=*`, {
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
    });
    if (!resp.ok) throw new Error(`Supabase respondió ${resp.status}`);

    const rows = await resp.json();
    if (rows.length === 0) return; // nadie ha sincronizado todavía, no hay nada que traer

    const remote = rows[0];
    const lastSync = (await invoke('db_get', { pluginId: PLUGIN_ID, key: LAST_SYNC_KEY }).catch(() => null))
      || '1970-01-01T00:00:00Z';

    if (remote.updated_at > lastSync) {
      durations = { work: remote.focus_minutes * 60, break: remote.break_minutes * 60 };
      workInput.value = remote.focus_minutes;
      breakInput.value = remote.break_minutes;
      if (!running) remaining = durations[mode];
      await saveSettings();
    }

    if (remote.count_date === todayKey() && remote.completed_today > completedToday) {
      completedToday = remote.completed_today;
      await saveStats();
    }

    await invoke('db_set', { pluginId: PLUGIN_ID, key: LAST_SYNC_KEY, value: new Date().toISOString() });
    renderAll();
  } catch (err) {
    console.error('pullState falló:', err);
  }
}

(async () => {
  await loadSettings();
  await loadStats();
  renderAll();

  const configured = await loadSyncConfig();
  if (configured) {
    await pullState();
  }
  // Si no está configurado, no forzamos el formulario al abrir — Pomodoro es
  // una ventana pequeña; siempre puedes configurarlo después con el botón 🔗.
})();
