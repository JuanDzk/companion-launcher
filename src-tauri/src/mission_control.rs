// mission_control.rs — lectura de PRs e Issues abiertos por proyecto.
// A diferencia de backup.rs, este módulo NUNCA escribe nada en GitHub, solo lee.
// Igual que el resto del launcher: nada corre hasta que abres la ventana.

use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

const KEYRING_SERVICE: &str = "companion-mission-control";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepoRef {
    pub name: String,        // nombre de la carpeta local
    pub github_repo: String, // "usuario/repo", ya parseado del remote
}

// Reutiliza la misma carpeta que ya vigila Backup Inteligente, pero en vez de
// mirar el estado de git, extrae a qué repo de GitHub apunta cada proyecto.
#[tauri::command]
pub fn mission_control_list_repos(watch_root: String) -> Result<Vec<RepoRef>, String> {
    let root = PathBuf::from(&watch_root);
    let entries = std::fs::read_dir(&root).map_err(|e| format!("no se pudo leer {watch_root}: {e}"))?;

    let mut repos = Vec::new();

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

        if let Some(github_repo) = remote_to_github_repo(&path) {
            repos.push(RepoRef { name, github_repo });
        }
        // Si no tiene remote de GitHub (o es de otro proveedor), simplemente se omite —
        // Mission Control no tiene nada que mostrar para ese proyecto.
    }

    repos.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(repos)
}

fn remote_to_github_repo(repo_path: &Path) -> Option<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(["remote", "get-url", "origin"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
    parse_github_repo(&url)
}

// Acepta SSH (git@github.com:usuario/repo.git), HTTPS normal
// (https://github.com/usuario/repo.git), y HTTPS con credenciales incrustadas
// (https://usuario:token@github.com/usuario/repo.git) — busca "github.com/" en
// cualquier parte del string en vez de exigir que la URL empiece exactamente así.
fn parse_github_repo(url: &str) -> Option<String> {
    let trimmed = url.trim();

    if let Some(rest) = trimmed.strip_prefix("git@github.com:") {
        return Some(rest.trim_end_matches(".git").to_string());
    }

    if let Some(idx) = trimmed.find("github.com/") {
        let rest = &trimmed[idx + "github.com/".len()..];
        let repo = rest.trim_end_matches(".git").trim_end_matches('/');
        if !repo.is_empty() {
            return Some(repo.to_string());
        }
    }

    None // remote de otro proveedor (GitLab, Bitbucket, etc.) — no aplica aquí
}

// --- Credenciales (separadas de las de Backup Inteligente) ---

#[tauri::command]
pub fn mission_control_has_credentials() -> bool {
    Entry::new(KEYRING_SERVICE, "github_token")
        .and_then(|e| e.get_password())
        .is_ok()
}

#[tauri::command]
pub fn mission_control_save_credentials(token: String) -> Result<(), String> {
    let entry = Entry::new(KEYRING_SERVICE, "github_token").map_err(|e| e.to_string())?;
    entry.set_password(&token).map_err(|e| e.to_string())?;
    Ok(())
}

fn read_token() -> Result<String, String> {
    Entry::new(KEYRING_SERVICE, "github_token")
        .and_then(|e| e.get_password())
        .map_err(|_| "no hay token de Mission Control guardado todavía".to_string())
}

// --- Lectura de PRs e Issues ---

#[derive(Debug, Serialize, Clone)]
pub struct ItemInfo {
    pub title: String,
    pub number: u64,
    pub url: String,
}

#[derive(Debug, Serialize)]
pub struct RepoSummary {
    pub name: String,
    pub github_repo: String,
    pub prs: Vec<ItemInfo>,
    pub issues: Vec<ItemInfo>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn mission_control_fetch_all(repos: Vec<RepoRef>) -> Result<Vec<RepoSummary>, String> {
    let token = read_token()?;
    let client = reqwest::Client::new();
    let mut summaries = Vec::new();

    for repo in repos {
        let summary = fetch_repo_summary(&client, &token, &repo).await;
        summaries.push(summary);
    }

    Ok(summaries)
}

async fn fetch_repo_summary(client: &reqwest::Client, token: &str, repo: &RepoRef) -> RepoSummary {
    let base = format!("https://api.github.com/repos/{}", repo.github_repo);

    let prs_result = fetch_items(client, token, &format!("{base}/pulls?state=open&per_page=20")).await;
    let issues_result =
        fetch_items(client, token, &format!("{base}/issues?state=open&per_page=20")).await;

    match (prs_result, issues_result) {
        (Ok(prs), Ok(all_issues)) => {
            // El endpoint /issues de GitHub también incluye los PRs — se filtran aparte,
            // quedándonos solo con los que NO tienen el campo "pull_request".
            let issues = all_issues;
            RepoSummary {
                name: repo.name.clone(),
                github_repo: repo.github_repo.clone(),
                prs,
                issues,
                error: None,
            }
        }
        (Err(e), _) | (_, Err(e)) => RepoSummary {
            name: repo.name.clone(),
            github_repo: repo.github_repo.clone(),
            prs: vec![],
            issues: vec![],
            error: Some(e),
        },
    }
}

async fn fetch_items(client: &reqwest::Client, token: &str, url: &str) -> Result<Vec<ItemInfo>, String> {
    let resp = client
        .get(url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "companion-mission-control")
        .send()
        .await
        .map_err(|e| format!("error de red: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub respondió {}", resp.status()));
    }

    let raw: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    let items = raw
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        // Filtra los PRs cuando estamos leyendo /issues (GitHub los mezcla en ese endpoint).
        .filter(|item| item.get("pull_request").is_none() || url.contains("/pulls?"))
        .filter_map(|item| {
            Some(ItemInfo {
                title: item.get("title")?.as_str()?.to_string(),
                number: item.get("number")?.as_u64()?,
                url: item.get("html_url")?.as_str()?.to_string(),
            })
        })
        .collect();

    Ok(items)
}

// Abre una URL en el navegador del sistema — xdg-open es estándar en cualquier
// distro Linux con un entorno de escritorio, no requiere ningún crate adicional.
#[tauri::command]
pub fn open_in_browser(url: String) -> Result<(), String> {
    Command::new("xdg-open")
        .arg(url)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
