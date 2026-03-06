use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};

static DATA_SETUP_RUNNING: AtomicBool = AtomicBool::new(false);

const PACKAGE_BY_SERVER: &[(&str, &str)] = &[
    ("kr", "jp.co.ponos.battlecatskr"),
    ("jp", "jp.co.ponos.battlecats"),
    ("en", "jp.co.ponos.battlecatsen"),
    ("tw", "jp.co.ponos.battlecatstw"),
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunDataSetupArgs {
    pub workspace_path: String,
    pub server: String,
    pub version: String,
    pub apk_path: Option<String>,
    pub force_server_files: bool,
    pub force_extract: bool,
    pub force_download_apk: bool,
}

/// 프로젝트 루트(src-tauri/scripts/ 가 있는 디렉터리)를 찾는다.
/// 앱이 사용하는 Python 스크립트는 src-tauri/scripts/ 에 포함.
fn find_project_root() -> Result<PathBuf, String> {
    let mut dir = std::env::current_dir().map_err(|e| e.to_string())?;
    for _ in 0..10 {
        let script = dir.join("src-tauri").join("scripts").join("data_setup.py");
        if script.exists() {
            return Ok(dir);
        }
        if dir.file_name().map(|n| n == "src-tauri").unwrap_or(false) {
            if let Some(parent) = dir.parent() {
                let script = parent.join("src-tauri").join("scripts").join("data_setup.py");
                if script.exists() {
                    return Ok(parent.to_path_buf());
                }
            }
        }
        dir = match dir.parent() {
            Some(p) => p.to_path_buf(),
            None => break,
        };
    }
    Err("src-tauri/scripts/data_setup.py를 찾을 수 없습니다.".to_string())
}

fn dataset_to_relative_path(server: &str, version: &str) -> String {
    let pkg = match server {
        "jp" => "jp.co.ponos.battlecats",
        "en" => "jp.co.ponos.battlecatsen",
        "tw" => "jp.co.ponos.battlecatstw",
        _ => "jp.co.ponos.battlecatskr",
    };
    let folder = format!("{version}{server}");
    format!("BCData/apks/{pkg}/{folder}")
}

#[tauri::command]
pub async fn run_data_setup(app: AppHandle, args: RunDataSetupArgs) -> Result<(), String> {
    if DATA_SETUP_RUNNING.swap(true, Ordering::SeqCst) {
        return Err("이미 실행 중입니다.".to_string());
    }

    let project_root = find_project_root()?;
    let data_setup_py = project_root
        .join("src-tauri")
        .join("scripts")
        .join("data_setup.py");
    if !data_setup_py.exists() {
        DATA_SETUP_RUNNING.store(false, Ordering::SeqCst);
        return Err(format!("data_setup.py를 찾을 수 없습니다: {}", data_setup_py.display()));
    }

    let python = std::env::var("PYTHON").unwrap_or_else(|_| "python".to_string());
    let mut cmd = Command::new(&python);
    cmd.arg(data_setup_py)
        .arg("--workspace")
        .arg(&args.workspace_path)
        .arg("--game-version")
        .arg(&args.version)
        .arg("--country-code")
        .arg(&args.server)
        .current_dir(&project_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(ref apk) = args.apk_path {
        if !apk.is_empty() {
            cmd.arg("--apk-path").arg(apk);
        }
    }
    if args.force_server_files {
        cmd.arg("--force-server-files");
    }
    if args.force_extract {
        cmd.arg("--force-extract");
    }
    if args.force_download_apk {
        cmd.arg("--force-download-apk");
    }

    let cmd_debug = format!("{:?}", cmd);
    let _ = app.emit("data-setup-log", cmd_debug);

    let mut child = cmd.spawn().map_err(|e| {
        DATA_SETUP_RUNNING.store(false, Ordering::SeqCst);
        e.to_string()
    })?;

    let stdout = child.stdout.take().ok_or("stdout pipe missing")?;
    let stderr = child.stderr.take().ok_or("stderr pipe missing")?;

    let app_stdout = app.clone();
    let app_stderr = app.clone();

    let th_stdout = std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(line) = line {
                let _ = app_stdout.emit("data-setup-log", line);
            }
        }
    });
    let th_stderr = std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(line) = line {
                let _ = app_stderr.emit("data-setup-log", line);
            }
        }
    });

    th_stdout.join().map_err(|_| "stdout thread join failed")?;
    th_stderr.join().map_err(|_| "stderr thread join failed")?;

    let status = child.wait().map_err(|e| {
        DATA_SETUP_RUNNING.store(false, Ordering::SeqCst);
        e.to_string()
    })?;

    DATA_SETUP_RUNNING.store(false, Ordering::SeqCst);
    let code = status.code().unwrap_or(-1);

    if code == 0 {
        let dataset_path = dataset_to_relative_path(&args.server, &args.version);
        let _ = app.emit("data-setup-log", "[매니페스트] 에셋 인덱스 생성 중...");
        match super::sprite::build_manifest(super::sprite::BuildManifestArgs {
            workspace_path: args.workspace_path.clone(),
            dataset_path: dataset_path.clone(),
        }) {
            Ok(r) => {
                let _ = app.emit(
                    "data-setup-log",
                    format!("[매니페스트] {}개 파일 인덱싱 완료", r.file_count),
                );
            }
            Err(e) => {
                let _ = app.emit("data-setup-log", format!("[매니페스트] 오류: {}", e));
            }
        }
    }

    let result = if code == 0 {
        serde_json::json!({
            "exitCode": 0,
            "dataset": {
                "server": args.server,
                "version": args.version,
                "path": dataset_to_relative_path(&args.server, &args.version),
            },
        })
    } else {
        serde_json::json!({ "exitCode": code })
    };
    let _ = app.emit("data-setup-finished", result);
    Ok(())
}

/// 워크스페이스 BCData/apks 아래 데이터 셋 스캔. 각 셋에 대해 팩 추출본(decompiled) 여부 반환.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedDataset {
    pub server: String,
    pub version: String,
    pub path: String,
    pub has_extracted: bool,
    pub has_manifest: bool,
}

#[tauri::command]
pub fn scan_datasets(workspace_path: String) -> Result<Vec<ScannedDataset>, String> {
    let apks_dir = Path::new(&workspace_path).join("BCData").join("apks");
    if !apks_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut result = Vec::new();
    for pkg_entry in apks_dir.read_dir().map_err(|e| e.to_string())? {
        let pkg_entry = pkg_entry.map_err(|e| e.to_string())?;
        if !pkg_entry.path().is_dir() {
            continue;
        }
        let pkg_name = pkg_entry.file_name();
        let pkg_name = pkg_name.to_str().unwrap_or("");

        for version_entry in pkg_entry.path().read_dir().map_err(|e| e.to_string())? {
            let version_entry = version_entry.map_err(|e| e.to_string())?;
            if !version_entry.path().is_dir() {
                continue;
            }
            let version_folder_name = version_entry.file_name();
            let version_folder_name = version_folder_name.to_str().unwrap_or("");
            // 15.1.0kr -> server kr, version 15.1.0
            let mut server = "kr".to_string();
            let mut version = version_folder_name.to_string();
            for (code, _) in PACKAGE_BY_SERVER {
                if version_folder_name.ends_with(code) {
                    server = code.to_string();
                    version = version_folder_name[..version_folder_name.len() - code.len()].to_string();
                    break;
                }
            }
            let rel_path = format!("BCData/apks/{}/{}", pkg_name, version_folder_name);
            let decompiled_dir = version_entry.path().join("decompiled");
            let has_extracted = decompiled_dir.is_dir();
            let has_manifest = decompiled_dir.join("_manifest.json").is_file();

            result.push(ScannedDataset {
                server,
                version,
                path: rel_path,
                has_extracted,
                has_manifest,
            });
        }
    }
    result.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(result)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractPacksArgs {
    pub workspace_path: String,
    pub server: String,
    pub version: String,
}

/// 기존 버전 폴더의 팩만 decompiled/ 로 추출. 로그는 data-setup-log로 전달.
#[tauri::command]
pub async fn extract_packs(app: AppHandle, args: ExtractPacksArgs) -> Result<(), String> {
    if DATA_SETUP_RUNNING.swap(true, Ordering::SeqCst) {
        return Err("이미 실행 중입니다.".to_string());
    }

    let project_root = find_project_root()?;
    let data_setup_py = project_root
        .join("src-tauri")
        .join("scripts")
        .join("data_setup.py");
    if !data_setup_py.exists() {
        DATA_SETUP_RUNNING.store(false, Ordering::SeqCst);
        return Err(format!("data_setup.py를 찾을 수 없습니다: {}", data_setup_py.display()));
    }

    let python = std::env::var("PYTHON").unwrap_or_else(|_| "python".to_string());
    let mut cmd = Command::new(&python);
    cmd.arg(&data_setup_py)
        .arg("--extract-packs-only")
        .arg("--workspace")
        .arg(&args.workspace_path)
        .arg("--country-code")
        .arg(&args.server)
        .arg("--game-version")
        .arg(&args.version)
        .current_dir(&project_root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let _ = app.emit("data-setup-log", "[팩 추출] 실행 중...");

    let mut child = cmd.spawn().map_err(|e| {
        DATA_SETUP_RUNNING.store(false, Ordering::SeqCst);
        e.to_string()
    })?;

    let stdout = child.stdout.take().ok_or("stdout pipe missing")?;
    let stderr = child.stderr.take().ok_or("stderr pipe missing")?;

    let app_stdout = app.clone();
    let app_stderr = app.clone();

    let th_stdout = std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(line) = line {
                let _ = app_stdout.emit("data-setup-log", line);
            }
        }
    });
    let th_stderr = std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            if let Ok(line) = line {
                let _ = app_stderr.emit("data-setup-log", line);
            }
        }
    });

    th_stdout.join().map_err(|_| "stdout thread join failed")?;
    th_stderr.join().map_err(|_| "stderr thread join failed")?;

    let status = child.wait().map_err(|e| {
        DATA_SETUP_RUNNING.store(false, Ordering::SeqCst);
        e.to_string()
    })?;

    DATA_SETUP_RUNNING.store(false, Ordering::SeqCst);
    let code = status.code().unwrap_or(-1);

    if code == 0 {
        let dataset_path = dataset_to_relative_path(&args.server, &args.version);
        let _ = app.emit("data-setup-log", "[매니페스트] 에셋 인덱스 생성 중...");
        match super::sprite::build_manifest(super::sprite::BuildManifestArgs {
            workspace_path: args.workspace_path.clone(),
            dataset_path,
        }) {
            Ok(r) => {
                let _ = app.emit(
                    "data-setup-log",
                    format!("[매니페스트] {}개 파일 인덱싱 완료", r.file_count),
                );
            }
            Err(e) => {
                let _ = app.emit("data-setup-log", format!("[매니페스트] 오류: {}", e));
            }
        }
    }

    let _ = app.emit("data-setup-finished", serde_json::json!({ "exitCode": code, "dataset": null }));
    Ok(())
}
