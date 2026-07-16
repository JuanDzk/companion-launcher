# 🛰️ Companion Launcher

Shell de escritorio extensible, con arquitectura de plugins, construido en **Rust + Tauri**.
Vive en la bandeja del sistema, no ocupa espacio en la barra de tareas, y cada funcionalidad
nueva se agrega como un plugin independiente sin tocar el núcleo de la aplicación.

Primer plugin incluido: **Gamer HUD** — un widget flotante y semitransparente, estilo overlay
de videojuego, que muestra CPU, RAM, disco y temperatura en tiempo real.

## ✨ Motivación

La mayoría de mis proyectos anteriores fueron páginas web corriendo en `localhost`. Este
proyecto nace de querer dar el salto a **aplicaciones nativas de escritorio de verdad**:
ejecutable propio, ícono en el sistema, ejecución en segundo plano — sin sacrificar que siga
siendo mantenible y fácil de extender con el tiempo.

En vez de construir 6 mini-apps sueltas (una por cada idea), se diseñó un **core reutilizable**
que resuelve una sola vez los problemas comunes (ícono de bandeja, atajo global, base de datos
compartida, ciclo de vida de ventanas) para que cada nueva funcionalidad futura sea solo un
plugin más.

## 🧱 Arquitectura

```
companion-launcher/
├── src-tauri/              ← el core (Rust)
│   ├── src/
│   │   ├── main.rs             → arranca la app, expone comandos, registra atajo global
│   │   ├── db.rs                → SQLite compartida (kv_store con namespace por plugin)
│   │   ├── plugin_loader.rs    → descubre plugins, crea/posiciona sus ventanas
│   │   └── tray.rs             → ícono de bandeja + menú dinámico según plugins detectados
│   ├── Cargo.toml
│   └── tauri.conf.json
└── plugins/
    └── gamer-hud/           ← primer plugin
        ├── manifest.json        → contrato: tamaño, transparencia, always_on_top, etc.
        ├── index.html
        ├── style.css
        └── main.js              → consume el comando get_system_metrics cada 1.5s
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

```js
document.getElementById('close-btn').addEventListener('click', async () => {
  await invoke('hide_window');
});
```

### Mover cualquier ventana del launcher

Ninguna ventana de plugin tiene barra de título ni aparece en la barra de tareas, así que se
reposicionan sosteniendo **Win (Meta) + clic izquierdo** en cualquier punto de la ventana y
arrastrando — es un atajo nativo de KDE Plasma que mueve ventanas sin decoración, sin
depender del `data-tauri-drag-region` de cada plugin ni de tener un ícono en la barra de
tareas para hacerlo.

## 🛠️ Stack

- **Rust** + **Tauri 2** — shell nativo, liviano comparado con soluciones basadas en Electron
- **sysinfo** — lectura de métricas de sistema (CPU, RAM, disco, sensores de temperatura)
- **rusqlite (SQLite embebida)** — persistencia local compartida entre plugins
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

### Revisar el consumo de RAM en caliente

```bash
ps -o pid,rss,vsz,cmd -C companion
```

`RSS` es la memoria física real en uso (en KB, dividir entre 1024 para MB).

## 🧩 Retos técnicos y cómo se resolvieron

Documentar esto porque el camino real casi nunca es lineal, y creo que vale más mostrarlo
que esconderlo:

- **Cambios de API entre versiones de crates.** `sysinfo` cambió el nombre de su método de
  CPU global entre versiones (`global_cpu_usage` → `global_cpu_info().cpu_usage()`), y la API
  de menús de Tauri 2 no es encadenable (`Menu::append` devuelve `Result<()>`, no el propio
  menú). Ambos se detectaron directamente por los errores del compilador de Rust, que son
  bastante explícitos sobre qué método sí existe.

- **"Siempre encima" no es solo una bandera de la app.** Bajo Wayland (la sesión por defecto
  en KDE Plasma 6 / Nobara), el compositor no confía en que una aplicación decida por sí
  misma quedarse por encima de las demás — es una protección de seguridad del protocolo. La
  solución confiable no fue código, sino una **regla de ventana de KWin** forzando "Mantener
  por encima" a nivel de sistema operativo.

- **`skip_taskbar` desde el código no siempre se respeta al vuelo.** Forzar que la ventana no
  aparezca en la barra de tareas vía reglas de KWin (`Omitir la barra de tareas`, `Forzar`)
  solo tomó efecto después de cerrar y volver a crear la ventana — quedó como lección que
  ciertas propiedades de ventana en Wayland se fijan al momento de creación, no se pueden
  mutar en una ventana ya existente.

- **El arrastre de ventana compite con los eventos del propio JS.** El atributo
  `data-tauri-drag-region`, necesario para mover la ventana con el mouse, intercepta también
  el clic derecho antes de que llegue al script — así que la función de "saltar a la
  siguiente esquina" se migró a clic con el botón central, evitando el conflicto.

## 🧩 Plugins disponibles

| Plugin | Qué hace |
|---|---|
| **Gamer HUD** | Overlay flotante y transparente con CPU, RAM, disco y temperatura en tiempo real, estilo barras de videojuego. |
| **Notas Rápidas** | Notas de texto persistentes con búsqueda en vivo — guardadas en la SQLite del core, sobreviven a cerrar y reabrir la app. |

## 🗺️ Roadmap

- [x] Core: tray icon, atajo global, SQLite compartida, plugin loader
- [x] Plugin: Gamer HUD (CPU / RAM / Disco / Temperatura)
- [x] Plugin: notas rápidas persistentes
- [ ] Plugin: pomodoro / temporizador de enfoque
- [ ] Capa de conexión (Supabase Realtime) para estado compartido entre dos instancias
- [ ] Mission Control: integración con la API de GitHub

## 📄 Licencia

MIT — libre de usar, modificar y aprender de él.
