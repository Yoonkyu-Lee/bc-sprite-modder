"""
Rust/Tauri에서 호출: 데이터 준비에서 미리 풀어둔 decompiled 폴더를 스캔해 유닛·폼 목록을 JSON으로 stdout 출력.
팩 로드는 하지 않음. decompiled가 없으면 [팩 추출] 실행을 안내.
사용: python list_unit_forms.py --workspace <path> --project-dir <path>
성공 시: 한 줄 JSON 배열 [{ "unit_id", "form", "form_label", "display", "is_enraged" }, ...]
실패 시: stderr에 에러 메시지, exit code 1
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# 스크립트 위치: src-tauri/scripts/ -> 프로젝트 루트 = parent.parent
_SCRIPT_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _SCRIPT_DIR.parent.parent


def main() -> int:
    # Windows에서 stdout이 cp1252일 때 한글 등 유니코드 출력 오류 방지
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="List unit forms from pre-extracted packs (JSON to stdout)")
    parser.add_argument("--workspace", required=True, help="Workspace root path")
    parser.add_argument("--project-dir", required=True, dest="project_dir", help="Project directory (contains project.json)")
    args = parser.parse_args()

    if str(_SCRIPT_DIR) not in sys.path:
        sys.path.insert(0, str(_SCRIPT_DIR))
    if str(_PROJECT_ROOT) not in sys.path:
        sys.path.insert(0, str(_PROJECT_ROOT))

    try:
        from game_packs_loader import get_extracted_dir, list_unit_forms_from_extracted
    except ImportError as e:
        print(f"Import error: {e}", file=sys.stderr)
        return 1

    workspace_path = Path(args.workspace)
    project_dir = Path(args.project_dir)
    if not workspace_path.is_dir():
        print(f"Workspace not found: {workspace_path}", file=sys.stderr)
        return 1
    if not project_dir.is_dir():
        print(f"Project dir not found: {project_dir}", file=sys.stderr)
        return 1

    extracted_dir = get_extracted_dir(workspace_path, project_dir)
    if extracted_dir is None:
        print("decompiled 폴더가 없습니다. [데이터 준비] 탭에서 '데이터 있는지 스캔' 후 '팩 추출'을 실행하세요.", file=sys.stderr)
        return 1

    unit_forms = list_unit_forms_from_extracted(extracted_dir)
    out = json.dumps(unit_forms, ensure_ascii=False)
    sys.stdout.buffer.write(out.encode("utf-8"))
    sys.stdout.buffer.write(b"\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
