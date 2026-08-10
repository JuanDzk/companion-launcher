const { invoke } = window.__TAURI__.core;

const PLUGIN_ID = 'notas-rapidas';
const STORAGE_KEY = 'notes';
const SYNC_CONFIG_ID = 'sync-config'; // compartido entre Notas y Pomodoro
const LAST_SYNC_KEY = 'last_synced_at';

const notesListEl = document.getElementById('notes-list');
const emptyStateEl = document.getElementById('empty-state');
const searchInput = document.getElementById('search-input');
const newNoteForm = document.getElementById('new-note-form');
const newNoteText = document.getElementById('new-note-text');
const closeBtn = document.getElementById('close-btn');
const syncSetup = document.getElementById('sync-setup');
const sbUrlInput = document.getElementById('sb-url');
const sbKeyInput = document.getElementById('sb-key');
const syncSaveBtn = document.getElementById('sync-save');
const syncSetupStatus = document.getElementById('sync-setup-status');
const syncBtn = document.getElementById('sync-btn');
const syncConfigBtn = document.getElementById('sync-config-btn');
const syncStatus = document.getElementById('sync-status');

let notes = [];
let sbUrl = null;
let sbKey = null;

// Acepta tanto la URL base (https://xxx.supabase.co) como la URL completa del
// endpoint REST pegada por accidente (https://xxx.supabase.co/rest/v1/) y
// siempre devuelve solo la base, para que el resto del código no duplique la ruta.
function normalizeSupabaseUrl(raw) {
  return raw
    .trim()
    .replace(/\/rest\/v1\/?$/i, '')
    .replace(/\/$/, '');
}

async function loadNotes() {
  try {
    const result = await invoke('db_get', { pluginId: PLUGIN_ID, key: STORAGE_KEY });
    notes = result ? JSON.parse(result) : [];
  } catch (err) {
    notes = []; // primera vez que se abre el plugin — no es un error real
  }
  render();
}

async function saveNotes() {
  await invoke('db_set', {
    pluginId: PLUGIN_ID,
    key: STORAGE_KEY,
    value: JSON.stringify(notes),
  });
}

function render(filterText = '') {
  const query = filterText.trim().toLowerCase();
  const visible = query
    ? notes.filter((n) => n.text.toLowerCase().includes(query))
    : notes;

  notesListEl.querySelectorAll('.note-card').forEach((el) => el.remove());

  if (visible.length === 0) {
    emptyStateEl.textContent = notes.length === 0
      ? 'Sin notas todavía. Escribe la primera arriba.'
      : 'Nada coincide con tu búsqueda.';
    emptyStateEl.style.display = 'block';
    return;
  }

  emptyStateEl.style.display = 'none';

  [...visible].reverse().forEach((note) => {
    const card = document.createElement('div');
    card.className = 'note-card';

    const text = document.createElement('div');
    text.className = 'note-text';
    text.textContent = note.text;

    const del = document.createElement('button');
    del.className = 'note-delete';
    del.textContent = '✕';
    del.title = 'Borrar nota';
    del.addEventListener('click', () => deleteNote(note.id));

    card.appendChild(text);
    card.appendChild(del);
    notesListEl.appendChild(card);
  });
}

async function addNote(text) {
  const trimmed = text.trim();
  if (!trimmed) return;

  const note = {
    id: crypto.randomUUID(),
    text: trimmed,
    createdAt: Date.now(),
  };

  notes.push(note);
  await saveNotes();
  render(searchInput.value);

  // Empuja a Supabase en cuanto se crea, sin esperar a la próxima sincronización.
  // Si falla (sin internet, sin configurar todavía), la nota igual queda guardada
  // localmente — el push es un "además", nunca un requisito para guardar.
  pushNoteToSupabase(note).catch((err) => console.error('no se pudo sincronizar la nota nueva:', err));
}

async function deleteNote(id) {
  notes = notes.filter((n) => n.id !== id);
  await saveNotes();
  render(searchInput.value);
}

// --- Sincronización ---

async function loadSyncConfig() {
  sbUrl = await invoke('db_get', { pluginId: SYNC_CONFIG_ID, key: 'supabase_url' }).catch(() => null);
  sbKey = await invoke('db_get', { pluginId: SYNC_CONFIG_ID, key: 'supabase_anon_key' }).catch(() => null);

  if (!sbUrl || !sbKey) {
    syncSetup.style.display = 'flex';
    return false;
  }
  return true;
}

syncSaveBtn.addEventListener('click', async () => {
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
    syncSetup.style.display = 'none';
    await pullChanges();
  } catch (err) {
    syncSetupStatus.textContent = 'No se pudo guardar: ' + err;
    syncSetupStatus.style.color = '#e87a7a';
  }
});

async function pushNoteToSupabase(note) {
  if (!sbUrl || !sbKey) return; // sin configurar todavía, no hay a dónde empujar

  await fetch(`${sbUrl}/rest/v1/synced_notes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: sbKey,
      Authorization: `Bearer ${sbKey}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      id: note.id,
      content: note.text,
      created_at: new Date(note.createdAt).toISOString(),
    }),
  });
}

// Trae solo lo que llegó después de la última vez que se revisó — nunca borra
// nada local, solo agrega lo que falte (según lo que decidiste: fusión aditiva).
async function pullChanges() {
  if (!sbUrl || !sbKey) return;

  syncStatus.textContent = 'Buscando cambios...';

  const lastSync = (await invoke('db_get', { pluginId: PLUGIN_ID, key: LAST_SYNC_KEY }).catch(() => null))
    || '1970-01-01T00:00:00Z';

  try {
    const resp = await fetch(
      `${sbUrl}/rest/v1/synced_notes?created_at=gt.${encodeURIComponent(lastSync)}&order=created_at.asc`,
      { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } },
    );

    if (!resp.ok) throw new Error(`Supabase respondió ${resp.status}`);

    const remoteNotes = await resp.json();
    const existingIds = new Set(notes.map((n) => n.id));
    let added = 0;

    for (const row of remoteNotes) {
      if (existingIds.has(row.id)) continue; // ya la tenemos (ej. la que acabamos de subir nosotros mismos)
      notes.push({ id: row.id, text: row.content, createdAt: new Date(row.created_at).getTime() });
      added++;
    }

    if (added > 0) {
      await saveNotes();
      render(searchInput.value);
    }

    await invoke('db_set', { pluginId: PLUGIN_ID, key: LAST_SYNC_KEY, value: new Date().toISOString() });

    syncStatus.textContent = added > 0 ? `${added} nota(s) nueva(s) de la otra máquina.` : 'Todo al día.';
    syncStatus.style.color = added > 0 ? '#6fd88a' : '#9a9aa0';
  } catch (err) {
    console.error('pullChanges falló:', err);
    syncStatus.textContent = 'No se pudo sincronizar: ' + err.message;
    syncStatus.style.color = '#e87a7a';
  }
}

syncBtn.addEventListener('click', () => pullChanges());

syncConfigBtn.addEventListener('click', () => {
  sbUrlInput.value = sbUrl || '';
  sbKeyInput.value = sbKey || '';
  syncSetupStatus.textContent = '';
  syncSetup.style.display = 'flex';
});

newNoteForm.addEventListener('submit', (e) => e.preventDefault());

newNoteText.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    await addNote(newNoteText.value);
    newNoteText.value = '';
  }
});

searchInput.addEventListener('input', () => render(searchInput.value));

closeBtn.addEventListener('click', async () => {
  try {
    await invoke('hide_window');
  } catch (err) {
    console.error('no se pudo ocultar la ventana:', err);
  }
});

async function init() {
  await loadNotes();
  const configured = await loadSyncConfig();
  if (configured) await pullChanges(); // revisa cambios de la otra máquina al abrir
}

init();
