"""
decompiled 폴더 스캔 및 (선택) tbcml GamePacks 로드.
list_unit_forms, load_form_assets, extract_form_assets 는 decompiled만 사용하며 tbcml을 로드하지 않음.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

# 스크립트 위치: src-tauri/scripts/ → 프로젝트 루트 = parent.parent
_SCRIPT_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _SCRIPT_DIR.parent.parent

from project_model import PACKAGE_BY_SERVER, load_project_meta


def _ensure_tbcml():
    """tbcml이 필요한 함수에서만 호출. 상단 import 제거로 decompiled 전용 스크립트는 tbcml 로드 안 함."""
    import sys as _sys
    _tbcml_src = _PROJECT_ROOT / "tbcml" / "src"
    if _tbcml_src.exists() and str(_tbcml_src) not in _sys.path:
        _sys.path.insert(0, str(_tbcml_src))
    import tbcml
    return tbcml

# 스프라이트로 쓸 확장자
IMAGE_EXTENSIONS = (".png", ".imgcut")

# 폼 코드 → 표시 라벨 (e=광란은 별도 캐릭터)
FORM_LABELS = {"f": "1폼", "c": "2폼", "s": "3폼", "u": "4폼", "e": "광란"}

# 유닛·폼 추출용 패턴: {숫자}_{f|c|s|u|e} 또는 uni/udi{숫자}_{form}
_RE_UNIT_FORM_IMGCUT = re.compile(r"^(\d+)_([fcsu])\.(imgcut|mamodel)$")
_RE_UNIT_FORM_E_IMGCUT = re.compile(r"^(\d+)_e\.(imgcut|mamodel)$")
_RE_UNIT_FORM_MAANIM = re.compile(r"^(\d+)_([fcsu])\d+\.maanim$")
_RE_UNIT_FORM_E_MAANIM = re.compile(r"^(\d+)_e\d+\.maanim$")
_RE_UNI = re.compile(r"^uni(\d+)_([fcsu])\d*\.png$", re.I)
_RE_UNI_E = re.compile(r"^uni(\d+)_e\d*\.png$", re.I)
_RE_UDI = re.compile(r"^udi(\d+)_([fcsu])\.png$", re.I)
_RE_UDI_E = re.compile(r"^udi(\d+)_e\.png$", re.I)
_RE_NUMBER = re.compile(r"^(\d+)_([fcsu])\.png$")
_RE_NUMBER_E = re.compile(r"^(\d+)_e\.png$")


def get_extracted_dir(workspace_root: Path, project_dir: Path) -> Path | None:
    """
    프로젝트 dataset에 해당하는 'decompiled' 폴더 경로 (팩 압축 해제본).
    데이터 준비에서 [팩 추출]을 실행해 두면 workspace/BCData/apks/pkg/version/decompiled 가 됨.
    없으면 None.
    """
    meta = load_project_meta(project_dir)
    if not meta:
        return None
    dataset = meta.get("dataset") or {}
    rel_path = dataset.get("path", "")
    if not rel_path:
        server = dataset.get("server", "kr")
        version = dataset.get("version", "15.1.0")
        rel_path = f"BCData/apks/{PACKAGE_BY_SERVER.get(server, 'jp.co.ponos.battlecatskr')}/{version}{server}"
    decompiled_path = (workspace_root / rel_path.replace("\\", "/") / "decompiled").resolve()
    return decompiled_path if decompiled_path.is_dir() else None


def list_unit_forms_from_extracted(extracted_dir: Path) -> list[dict]:
    """
    이미 풀려 있는 decompiled 폴더를 스캔해 유닛·폼 목록 반환.
    각 항목: {"unit_id", "form", "form_label", "display", "is_enraged"}.
    """
    seen: set[tuple[str, str]] = set()
    result: list[dict] = []
    for path in extracted_dir.rglob("*"):
        if not path.is_file():
            continue
        parsed = _parse_unit_form(path.name)
        if parsed is None:
            continue
        uid, form = parsed
        key = (uid, form)
        if key in seen:
            continue
        seen.add(key)
        form_label = FORM_LABELS.get(form, form)
        is_enraged = form == "e"
        display = f"{uid} ({form_label})"
        result.append({
            "unit_id": uid,
            "form": form,
            "form_label": form_label,
            "display": display,
            "is_enraged": is_enraged,
        })
    result.sort(key=lambda x: (int(x["unit_id"]) if x["unit_id"].isdigit() else 0, x["form"]))
    return result


def get_asset_paths_for_form_from_extracted(extracted_dir: Path, unit_id: str, form: str) -> list[tuple[str, Path]]:
    """
    추출 폴더에서 (unit_id, form)에 해당하는 파일 (file_name, full_path) 목록.
    """
    result: list[tuple[str, Path]] = []
    for path in extracted_dir.rglob("*"):
        if not path.is_file():
            continue
        if not _file_belongs_to_form(path.name, unit_id, form):
            continue
        result.append((path.name, path))
    result.sort(key=lambda x: (_asset_category(x[0]), x[0]))
    return result


def load_game_packs(workspace_root: Path, project_dir: Path):
    """
    프로젝트의 project.json dataset으로 Apk(이미 추출된 폴더) 생성 후 get_game_packs() 반환.
    반환: (game_packs, error_message). 실패 시 (None, str).
    """
    tbcml = _ensure_tbcml()
    meta = load_project_meta(project_dir)
    if not meta:
        return None, "project.json을 읽을 수 없습니다."
    dataset = meta.get("dataset") or {}
    server = dataset.get("server", "kr")
    version = dataset.get("version", "15.1.0")
    rel_path = dataset.get("path", "")
    if not rel_path:
        rel_path = f"BCData/apks/{PACKAGE_BY_SERVER.get(server, 'jp.co.ponos.battlecatskr')}/{version}{server}"
    # rel_path = BCData/apks/pkg/15.1.0kr 형태. apk_folder = workspace/BCData/apks/pkg
    full = (workspace_root / rel_path.replace("\\", "/")).resolve()
    if not full.exists():
        return None, f"데이터 셋 경로가 없습니다: {full}"
    # tbcml Pkg: pkg_folder는 버전 폴더의 부모 (apks/pkg)
    apk_folder = full.parent
    try:
        cc = tbcml.CountryCode.from_code(server)
        gv = tbcml.GameVersion.from_string(version)
    except Exception as e:
        return None, f"서버/버전 변환 실패: {e}"
    apk = tbcml.Apk(
        game_version=gv,
        country_code=cc,
        apk_folder=str(apk_folder),
        create_dirs=False,
    )
    try:
        packs = apk.get_game_packs()
    except Exception as e:
        return None, f"GamePacks 로드 실패: {e}"
    return packs, None


def _parse_unit_form(file_name: str) -> tuple[str, str] | None:
    """파일명에서 (unit_id, form) 추출. 매칭 안 되면 None."""
    for pat in (
        _RE_UNIT_FORM_IMGCUT,
        _RE_UNIT_FORM_MAANIM,
        _RE_NUMBER,
    ):
        m = pat.match(file_name)
        if m:
            return (m.group(1), m.group(2))
    for pat in (_RE_UNIT_FORM_E_IMGCUT, _RE_UNIT_FORM_E_MAANIM, _RE_NUMBER_E):
        m = pat.match(file_name)
        if m:
            return (m.group(1), "e")
    for pat in (_RE_UNI, _RE_UDI):
        m = pat.match(file_name)
        if m:
            return (m.group(1), m.group(2))
    for pat in (_RE_UNI_E, _RE_UDI_E):
        m = pat.match(file_name)
        if m:
            return (m.group(1), "e")
    return None


def list_unit_forms(game_packs) -> list[dict]:
    """
    GamePacks에서 유닛·폼 목록 추출. 탐색 1·2단계용.
    각 항목: {"unit_id", "form", "form_label", "display", "is_enraged"}.
    """
    seen: set[tuple[str, str]] = set()
    result: list[dict] = []
    for _pack_name, pack in game_packs.packs.items():
        for gf in pack.get_files():
            parsed = _parse_unit_form(gf.file_name)
            if parsed is None:
                continue
            uid, form = parsed
            key = (uid, form)
            if key in seen:
                continue
            seen.add(key)
            form_label = FORM_LABELS.get(form, form)
            is_enraged = form == "e"
            display = f"{uid} ({form_label})"
            result.append({
                "unit_id": uid,
                "form": form,
                "form_label": form_label,
                "display": display,
                "is_enraged": is_enraged,
            })
    result.sort(key=lambda x: (int(x["unit_id"]) if x["unit_id"].isdigit() else 0, x["form"]))
    return result


def _file_belongs_to_form(file_name: str, unit_id: str, form: str) -> bool:
    """file_name이 (unit_id, form)에 속하는지."""
    parsed = _parse_unit_form(file_name)
    if parsed is None:
        return False
    uid, f = parsed
    return uid == unit_id and f == form


def load_form_model(game_packs, unit_id: str, form: str):
    """
    지정한 (unit_id, form)에 해당하는 tbcml.Model 로드. (팩 기반; decompiled 경로에서는 사용 안 함)
    imgcut, mamodel, maim 애니 목록, 스프라이트 시트(076_u.png 형식)를 모아 Model.read() 호출.
    반환: (model, error_message). 실패 시 (None, str).
    """
    assets = get_assets_for_form(game_packs, unit_id, form)
    imgcut_name = f"{unit_id}_{form}.imgcut"
    mamodel_name = f"{unit_id}_{form}.mamodel"
    maanim_names = sorted(
        a["file_name"] for a in assets if a["file_name"].endswith(".maanim")
    )
    # 애니메이션용 스프라이트 시트: {unit_id}_{form}.png (예: 076_u.png)
    animation_sprite_name = f"{unit_id}_{form}.png"
    sprite_name = None
    for a in assets:
        if a["file_name"] == animation_sprite_name:
            sprite_name = animation_sprite_name
            break
    if not sprite_name:
        return None, f"해당 폼의 스프라이트 시트({animation_sprite_name})를 찾을 수 없습니다."
    if not maanim_names:
        return None, "해당 폼의 maim 애니메이션 파일이 없습니다."

    # 편집 메모리에 로드되는 에셋 터미널 로그 (stderr로 출력해 Tauri/스크립트 stdout 파싱 방해하지 않음)
    print(f"[편집 로드] {unit_id}_{form} — 로드 에셋:", file=sys.stderr)
    print(f"  스프라이트 시트: {sprite_name}", file=sys.stderr)
    print(f"  imgcut: {imgcut_name}", file=sys.stderr)
    print(f"  mamodel: {mamodel_name}", file=sys.stderr)
    print(f"  maim 애니 ({len(maanim_names)}개): {maanim_names}", file=sys.stderr)
    print(f"  (해당 폼 전체 에셋 {len(assets)}개)", file=sys.stderr)

    tbcml = _ensure_tbcml()
    try:
        model = tbcml.Model()
        model.read(
            game_packs,
            sprite_name,
            imgcut_name,
            maanim_names,
            mamodel_name,
        )
        return model, None
    except Exception as e:
        return None, str(e)


def get_assets_for_form(game_packs, unit_id: str, form: str) -> list[dict]:
    """
    지정한 (unit_id, form)에 속한 에셋 목록. 탐색 3단계·편집 진입용.
    각 항목: {"file_name", "pack_name", "category"}.
    """
    result = []
    for pack_name, pack in game_packs.packs.items():
        for gf in pack.get_files():
            if not _file_belongs_to_form(gf.file_name, unit_id, form):
                continue
            category = _asset_category(gf.file_name)
            result.append({
                "file_name": gf.file_name,
                "pack_name": pack_name,
                "category": category,
            })
    result.sort(key=lambda x: (x["category"], x["file_name"]))
    return result


def _asset_category(file_name: str) -> str:
    """에셋 표시용 타입 라벨."""
    n = file_name.lower()
    if n.endswith(".imgcut"):
        return "imgcut"
    if n.endswith(".mamodel"):
        return "mamodel"
    if n.endswith(".maanim"):
        return "maanim"
    if n.startswith("udi"):
        return "아이콘"
    if n.startswith("uni"):
        return "스프라이트"
    if re.match(r"^\d+_[fcsu]\.png$", n) or re.match(r"^\d+_e\.png$", n):
        return "번호"
    return "기타"


def list_sprite_files(game_packs) -> list[dict]:
    """
    GamePacks에서 이미지(스프라이트) 파일 목록 추출.
    각 항목: {"file_name", "pack_name", "category"}.
    category는 팩 이름 또는 파일 접두사(숫자_ 등)로 유추.
    """
    result = []
    for pack_name, pack in game_packs.packs.items():
        for gf in pack.get_files():
            name = gf.file_name
            if not name.lower().endswith(IMAGE_EXTENSIONS):
                continue
            category = _infer_category(pack_name, name)
            result.append({
                "file_name": name,
                "pack_name": pack_name,
                "category": category,
            })
    result.sort(key=lambda x: (x["category"], x["file_name"]))
    return result


def _infer_category(pack_name: str, file_name: str) -> str:
    """팩명/파일명으로 표시용 카테고리 라벨."""
    name_lower = file_name.lower()
    if "unit" in pack_name.lower() or "cat" in pack_name.lower() or name_lower.startswith(("uni", "udi", "0")) and "_" in file_name:
        return "유닛"
    if "enemy" in pack_name.lower() or name_lower.startswith("enemy") or "_e." in name_lower:
        return "적"
    if "img" in pack_name.lower() or name_lower.startswith("img"):
        return "UI/이미지"
    if "map" in pack_name.lower() or name_lower.startswith("map"):
        return "맵"
    if "item" in pack_name.lower() or name_lower.startswith("item"):
        return "아이템"
    if "gatya" in pack_name.lower():
        return "가챠"
    return pack_name or "기타"


def get_sprite_frames(game_packs, file_name: str) -> list[tuple[str, object]]:
    """
    스프라이트 파일의 프레임 목록. Phase 4a 뷰어용.
    반환: [(라벨, BCImage), ...]. 단일 PNG면 길이 1, imgcut이면 get_cuts() 각각.
    실패 시 빈 리스트.
    """
    if not game_packs:
        return []
    tbcml = _ensure_tbcml()
    name_lower = file_name.lower()
    if name_lower.endswith(".png"):
        img = game_packs.get_img(file_name, show_error=False)
        if img is None:
            return []
        return [(file_name, img)]
    if name_lower.endswith(".imgcut"):
        img_name = file_name[:-7] + ".png"
        imgcut_name = file_name
        try:
            texture = tbcml.Texture()
            ok = texture.read_from_game_file_names(
                game_packs, img_name, imgcut_name
            )
            if not ok:
                return []
            cuts = texture.get_cuts()
            return [(f"프레임 {i}", c) for i, c in enumerate(cuts) if c is not None]
        except Exception:
            return []
    return []
