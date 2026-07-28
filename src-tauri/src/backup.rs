// backup.rs — lógica del plugin Backup Inteligente.
// Nada de esto corre en segundo plano: cada función se invoca una sola vez,
// cuando el usuario abre la ventana o presiona "Respaldar ahora".

use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use zip::write::FileOptions;

// Nombre del servicio en el almacén de credenciales del sistema (KWallet/Secret Service).
// "companion-backup" es solo una etiqueta, no un plugin_id de la SQLite.
const KEYRING_SERVICE: &str = "companion-backup";

// Carpetas que nunca se comprimen: son reproducibles (se regeneran con un comando)
// o ya viven versionadas en otro lado (.git ya está en GitHub).
const IGNORED_DIRS: &[&str] = &[
    ".git",
"target",           // Rust
"node_modules",     // JS/Node
"build",            // Flutter/Dart, y algunos JS
".dart_tool",       // Flutter/Dart
".gradle",          // Android/Flutter
"Pods",             // iOS/Flutter (CocoaPods)
"__pycache__",      // Python
".venv",            // Python
"venv",             // Python
".pytest_cache",    // Python
"vendor",           // PHP (composer)
];

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProjectInfo {
    pub name: String,
    pub path: String,
    // None = no se pudo leer el historial git (repo vacío o corrupto).
    pub days_since_commit: Option<i64>,
    // "en-github" | "cambios-sin-subir" | "sin-repositorio"
    pub status: String,
}

// Escanea la carpeta padre y devuelve solo las subcarpetas que son repos git
// (tienen un .git). Esto es barato: solo lee el listado de directorios,
// no abre ni recorre el contenido de cada proyecto.
#[tauri::command]
pub fn backup_list_projects(watch_root: String) -> Result<Vec<ProjectInfo>, String> {
    let root = PathBuf::from(&watch_root);
    let entries = std::fs::read_dir(&root).map_err(|e| format!("no se pudo leer {watch_root}: {e}"))?;

    let mut projects = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() || !path.join(".git").exists() {
            continue;
        }
        let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("desconocido")
        .to_string();

        let days_since_commit = last_commit_days(&path);
        let status = compute_status(&path);

        projects.push(ProjectInfo {
            name,
            path: path.to_string_lossy().to_string(),
                      days_since_commit,
                      status,
        });
    }

    // Alfabético, para que la lista no salte de orden entre aperturas.
    projects.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(projects)
}

// La pregunta real que le importa al usuario no es "cuántos días pasaron",
// sino "¿tengo algo ahora mismo que solo existe en este disco?". Se responde
// con dos chequeos locales, sin red, casi instantáneos:
fn compute_status(repo_path: &Path) -> String {
    if !has_remote(repo_path) {
        return "sin-repositorio".to_string();
    }
    if is_dirty(repo_path) || commits_ahead(repo_path) > 0 {
        return "cambios-sin-subir".to_string();
    }
    "en-github".to_string()
}

fn has_remote(repo_path: &Path) -> bool {
    Command::new("git")
    .arg("-C")
    .arg(repo_path)
    .args(["remote"])
    .output()
    .map(|o| o.status.success() && !String::from_utf8_lossy(&o.stdout).trim().is_empty())
    .unwrap_or(false)
}

// git status --porcelain no toca la red — solo compara el árbol de trabajo
// contra el último commit local. Cualquier línea de salida = hay algo sin commitear.
fn is_dirty(repo_path: &Path) -> bool {
    Command::new("git")
    .arg("-C")
    .arg(repo_path)
    .args(["status", "--porcelain"])
    .output()
    .map(|o| !String::from_utf8_lossy(&o.stdout).trim().is_empty())
    .unwrap_or(false)
}

// Compara la rama local contra la última copia CONOCIDA de su remoto — tampoco
// hace fetch, así que es instantáneo. Si no hay rama de tracking configurada
// (@{upstream} falla), se asume 0 en vez de fallar el chequeo completo.
fn commits_ahead(repo_path: &Path) -> i64 {
    Command::new("git")
    .arg("-C")
    .arg(repo_path)
    .args(["rev-list", "--count", "@{upstream}..HEAD"])
    .output()
    .ok()
    .filter(|o| o.status.success())
    .and_then(|o| String::from_utf8_lossy(&o.stdout).trim().parse::<i64>().ok())
    .unwrap_or(0)
}

// git log -1 --format=%cI lee solo la referencia del último commit — es prácticamente
// instantáneo, no recorre el historial completo. Se ejecuta vía shell porque no hay
// (ni hace falta) un crate de git en Rust para algo tan puntual.
fn last_commit_days(repo_path: &Path) -> Option<i64> {
    let output = Command::new("git")
    .arg("-C")
    .arg(repo_path)
    .args(["log", "-1", "--format=%cI"])
    .output()
    .ok()?;

    if !output.status.success() {
        return None; // repo sin commits todavía
    }

    let date_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let commit_date = chrono::DateTime::parse_from_rfc3339(&date_str).ok()?;
    let now = chrono::Utc::now();

    Some((now - commit_date.with_timezone(&chrono::Utc)).num_days())
}

// --- Credenciales ---
// Nunca tocan la SQLite del core. keyring habla directamente con KWallet/Secret Service.
// Solo se guarda una cosa: el Personal Access Token de GitHub, con permiso de
// "Contents" (lectura/escritura) restringido al repo de backups — no a toda tu cuenta.

#[tauri::command]
pub fn backup_has_credentials() -> bool {
    Entry::new(KEYRING_SERVICE, "github_token")
    .and_then(|e| e.get_password())
    .is_ok()
}

#[tauri::command]
pub fn backup_save_credentials(token: String) -> Result<(), String> {
    let entry = Entry::new(KEYRING_SERVICE, "github_token").map_err(|e| e.to_string())?;
    entry.set_password(&token).map_err(|e| e.to_string())?;
    Ok(())
}

fn read_token() -> Result<String, String> {
    Entry::new(KEYRING_SERVICE, "github_token")
    .and_then(|e| e.get_password())
    .map_err(|_| "no hay token de GitHub guardado todavía".to_string())
}

// --- Respaldo ---

#[derive(Debug, Serialize)]
pub struct BackupResult {
    pub project: String,
    pub success: bool,
    pub error: Option<String>,
}

// Comprime cada proyecto seleccionado (excluyendo IGNORED_DIRS) y lo sube como
// asset de un GitHub Release nuevo. Todo esto corre una sola vez, al presionar
// el botón — nada de timers, nada de servidor propio corriendo.
#[tauri::command]
pub async fn backup_run(
    repo: String, // formato "usuario/nombre-repo"
    project_paths: Vec<String>,
) -> Result<Vec<BackupResult>, String> {
    let token = read_token()?;
    let client = reqwest::Client::new();
    let mut results = Vec::new();

    for path_str in project_paths {
        let path = PathBuf::from(&path_str);
        let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("proyecto")
        .to_string();

        let outcome = backup_single_project(&client, &repo, &token, &path, &name).await;

        results.push(match outcome {
            Ok(()) => BackupResult { project: name, success: true, error: None },
                     Err(e) => {
                         eprintln!("backup falló para '{name}': {e}");
                         BackupResult { project: name, success: false, error: Some(e) }
                     }
        });
    }

    Ok(results)
}

async fn backup_single_project(
    client: &reqwest::Client,
    repo: &str,
    token: &str,
    project_path: &Path,
    project_name: &str,
) -> Result<(), String> {
    // 1. Comprimir a un archivo temporal.
    let zip_path = std::env::temp_dir().join(format!("{project_name}-backup.zip"));
    zip_directory(project_path, &zip_path).map_err(|e| format!("error comprimiendo: {e}"))?;

    let mut file = File::open(&zip_path).map_err(|e| e.to_string())?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer).map_err(|e| e.to_string())?;

    let timestamp = chrono::Utc::now().format("%Y-%m-%d_%H%M");
    let tag = format!("backup-{project_name}-{timestamp}");

    // 2. Crear un Release nuevo — cada backup queda como su propia entrada con fecha,
    //    lo que de paso da historial de versiones sin ningún esfuerzo extra.
    let create_url = format!("https://api.github.com/repos/{repo}/releases");
    let create_resp = client
    .post(&create_url)
    .header("Authorization", format!("Bearer {token}"))
    .header("Accept", "application/vnd.github+json")
    .header("X-GitHub-Api-Version", "2022-11-28")
    .header("User-Agent", "companion-backup")
    .json(&serde_json::json!({
        "tag_name": tag,
        "name": tag,
        "draft": false,
        "prerelease": true,
    }))
    .send()
    .await
    .map_err(|e| format!("error de red creando release: {e}"))?;

    if !create_resp.status().is_success() {
        let status = create_resp.status();
        let body = create_resp.text().await.unwrap_or_default();
        let _ = std::fs::remove_file(&zip_path);
        return Err(format!("GitHub respondió {status} al crear el release: {body}"));
    }

    let release_json: serde_json::Value = create_resp.json().await.map_err(|e| e.to_string())?;
    // upload_url llega como plantilla, ej: ".../assets{?name,label}" — se recorta la parte {?...}
    let upload_template = release_json["upload_url"]
    .as_str()
    .ok_or("GitHub no devolvió upload_url")?;
    let upload_base = upload_template.split('{').next().unwrap_or(upload_template);
    let upload_url = format!("{upload_base}?name={project_name}.zip");

    // 3. Subir el zip como asset del release recién creado.
    let upload_resp = client
    .post(&upload_url)
    .header("Authorization", format!("Bearer {token}"))
    .header("Accept", "application/vnd.github+json")
    .header("Content-Type", "application/zip")
    .header("User-Agent", "companion-backup")
    .body(buffer)
    .send()
    .await
    .map_err(|e| format!("error de red subiendo el zip: {e}"))?;

    let _ = std::fs::remove_file(&zip_path); // limpieza del temporal, no crítico si falla

    if !upload_resp.status().is_success() {
        return Err(format!("GitHub respondió {} al subir el archivo", upload_resp.status()));
    }

    // 4. Limpieza: conserva solo los últimos 5 backups de este proyecto, borra el resto.
    //    Si la limpieza falla no se considera un error del backup — el archivo ya quedó
    //    subido, que es lo que realmente importa.
    let _ = cleanup_old_backups(client, repo, token, project_name, 5).await;

    Ok(())
}

// Los Releases de GitHub llegan ordenados del más nuevo al más viejo por defecto.
// Se filtran los que pertenecen a este proyecto (por el prefijo del tag) y se
// borran los que sobren más allá de `keep` — release y su tag, para no dejar basura.
async fn cleanup_old_backups(
    client: &reqwest::Client,
    repo: &str,
    token: &str,
    project_name: &str,
    keep: usize,
) -> Result<(), String> {
    let list_url = format!("https://api.github.com/repos/{repo}/releases?per_page=100");
    let resp = client
    .get(&list_url)
    .header("Authorization", format!("Bearer {token}"))
    .header("Accept", "application/vnd.github+json")
    .header("User-Agent", "companion-backup")
    .send()
    .await
    .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("no se pudo listar releases: {}", resp.status()));
    }

    let releases: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let prefix = format!("backup-{project_name}-");

    let mut project_releases: Vec<(u64, String)> = releases
    .as_array()
    .cloned()
    .unwrap_or_default()
    .into_iter()
    .filter_map(|r| {
        let tag = r["tag_name"].as_str()?.to_string();
        if !tag.starts_with(&prefix) {
            return None;
        }
        let id = r["id"].as_u64()?;
        Some((id, tag))
    })
    .collect();

    // Ya vienen ordenados del más nuevo al más viejo, así que lo que sobra
    // después del índice `keep` es exactamente lo más antiguo.
    if project_releases.len() <= keep {
        return Ok(());
    }
    let to_delete = project_releases.split_off(keep);

    for (id, tag) in to_delete {
        let del_release_url = format!("https://api.github.com/repos/{repo}/releases/{id}");
        let _ = client
        .delete(&del_release_url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "companion-backup")
        .send()
        .await;

        let del_tag_url = format!("https://api.github.com/repos/{repo}/git/refs/tags/{tag}");
        let _ = client
        .delete(&del_tag_url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "companion-backup")
        .send()
        .await;
    }

    Ok(())
}

fn zip_directory(src_dir: &Path, zip_path: &Path) -> Result<(), String> {
    let zip_file = File::create(zip_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(zip_file);
    let options: FileOptions = FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    add_dir_to_zip(&mut zip, src_dir, src_dir, &options)?;
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

fn add_dir_to_zip(
    zip: &mut zip::ZipWriter<File>,
    base_dir: &Path,
    current_dir: &Path,
    options: &FileOptions,
) -> Result<(), String> {
    for entry in std::fs::read_dir(current_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let file_name = entry.file_name();
        let name_str = file_name.to_string_lossy();

        if IGNORED_DIRS.contains(&name_str.as_ref()) {
            continue;
        }

        let relative = path.strip_prefix(base_dir).map_err(|e| e.to_string())?;

        if path.is_dir() {
            add_dir_to_zip(zip, base_dir, &path, options)?;
        } else {
            zip.start_file(relative.to_string_lossy(), *options)
            .map_err(|e| e.to_string())?;
            let mut f = File::open(&path).map_err(|e| e.to_string())?;
            let mut buf = Vec::new();
            f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            zip.write_all(&buf).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
