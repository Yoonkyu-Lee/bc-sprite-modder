use serde::Serialize;
use std::path::PathBuf;
use tauri::AppHandle;

const WORKSPACE_FILE: &str = "workspace_path.txt";

fn workspace_file_path(_app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_dir().ok_or_else(|| "app_data_dir unavailable".to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(WORKSPACE_FILE))
}

#[cfg(windows)]
fn app_data_dir() -> Option<PathBuf> {
    std::env::var("APPDATA").ok().map(|p| PathBuf::from(p).join("BattleCatsSpriteModder"))
}

#[cfg(not(windows))]
fn app_data_dir() -> Option<PathBuf> {
    std::env::var("HOME")
        .ok()
        .map(|p| PathBuf::from(p).join(".config").join("BattleCatsSpriteModder"))
}

#[derive(Serialize)]
pub struct WorkspaceResult {
    pub path: Option<String>,
}

#[tauri::command]
pub fn get_workspace(app: AppHandle) -> WorkspaceResult {
    eprintln!("[init] get_workspace: 시작");
    let t0 = std::time::Instant::now();
    let path = match workspace_file_path(&app) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[init] get_workspace: workspace_file_path 실패: {}", e);
            return WorkspaceResult { path: None };
        }
    };
    eprintln!("[init] get_workspace: 설정 파일 경로 {:?}, 경과(ms): {:?}", path, t0.elapsed());
    let s = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[init] get_workspace: read_to_string 실패: {}, 경과(ms): {:?}", e, t0.elapsed());
            return WorkspaceResult { path: None };
        }
    };
    let s = s.trim().to_string();
    let result = if s.is_empty() {
        eprintln!("[init] get_workspace: 완료 (path 없음), 총 경과(ms): {:?}", t0.elapsed());
        WorkspaceResult { path: None }
    } else {
        eprintln!("[init] get_workspace: 완료 path={}, 총 경과(ms): {:?}", s, t0.elapsed());
        WorkspaceResult { path: Some(s) }
    };
    result
}

#[tauri::command]
pub fn set_workspace(app: AppHandle, path: String) -> Result<(), String> {
    let file_path = workspace_file_path(&app)?;
    std::fs::write(&file_path, path.trim()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn ensure_workspace_structure(workspace_path: String) -> Result<(), String> {
    let path = PathBuf::from(&workspace_path);
    let bcdata = path.join("BCData");
    let projects = path.join("projects");
    std::fs::create_dir_all(&bcdata).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&projects).map_err(|e| e.to_string())?;
    Ok(())
}
