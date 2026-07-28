const { invoke } = window.__TAURI__.core;

const PLUGIN_ID = 'backup-inteligente';

const setupForm = document.getElementById('setup-form');
const mainView = document.getElementById('main-view');
const watchRootInput = document.getElementById('watch-root');
const ghRepoInput = document.getElementById('gh-repo');
const ghTokenInput = document.getElementById('gh-token');
const setupSaveBtn = document.getElementById('setup-save');
const setupStatus = document.getElementById('setup-status');
const projectsListEl = document.getElementById('projects-list');
const backupBtn = document.getElementById('backup-btn');
const statusMsg = document.getElementById('status-msg');
const closeBtn = document.getElementById('close-btn');

let watchRoot = '';
let githubRepo = '';
let projects = [];

// Acepta tanto "usuario/repo" como una URL completa de GitHub pegada por accidente
// (ej: https://github.com/usuario/repo.git) y siempre devuelve "usuario/repo".
function normalizeRepoInput(raw) {
  return raw
  .replace(/^https?:\/\/github\.com\//i, '')
  .replace(/\.git$/i, '')
  .replace(/\/$/, '')
  .trim();
}

async function init() {
  const hasCreds = await invoke('backup_has_credentials');
  const savedRoot = await invoke('db_get', { pluginId: PLUGIN_ID, key: 'watch_root' }).catch(() => null);
  const savedRepo = await invoke('db_get', { pluginId: PLUGIN_ID, key: 'github_repo' }).catch(() => null);

  if (!hasCreds || !savedRoot || !savedRepo) {
    setupForm.style.display = 'flex';
    return;
  }

  watchRoot = savedRoot;
  githubRepo = savedRepo;
  mainView.style.display = 'flex';
  await loadProjects();
}

setupSaveBtn.addEventListener('click', async () => {
  const root = watchRootInput.value.trim();
  const repo = normalizeRepoInput(ghRepoInput.value.trim());
  const token = ghTokenInput.value.trim();

  if (!root || !repo || !token) {
    setupStatus.textContent = 'Completa todos los campos.';
    return;
  }

  try {
    await invoke('backup_save_credentials', { token });
    await invoke('db_set', { pluginId: PLUGIN_ID, key: 'watch_root', value: root });
    await invoke('db_set', { pluginId: PLUGIN_ID, key: 'github_repo', value: repo });

    watchRoot = root;
    githubRepo = repo;
    setupForm.style.display = 'none';
    mainView.style.display = 'flex';
    await loadProjects();
  } catch (err) {
    console.error('backup_save_credentials falló:', err);
    setupStatus.textContent = 'No se pudo guardar: ' + err;
    setupStatus.style.color = '#e87a7a';
  }
});

async function loadProjects() {
  projectsListEl.innerHTML = '<p style="font-size:12px;color:#9a9aa0;">Buscando proyectos...</p>';

  try {
    projects = await invoke('backup_list_projects', { watchRoot });
  } catch (err) {
    projectsListEl.innerHTML = `<p style="font-size:12px;color:#e87a7a;">Error: ${err}</p>`;
    return;
  }

  const savedSelection = await invoke('db_get', { pluginId: PLUGIN_ID, key: 'selected_projects' })
  .then((v) => (v ? JSON.parse(v) : null))
  .catch(() => null);

  renderProjects(savedSelection);
}

function renderProjects(savedSelection) {
  projectsListEl.innerHTML = '';

  if (projects.length === 0) {
    projectsListEl.innerHTML = '<p style="font-size:12px;color:#9a9aa0;">No se encontraron proyectos con .git en esa carpeta.</p>';
    return;
  }

  projects.forEach((p) => {
    const row = document.createElement('label');
    row.className = 'project-row';

    const checked = savedSelection ? savedSelection.includes(p.path) : true;

    const badge = badgeFor(p.status);
    const daysLabel = p.days_since_commit === null || p.days_since_commit === undefined
    ? 'sin commits'
    : p.days_since_commit === 0 ? 'hoy' : `hace ${p.days_since_commit}d`;

    row.innerHTML = `
    <input type="checkbox" ${checked ? 'checked' : ''} data-path="${p.path}" />
    <span class="name">${p.name}</span>
    <span class="days-hint">${daysLabel}</span>
    <span class="badge ${badge.cls}">${badge.label}</span>
    `;
    projectsListEl.appendChild(row);
  });

  projectsListEl.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.addEventListener('change', saveSelection);
  });
}

function badgeFor(status) {
  if (status === 'en-github') return { cls: 'ok', label: 'en GitHub' };
  if (status === 'cambios-sin-subir') return { cls: 'warn', label: 'cambios sin subir' };
  return { cls: 'late', label: 'sin repositorio' };
}

async function saveSelection() {
  const selected = [...projectsListEl.querySelectorAll('input[type=checkbox]:checked')]
  .map((cb) => cb.dataset.path);
  await invoke('db_set', { pluginId: PLUGIN_ID, key: 'selected_projects', value: JSON.stringify(selected) });
}

backupBtn.addEventListener('click', async () => {
  const selected = [...projectsListEl.querySelectorAll('input[type=checkbox]:checked')]
  .map((cb) => cb.dataset.path);

  if (selected.length === 0) {
    statusMsg.textContent = 'Selecciona al menos un proyecto.';
    return;
  }

  backupBtn.disabled = true;
  backupBtn.textContent = 'Subiendo...';
  statusMsg.textContent = '';

  try {
    const results = await invoke('backup_run', { repo: githubRepo, projectPaths: selected });
    console.log('resultados del backup:', results);

    const ok = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success);

    if (failed.length === 0) {
      statusMsg.textContent = `${ok} proyecto(s) subidos a GitHub.`;
      statusMsg.style.color = '#6fd88a';
    } else {
      const firstReason = failed[0].error || 'motivo desconocido';
      statusMsg.textContent = `${ok} subidos, ${failed.length} fallaron. Motivo: ${firstReason}`;
      statusMsg.style.color = '#e87a7a';
    }
  } catch (err) {
    statusMsg.textContent = 'Error: ' + err;
    statusMsg.style.color = '#e87a7a';
  } finally {
    backupBtn.disabled = false;
    backupBtn.textContent = 'Respaldar ahora';
  }
});

closeBtn.addEventListener('click', async () => {
  try {
    await invoke('hide_window');
  } catch (err) {
    console.error('no se pudo ocultar la ventana:', err);
  }
});

init();
