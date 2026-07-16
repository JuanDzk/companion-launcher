use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Db(pub Mutex<Connection>);

fn db_path() -> PathBuf {
    // Guarda core.db junto a los datos de la app (~/.local/share/com.juandiego.companion en Linux)
    let mut dir = dirs::data_dir().expect("no se pudo resolver el directorio de datos");
    dir.push("companion");
    std::fs::create_dir_all(&dir).expect("no se pudo crear el directorio de datos");
    dir.push("core.db");
    dir
}

pub fn init() -> Db {
    let conn = Connection::open(db_path()).expect("no se pudo abrir core.db");

    // Tabla genérica clave-valor, con namespace por plugin para evitar choques.
    conn.execute(
        "CREATE TABLE IF NOT EXISTS kv_store (
            plugin_id TEXT NOT NULL,
            key       TEXT NOT NULL,
            value     TEXT NOT NULL,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (plugin_id, key)
        )",
        [],
    )
    .expect("no se pudo crear kv_store");

    // Registro de plugins detectados, útil para el launcher/menú del tray.
    conn.execute(
        "CREATE TABLE IF NOT EXISTS plugins (
            id      TEXT PRIMARY KEY,
            name    TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1
        )",
        [],
    )
    .expect("no se pudo crear tabla plugins");

    Db(Mutex::new(conn))
}

#[tauri::command]
pub fn db_get(db: tauri::State<Db>, plugin_id: String, key: String) -> Option<String> {
    let conn = db.0.lock().unwrap();
    conn.query_row(
        "SELECT value FROM kv_store WHERE plugin_id = ?1 AND key = ?2",
        rusqlite::params![plugin_id, key],
        |row| row.get(0),
    )
    .ok()
}

#[tauri::command]
pub fn db_set(db: tauri::State<Db>, plugin_id: String, key: String, value: String) -> bool {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO kv_store (plugin_id, key, value, updated_at)
         VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
         ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
        rusqlite::params![plugin_id, key, value],
    )
    .is_ok()
}
