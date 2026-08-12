use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::AppHandle;

use crate::plugin_loader;

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let plugins = plugin_loader::discover(app);

    let menu = Menu::new(app)?;

    // Un ítem de menú por plugin marcado con tray_entry: true en su manifest.
    for plugin in &plugins {
        if !plugin.tray_entry {
            continue;
        }
        let item = MenuItem::with_id(app, &plugin.id, &plugin.name, true, None::<&str>)?;
        menu.append(&item)?;
    }

    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?)?;

    TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("Companion")
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "quit" => {
                app.exit(0);
            }
            plugin_id => {
                let _ = plugin_loader::open_plugin_window(app.clone(), plugin_id.to_string());
            }
        })
        .build(app)?;

    Ok(())
}
