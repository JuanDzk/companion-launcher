# 🛰️ Companion Launcher

Shell de escritorio extensible, con arquitectura de plugins, construido en **Rust + Tauri**.
Vive en la bandeja del sistema, no ocupa espacio en la barra de tareas, y cada funcionalidad
nueva se agrega como un plugin independiente sin tocar el núcleo de la aplicación.

## ✨ Motivación

La mayoría de mis proyectos anteriores fueron páginas web corriendo en `localhost`. Este
proyecto nace de querer dar el salto a **aplicaciones nativas de escritorio de verdad**:
ejecutable propio, ícono en el sistema, ejecución en segundo plano — sin sacrificar que siga
siendo mantenible y fácil de extender con el tiempo.

En vez de construir varias mini-apps sueltas (una por cada idea), se diseñó un **core
reutilizable** que resuelve una sola vez los problemas comunes (ícono de bandeja, atajo
global, base de datos compartida, ciclo de vida de ventanas) para que cada nueva
funcionalidad futura sea solo un plugin más.

## 🧱 Arquitectura

```
companion-launcher/
├── src-tauri/              ← el core (Rust)
│   ├── src/
│   │   ├── main.rs             → arranca la app, expone comandos, registra atajo global
│   │   ├── db.rs                → SQLite compartida (kv_store con namespace por plugin)
│   │   ├── plugin_loader.rs    → descubre plugins, crea/posiciona sus ventanas
│   │   ├── tray.rs             → ícono de bandeja + menú dinámico según plugins detectados
│   │   └── backup.rs           → lógica del plugin Backup Inteligente (ver más abajo)
│   ├── Cargo.toml
│   └── tauri.conf.json
└── plugins/
    ├── gamer-hud/
    ├── notas-rapidas/
    ├── pomodoro/
    └── backup-inteligente/
```

### El contrato del plugin

Cualquier carpeta nueva dentro de `/plugins` con un `manifest.json` válido se detecta sola
al reiniciar la app — el core nunca necesita conocer de antemano qué plugins existen:

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

Desde el JS de cualquier plugin hay comandos disponibles sin escribir Rust adicional:

| Comando | Uso |
|---|---|
| `get_system_metrics` | CPU / RAM / disco / temperatura en tiempo real |
| `db_get({ pluginId, key })` | leer un valor persistido en SQLite |
| `db_set({ pluginId, key, value })` | guardar un valor persistido en SQLite |
| `list_plugins` | lista todos los plugins detectados |
| `open_plugin_window({ pluginId })` | abre (o enfoca) la ventana de otro plugin |
| `snap_to_corner({ corner })` | reposiciona la ventana a una esquina del monitor |
| `hide_window` | oculta la ventana actual (no la destruye — sigue viva en el tray) |

### Convención: todo plugin con ventana debe poder ocultarse solo

Como las ventanas no tienen barra de título nativa (`decorations: false`), cada plugin es
responsable de traer su propio control de cierre — un botón `×` que llame a `hide_window`.
No uses `window.__TAURI__.window.getCurrentWindow().hide()` directamente: el sistema de
permisos (capabilities) de Tauri 2 bloquea las llamadas nativas de ventana desde el frontend
sin configuración adicional. `hide_window` evita ese problema porque es un comando propio,
registrado en nuestro `invoke_handler`, y por lo tanto no necesita permisos extra.

### Mover cualquier ventana del launcher

Ninguna ventana de plugin tiene barra de título ni aparece en la barra de tareas, así que se
reposicionan sosteniendo **Win (Meta) + clic izquierdo** en cualquier punto de la ventana y
arrastrando — es un atajo nativo de KDE Plasma que mueve ventanas sin decoración.

## 🛠️ Stack

- **Rust** + **Tauri 2** — shell nativo, liviano comparado con soluciones basadas en Electron
- **sysinfo** — lectura de métricas de sistema (CPU, RAM, disco, sensores de temperatura)
- **rusqlite (SQLite embebida)** — persistencia local compartida entre plugins
- **keyring** — credenciales sensibles guardadas en el almacén del sistema (KWallet/Secret
  Service), nunca en la SQLite de la app
- **reqwest + zip** — compresión de proyectos y subida a la API de GitHub (Backup Inteligente)
- **HTML / CSS / JS vanilla** — interfaz de cada plugin, sin build step ni framework

## 🚀 Instalación y ejecución

### Requisitos (una sola vez por máquina)

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# Dependencias de sistema (Fedora/Nobara)
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file \
  libappindicator-gtk3-devel librsvg2-devel

# Node.js y Tauri CLI
sudo dnf install nodejs npm
cargo install tauri-cli --version "^2"
```

### Correr en modo desarrollo

```bash
npm install
cargo tauri dev
```

### Compilar a ejecutable con ícono y doble clic

```bash
cargo tauri build
```

Genera un `.AppImage` y un `.deb` en `src-tauri/target/release/bundle/`.

## 🧩 Retos técnicos y cómo se resolvieron

Documentar esto porque el camino real casi nunca es lineal, y creo que vale más mostrarlo
que esconderlo:

- **Cambios de API entre versiones de crates.** `sysinfo` cambió el nombre de su método de
  CPU global entre versiones, la API de menús de Tauri 2 no es encadenable, y `zip` 0.6.x
  tiene una firma distinta a la de versiones más recientes del mismo crate (`FileOptions` no
  es genérico en 0.6.x). Los tres se detectaron directamente por los errores del compilador.

- **"Siempre encima" no es solo una bandera de la app.** Bajo Wayland, el compositor no
  confía en que una aplicación decida por sí misma quedarse por encima de las demás. La
  solución confiable fue una **regla de ventana de KWin**, no código.

- **`keyring` necesita un backend explícito en Linux.** La versión 3 del crate no asume con
  qué gestor de credenciales hablar — hay que activar el feature `sync-secret-service` para
  que hable con KWallet/Secret Service. Sin eso, falla en tiempo de ejecución sin avisar en
  la terminal, algo que costó detectar porque el error solo vivía del lado de JavaScript.

- **GitHub no puede crear un Release en un repo sin commits.** El repo de backups
  (`zudok-backups`) se creó completamente vacío, sin ni siquiera un `README`. Un Release
  necesita un tag apuntando a algún commit — sin historial, no hay dónde anclarlo. Se
  resolvió con un primer commit cualquiera para darle "piso" al repo.

## 🧩 Plugins disponibles

| Plugin | Qué hace |
|---|---|
| **Gamer HUD** | Overlay flotante y transparente con CPU, RAM, disco y temperatura en tiempo real, estilo barras de videojuego. |
| **Notas Rápidas** | Notas de texto persistentes con búsqueda en vivo — guardadas en la SQLite del core, sobreviven a cerrar y reabrir la app. |
| **Pomodoro** | Temporizador de enfoque con anillo de progreso, ciclos de descanso corto/largo automáticos, y contador de pomodoros completados por día. |
| **Backup Inteligente** | Detecta automáticamente tus proyectos con Git, muestra si cada uno tiene cambios sin subir a GitHub (semáforo verde/amarillo/rojo), y sube un `.zip` de los que elijas como Release a un repo privado dedicado — con limpieza automática de backups viejos. Sin timers, sin servidor propio: solo corre cuando abres la ventana. |

## 🗺️ Roadmap

- [x] Core: tray icon, atajo global, SQLite compartida, plugin loader
- [x] Plugin: Gamer HUD (CPU / RAM / Disco / Temperatura)
- [x] Plugin: notas rápidas persistentes
- [x] Plugin: pomodoro / temporizador de enfoque
- [x] Plugin: Backup Inteligente (respaldo a GitHub Releases)
- [ ] Capa de conexión (Supabase Realtime) para estado compartido entre dos instancias
- [ ] Mission Control: panel de visibilidad sobre repos, PRs e issues vía la API de GitHub

## 📄 Licencia

MIT — libre de usar, modificar y aprender de él.
