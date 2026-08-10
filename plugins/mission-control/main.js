const { invoke } = window.__TAURI__.core;

const PLUGIN_ID = 'mission-control';
const BACKUP_PLUGIN_ID = 'backup-inteligente'; // de aquí reutilizamos watch_root

const setupForm = document.getElementById('setup-form');
const mainView = document.getElementById('main-view');
const tokenInput = document.getElementById('gh-token');
const setupSaveBtn = document.getElementById('setup-save');
const setupStatus = document.getElementById('setup-status');
const reposListEl = document.getElementById('repos-list');
const statusMsg = document.getElementById('status-msg');
const refreshBtn = document.getElementById('refresh-btn');
const configBtn = document.getElementById('config-btn');
const closeBtn = document.getElementById('close-btn');

async function init() {
  const hasCreds = await invoke('mission_control_has_credentials');
  if (!hasCreds) {
    setupForm.style.display = 'flex';
    return;
  }
  mainView.style.display = 'flex';
  await loadAndFetch();
}

setupSaveBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (!token) {
    setupStatus.textContent = 'Pega el token primero.';
    return;
  }
  try {
    await invoke('mission_control_save_credentials', { token });
    setupForm.style.display = 'none';
    mainView.style.display = 'flex';
    await loadAndFetch();
  } catch (err) {
    console.error('mission_control_save_credentials falló:', err);
    setupStatus.textContent = 'No se pudo guardar: ' + err;
  }
});

configBtn.addEventListener('click', () => {
  tokenInput.value = '';
  setupStatus.textContent = '';
  setupForm.style.display = 'flex';
  mainView.style.display = 'none';
});

async function loadAndFetch() {
  reposListEl.innerHTML = '<p class="status-msg">Buscando repos...</p>';

  const watchRoot = await invoke('db_get', { pluginId: BACKUP_PLUGIN_ID, key: 'watch_root' }).catch(() => null);
  if (!watchRoot) {
    reposListEl.innerHTML = '<p class="status-msg">Configura primero la carpeta en Backup Inteligente — Mission Control la reutiliza.</p>';
    return;
  }

  let repos;
  try {
    repos = await invoke('mission_control_list_repos', { watchRoot });
  } catch (err) {
    reposListEl.innerHTML = `<p class="status-msg">Error: ${err}</p>`;
    return;
  }

  if (repos.length === 0) {
    reposListEl.innerHTML = '<p class="status-msg">Ningún proyecto ahí apunta a un repo de GitHub.</p>';
    return;
  }

  statusMsg.textContent = 'Consultando GitHub...';
  try {
    const summaries = await invoke('mission_control_fetch_all', { repos });
    render(summaries);
    statusMsg.textContent = `Actualizado — ${summaries.length} repo(s).`;
  } catch (err) {
    console.error('mission_control_fetch_all falló:', err);
    reposListEl.innerHTML = `<p class="status-msg">Error: ${err}</p>`;
  }
}

function render(summaries) {
  reposListEl.innerHTML = '';

  summaries.forEach((repo) => {
    const card = document.createElement('div');
    card.className = 'repo-card';

    if (repo.error) {
      card.innerHTML = `
        <div class="repo-header">
          <span class="repo-name">${repo.name}</span>
          <span class="badge err">error</span>
        </div>
        <p class="status-msg">${repo.error}</p>
      `;
      reposListEl.appendChild(card);
      return;
    }

    const prCount = repo.prs.length;
    const issueCount = repo.issues.length;
    const clear = prCount === 0 && issueCount === 0;

    const badges = clear
      ? '<span class="badge clear">al día</span>'
      : [
          prCount > 0 ? `<span class="badge pr">${prCount} PR${prCount === 1 ? '' : 's'}</span>` : '',
          issueCount > 0 ? `<span class="badge issue">${issueCount} issue${issueCount === 1 ? '' : 's'}</span>` : '',
        ].join('');

    const header = document.createElement('div');
    header.className = 'repo-header';
    header.innerHTML = `<span class="repo-name">${repo.name}</span>${badges}`;
    card.appendChild(header);

    if (!clear) {
      const itemList = document.createElement('div');
      itemList.className = 'item-list';
      [...repo.prs, ...repo.issues].forEach((item) => {
        const link = document.createElement('a');
        link.className = 'item-link';
        link.href = '#';
        link.textContent = `#${item.number} ${item.title}`;
        link.title = item.title;
        link.addEventListener('click', (e) => {
          e.preventDefault();
          invoke('open_in_browser', { url: item.url }).catch((err) => console.error('no se pudo abrir el navegador:', err));
        });
        itemList.appendChild(link);
      });
      card.appendChild(itemList);
    }

    reposListEl.appendChild(card);
  });
}

refreshBtn.addEventListener('click', () => loadAndFetch());

closeBtn.addEventListener('click', async () => {
  try {
    await invoke('hide_window');
  } catch (err) {
    console.error('no se pudo ocultar la ventana:', err);
  }
});

init();
