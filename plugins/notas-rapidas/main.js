const { invoke } = window.__TAURI__.core;

const PLUGIN_ID = 'notas-rapidas';
const STORAGE_KEY = 'notes';

const notesListEl = document.getElementById('notes-list');
const emptyStateEl = document.getElementById('empty-state');
const searchInput = document.getElementById('search-input');
const newNoteForm = document.getElementById('new-note-form');
const newNoteText = document.getElementById('new-note-text');
const closeBtn = document.getElementById('close-btn');

let notes = [];

async function loadNotes() {
  try {
    const result = await invoke('db_get', { pluginId: PLUGIN_ID, key: STORAGE_KEY });
    notes = result ? JSON.parse(result) : [];
  } catch (err) {
    // Sin valor guardado todavía (primera vez que se abre el plugin) — no es un error real.
    notes = [];
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

  // Más recientes primero.
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

  notes.push({
    id: crypto.randomUUID(),
    text: trimmed,
    createdAt: Date.now(),
  });

  await saveNotes();
  render(searchInput.value);
}

async function deleteNote(id) {
  notes = notes.filter((n) => n.id !== id);
  await saveNotes();
  render(searchInput.value);
}

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

loadNotes();
