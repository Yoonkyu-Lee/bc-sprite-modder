"""
한 프레임을 렌더해 PNG base64로 stdout 출력. 뷰포트 미리보기용.
사용: python render_viewport_frame.py --workspace ... --project-dir ... --unit-id ... --form ...
     [--anim-index 0] [--frame-index 0] [--width 400] [--height 400]
stdout: 한 줄에 base64 PNG (UTF-8)
"""
from __future__ import annotations

import argparse
import base64
import io
import sys
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _SCRIPT_DIR.parent.parent

# Qt 백엔드 (QPainter 사용을 위해)
def _ensure_qt():
    from PySide6.QtWidgets import QApplication
    if not QApplication.instance():
        QApplication([])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--project-dir", required=True, dest="project_dir")
    parser.add_argument("--unit-id", required=True, dest="unit_id")
    parser.add_argument("--form", required=True)
    parser.add_argument("--anim-index", type=int, default=0, dest="anim_index")
    parser.add_argument("--frame-index", type=int, default=0, dest="frame_index")
    parser.add_argument("--width", type=int, default=400)
    parser.add_argument("--height", type=int, default=400)
    args = parser.parse_args()

    if str(_SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(_SCRIPT_DIR))
    if str(_PROJECT_ROOT) not in sys.path:
        sys.path.insert(0, str(_PROJECT_ROOT))

    _ensure_qt()

    from PySide6.QtGui import QImage, QPainter, QColor
    from game_packs_loader import load_game_packs, load_form_model

    workspace_path = Path(args.workspace)
    project_dir = Path(args.project_dir)
    packs, err = load_game_packs(workspace_path, project_dir)
    if err or packs is None:
        print(err or "load_game_packs failed", file=sys.stderr)
        return 1

    model, model_err = load_form_model(packs, args.unit_id, args.form)
    if model_err or model is None:
        print(model_err or "load_form_model failed", file=sys.stderr)
        return 1

    import tbcml
    anim = tbcml.Anim(model, args.anim_index)
    anim.set_part_vals()
    anim.set_frame(args.frame_index)

    w, h = args.width, args.height
    img = QImage(w, h, QImage.Format.Format_ARGB32)
    img.fill(QColor(40, 44, 52))
    painter = QPainter(img)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
    painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)
    try:
        painter.translate(w / 2, h / 2)
        base = 10.0
        anim.draw_frame(painter, base, base)
    finally:
        painter.end()

    buf = io.BytesIO()
    img.save(buf, "PNG")
    sys.stdout.buffer.write(base64.b64encode(buf.getvalue()).decode("ascii").encode("ascii"))
    sys.stdout.buffer.write(b"\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
