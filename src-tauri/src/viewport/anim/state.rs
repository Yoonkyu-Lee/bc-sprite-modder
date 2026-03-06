use crate::viewport::parse::mamodel::{MaModel, Part};
use crate::viewport::parse::maanim::{KeyFrame, KeyFrameSet, MaAnim};

#[derive(Debug, Clone)]
pub struct PartAnim {
    pub part_id: usize,
    pub parent_id: i32,
    pub unit_id: i32,
    pub cut_id: i32,
    pub z_depth: i32,
    pub x: i32,
    pub y: i32,
    pub pivot_x: i32,
    pub pivot_y: i32,
    pub scale_x: i32,
    pub scale_y: i32,
    pub rotation: i32,
    pub alpha: i32,
    pub glow: i32,
    pub real_scale_x: f32,
    pub real_scale_y: f32,
}

impl PartAnim {
    pub fn from_base(idx: usize, p: &Part, scale_unit: i32) -> Self {
        let su = scale_unit as f32;
        Self {
            part_id: idx,
            parent_id: p.parent_id,
            unit_id: p.unit_id,
            cut_id: p.cut_id,
            z_depth: p.z_depth,
            x: p.x,
            y: p.y,
            pivot_x: p.pivot_x,
            pivot_y: p.pivot_y,
            scale_x: p.scale_x,
            scale_y: p.scale_y,
            rotation: p.rotation,
            alpha: p.alpha,
            glow: p.glow,
            real_scale_x: if su != 0.0 { p.scale_x as f32 / su } else { 0.0 },
            real_scale_y: if su != 0.0 { p.scale_y as f32 / su } else { 0.0 },
        }
    }
}

pub struct AnimState {
    pub base_parts: Vec<Part>,
    pub parts: Vec<PartAnim>,
    pub anims: Vec<MaAnim>,
    pub current_anim: usize,
    pub frame: i32,
    pub total_frames: i32,
    pub total_parts: usize,
    pub scale_unit: i32,
    pub angle_unit: i32,
    pub alpha_unit: i32,
    change_cache: Vec<Vec<Option<i32>>>,
    keyframe_map: Vec<Vec<(usize, usize)>>,
    pub sorted_indices: Vec<usize>,
}

impl AnimState {
    pub fn new(model: &MaModel, anims: Vec<MaAnim>) -> Self {
        let su = model.units.scale_unit;
        let base_parts = model.parts.clone();
        let parts: Vec<PartAnim> = base_parts
            .iter()
            .enumerate()
            .map(|(i, p)| PartAnim::from_base(i, p, su))
            .collect();
        let total_parts = parts.len();
        let sorted_indices: Vec<usize> = (0..total_parts).collect();
        let mut state = AnimState {
            base_parts,
            parts,
            anims,
            current_anim: 0,
            frame: 0,
            total_frames: 1,
            total_parts,
            scale_unit: su,
            angle_unit: model.units.angle_unit,
            alpha_unit: model.units.alpha_unit,
            change_cache: Vec::new(),
            keyframe_map: Vec::new(),
            sorted_indices,
        };
        if !state.anims.is_empty() {
            state.set_anim(0);
        }
        state
    }

    pub fn set_anim(&mut self, idx: usize) {
        if idx >= self.anims.len() {
            return;
        }
        self.current_anim = idx;
        self.frame = 0;
        for (i, p) in self.base_parts.iter().enumerate() {
            self.parts[i] = PartAnim::from_base(i, p, self.scale_unit);
        }
        let tp = self.total_parts as i32;
        for p in &mut self.parts {
            p.z_depth = p.z_depth * tp + p.part_id as i32;
        }
        let anim = &self.anims[idx];
        self.total_frames = anim
            .sets
            .iter()
            .map(|s| s.end_frame())
            .max()
            .unwrap_or(1)
            .max(1);
        self.change_cache = (0..self.total_frames)
            .map(|f| anim.sets.iter().map(|set| interpolate_keyframes(set, f)).collect())
            .collect();
        self.keyframe_map = vec![Vec::new(); self.total_parts];
        for (set_idx, set) in anim.sets.iter().enumerate() {
            let pid = set.model_id as usize;
            if pid < self.total_parts {
                self.keyframe_map[pid].push((set_idx, set_idx));
            }
        }
        self.resort_z();
    }

    pub fn apply_frame(&mut self) {
        let local_frame = self.frame.rem_euclid(self.total_frames) as usize;
        if local_frame >= self.change_cache.len() {
            return;
        }
        let changes = &self.change_cache[local_frame];
        let anim = &self.anims[self.current_anim];
        for pid in 0..self.total_parts {
            for &(set_idx, _) in &self.keyframe_map[pid] {
                let change = match changes.get(set_idx) {
                    Some(Some(v)) => *v,
                    _ => continue,
                };
                let mod_type = anim.sets[set_idx].modification_type;
                let base = &self.base_parts[pid];
                let p = &mut self.parts[pid];
                match mod_type {
                    0 => p.parent_id = change,
                    1 => p.unit_id = change,
                    2 => p.cut_id = change,
                    3 => p.z_depth = change * self.total_parts as i32 + p.part_id as i32,
                    4 => p.x = base.x + change,
                    5 => p.y = base.y + change,
                    6 => p.pivot_x = base.pivot_x + change,
                    7 => p.pivot_y = base.pivot_y + change,
                    8 => {
                        let su = self.scale_unit as f32;
                        let scaled = change as f32 / su;
                        p.scale_x = (base.scale_x as f32 * scaled) as i32;
                        p.scale_y = (base.scale_y as f32 * scaled) as i32;
                        p.real_scale_x = p.scale_x as f32 / su;
                        p.real_scale_y = p.scale_y as f32 / su;
                    }
                    9 => {
                        let su = self.scale_unit as f32;
                        let scaled = change as f32 / su;
                        p.scale_x = (base.scale_x as f32 * scaled) as i32;
                        p.real_scale_x = p.scale_x as f32 / su;
                    }
                    10 => {
                        let su = self.scale_unit as f32;
                        let scaled = change as f32 / su;
                        p.scale_y = (base.scale_y as f32 * scaled) as i32;
                        p.real_scale_y = p.scale_y as f32 / su;
                    }
                    11 => p.rotation = base.rotation + change,
                    12 => p.alpha = change,
                    13 | 14 => {}
                    _ => {}
                }
            }
        }
        self.resort_z();
    }

    fn resort_z(&mut self) {
        self.sorted_indices.sort_by_key(|&i| self.parts[i].z_depth);
    }
}

fn interpolate_keyframes(set: &KeyFrameSet, frame: i32) -> Option<i32> {
    let kfs = &set.keyframes;
    if kfs.is_empty() {
        return None;
    }
    let start = &kfs[0];
    let end = &kfs[kfs.len() - 1];
    if frame < start.frame {
        return None;
    }
    let start_frame = start.frame;
    let end_frame = end.frame;
    let total = end_frame - start_frame;
    let local_frame = if frame < end_frame || start_frame == end_frame {
        frame
    } else if set.loop_count == -1 && total > 0 {
        ((frame - start_frame) % total) + start_frame
    } else if set.loop_count >= 1 && total > 0 {
        let progress = frame - start_frame;
        if progress / total < set.loop_count {
            (progress % total) + start_frame
        } else {
            end_frame
        }
    } else {
        end_frame
    };
    if start_frame == end_frame {
        return Some(start.value);
    }
    if local_frame == end_frame {
        return Some(end.value);
    }
    for i in 0..kfs.len() - 1 {
        let c = &kfs[i];
        let n = &kfs[i + 1];
        if local_frame < c.frame || local_frame >= n.frame {
            continue;
        }
        let val = ease(c, n, local_frame, i, kfs);
        return Some(val as i32);
    }
    None
}

fn ease(c: &KeyFrame, n: &KeyFrame, local_frame: i32, c_idx: usize, kfs: &[KeyFrame]) -> f64 {
    let c_frame = c.frame as f64;
    let n_frame = n.frame as f64;
    let span = n_frame - c_frame;
    if span == 0.0 {
        return c.value as f64;
    }
    let lerp = (local_frame as f64 - c_frame) / span;
    let c_val = c.value as f64;
    let n_val = n.value as f64;
    let diff = n_val - c_val;
    match c.ease_mode {
        0 => lerp * diff + c_val,
        1 => c_val,
        2 => {
            let power = c.ease_power;
            if power >= 0 {
                (1.0 - (1.0 - lerp.powi(power)).sqrt()) * diff + c_val
            } else {
                (1.0 - (1.0 - lerp).powi(-power)).sqrt() * diff + c_val
            }
        }
        3 => {
            let mut low = c_idx;
            let mut high = c_idx;
            for i in (0..c_idx).rev() {
                if kfs[i].ease_mode == 3 {
                    low = i;
                } else {
                    break;
                }
            }
            for i in c_idx + 1..kfs.len() {
                high = i;
                if kfs[i].ease_mode != 3 {
                    break;
                }
            }
            let mut total = 0.0f64;
            for i in low..=high {
                let mut val = kfs[i].value as f64 * 4096.0;
                for j in low..=high {
                    if i != j {
                        let i_f = kfs[i].frame as f64;
                        let j_f = kfs[j].frame as f64;
                        if (i_f - j_f).abs() > f64::EPSILON {
                            val *= (local_frame as f64 - j_f) / (i_f - j_f);
                        }
                    }
                }
                total += val;
            }
            total / 4096.0
        }
        _ => lerp * diff + c_val,
    }
}
