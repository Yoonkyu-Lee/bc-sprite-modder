use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

const PACKAGE_BY_SERVER: &[(&str, &str)] = &[
    ("kr", "jp.co.ponos.battlecatskr"),
    ("jp", "jp.co.ponos.battlecats"),
    ("en", "jp.co.ponos.battlecatsen"),
    ("tw", "jp.co.ponos.battlecatstw"),
];

fn dataset_to_relative_path(server: &str, version: &str) -> String {
    let pkg = PACKAGE_BY_SERVER
        .iter()
        .find(|(k, _)| *k == server)
        .map(|(_, v)| *v)
        .unwrap_or("jp.co.ponos.battlecatskr");
    format!("BCData/apks/{pkg}/{version}{server}")
}

#[derive(Serialize)]
pub struct DatasetEntry {
    pub server: String,
    pub version: String,
    pub path: String,
    pub display: String,
}

#[tauri::command]
pub fn list_datasets(workspace_path: String) -> Result<Vec<DatasetEntry>, String> {
    let apks_dir = Path::new(&workspace_path).join("BCData").join("apks");
    if !apks_dir.exists() {
        return Ok(vec![]);
    }

    let mut result: Vec<DatasetEntry> = Vec::new();
    for pkg_dir in fs::read_dir(&apks_dir).map_err(|e| e.to_string())? {
        let pkg_dir = pkg_dir.map_err(|e| e.to_string())?;
        if !pkg_dir.path().is_dir() {
            continue;
        }
        for version_entry in fs::read_dir(pkg_dir.path()).map_err(|e| e.to_string())? {
            let version_entry = version_entry.map_err(|e| e.to_string())?;
            if !version_entry.path().is_dir() {
                continue;
            }
            let name = version_entry.file_name().to_string_lossy().to_string();
            let mut server = String::from("kr");
            let mut version = name.clone();
            for (code, _) in PACKAGE_BY_SERVER {
                if name.ends_with(code) {
                    server = code.to_string();
                    version = name[..name.len() - code.len()].to_string();
                    break;
                }
            }
            let version_path = version_entry.path();
            let rel = version_path
                .strip_prefix(Path::new(&workspace_path))
                .map_err(|_| "strip prefix failed")?;
            let path = rel.to_string_lossy().replace('\\', "/");
            let display = format!("{} {}", server.to_uppercase(), version);
            result.push(DatasetEntry {
                server,
                version,
                path,
                display,
            });
        }
    }
    result.sort_by(|a, b| {
        (b.server.as_str(), b.version.as_str()).cmp(&(a.server.as_str(), a.version.as_str()))
    });
    Ok(result)
}

#[derive(Serialize)]
pub struct ProjectMeta {
    pub name: String,
    pub description: String,
    pub created: Option<String>,
    pub modified: Option<String>,
    pub dataset: Option<serde_json::Value>,
}

#[derive(Serialize)]
pub struct ProjectEntry {
    pub path: String,
    pub meta: ProjectMeta,
}

#[tauri::command]
pub fn list_projects(workspace_path: String) -> Result<Vec<ProjectEntry>, String> {
    let projects_dir = Path::new(&workspace_path).join("projects");
    if !projects_dir.exists() {
        return Ok(vec![]);
    }

    let mut result: Vec<ProjectEntry> = Vec::new();
    for d in fs::read_dir(&projects_dir).map_err(|e| e.to_string())? {
        let d = d.map_err(|e| e.to_string())?;
        if !d.path().is_dir() {
            continue;
        }
        let meta_path = d.path().join("project.json");
        if !meta_path.exists() {
            continue;
        }
        let content = fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
        let meta: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        let name = meta
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let description = meta
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let created = meta.get("created").and_then(|v| v.as_str()).map(String::from);
        let modified = meta.get("modified").and_then(|v| v.as_str()).map(String::from);
        let dataset = meta.get("dataset").cloned();

        result.push(ProjectEntry {
            path: d.path().to_string_lossy().to_string(),
            meta: ProjectMeta {
                name,
                description,
                created,
                modified,
                dataset,
            },
        });
    }
    result.sort_by(|a, b| {
        let ma = a.meta.modified.as_deref().unwrap_or("");
        let mb = b.meta.modified.as_deref().unwrap_or("");
        mb.cmp(ma)
    });
    Ok(result)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectArgs {
    pub workspace_path: String,
    pub name: String,
    pub description: String,
    pub dataset: DatasetRef,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetRef {
    pub server: String,
    pub version: String,
    pub path: Option<String>,
}

fn sanitize_project_name(name: &str) -> String {
    let s: String = name
        .trim()
        .chars()
        .filter(|c| !r#"<>:"/\|?*"#.contains(*c))
        .collect();
    let s = s.trim();
    if s.is_empty() {
        "unnamed".to_string()
    } else {
        s.to_string()
    }
}

#[tauri::command]
pub fn create_project(args: CreateProjectArgs) -> Result<String, String> {
    let safe_name = sanitize_project_name(&args.name);
    if safe_name.is_empty() {
        return Err("프로젝트 이름이 비어 있습니다.".to_string());
    }

    let project_dir = Path::new(&args.workspace_path)
        .join("projects")
        .join(&safe_name);

    if project_dir.exists() {
        return Err(format!("이미 존재하는 프로젝트 이름입니다: {}", safe_name));
    }

    fs::create_dir_all(project_dir.join("mods")).map_err(|e| e.to_string())?;
    fs::create_dir_all(project_dir.join("exports")).map_err(|e| e.to_string())?;

    let dataset_path = args.dataset.path.unwrap_or_else(|| {
        dataset_to_relative_path(&args.dataset.server, &args.dataset.version)
    });

    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let project_json = serde_json::json!({
        "name": safe_name,
        "description": args.description.trim(),
        "created": now,
        "modified": now,
        "dataset": {
            "server": args.dataset.server,
            "version": args.dataset.version,
            "path": dataset_path,
        },
    });

    let path = project_dir.join("project.json");
    fs::write(
        path,
        serde_json::to_string_pretty(&project_json).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    Ok(project_dir.to_string_lossy().to_string())
}
