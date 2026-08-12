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
│   │   ├── backup.rs           → lógica del plugin Backup Inteligente
│   │   └── mission_control.rs  → lógica del plugin Mission Control (ver más abajo)
│   ├── Cargo.toml
│   └── tauri.conf.json
└── plugins/
    ├── gamer-hud/
    ├── notas-rapidas/
    ├── pomodoro/
    ├── backup-inteligente/
    └── mission-control/
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
| `open_in_browser({ url })` | abre una URL en el navegador del sistema (vía `xdg-open`) |

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
  Service), nunca en la SQLite de la app. Backup Inteligente y Mission Control usan tokens de
  GitHub completamente separados entre sí, cada uno con el permiso mínimo que necesita.
- **reqwest + zip** — compresión de proyectos y subida a la API de GitHub (Backup Inteligente)
- **Supabase (Postgres + REST/RPC)** — sincronización de estado entre Nobara-san y Nobara-chan, sin servidor propio
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

### Si solo vas a usar la app (no a desarrollarla)

Si alguien te compartió el archivo `.AppImage` ya generado, no necesitas nada de lo anterior
(ni Rust, ni Node, ni Tauri CLI) — solo estas librerías del sistema:

```bash
sudo dnf install webkit2gtk4.1-devel libappindicator-gtk3-devel librsvg2-devel
```

Luego, clic derecho sobre el `.AppImage` → Propiedades → marca "permitir ejecutar como
programa" (o corre `chmod +x nombre-del-archivo.AppImage` en terminal) → doble clic para
abrir. Va a aparecer un ícono nuevo en la bandeja del sistema — ese es el launcher.

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

- **"Realtime" no significa lo mismo aquí que en el nombre del producto.** Una conexión
  WebSocket persistente de Supabase Realtime seguiría viva aunque "cerraras" la ventana de un
  plugin (porque `hide_window` no la destruye, solo la oculta) — rompiendo la regla de "nada
  corre hasta que lo abro" del resto del proyecto. Se optó por un modelo de **sincronización
  al abrir** (pull-on-open) más un botón manual de refresco: menos instantáneo, pero
  coherente con la arquitectura y sin conexiones colgadas de fondo.

- **No toda fusión de datos es igual.** Las notas se fusionan de forma aditiva (nunca se
  borra nada localmente), pero el contador de pomodoros completados necesitaba sumar entre
  máquinas sin perder ninguno — ahí sí conviene calcular el máximo/la suma directamente en
  Supabase en vez de confiar en que el cliente "adivine" el estado correcto.

- **Los navegadores embebidos tienen su propio estilo de botón por defecto.** Sin un reset
  explícito (`appearance: none`), WebKitGTK dibuja sus propios botones con forma de píldora
  encima de cualquier estilo personalizado — un detalle fácil de pasar por alto porque no
  aparece en la mayoría de tutoriales pensados para navegadores de escritorio normales.

- **Un parser de URLs de git tiene que asumir que van a venir "sucias".** La primera versión
  de Mission Control solo reconocía `https://github.com/usuario/repo.git` al pie de la letra
  — y fallaba en silencio con remotes que traían credenciales incrustadas
  (`https://usuario:token@github.com/...`), un formato más común de lo que parece. Se
  corrigió buscando `github.com/` en cualquier parte del string en vez de exigir que la URL
  empezara exactamente así.

- **Nunca guardes un token dentro de la URL del remote de git.** Ese mismo caso reveló que
  varios remotes locales tenían un token clásico de GitHub incrustado en texto plano dentro
  de `.git/config` — visible con un simple `git remote -v`. Se revocó el token y se
  reemplazaron esos remotes por la URL limpia (`https://github.com/usuario/repo.git`), dejando
  la autenticación real a cargo de SSH o de un gestor de credenciales, nunca de la URL misma.

## 🔄 Sincronización entre instancias

Notas Rápidas y Pomodoro comparten una capa opcional de sincronización vía Supabase, pensada
para mantener a Nobara-san y Nobara-chan (la máquina de mi novia) al día sin que ninguna de
las dos dependa de un servidor propio encendido:

- **Configuración única y compartida**: la URL y la clave de Supabase se guardan una sola vez
  (en cualquiera de los dos plugins) y ambos la reutilizan.
- **Pull-on-open, no WebSocket persistente**: cada plugin revisa cambios al abrirse (y con un
  botón manual de refresco), en vez de mantener una conexión en vivo — ver el porqué en
  "Retos técnicos".
- **Notas Rápidas**: fusión aditiva. Las notas nuevas de la otra máquina se agregan; nunca se
  borra nada localmente por una sincronización.
- **Pomodoro**: los minutos de enfoque/descanso se sincronizan por "el cambio más reciente
  gana"; el contador de completados del día se fusiona sumando entre máquinas, calculado del
  lado de Supabase para evitar condiciones de carrera.

## 📖 Primeros pasos por plugin

Gamer HUD y Notas/Pomodoro (sin sincronización) funcionan apenas los abres, sin configurar
nada. Los siguientes cuatro sí piden algo la primera vez — aquí está exactamente qué hacer,
pensado para alguien que nunca ha tocado un token o una base de datos.

### 🔄 Sincronizar Notas Rápidas y Pomodoro entre dos máquinas

Ambos comparten la misma configuración — solo se hace una vez, en cualquiera de los dos.

1. Crea una cuenta gratis en [supabase.com](https://supabase.com) (con GitHub es lo más
   rápido) → "New project" → dale un nombre, contraseña de base de datos (guárdala en algún
   lado) y la región más cercana → espera 1-2 minutos a que se cree.
2. En el menú izquierdo, entra a **SQL Editor** → pega y corre esto (botón "Run"):

```sql
create table synced_notes (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  created_at timestamptz not null default now()
);

create table synced_pomodoro (
  id text primary key default 'shared',
  focus_minutes int not null default 25,
  break_minutes int not null default 5,
  completed_today int not null default 0,
  updated_at timestamptz not null default now()
);

alter table synced_notes enable row level security;
create policy "allow all - personal use" on synced_notes for all using (true) with check (true);
alter table synced_pomodoro enable row level security;
create policy "allow all - personal use" on synced_pomodoro for all using (true) with check (true);

create or replace function upsert_pomodoro_settings(mins_work int, mins_break int)
returns void language sql as $$
  insert into synced_pomodoro (id, focus_minutes, break_minutes, updated_at)
  values ('shared', mins_work, mins_break, now())
  on conflict (id) do update
    set focus_minutes = excluded.focus_minutes,
        break_minutes = excluded.break_minutes,
        updated_at = now();
$$;

create or replace function increment_pomodoro_completed()
returns void language plpgsql as $$
begin
  insert into synced_pomodoro (id, completed_today, updated_at)
  values ('shared', 1, now())
  on conflict (id) do update
    set completed_today = case
          when synced_pomodoro.updated_at::date = now()::date then synced_pomodoro.completed_today + 1
          else 1
        end,
        updated_at = now();
end;
$$;
```

3. Ve a **Project Settings → API** y copia dos cosas: la **Project URL** y la **anon public
   key**.
4. Abre Notas Rápidas o Pomodoro en la app → pega esos dos valores en el formulario que
   aparece → Guardar. La otra persona pega exactamente los mismos dos valores en su propia
   máquina, y desde ahí ambas quedan conectadas.

### 💾 Backup Inteligente

1. En GitHub, crea un repositorio **privado y vacío** (sin README) — este va a ser el
   destino de tus backups, ej. `mis-backups`.
2. Settings → Developer settings → **Personal access tokens → Fine-grained tokens** →
   "Generate new token".
3. **Repository access** → "Only select repositories" → elige el repo que acabas de crear.
4. **Permissions** → busca "Contents" → cámbialo a **Read and write**.
5. Genera el token (empieza con `github_pat_...`) y cópialo — solo se muestra una vez.
6. Abre Backup Inteligente en la app → pega la carpeta donde viven tus proyectos, el nombre
   del repo (`tu-usuario/mis-backups`), y el token → Guardar.

### 🔭 Mission Control

Usa un token **distinto** al de Backup Inteligente — este solo necesita permiso de lectura.

1. GitHub → Fine-grained tokens → "Generate new token".
2. **Repository access** → elige los repos que quieras vigilar (pueden ser varios).
3. **Permissions** → busca "Pull requests" → **Read-only**. Busca "Issues" → **Read-only**.
   No actives nada de escritura, este plugin nunca modifica nada en GitHub.
4. Genera y copia el token.
5. Abre Mission Control en la app → pégalo → Guardar. Reutiliza la misma carpeta de
   proyectos que configuraste en Backup Inteligente.



| Plugin | Qué hace |
|---|---|
| **Gamer HUD** | Overlay flotante y transparente con CPU, RAM, disco y temperatura en tiempo real, estilo barras de videojuego. |
| **Notas Rápidas** | Notas de texto persistentes con búsqueda en vivo — guardadas en la SQLite del core, sobreviven a cerrar y reabrir la app. Se sincronizan opcionalmente con Nobara-chan vía Supabase. |
| **Pomodoro** | Temporizador de enfoque con anillo de progreso, ciclos de descanso corto/largo automáticos, y contador de pomodoros completados por día — también sincronizable entre máquinas. |
| **Backup Inteligente** | Detecta automáticamente tus proyectos con Git, muestra si cada uno tiene cambios sin subir a GitHub (semáforo verde/amarillo/rojo), y sube un `.zip` de los que elijas como Release a un repo privado dedicado — con limpieza automática de backups viejos. Sin timers, sin servidor propio: solo corre cuando abres la ventana. |
| **Mission Control** | Reutiliza los mismos proyectos que Backup Inteligente detecta y muestra, por repo, cuántos Pull Requests e Issues abiertos tiene en GitHub — con la lista de títulos y un clic para abrirlos en el navegador. Solo lee, nunca escribe nada en GitHub. |

## 🗺️ Roadmap

- [x] Core: tray icon, atajo global, SQLite compartida, plugin loader
- [x] Plugin: Gamer HUD (CPU / RAM / Disco / Temperatura)
- [x] Plugin: notas rápidas persistentes
- [x] Plugin: pomodoro / temporizador de enfoque
- [x] Plugin: Backup Inteligente (respaldo a GitHub Releases)
- [x] Capa de conexión (Supabase) para estado compartido entre dos instancias — sincronización al abrir, sin conexiones persistentes de fondo
- [x] Mission Control: panel de visibilidad sobre repos, PRs e issues vía la API de GitHub
- [ ] Probar la sincronización de punta a punta en Nobara-chan (pendiente de empaquetar la app)

## 📄 Licencia

MIT — libre de usar, modificar y aprender de él.
