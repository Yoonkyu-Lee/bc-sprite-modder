//! 한 프레임 분의 그리기 데이터 생성 (GL 없이 데이터만, 프론트 캔버스용).

use crate::viewport::anim::skeleton;
use crate::viewport::anim::state::AnimState;
use crate::viewport::parse::imgcut::Rect;
use crate::viewport::parse::mamodel::Ints;

/// 한 파츠: 텍스처 rect + 월드 좌표 4꼭짓점 + 알파/가법. 캔버스 setTransform + drawImage용.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PartDraw {
    /// 텍스처 내 사각형 (픽셀)
    pub rect: [i32; 4],
    /// 월드 좌표 4꼭짓점 (x0,y0, x1,y1, x2,y2, x3,y3) — 캔버스 변환 행렬 계산용
    pub corners: [f32; 8],
    pub alpha: f32,
    pub additive: bool,
}

/// 한 프레임의 모든 파츠 (z-order 적용됨)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FrameDrawData {
    pub parts: Vec<PartDraw>,
}

/// 현재 state 기준으로 한 프레임 분의 PartDraw 목록 생성.
/// vp_w, vp_h: 뷰포트 크기(픽셀). zoom=1, offset=0 가정.
pub fn build_frame_draw_data(
    state: &AnimState,
    imgcut_rects: &[Rect],
    ints: &[Ints],
    _tex_w: f32,
    _tex_h: f32,
    vp_w: f32,
    vp_h: f32,
) -> FrameDrawData {
    let center_x = (vp_w / 2.0) as f64;
    let center_y = (vp_h / 2.0) as f64;
    let base = 10.0_f64;
    let scale_unit = state.scale_unit as f64;
    let angle_unit = state.angle_unit as f64;
    let alpha_unit = state.alpha_unit as f64;

    let mut parts = Vec::new();
    for &idx in &state.sorted_indices {
        let p = &state.parts[idx];
        if p.parent_id < 0 || p.unit_id < 0 {
            continue;
        }
        let cut_id = p.cut_id;
        if cut_id < 0 || cut_id as usize >= imgcut_rects.len() {
            continue;
        }
        let rect = &imgcut_rects[cut_id as usize];
        if rect.w == 0 || rect.h == 0 {
            continue;
        }

        let (matrix, part_scale_x, part_scale_y) = skeleton::build_part_transform(
            &state.parts,
            idx,
            base,
            base,
            scale_unit,
            angle_unit,
            ints,
        );
        let scx_bx = part_scale_x * base;
        let scy_by = part_scale_y * base;
        let flip_x: f64 = if part_scale_x < 0.0 { -1.0 } else { 1.0 };
        let flip_y: f64 = if part_scale_y < 0.0 { -1.0 } else { 1.0 };
        let t_piv_x = p.pivot_x as f64 * scx_bx * flip_x;
        let t_piv_y = p.pivot_y as f64 * scy_by * flip_y;
        let m0 = matrix[0] * flip_x;
        let m3 = matrix[3] * flip_x;
        let m1 = matrix[1] * flip_y;
        let m4 = matrix[4] * flip_y;
        let m2 = matrix[2];
        let m5 = matrix[5];
        let sc_w = (rect.w as f64 * scx_bx).abs();
        let sc_h = (rect.h as f64 * scy_by).abs();
        let local_x = -t_piv_x;
        let local_y = -t_piv_y;
        let corners_world: [(f32, f32); 4] = [
            ((m0 * local_x + m1 * local_y + m2 + center_x) as f32, (m3 * local_x + m4 * local_y + m5 + center_y) as f32),
            ((m0 * (local_x + sc_w) + m1 * local_y + m2 + center_x) as f32, (m3 * (local_x + sc_w) + m4 * local_y + m5 + center_y) as f32),
            ((m0 * (local_x + sc_w) + m1 * (local_y + sc_h) + m2 + center_x) as f32, (m3 * (local_x + sc_w) + m4 * (local_y + sc_h) + m5 + center_y) as f32),
            ((m0 * local_x + m1 * (local_y + sc_h) + m2 + center_x) as f32, (m3 * local_x + m4 * (local_y + sc_h) + m5 + center_y) as f32),
        ];
        let alpha = (skeleton::get_recursive_alpha(&state.parts, idx, alpha_unit).clamp(0.0, 1.0)) as f32;
        let additive = p.glow != 0;

        parts.push(PartDraw {
            rect: [rect.x, rect.y, rect.w, rect.h],
            corners: [
                corners_world[0].0, corners_world[0].1,
                corners_world[1].0, corners_world[1].1,
                corners_world[2].0, corners_world[2].1,
                corners_world[3].0, corners_world[3].1,
            ],
            alpha,
            additive,
        });
    }
    FrameDrawData { parts }
}
