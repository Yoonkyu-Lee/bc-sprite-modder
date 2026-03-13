use crate::types::{Point, Rect};
use std::collections::VecDeque;

pub fn normalize_rect(a: Point, b: Point) -> Rect {
    let x0 = a.x.min(b.x);
    let y0 = a.y.min(b.y);
    let x1 = a.x.max(b.x);
    let y1 = a.y.max(b.y);
    Rect {
        x: x0,
        y: y0,
        width: x1 - x0 + 1,
        height: y1 - y0 + 1,
    }
}

pub fn point_in_rect(p: Point, rect: Rect) -> bool {
    p.x >= rect.x && p.y >= rect.y && p.x < rect.x + rect.width && p.y < rect.y + rect.height
}

pub fn bresenham_line(from: Point, to: Point) -> Vec<Point> {
    let mut out = Vec::new();
    let mut x0 = from.x;
    let mut y0 = from.y;
    let x1 = to.x;
    let y1 = to.y;
    let dx = (x1 - x0).abs();
    let sx = if x0 < x1 { 1 } else { -1 };
    let dy = -(y1 - y0).abs();
    let sy = if y0 < y1 { 1 } else { -1 };
    let mut err = dx + dy;
    loop {
        out.push(Point { x: x0, y: y0 });
        if x0 == x1 && y0 == y1 {
            break;
        }
        let e2 = 2 * err;
        if e2 >= dy {
            err += dy;
            x0 += sx;
        }
        if e2 <= dx {
            err += dx;
            y0 += sy;
        }
    }
    out
}

pub fn flood_fill(
    bitmap: &[u8],
    width: i32,
    height: i32,
    start: Point,
    target: [u8; 4],
) -> Vec<Point> {
    let area = (width * height) as usize;
    let mut seen = vec![false; area];
    let mut queue = VecDeque::from([start]);
    let mut out = Vec::new();

    while let Some(p) = queue.pop_front() {
        if p.x < 0 || p.y < 0 || p.x >= width || p.y >= height {
            continue;
        }
        let pi = (p.y * width + p.x) as usize;
        if seen[pi] {
            continue;
        }
        seen[pi] = true;
        let i = pi * 4;
        if bitmap[i] != target[0]
            || bitmap[i + 1] != target[1]
            || bitmap[i + 2] != target[2]
            || bitmap[i + 3] != target[3]
        {
            continue;
        }
        out.push(p);
        queue.push_back(Point { x: p.x + 1, y: p.y });
        queue.push_back(Point { x: p.x - 1, y: p.y });
        queue.push_back(Point { x: p.x, y: p.y + 1 });
        queue.push_back(Point { x: p.x, y: p.y - 1 });
    }
    out
}
