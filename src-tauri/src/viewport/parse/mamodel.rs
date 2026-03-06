//! Skeleton / model data parsed from .mamodel files.

#[derive(Debug, Clone)]
pub struct Part {
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
}

#[derive(Debug, Clone)]
pub struct Units {
    pub scale_unit: i32,
    pub angle_unit: i32,
    pub alpha_unit: i32,
}

#[derive(Debug, Clone)]
pub struct Ints {
    pub part_id: i32,
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone)]
pub struct MaModel {
    pub parts: Vec<Part>,
    pub units: Units,
    pub ints: Vec<Ints>,
}

fn parse_i32(s: &str) -> i32 {
    s.trim().parse().unwrap_or(0)
}

impl MaModel {
    pub fn from_file(path: &std::path::Path) -> Result<Self, String> {
        let content = std::fs::read_to_string(path).map_err(|e| format!("{e}"))?;
        Self::parse(&content)
    }

    pub fn parse(content: &str) -> Result<Self, String> {
        let lines: Vec<&str> = content.lines().collect();
        if lines.len() < 3 {
            return Err("mamodel: too few lines".into());
        }
        let total_parts: usize = parse_i32(lines[2]) as usize;
        let mut parts = Vec::with_capacity(total_parts);
        for i in 0..total_parts {
            let line = lines.get(3 + i).ok_or("mamodel: unexpected EOF in parts")?;
            let f: Vec<&str> = line.splitn(14, ',').collect();
            if f.len() < 13 {
                return Err(format!("mamodel part {i}: too few fields (got {})", f.len()));
            }
            parts.push(Part {
                parent_id: parse_i32(f[0]),
                unit_id: parse_i32(f[1]),
                cut_id: parse_i32(f[2]),
                z_depth: parse_i32(f[3]),
                x: parse_i32(f[4]),
                y: parse_i32(f[5]),
                pivot_x: parse_i32(f[6]),
                pivot_y: parse_i32(f[7]),
                scale_x: parse_i32(f[8]),
                scale_y: parse_i32(f[9]),
                rotation: parse_i32(f[10]),
                alpha: parse_i32(f[11]),
                glow: parse_i32(f[12]),
            });
        }

        let units_line_idx = 3 + total_parts;
        let units = if let Some(line) = lines.get(units_line_idx) {
            let f: Vec<&str> = line.split(',').collect();
            Units {
                scale_unit: f.first().map(|s| parse_i32(s)).unwrap_or(1000),
                angle_unit: f.get(1).map(|s| parse_i32(s)).unwrap_or(3600),
                alpha_unit: f.get(2).map(|s| parse_i32(s)).unwrap_or(1000),
            }
        } else {
            Units {
                scale_unit: 1000,
                angle_unit: 3600,
                alpha_unit: 1000,
            }
        };

        let mut ints = Vec::new();
        let ints_count_idx = units_line_idx + 1;
        if let Some(count_line) = lines.get(ints_count_idx) {
            let count: usize = parse_i32(count_line) as usize;
            for i in 0..count {
                if let Some(line) = lines.get(ints_count_idx + 1 + i) {
                    let f: Vec<&str> = line.split(',').collect();
                    if f.len() >= 4 {
                        ints.push(Ints {
                            part_id: parse_i32(f[0]),
                            x: parse_i32(f[2]),
                            y: parse_i32(f[3]),
                        });
                    }
                }
            }
        }

        Ok(MaModel { parts, units, ints })
    }
}
