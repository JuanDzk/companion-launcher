    // Evita que en Windows se abra una consola detrás de la app (no aplica en Linux, no estorba).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod plugin_loader;
mod tray;
mod backup;   // ← nuevo
mod mission_control;   // ← nuevo

use serde::Serialize;
use sysinfo::{Components, Disks, System};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[derive(Serialize)]
struct SystemMetrics {
    cpu_percent: f32,
    ram_used_mb: u64,
    ram_total_mb: u64,
    ram_percent: f32,
    disk_used_gb: u64,
    disk_total_gb: u64,
    temp_celsius: Option<f32>,
}

// Comando que cualquier plugin puede invocar via window.__TAURI__.core.invoke("get_system_metrics")
#[tauri::command]
fn get_system_metrics() -> SystemMetrics {
    let mut sys = System::new_all();
    sys.refresh_cpu_usage();
    // sysinfo recomienda esperar un intervalo entre refrescos para que el % de CPU sea real
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let cpu_percent = sys.global_cpu_info().cpu_usage();
    let ram_used_mb = sys.used_memory() / 1024 / 1024;
    let ram_total_mb = sys.total_memory() / 1024 / 1024;
    let ram_percent = if ram_total_mb > 0 {
        (ram_used_mb as f32 / ram_total_mb as f32) * 100.0
    } else {
        0.0
    };

    let disks = Disks::new_with_refreshed_list();
    let (disk_used, disk_total) = disks.iter().fold((0u64, 0u64), |(used, total), d| {
        let t = d.total_space();
        let a = d.available_space();
        (used + (t - a), total + t)
    });

    // Busca primero el sensor "Tctl" (temperatura de CPU en AMD/k10temp, como en Ryzen).
    // Si no existe, se queda con el sensor más caliente que encuentre como aproximación razonable.
    let components = Components::new_with_refreshed_list();
    let temp_celsius = components
        .iter()
        .find(|c| c.label().to_lowercase().contains("tctl"))
        .or_else(|| {
            components
                .iter()
                .max_by(|a, b| a.temperature().partial_cmp(&b.temperature()).unwrap())
        })
        .map(|c| c.temperature());

    SystemMetrics {
        cpu_percent,
        ram_used_mb,
        ram_total_mb,
        ram_percent,
        disk_used_gb: disk_used / 1024 / 1024 / 1024,
        disk_total_gb: disk_total / 1024 / 1024 / 1024,
        temp_celsius,
    }
}

#[tauri::command]
fn hide_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(db::init())
        .invoke_handler(tauri::generate_handler![
            get_system_metrics,
            plugin_loader::list_plugins,
            plugin_loader::open_plugin_window,
            plugin_loader::snap_to_corner,
            hide_window,
            db::db_get,
            db::db_set,
            backup::backup_list_projects,
            backup::backup_has_credentials,
            backup::backup_save_credentials,
            backup::backup_run,
            mission_control::mission_control_list_repos,      // ← nuevo
            mission_control::mission_control_has_credentials,  // ← nuevo
            mission_control::mission_control_save_credentials, // ← nuevo
            mission_control::mission_control_fetch_all,        // ← nuevo
            mission_control::open_in_browser,                  // ← nuevo
        ])
        .setup(|app| {
            let handle = app.handle();

            tray::build(handle)?;

            // Atajo global Alt+Espacio: abre/enfoca el primer plugin marcado tray_entry.
            // (Pensado para crecer a un selector tipo Spotlight más adelante).
            let handle_for_shortcut = handle.clone();
            app.global_shortcut().on_shortcut(
                "Alt+Space",
                move |_app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Some(first) = plugin_loader::discover(&handle_for_shortcut)
                            .into_iter()
                            .find(|p| p.tray_entry)
                        {
                            let _ = plugin_loader::open_plugin_window(
                                handle_for_shortcut.clone(),
                                first.id,
                            );
                        }
                    }
                },
            )?;

            Ok(())
        })
        // La app sigue viva en el tray aunque se cierren todas las ventanas de plugins.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                window.hide().unwrap();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error corriendo Companion");
}
