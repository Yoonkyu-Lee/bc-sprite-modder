use crate::viewport::anim::state::PartAnim;
use crate::viewport::parse::mamodel::Ints;

pub type Mat2x3 = [f64; 6];

#[allow(dead_code)]
pub fn identity() -> Mat2x3 {
    [1.0, 0.0, 0.0, 0.0, 1.0, 0.0]
}

pub fn build_part_transform(
    parts: &[PartAnim],
    part_idx: usize,
    sizer_x: f64,
    sizer_y: f64,
    scale_unit: f64,
    angle_unit: f64,
    ints: &[Ints],
) -> (Mat2x3, f64, f64) {
    let initial = [0.1, 0.0, 0.0, 0.0, 0.1, 0.0];
    transform_inner(
        parts,
        part_idx,
        initial,
        sizer_x,
        sizer_y,
        scale_unit,
        angle_unit,
        ints,
    )
}

fn transform_inner(
    parts: &[PartAnim],
    part_idx: usize,
    mut matrix: Mat2x3,
    sizer_x: f64,
    sizer_y: f64,
    scale_unit: f64,
    angle_unit: f64,
    ints: &[Ints],
) -> (Mat2x3, f64, f64) {
    let p = &parts[part_idx];
    let mut siz_x = sizer_x;
    let mut siz_y = sizer_y;

    let (part_scale_x, part_scale_y) = get_recursive_scale(parts, part_idx);

    let parent_id = p.parent_id;
    if parent_id >= 0 && (parent_id as usize) < parts.len() {
        let (m, _, _) = transform_inner(
            parts,
            parent_id as usize,
            matrix,
            sizer_x,
            sizer_y,
            scale_unit,
            angle_unit,
            ints,
        );
        matrix = m;

        let real_sx = p.real_scale_x as f64;
        let real_sy = p.real_scale_y as f64;
        let sx = if real_sx == 0.0 {
            0.0
        } else {
            part_scale_x / real_sx
        };
        let sy = if real_sy == 0.0 {
            0.0
        } else {
            part_scale_y / real_sy
        };
        siz_x = sx * sizer_x;
        siz_y = sy * sizer_y;
    }

    let [m0, m1, mut m2, m3, m4, mut m5] = matrix;

    if p.part_id != 0 {
        let t_pos_x = p.x as f64 * siz_x;
        let t_pos_y = p.y as f64 * siz_y;
        m2 += m0 * t_pos_x + m1 * t_pos_y;
        m5 += m3 * t_pos_x + m4 * t_pos_y;
    } else {
        if let Some(int_data) = ints.first() {
            let (p0_x, p0_y) =
                get_base_size(parts, part_idx, false, int_data.part_id, scale_unit);
            let shi_x = int_data.x as f64 * p0_x;
            let shi_y = int_data.y as f64 * p0_y;
            let p3_x = shi_x * sizer_x;
            let p3_y = shi_y * sizer_y;
            let px = p.pivot_x as f64 * part_scale_x * sizer_x;
            let py = p.pivot_y as f64 * part_scale_y * sizer_y;
            let x = px - p3_x;
            let y = py - p3_y;
            m2 += m0 * x + m1 * y;
            m5 += m3 * x + m4 * y;
        }
    }

    let mut out_m0 = m0;
    let mut out_m1 = m1;
    let mut out_m3 = m3;
    let mut out_m4 = m4;

    if p.rotation != 0 {
        let degrees = (p.rotation as f64 / angle_unit) * 360.0;
        let radians = degrees.to_radians();
        let sin = radians.sin();
        let cos = radians.cos();
        let f = m0 * cos + m1 * sin;
        let f2 = m0 * (-sin) + m1 * cos;
        let f3 = m3 * cos + m4 * sin;
        let f4 = m3 * (-sin) + m4 * cos;
        out_m0 = f;
        out_m1 = f2;
        out_m3 = f3;
        out_m4 = f4;
    }

    ([out_m0, out_m1, m2, out_m3, out_m4, m5], part_scale_x, part_scale_y)
}

fn get_recursive_scale(parts: &[PartAnim], part_idx: usize) -> (f64, f64) {
    get_recursive_scale_inner(parts, part_idx, 1.0, 1.0)
}

fn get_recursive_scale_inner(
    parts: &[PartAnim],
    part_idx: usize,
    sx: f64,
    sy: f64,
) -> (f64, f64) {
    let p = &parts[part_idx];
    let new_sx = sx * p.real_scale_x as f64;
    let new_sy = sy * p.real_scale_y as f64;
    let pid = p.parent_id;
    if pid >= 0 && (pid as usize) < parts.len() {
        get_recursive_scale_inner(parts, pid as usize, new_sx, new_sy)
    } else {
        (new_sx, new_sy)
    }
}

pub fn get_recursive_alpha(parts: &[PartAnim], part_idx: usize, alpha_unit: f64) -> f64 {
    get_recursive_alpha_inner(parts, part_idx, 1.0, alpha_unit)
}

fn get_recursive_alpha_inner(
    parts: &[PartAnim],
    part_idx: usize,
    current: f64,
    alpha_unit: f64,
) -> f64 {
    let p = &parts[part_idx];
    let a = current * (p.alpha as f64 / alpha_unit);
    let pid = p.parent_id;
    if pid >= 0 && (pid as usize) < parts.len() {
        get_recursive_alpha_inner(parts, pid as usize, a, alpha_unit)
    } else {
        a
    }
}

fn get_base_size(
    parts: &[PartAnim],
    part_idx: usize,
    parent: bool,
    int_part_id: i32,
    scale_unit: f64,
) -> (f64, f64) {
    let p = &parts[part_idx];
    let signum_x: f64 = if p.scale_x >= 0 { 1.0 } else { -1.0 };
    let signum_y: f64 = if p.scale_y >= 0 { 1.0 } else { -1.0 };

    if parent {
        let pid = p.parent_id;
        if pid >= 0 && (pid as usize) < parts.len() {
            let (sx, sy) = get_base_size(parts, pid as usize, true, int_part_id, scale_unit);
            return (sx * signum_x, sy * signum_y);
        }
        return (signum_x, signum_y);
    }

    if int_part_id == -1 || int_part_id == p.part_id as i32 {
        return (p.x as f64 / scale_unit, p.y as f64 / scale_unit);
    }

    let ip = int_part_id as usize;
    if ip < parts.len() {
        let (sx, sy) = get_base_size(parts, ip, true, int_part_id, scale_unit);
        let rx = sx * p.x as f64 / scale_unit;
        let ry = sy * p.y as f64 / scale_unit;
        return (rx * signum_x, ry * signum_y);
    }
    (p.x as f64 / scale_unit, p.y as f64 / scale_unit)
}
