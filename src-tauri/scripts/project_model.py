"""
프로젝트 메타(project.json). game_packs_loader에서 사용.
lab 의존성 제거 후 앱 소스(src-tauri/scripts/)에 포함.
"""
from __future__ import annotations

import json
from pathlib import Path

# 서버 코드 → tbcml 패키지명 (data_setup과 동일한 규칙)
PACKAGE_BY_SERVER = {
    "kr": "jp.co.ponos.battlecatskr",
    "jp": "jp.co.ponos.battlecats",
    "en": "jp.co.ponos.battlecatsen",
    "tw": "jp.co.ponos.battlecatstw",
}


def load_project_meta(project_dir: Path) -> dict | None:
    """project.json 로드. 없거나 오류 시 None."""
    path = project_dir / "project.json"
    if not path.exists():
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None
