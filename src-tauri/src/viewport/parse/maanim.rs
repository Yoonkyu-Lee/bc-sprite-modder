//! Keyframe animation data parsed from .maanim files.

#[derive(Debug, Clone)]
pub struct KeyFrame {
    pub frame: i32,
    pub value: i32,
    pub ease_mode: i32,
    pub ease_power: i32,
}

#[derive(Debug, Clone)]
pub struct KeyFrameSet {
    pub model_id: i32,
    pub modification_type: i32,
    pub loop_count: i32,
    pub keyframes: Vec<KeyFrame>,
}

#[derive(Debug, Clone)]
pub struct MaAnim {
    pub sets: Vec<KeyFrameSet>,
}

fn parse_i32(s: &str) -> i32 {
    s.trim().parse().unwrap_or(0)
}

impl MaAnim {
    pub fn from_file(path: &std::path::Path) -> Result<Self, String> {
        let content = std::fs::read_to_string(path).map_err(|e| format!("{e}"))?;
        Self::parse(&content)
    }

    pub fn parse(content: &str) -> Result<Self, String> {
        let lines: Vec<&str> = content.lines().collect();
        if lines.len() < 3 {
            return Err("maanim: too few lines".into());
        }
        let total: usize = parse_i32(lines[2]) as usize;
        let mut sets = Vec::with_capacity(total);
        let mut idx = 3;
        for _ in 0..total {
            if idx >= lines.len() {
                break;
            }
            let header_fields: Vec<&str> = lines[idx].splitn(6, ',').collect();
            if header_fields.len() < 3 {
                idx += 1;
                continue;
            }
            let model_id = parse_i32(header_fields[0]);
            let modification_type = parse_i32(header_fields[1]);
            let loop_count = parse_i32(header_fields[2]);
            idx += 1;

            if idx >= lines.len() {
                break;
            }
            let kf_count: usize = parse_i32(lines[idx]) as usize;
            idx += 1;

            let mut keyframes = Vec::with_capacity(kf_count);
            for _ in 0..kf_count {
                if idx >= lines.len() {
                    break;
                }
                let f: Vec<&str> = lines[idx].split(',').collect();
                keyframes.push(KeyFrame {
                    frame: f.first().map(|s| parse_i32(s)).unwrap_or(0),
                    value: f.get(1).map(|s| parse_i32(s)).unwrap_or(0),
                    ease_mode: f.get(2).map(|s| parse_i32(s)).unwrap_or(0),
                    ease_power: f.get(3).map(|s| parse_i32(s)).unwrap_or(0),
                });
                idx += 1;
            }
            sets.push(KeyFrameSet {
                model_id,
                modification_type,
                loop_count,
                keyframes,
            });
        }
        Ok(MaAnim { sets })
    }
}

impl KeyFrameSet {
    pub fn end_frame(&self) -> i32 {
        let last = self.keyframes.last().map(|k| k.frame).unwrap_or(0);
        let loop_mul = if self.loop_count > 0 {
            self.loop_count
        } else {
            1
        };
        let val = last * loop_mul;
        if val == 0 {
            1
        } else {
            val
        }
    }
}
