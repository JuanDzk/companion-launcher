const { invoke } = window.__TAURI__.core;

const cpuFill = document.getElementById('cpu-fill');
const cpuValue = document.getElementById('cpu-value');
const ramFill = document.getElementById('ram-fill');
const ramValue = document.getElementById('ram-value');
const diskFill = document.getElementById('disk-fill');
const diskValue = document.getElementById('disk-value');
const tempFill = document.getElementById('temp-fill');
const tempValue = document.getElementById('temp-value');
const footer = document.getElementById('footer-detail');

async function refresh() {
  try {
    const m = await invoke('get_system_metrics');

    cpuFill.style.width = `${m.cpu_percent}%`;
    cpuValue.textContent = `${Math.round(m.cpu_percent)}%`;

    ramFill.style.width = `${m.ram_percent}%`;
    ramValue.textContent = `${Math.round(m.ram_percent)}%`;

    const diskPercent = m.disk_total_gb > 0
      ? (m.disk_used_gb / m.disk_total_gb) * 100
      : 0;
    diskFill.style.width = `${diskPercent}%`;
    diskValue.textContent = `${Math.round(diskPercent)}%`;

    if (m.temp_celsius !== null && m.temp_celsius !== undefined) {
      // Escala visual: 0°C - 100°C mapeado a 0% - 100% de la barra (recorta si se pasa).
      const tempPercent = Math.min(100, Math.max(0, m.temp_celsius));
      tempFill.style.width = `${tempPercent}%`;
      tempValue.textContent = `${Math.round(m.temp_celsius)}°C`;
    } else {
      tempFill.style.width = '0%';
      tempValue.textContent = 'N/A';
    }

    footer.textContent = `${m.ram_used_mb} MB / ${m.ram_total_mb} MB — ${m.disk_used_gb} GB / ${m.disk_total_gb} GB`;
  } catch (err) {
    footer.textContent = 'error leyendo métricas';
    console.error(err);
  }
}

refresh();
setInterval(refresh, 1500);

// Clic con el botón central (rueda) manda el HUD a la siguiente esquina de la pantalla.
// (El clic derecho no sirve aquí porque data-tauri-drag-region intercepta esos eventos
// antes de que le lleguen a este script.)
const corners = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
let cornerIndex = 0;

document.addEventListener('mousedown', async (event) => {
  if (event.button !== 1) return; // 1 = botón central
  event.preventDefault();
  cornerIndex = (cornerIndex + 1) % corners.length;
  try {
    await invoke('snap_to_corner', { corner: corners[cornerIndex] });
  } catch (err) {
    console.error('no se pudo reposicionar la ventana:', err);
  }
});
