//! Python이 추출한 경로(extract_dir)에서 imgcut/mamodel/maanim/PNG를 읽어 뷰포트 메타·재생 데이터 생성.

use base64::Engine;

mod anim;
mod draw_data;
mod parse;

pub use draw_data::{build_frame_draw_data, FrameDrawData};

use std::path::Path;

use parse::imgcut::ImgCut;
use parse::mamodel::MaModel;
use parse::maanim::MaAnim;
use anim::state::AnimState;

/// 추출 디렉터리에서 로드한 뷰포트 메타. (텍스처/프레임 draw 데이터는 추후 확장)
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct ViewportMeta {
    pub part_count: usize,
    pub anim_count: usize,
    pub total_frames: i32,
    pub imgcut_rect_count: usize,
    pub texture_width: u32,
    pub texture_height: u32,
}

/// Python extract_form_assets.py가 추출한 디렉터리 경로에서 파일을 찾아 파싱하고 AnimState를 구성.
/// 반환: (imgcut, mamodel, anim_state, 메타, png_path).
pub fn load_from_extract_dir(extract_dir: &Path) -> Result<(ImgCut, MaModel, AnimState, ViewportMeta, std::path::PathBuf), String> {
    let extract_dir = extract_dir
        .canonicalize()
        .map_err(|e| format!("extract_dir 접근 실패: {}", e))?;

    // *.imgcut, *.mamodel, *.maanim, *.png 찾기 (동일 stem 기준)
    let mut imgcut_path: Option<std::path::PathBuf> = None;
    let mut mamodel_path: Option<std::path::PathBuf> = None;
    let mut png_path: Option<std::path::PathBuf> = None;
    let mut maanim_paths: Vec<std::path::PathBuf> = Vec::new();

    for e in std::fs::read_dir(&extract_dir).map_err(|e| format!("디렉터리 읽기: {}", e))? {
        let e = e.map_err(|e| format!("read_dir: {}", e))?;
        let p = e.path();
        let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("");
        let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
        match ext.to_lowercase().as_str() {
            "imgcut" => {
                if imgcut_path.is_none() {
                    imgcut_path = Some(p.clone());
                }
            }
            "mamodel" => {
                if mamodel_path.is_none() {
                    mamodel_path = Some(p.clone());
                }
            }
            "png" => {
                if !name.starts_with("uni") && !name.starts_with("udi") {
                    if png_path.is_none() {
                        png_path = Some(p.clone());
                    }
                }
            }
            "maanim" => maanim_paths.push(p),
            _ => {}
        }
    }

    let imgcut_path = imgcut_path.ok_or("추출 디렉터리에 .imgcut 파일이 없습니다.")?;
    let mamodel_path = mamodel_path.ok_or("추출 디렉터리에 .mamodel 파일이 없습니다.")?;
    let png_path_buf = png_path.ok_or("추출 디렉터리에 애니용 .png 파일이 없습니다.")?;
    maanim_paths.sort();

    let imgcut = ImgCut::from_file(&imgcut_path)?;
    let model = MaModel::from_file(&mamodel_path)?;
    let anims: Vec<MaAnim> = maanim_paths
        .iter()
        .map(|p| MaAnim::from_file(p))
        .collect::<Result<Vec<_>, _>>()?;
    if anims.is_empty() {
        return Err("추출 디렉터리에 .maanim 파일이 없습니다.".into());
    }

    let state = AnimState::new(&model, anims.clone());
    let total_frames = state.total_frames;
    let anim_count = state.anims.len();
    let part_count = state.total_parts;
    let imgcut_rect_count = imgcut.rects.len();

    let (texture_width, texture_height) = read_png_dimensions(&png_path_buf).unwrap_or((0, 0));

    Ok((
        imgcut,
        model,
        state,
        ViewportMeta {
            part_count,
            anim_count,
            total_frames,
            imgcut_rect_count,
            texture_width,
            texture_height,
        },
        png_path_buf,
    ))
}

/// 재생용: 한 애니메이션의 모든 프레임에 대한 draw 데이터 + PNG base64.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewportPlaybackData {
    pub texture_base64: String,
    pub texture_width: u32,
    pub texture_height: u32,
    pub frames: Vec<FrameDrawData>,
    pub total_frames: i32,
    pub anim_count: usize,
}

/// extract_dir에서 로드 후, 지정 애니(anim_index)의 전체 프레임 draw 데이터와 PNG base64 반환.
pub fn build_playback_data(
    extract_dir: &Path,
    anim_index: usize,
    vp_w: f32,
    vp_h: f32,
) -> Result<ViewportPlaybackData, String> {
    let (imgcut, model, mut state, meta, png_path) = load_from_extract_dir(extract_dir)?;
    if anim_index >= state.anims.len() {
        return Err(format!("anim_index {} >= anim_count {}", anim_index, state.anims.len()));
    }
    state.set_anim(anim_index);
    let tex_w = meta.texture_width as f32;
    let tex_h = meta.texture_height as f32;
    if tex_w <= 0.0 || tex_h <= 0.0 {
        return Err("텍스처 크기를 알 수 없습니다.".into());
    }

    let mut frames = Vec::with_capacity(state.total_frames as usize);
    for f in 0..state.total_frames {
        state.frame = f;
        state.apply_frame();
        let frame_data = build_frame_draw_data(
            &state,
            &imgcut.rects,
            &model.ints,
            tex_w,
            tex_h,
            vp_w,
            vp_h,
        );
        frames.push(frame_data);
    }

    let png_bytes = std::fs::read(&png_path).map_err(|e| format!("PNG 읽기: {}", e))?;
    let texture_base64 = base64::engine::general_purpose::STANDARD.encode(&png_bytes);

    Ok(ViewportPlaybackData {
        texture_base64,
        texture_width: meta.texture_width,
        texture_height: meta.texture_height,
        frames,
        total_frames: state.total_frames,
        anim_count: meta.anim_count,
    })
}

/// PNG 파일에서 width/height만 읽기 (시그니처 + IHDR).
fn read_png_dimensions(path: &Path) -> Result<(u32, u32), String> {
    let buf = std::fs::read(path).map_err(|e| format!("PNG 읽기: {}", e))?;
    if buf.len() < 24 {
        return Err("PNG 파일이 너무 짧습니다.".into());
    }
    let sig: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    if buf[0..8] != sig {
        return Err("PNG 시그니처가 아닙니다.".into());
    }
    let mut i = 8usize;
    while i + 12 <= buf.len() {
        let len = u32::from_be_bytes([buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]) as usize;
        let chunk = &buf[i + 4..i + 8];
        if chunk == b"IHDR" && len >= 8 && i + 8 + len + 4 <= buf.len() {
            let w = u32::from_be_bytes([buf[i + 8], buf[i + 9], buf[i + 10], buf[i + 11]]);
            let h = u32::from_be_bytes([buf[i + 12], buf[i + 13], buf[i + 14], buf[i + 15]]);
            return Ok((w, h));
        }
        i += 4 + 4 + len + 4;
    }
    Err("PNG IHDR 청크를 찾을 수 없습니다.".into())
}
