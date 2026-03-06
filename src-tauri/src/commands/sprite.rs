use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use regex::Regex;
use walkdir::WalkDir;

const FORM_LABELS: &[(&str, &str)] = &[
    ("f", "1폼"),
    ("c", "2폼"),
    ("s", "3폼"),
    ("u", "4폼"),
    ("e", "광란"),
];

// ── 매니페스트 구조 ──────────────────────────────────────────────────

/// 매니페스트 파일 항목 (사전 파싱 완료)
#[derive(Serialize, Deserialize, Clone)]
pub struct ManifestFileEntry {
    pub name: String,
    pub rel_path: String,
    pub unit_id: Option<String>,
    pub form: Option<String>,
    pub kind: String,
}

/// 매니페스트 유닛·폼 요약 (list_unit_forms용)
#[derive(Serialize, Deserialize, Clone)]
pub struct ManifestUnitForm {
    pub unit_id: String,
    pub form: String,
    pub form_label: String,
    pub display: String,
    pub is_enraged: bool,
}

/// 매니페스트 전체
#[derive(Serialize, Deserialize)]
struct Manifest {
    file_count: usize,
    unit_form_count: usize,
    files: Vec<ManifestFileEntry>,
    unit_forms: Vec<ManifestUnitForm>,
}

const MANIFEST_FILE: &str = "_manifest.json";

// ── 경로 유틸 ────────────────────────────────────────────────────────

fn get_decompiled_dir(workspace_path: &Path, project_dir: &Path) -> Result<PathBuf, String> {
    let project_json_path = project_dir.join("project.json");
    let content = fs::read_to_string(&project_json_path)
        .map_err(|e| format!("project.json 읽기 실패: {}", e))?;
    let meta: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("project.json 파싱 실패: {}", e))?;
    let dataset = meta.get("dataset").and_then(|d| d.as_object());
    let rel_path: String = dataset
        .and_then(|d| d.get("path").and_then(|p| p.as_str()).map(String::from))
        .or_else(|| {
            let server = dataset
                .and_then(|d| d.get("server").and_then(|s| s.as_str()))
                .unwrap_or("kr");
            let version = dataset
                .and_then(|d| d.get("version").and_then(|v| v.as_str()))
                .unwrap_or("15.1.0");
            let pkg = match server {
                "jp" => "jp.co.ponos.battlecats",
                "en" => "jp.co.ponos.battlecatsen",
                "tw" => "jp.co.ponos.battlecatstw",
                _ => "jp.co.ponos.battlecatskr",
            };
            Some(format!("BCData/apks/{pkg}/{version}{server}"))
        })
        .ok_or("dataset 경로를 찾을 수 없습니다.")?;
    let decompiled = workspace_path.join(rel_path.replace('\\', "/")).join("decompiled");
    if !decompiled.exists() || !decompiled.is_dir() {
        return Err(format!(
            "decompiled 폴더가 없습니다. [데이터 준비] 탭에서 '팩 추출'을 실행하세요. (경로: {})",
            decompiled.display()
        ));
    }
    Ok(decompiled.canonicalize().unwrap_or(decompiled))
}

fn get_decompiled_dir_from_dataset_path(workspace_path: &Path, dataset_rel_path: &str) -> PathBuf {
    workspace_path
        .join(dataset_rel_path.replace('\\', "/"))
        .join("decompiled")
}

// ── 파일명 파싱 (build_manifest 시 1회만 실행) ───────────────────────

struct UnitFormPatterns {
    patterns: Vec<(Regex, bool)>,
}

impl UnitFormPatterns {
    fn new() -> Self {
        let raw: &[(&str, bool)] = &[
            (r"^(\d+)_([fcsu])\.(imgcut|mamodel)$", false),
            (r"^(\d+)_e\.(imgcut|mamodel)$", true),
            (r"^(\d+)_([fcsu])\d+\.maanim$", false),
            (r"^(\d+)_e\d+\.maanim$", true),
            (r"^uni(\d+)_([fcsu])\d*\.png$", false),
            (r"^uni(\d+)_e\d*\.png$", true),
            (r"^udi(\d+)_([fcsu])\.png$", false),
            (r"^udi(\d+)_e\.png$", true),
            (r"^(\d+)_([fcsu])\.png$", false),
            (r"^(\d+)_e\.png$", true),
        ];
        let patterns = raw
            .iter()
            .filter_map(|&(p, is_e)| Regex::new(p).ok().map(|r| (r, is_e)))
            .collect();
        UnitFormPatterns { patterns }
    }

    fn parse(&self, name: &str) -> Option<(String, String)> {
        let n = name.to_lowercase();
        for (re, is_e) in &self.patterns {
            if let Some(caps) = re.captures(&n) {
                let uid = caps[1].to_string();
                let form = if *is_e { "e".to_string() } else { caps[2].to_string() };
                return Some((uid, form));
            }
        }
        None
    }
}

fn compute_asset_kind(name: &str) -> &'static str {
    let n = name.to_lowercase();
    if n.ends_with(".imgcut") { return "imgcut"; }
    if n.ends_with(".mamodel") { return "mamodel"; }
    if n.ends_with(".maanim") { return "maanim"; }
    if n.starts_with("udi") { return "아이콘"; }
    if n.starts_with("uni") { return "스프라이트"; }
    lazy_static_like_check(&n)
}

fn lazy_static_like_check(n: &str) -> &'static str {
    if let Ok(re) = Regex::new(r"^\d+_[fcsue]\.png$") {
        if re.is_match(n) { return "번호"; }
    }
    "기타"
}

// ── 매니페스트 빌드 / 읽기 ───────────────────────────────────────────

fn build_manifest_for_dir(decompiled_dir: &Path) -> Result<usize, String> {
    if !decompiled_dir.is_dir() {
        return Err(format!("decompiled 폴더가 없습니다: {}", decompiled_dir.display()));
    }

    let patterns = UnitFormPatterns::new();
    let mut files: Vec<ManifestFileEntry> = Vec::new();

    for entry in WalkDir::new(decompiled_dir)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !path.is_file() { continue; }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if name == MANIFEST_FILE { continue; }
        let rel = path
            .strip_prefix(decompiled_dir)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        let parsed = patterns.parse(&name);
        let kind = compute_asset_kind(&name).to_string();
        files.push(ManifestFileEntry {
            name,
            rel_path: rel,
            unit_id: parsed.as_ref().map(|(u, _)| u.clone()),
            form: parsed.as_ref().map(|(_, f)| f.clone()),
            kind,
        });
    }
    files.sort_by(|a, b| a.name.cmp(&b.name));

    let mut seen: HashSet<(String, String)> = HashSet::new();
    let mut unit_forms: Vec<ManifestUnitForm> = Vec::new();
    for f in &files {
        if let (Some(uid), Some(form)) = (&f.unit_id, &f.form) {
            if seen.insert((uid.clone(), form.clone())) {
                let form_label = FORM_LABELS
                    .iter()
                    .find(|(k, _)| *k == form.as_str())
                    .map(|(_, v)| v.to_string())
                    .unwrap_or_else(|| form.clone());
                let is_enraged = form == "e";
                let display = format!("{uid} ({form_label})");
                unit_forms.push(ManifestUnitForm {
                    unit_id: uid.clone(),
                    form: form.clone(),
                    form_label,
                    display,
                    is_enraged,
                });
            }
        }
    }
    unit_forms.sort_by(|a, b| {
        let a_num: u32 = a.unit_id.parse().unwrap_or(0);
        let b_num: u32 = b.unit_id.parse().unwrap_or(0);
        (a_num, a.form.as_str()).cmp(&(b_num, b.form.as_str()))
    });

    let file_count = files.len();
    let unit_form_count = unit_forms.len();
    let manifest = Manifest { file_count, unit_form_count, files, unit_forms };
    let json = serde_json::to_string(&manifest).map_err(|e| e.to_string())?;
    fs::write(decompiled_dir.join(MANIFEST_FILE), json).map_err(|e| e.to_string())?;
    Ok(file_count)
}

fn load_manifest(decompiled_dir: &Path) -> Result<Manifest, String> {
    let manifest_path = decompiled_dir.join(MANIFEST_FILE);
    if !manifest_path.exists() {
        return Err(
            "에셋 인덱스(_manifest.json)가 없습니다. [데이터 준비] 탭에서 '팩 추출' 후 '인덱스 생성'을 실행하세요."
                .to_string(),
        );
    }
    let t0 = std::time::Instant::now();
    let content = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("_manifest.json 읽기 실패: {}", e))?;
    let read_ms = t0.elapsed().as_millis();
    let t1 = std::time::Instant::now();
    let manifest: Manifest =
        serde_json::from_str(&content).map_err(|e| format!("_manifest.json 파싱 실패: {}", e))?;
    let parse_ms = t1.elapsed().as_millis();
    eprintln!(
        "[manifest] 로드 완료: {}개 파일, {}개 유닛·폼 (읽기 {}ms + 파싱 {}ms = {}ms)",
        manifest.file_count,
        manifest.unit_form_count,
        read_ms,
        parse_ms,
        read_ms + parse_ms
    );
    Ok(manifest)
}

// ── Tauri 커맨드: build_manifest ──────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildManifestArgs {
    pub workspace_path: String,
    pub dataset_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildManifestResult {
    pub file_count: usize,
}

#[tauri::command]
pub fn build_manifest(args: BuildManifestArgs) -> Result<BuildManifestResult, String> {
    let decompiled = get_decompiled_dir_from_dataset_path(
        Path::new(&args.workspace_path),
        &args.dataset_path,
    );
    eprintln!("[build_manifest] 시작: {}", decompiled.display());
    let t0 = std::time::Instant::now();
    let count = build_manifest_for_dir(&decompiled)?;
    let elapsed = t0.elapsed();
    eprintln!(
        "[build_manifest] 완료: {}개 파일 인덱싱 ({}ms) → {}",
        count,
        elapsed.as_millis(),
        decompiled.join(MANIFEST_FILE).display()
    );
    Ok(BuildManifestResult { file_count: count })
}

// ── Tauri 커맨드: list_unit_forms ─────────────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct UnitFormEntry {
    pub unit_id: String,
    pub form: String,
    pub form_label: String,
    pub display: String,
    pub is_enraged: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListUnitFormsArgs {
    pub workspace_path: String,
    pub project_dir: String,
}

#[tauri::command]
pub fn list_unit_forms(args: ListUnitFormsArgs) -> Result<Vec<UnitFormEntry>, String> {
    let t0 = std::time::Instant::now();
    eprintln!("[list_unit_forms] 호출됨");
    let workspace_path = Path::new(&args.workspace_path);
    let project_dir = Path::new(&args.project_dir);
    let decompiled = get_decompiled_dir(workspace_path, project_dir)?;
    let manifest = load_manifest(&decompiled)?;

    let result: Vec<UnitFormEntry> = manifest
        .unit_forms
        .into_iter()
        .map(|uf| UnitFormEntry {
            unit_id: uf.unit_id,
            form: uf.form,
            form_label: uf.form_label,
            display: uf.display,
            is_enraged: uf.is_enraged,
        })
        .collect();

    let elapsed = t0.elapsed();
    eprintln!(
        "[list_unit_forms] 반환: {}개 유닛·폼 (총 {}ms)",
        result.len(),
        elapsed.as_millis()
    );
    Ok(result)
}

// ── Tauri 커맨드: load_form_assets ────────────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct FormAssetEntry {
    pub name: String,
    pub kind: String,
}

#[derive(Serialize, Deserialize)]
pub struct LoadFormAssetsResult {
    pub unit_id: String,
    pub form: String,
    pub assets: Vec<FormAssetEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadFormAssetsArgs {
    pub workspace_path: String,
    pub project_dir: String,
    pub unit_id: String,
    pub form: String,
}

#[tauri::command]
pub fn load_form_assets(args: LoadFormAssetsArgs) -> Result<LoadFormAssetsResult, String> {
    let t0 = std::time::Instant::now();
    eprintln!(
        "[load_form_assets] 호출됨 unit_id={} form={}",
        args.unit_id, args.form
    );
    let workspace_path = Path::new(&args.workspace_path);
    let project_dir = Path::new(&args.project_dir);
    let decompiled = get_decompiled_dir(workspace_path, project_dir)?;
    let manifest = load_manifest(&decompiled)?;

    let t_filter = std::time::Instant::now();
    let mut assets: Vec<FormAssetEntry> = Vec::new();
    let mut seen = HashSet::new();
    for f in &manifest.files {
        let matches = f.unit_id.as_deref() == Some(&args.unit_id)
            && f.form.as_deref() == Some(&args.form);
        if matches && seen.insert(f.name.clone()) {
            assets.push(FormAssetEntry {
                name: f.name.clone(),
                kind: f.kind.clone(),
            });
        }
    }
    assets.sort_by(|a, b| (a.kind.as_str(), a.name.as_str()).cmp(&(b.kind.as_str(), b.name.as_str())));
    let filter_ms = t_filter.elapsed().as_millis();

    let elapsed = t0.elapsed();
    eprintln!(
        "[load_form_assets] {}_{} — {}개 에셋 (필터 {}ms, 총 {}ms)",
        args.unit_id, args.form, assets.len(), filter_ms, elapsed.as_millis()
    );
    for a in &assets {
        eprintln!("  {} [{}]", a.name, a.kind);
    }

    Ok(LoadFormAssetsResult {
        unit_id: args.unit_id,
        form: args.form,
        assets,
    })
}

// ── Tauri 커맨드: extract_viewport_assets ─────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct ExtractViewportAssetsResult {
    pub extract_dir: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractViewportAssetsArgs {
    pub workspace_path: String,
    pub project_dir: String,
    pub unit_id: String,
    pub form: String,
}

#[tauri::command]
pub fn extract_viewport_assets(
    args: ExtractViewportAssetsArgs,
) -> Result<ExtractViewportAssetsResult, String> {
    let t0 = std::time::Instant::now();
    eprintln!(
        "[extract_viewport_assets] 호출됨 unit_id={} form={}",
        args.unit_id, args.form
    );
    let workspace_path = Path::new(&args.workspace_path);
    let project_dir = Path::new(&args.project_dir);
    let decompiled = get_decompiled_dir(workspace_path, project_dir)?;
    let manifest = load_manifest(&decompiled)?;

    let out_dir = Path::new(&args.workspace_path)
        .join(".cache")
        .join("viewport")
        .join(format!("{}_{}", args.unit_id, args.form));
    fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

    let t_copy = std::time::Instant::now();
    let mut written = 0usize;
    let mut seen = HashSet::new();
    for f in &manifest.files {
        let matches = f.unit_id.as_deref() == Some(&args.unit_id)
            && f.form.as_deref() == Some(&args.form);
        if matches && seen.insert(f.name.clone()) {
            let src = decompiled.join(&f.rel_path);
            let dst = out_dir.join(&f.name);
            if src.exists() {
                fs::copy(&src, &dst).map_err(|err| {
                    format!("파일 복사 실패 {} → {}: {}", src.display(), dst.display(), err)
                })?;
                written += 1;
                eprintln!("  복사: {} → {}", f.rel_path, f.name);
            }
        }
    }
    let copy_ms = t_copy.elapsed().as_millis();
    let elapsed = t0.elapsed();
    eprintln!(
        "[extract_viewport_assets] {}_{} — {}개 파일 복사 (복사 {}ms, 총 {}ms) → {}",
        args.unit_id, args.form, written, copy_ms, elapsed.as_millis(), out_dir.display()
    );

    Ok(ExtractViewportAssetsResult {
        extract_dir: out_dir.to_string_lossy().to_string(),
    })
}

// ── 뷰포트 메타/재생 ─────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetViewportMetaArgs {
    pub extract_dir: String,
}

#[tauri::command]
pub fn get_viewport_meta(args: GetViewportMetaArgs) -> Result<crate::viewport::ViewportMeta, String> {
    let path = std::path::Path::new(&args.extract_dir);
    let (_imgcut, _model, _state, meta, _png) =
        crate::viewport::load_from_extract_dir(path)?;
    eprintln!(
        "[get_viewport_meta] parts={} anims={} frames={}",
        meta.part_count, meta.anim_count, meta.total_frames
    );
    Ok(meta)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetViewportPlaybackDataArgs {
    pub extract_dir: String,
    pub anim_index: Option<usize>,
    pub viewport_width: Option<f32>,
    pub viewport_height: Option<f32>,
}

#[tauri::command]
pub fn get_viewport_playback_data(
    args: GetViewportPlaybackDataArgs,
) -> Result<crate::viewport::ViewportPlaybackData, String> {
    let path = std::path::Path::new(&args.extract_dir);
    let anim_index = args.anim_index.unwrap_or(0);
    let vp_w = args.viewport_width.unwrap_or(400.0);
    let vp_h = args.viewport_height.unwrap_or(400.0);

    let t0 = std::time::Instant::now();
    let data = crate::viewport::build_playback_data(path, anim_index, vp_w, vp_h)?;
    let elapsed = t0.elapsed();
    eprintln!(
        "[get_viewport_playback_data] anim={} frames={} tex={}x{} — {:.0}ms",
        anim_index, data.frames.len(), data.texture_width, data.texture_height,
        elapsed.as_secs_f64() * 1000.0
    );
    Ok(data)
}
