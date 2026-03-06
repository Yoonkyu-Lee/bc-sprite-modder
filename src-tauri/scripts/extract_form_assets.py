"""
Rust/Tauri에서 호출: 지정 (unit_id, form)의 뷰포트용 에셋을 미리 추출된 폴더(decompiled)에서 .cache/viewport 로 복사.
팩 로드는 하지 않음.
stdout: 복사된 디렉터리의 절대 경로 한 줄 (Rust가 이 경로에서 파일을 읽음).
"""
from __future__ import annotations

import argparse
import shutil
import sys
import time
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _SCRIPT_DIR.parent.parent


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Copy form assets from pre-extracted folder to viewport cache"
    )
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--project-dir", required=True, dest="project_dir")
    parser.add_argument("--unit-id", required=True, dest="unit_id")
    parser.add_argument("--form", required=True)
    parser.add_argument(
        "--out-dir",
        dest="out_dir",
        default=None,
        help="Output directory (default: workspace/.cache/viewport/{unit_id}_{form})",
    )
    args = parser.parse_args()

    if str(_SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(_SCRIPT_DIR))
    if str(_PROJECT_ROOT) not in sys.path:
        sys.path.insert(0, str(_PROJECT_ROOT))

    try:
        from game_packs_loader import get_extracted_dir, get_asset_paths_for_form_from_extracted
    except ImportError as e:
        print(f"Import error: {e}", file=sys.stderr)
        return 1

    workspace_path = Path(args.workspace)
    project_dir = Path(args.project_dir)
    unit_id = args.unit_id
    form = args.form

    if not workspace_path.is_dir():
        print(f"Workspace not found: {workspace_path}", file=sys.stderr)
        return 1
    if not project_dir.is_dir():
        print(f"Project dir not found: {project_dir}", file=sys.stderr)
        return 1

    extracted_dir = get_extracted_dir(workspace_path, project_dir)
    if extracted_dir is None:
        print("decompiled 폴더가 없습니다. [데이터 준비] 탭에서 '팩 추출'을 실행하세요.", file=sys.stderr)
        return 1

    paths = get_asset_paths_for_form_from_extracted(extracted_dir, unit_id, form)
    if not paths:
        print(f"No assets for {unit_id}_{form}", file=sys.stderr)
        return 1

    if args.out_dir:
        out_dir = Path(args.out_dir).resolve()
    else:
        out_dir = (workspace_path / ".cache" / "viewport" / f"{unit_id}_{form}").resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    t0 = time.perf_counter()
    written = 0
    for file_name, src_path in paths:
        out_path = out_dir / file_name
        try:
            shutil.copy2(src_path, out_path)
            written += 1
            print(f"  추출: {file_name}", file=sys.stderr)
        except Exception as e:
            print(f"Write failed {file_name}: {e}", file=sys.stderr)

    elapsed_ms = (time.perf_counter() - t0) * 1000
    print(f"[뷰포트 추출] {unit_id}_{form} — {written}개 파일 → {out_dir} (소요: {elapsed_ms:.0f} ms)", file=sys.stderr)
    print(str(out_dir))
    return 0


if __name__ == "__main__":
    sys.exit(main())
