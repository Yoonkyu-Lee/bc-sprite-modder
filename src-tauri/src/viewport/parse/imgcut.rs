//! Sprite sheet regions from .imgcut.

#[derive(Debug, Clone)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

#[derive(Debug, Clone)]
pub struct ImgCut {
    pub img_name: String,
    pub rects: Vec<Rect>,
}

impl ImgCut {
    pub fn from_file(path: &std::path::Path) -> Result<Self, String> {
        let content = std::fs::read_to_string(path).map_err(|e| format!("{e}"))?;
        Self::parse(&content)
    }

    pub fn parse(content: &str) -> Result<Self, String> {
        let lines: Vec<&str> = content.lines().collect();
        if lines.len() < 4 {
            return Err("imgcut: too few lines".into());
        }
        let img_name = lines[2].trim().to_string();
        let count: usize = lines[3].trim().parse().map_err(|e| format!("rect count: {e}"))?;
        let mut rects = Vec::with_capacity(count);
        for i in 0..count {
            let line = lines.get(4 + i).ok_or("imgcut: unexpected EOF")?;
            let fields: Vec<&str> = line.splitn(5, ',').collect();
            if fields.len() < 4 {
                return Err(format!("imgcut line {}: too few fields", 4 + i));
            }
            let x: i32 = fields[0].trim().parse().unwrap_or(0);
            let y: i32 = fields[1].trim().parse().unwrap_or(0);
            let w: i32 = fields[2].trim().parse().unwrap_or(0);
            let h: i32 = fields[3].trim().parse().unwrap_or(0);
            let _name = fields.get(4).unwrap_or(&"").trim().to_string();
            rects.push(Rect { x, y, w, h });
        }
        Ok(ImgCut { img_name, rects })
    }
}
