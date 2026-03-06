"""
Rust/Tauri에서 호출: 지정 (unit_id, form)의 편집용 에셋 목록 반환 (추출 폴더에서 즉시 스캔, 팩 미사용).
stderr에 "[편집 로드] ..." 로그 출력.
stdout: 한 줄 JSON { "unit_id", "form", "assets": [ {"name", "kind"}, ... ] }
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _SCRIPT_DIR.parent.parent


def main() -> int:
    parser = argparse.ArgumentParser(description="Load form asset list from pre-extracted folder")
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--project-dir", required=True, dest="project_dir")
    parser.add_argument("--unit-id", required=True, dest="unit_id")
    parser.add_argument("--form", required=True)
    args = parser.parse_args()

    if str(_SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(_SCRIPT_DIR))
    if str(_PROJECT_ROOT) not in sys.path:
        sys.path.insert(0, str(_PROJECT_ROOT))

    try:
        from game_packs_loader import get_extracted_dir, get_asset_paths_for_form_from_extracted, _asset_category
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

    t0 = time.perf_counter()
    paths = get_asset_paths_for_form_from_extracted(extracted_dir, unit_id, form)
    asset_entries = [{"name": name, "kind": _asset_category(name)} for name, _ in paths]

    imgcut_name = f"{unit_id}_{form}.imgcut"
    mamodel_name = f"{unit_id}_{form}.mamodel"
    maanim_names = sorted(name for name, _ in paths if name.endswith(".maanim"))
    animation_sprite_name = f"{unit_id}_{form}.png"
    print(f"[편집 로드] {unit_id}_{form} — 로드 에셋:", file=sys.stderr)
    print(f"  스프라이트 시트: {animation_sprite_name}", file=sys.stderr)
    print(f"  imgcut: {imgcut_name}", file=sys.stderr)
    print(f"  mamodel: {mamodel_name}", file=sys.stderr)
    print(f"  maim 애니 ({len(maanim_names)}개): {maanim_names}", file=sys.stderr)
    print(f"  (해당 폼 전체 에셋 {len(paths)}개)", file=sys.stderr)
    elapsed_ms = (time.perf_counter() - t0) * 1000
    print(f"  (소요: {elapsed_ms:.0f} ms)", file=sys.stderr)

    out = {
        "unit_id": unit_id,
        "form": form,
        "assets": asset_entries,
    }
    sys.stdout.buffer.write(json.dumps(out, ensure_ascii=False).encode("utf-8"))
    sys.stdout.buffer.write(b"\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
