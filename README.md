# Companion Launcher

Shell base extensible con arquitectura de plugins. Primer plugin incluido: **Gamer HUD**
(CPU / RAM / Disco en barras estilo RPG, ventana flotante transparente).

## Arquitectura

```
companion-launcher/
├── src-tauri/          ← el core (Rust)
│   ├── src/
│   │   ├── main.rs         → arranca todo, expone comandos, registra atajo global
│   │   ├── db.rs           → SQLite compartida (kv_store namespaced por plugin)
│   │   ├── plugin_loader.rs → lee /plugins, crea ventanas por plugin
│   │   └── tray.rs         → ícono de bandeja + menú dinámico según manifests
│   ├── Cargo.toml
│   └── tauri.conf.json
└── plugins/
    └── gamer-hud/       ← primer plugin
        ├── manifest.json    → contrato: tamaño, transparencia, always_on_top, etc.
        ├── index.html
        ├── style.css
        └── main.js          → llama a get_system_metrics cada 1.5s
```

## El contrato del plugin

Cualquier carpeta nueva dentro de `/plugins` con un `manifest.json` válido
se detecta sola al reiniciar la app — no hay que tocar el core para agregar plugins:

```json
{
  "id": "nombre-unico",
  "name": "Nombre visible",
  "entry": "index.html",
  "width": 300,
  "height": 190,
  "transparent": true,
  "always_on_top": true,
  "decorations": false,
  "tray_entry": true
}
```

Desde el JS de cualquier plugin tienes disponibles estos comandos:

- `invoke('get_system_metrics')` → CPU/RAM/disco en tiempo real
- `invoke('db_get', { pluginId: 'mi-plugin', key: 'algo' })`
- `invoke('db_set', { pluginId: 'mi-plugin', key: 'algo', value: 'valor' })`
- `invoke('list_plugins')` → lista todos los plugins detectados
- `invoke('open_plugin_window', { pluginId: 'otro-plugin' })`

Esto es lo que te va a ahorrar reescribir el core cada vez que agregues
Mission Control, Achievements, etc.

## Instalación en Nobara-san (Fedora-based)

```bash
# 1. Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# 2. Dependencias de sistema que pide Tauri en Linux
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file \
  libappindicator-gtk3-devel librsvg2-devel

# 3. Node.js (si no lo tienes ya)
sudo dnf install nodejs npm

# 4. Tauri CLI
cargo install tauri-cli --version "^2"
```

## Correrlo

```bash
cd companion-launcher
npm install
cargo tauri dev
```

La app arranca minimizada en la bandeja del sistema. Clic en el ícono del
tray → "Gamer HUD" para abrir el widget. `Alt+Espacio` también lo abre/enfoca.

## Empaquetarlo como ejecutable con ícono y doble clic

```bash
cargo tauri build
```

Esto genera un `.AppImage` y un `.deb` en `src-tauri/target/release/bundle/`,
lo que pediste desde el inicio: un ejecutable de verdad, no una página en localhost.

## Notas

- El ícono en `src-tauri/icons/icon.png` es un placeholder — cámbialo por uno
  tuyo cuando quieras (256x256 recomendado).
- `core.db` se guarda en `~/.local/share/companion/core.db`, fuera del
  proyecto, así que sobrevive a reinstalaciones.
- Próximo paso natural: un segundo plugin (ej. notas rápidas o pomodoro)
  reutilizando exactamente este mismo contrato, sin tocar `src-tauri/`.
