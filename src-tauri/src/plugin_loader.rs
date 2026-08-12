use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

// Contrato del plugin. Cada carpeta en /plugins debe traer un manifest.json
// con esta forma. Cualquier campo nuevo que agreguemos después debe tener
// un default para no romper plugins viejos.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub entry: String, // archivo html de entrada, relativo a la carpeta del plugin
    #[serde(default = "default_width")]
    pub width: f64,
    #[serde(default = "default_height")]
    pub height: f64,
    #[serde(default)]
    pub transparent: bool,
    #[serde(default)]
    pub always_on_top: bool,
    #[serde(default)]
    pub decorations: bool,
    #[serde(default)]
    pub tray_entry: bool, // si aparece como opción en el menú del tray
}

fn default_width() -> f64 {
    360.0
}
fn default_height() -> f64 {
    240.0
}

// En dev (`cargo tauri dev`), la carpeta /plugins vive junto al proyecto y se
// resuelve con una ruta relativa simple. En una app empaquetada (`cargo tauri
// build`), esa ruta relativa ya no existe — hay que preguntarle a Tauri dónde
// quedaron los "resources" que se empaquetaron junto al ejecutable.
// Esto es justo lo que hacía que el instalador funcionara "vacío" en otra
// máquina: sin este cambio, la ruta relativa no apunta a nada fuera de tu
// carpeta de desarrollo.
fn plugins_dir(app: &AppHandle) -> PathBuf {
    if cfg!(debug_assertions) {
        PathBuf::from("../plugins")
    } else {
        app.path()
            .resource_dir()
            .expect("no se pudo resolver el directorio de recursos de la app")
            .join("plugins")
    }
}

pub fn discover(app: &AppHandle) -> Vec<PluginManifest> {
    let dir = plugins_dir(app);
    let mut found = Vec::new();

    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return found, // sin carpeta de plugins, sin problema: 0 plugins
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let manifest_path = path.join("manifest.json");
        if !manifest_path.exists() {
            continue;
        }
        match fs::read_to_string(&manifest_path) {
            Ok(contents) => match serde_json::from_str::<PluginManifest>(&contents) {
                Ok(manifest) => found.push(manifest),
                Err(e) => eprintln!("manifest inválido en {:?}: {e}", manifest_path),
            },
            Err(e) => eprintln!("no se pudo leer {:?}: {e}", manifest_path),
        }
    }

    found
}

#[tauri::command]
pub fn list_plugins(app: AppHandle) -> Vec<PluginManifest> {
    discover(&app)
}

#[tauri::command]
pub fn open_plugin_window(app: AppHandle, plugin_id: String) -> Result<(), String> {
    let manifest = discover(&app)
        .into_iter()
        .find(|p| p.id == plugin_id)
        .ok_or_else(|| format!("plugin '{plugin_id}' no encontrado"))?;

    // Si la ventana ya existe, solo la mostramos/enfocamos en vez de duplicarla.
    if let Some(win) = app.get_webview_window(&manifest.id) {
        win.show().map_err(|e| e.to_string())?;
        win.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Cada ventana nace en un punto ligeramente distinto al de la anterior, para
    // que no se apilen exactamente unas encima de otras al reiniciar la app —
    // antes todas nacían fijas en (40,40), lo que obligaba a reacomodarlas a mano
    // cada vez. El offset se reinicia cada 6 ventanas para no salirse de pantalla.
    let open_count = app.webview_windows().len() as f64;
    let step = (open_count % 6.0) * 45.0;
    let base_x = 40.0 + step;
    let base_y = 40.0 + step;

    let url = WebviewUrl::App(format!("{}/{}", manifest.id, manifest.entry).into());

    WebviewWindowBuilder::new(&app, &manifest.id, url)
        .title(&manifest.name)
        .inner_size(manifest.width, manifest.height)
        .position(base_x, base_y)
        .transparent(manifest.transparent)
        .always_on_top(manifest.always_on_top)
        .decorations(manifest.decorations)
        .skip_taskbar(true)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn snap_to_corner(window: tauri::WebviewWindow, corner: String) -> Result<(), String> {
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no se pudo detectar el monitor".to_string())?;

    let monitor_pos = monitor.position();
    let monitor_size = monitor.size();
    let window_size = window.outer_size().map_err(|e| e.to_string())?;
    let margin: i32 = 20;

    let (x, y) = match corner.as_str() {
        "top-left" => (monitor_pos.x + margin, monitor_pos.y + margin),
        "top-right" => (
            monitor_pos.x + monitor_size.width as i32 - window_size.width as i32 - margin,
            monitor_pos.y + margin,
        ),
        "bottom-left" => (
            monitor_pos.x + margin,
            monitor_pos.y + monitor_size.height as i32 - window_size.height as i32 - margin,
        ),
        "bottom-right" => (
            monitor_pos.x + monitor_size.width as i32 - window_size.width as i32 - margin,
            monitor_pos.y + monitor_size.height as i32 - window_size.height as i32 - margin,
        ),
        other => return Err(format!("esquina desconocida: {other}")),
    };

    window
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))
        .map_err(|e| e.to_string())?;

    Ok(())
}
