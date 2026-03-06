"""
data_setup.py (앱 소스 포함: src-tauri/scripts/)

냥코대전쟁 앱(APK) 및 서버 데이터 다운로드를 담당하는 "data setup" 스크립트.
실행 시 프로젝트 루트를 기준으로 tbcml/BCData 경로 사용.
"""

from __future__ import annotations

import argparse
import io
import os
import sys
import zipfile
import shutil
from pathlib import Path

# 스크립트 위치: src-tauri/scripts/ → 프로젝트 루트 = parent.parent
_SCRIPT_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _SCRIPT_DIR.parent.parent

# 프로젝트 루트 기준 tbcml 소스
_tbcml_src = _PROJECT_ROOT / "tbcml" / "src"
if _tbcml_src.exists():
    sys.path.insert(0, str(_tbcml_src))

import tbcml

# workspace/BCData 기준 경로는 --workspace 인자로 전달. 미지정 시 프로젝트 루트 사용.
bc_lab = _PROJECT_ROOT

# project_model (팩 추출 경로 규칙)
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))
try:
    from project_model import PACKAGE_BY_SERVER
except ImportError:
    PACKAGE_BY_SERVER = {"kr": "jp.co.ponos.battlecatskr", "jp": "jp.co.ponos.battlecats", "en": "jp.co.ponos.battlecatsen", "tw": "jp.co.ponos.battlecatstw"}

# 기본 타겟: 한국 서버 15.1.0 버전 (필요 시 --game-version, --country-code 로 변경)
DEFAULT_PACKAGE_NAME = "jp.co.ponos.battlecatskr"
DEFAULT_GAME_VERSION = "15.1.0"
DEFAULT_COUNTRY_CODE = "kr"

# apkdown 등으로 이미 받아둔 APK를 둘 기본 경로 (옵션)
DEFAULT_APK_PATH = (
    bc_lab / "BCData" / "apks" / DEFAULT_PACKAGE_NAME / f"{DEFAULT_GAME_VERSION}.apk"
)


# ---------------------------------------------------------------------------
# XAPK 보정 유틸
# ---------------------------------------------------------------------------

def fix_xapk_extraction(apk: tbcml.Apk) -> None:
    """
    XAPK(sub-APK가 여러 개 들어 있는 패키지)일 때,
    apktool 추출 과정에서 누락되는 "로컬 팩(.pack)"을 자동 복원한다.
    """
    if not apk.is_xapk():
        return

    pack_loc = apk.get_pack_location()
    if pack_loc.exists() and any(
        name.endswith(".pack") for name in os.listdir(pack_loc.path)
    ):
        print("   XAPK sub-APKs already in place, skipping.")
        return

    print("   Fixing XAPK: extracting sub-APKs...")
    xapk_path = Path(apk.pkg_path.path)
    if not xapk_path.exists():
        print(f"   pkg_path not found: {xapk_path}")
        return

    with zipfile.ZipFile(str(xapk_path)) as z:
        sub_apk_names = [n for n in z.namelist() if n.endswith(".apk")]
        for sub_name in sub_apk_names:
            folder_name = sub_name.replace(".apk", "")
            sub_data = z.read(sub_name)

            for base_dir in [apk.extracted_path, apk.original_extracted_path]:
                target = Path(base_dir.path) / folder_name
                if target.exists():
                    shutil.rmtree(target)
                target.mkdir(parents=True, exist_ok=True)

                with zipfile.ZipFile(io.BytesIO(sub_data)) as sub_z:
                    sub_z.extractall(str(target))

    pack_loc = apk.get_pack_location()
    if pack_loc.exists():
        pack_count = sum(
            1 for name in os.listdir(pack_loc.path) if name.endswith(".pack")
        )
        print(f"   Done. {pack_count} local packs at {pack_loc}")
    else:
        print(f"   Warning: pack location still not found at {pack_loc}")


# ---------------------------------------------------------------------------
# APK / 데이터 세팅 메인 로직
# ---------------------------------------------------------------------------

def create_or_load_apk(
    game_version: str,
    country_code: str,
    apk_path: Path | None,
    force_download_apk: bool,
    workspace_root: Path | None = None,
) -> tbcml.Apk:
    root = workspace_root if workspace_root is not None else bc_lab
    apk_folder = root / "BCData" / "apks" / DEFAULT_PACKAGE_NAME

    if apk_path is not None:
        if not apk_path.exists():
            raise FileNotFoundError(f"APK not found: {apk_path}")

        print(f"1. Loading APK from existing file...\n   {apk_path}")
        apk, res = tbcml.Apk.from_pkg_path(
            str(apk_path),
            cc_overwrite=country_code,
            gv_overwrite=game_version,
            pkg_folder=str(apk_folder),
            skip_signature_check=True,
        )
        if apk is None:
            raise RuntimeError(f"Failed to load APK: {res.error}")
        return apk

    print("1. Creating APK object (auto download mode)...")
    apk = tbcml.Apk(
        game_version=game_version,
        country_code=country_code,
        apk_folder=str(apk_folder),
    )
    print(f"   APK folder: {apk_folder}")

    print("\n2. Downloading APK...")
    res = apk.download(
        progress=tbcml.Apk.progress,
        force=force_download_apk,
        skip_signature_check=True,
    )
    if not res:
        raise RuntimeError(f"APK download failed: {res.error}")

    print(f"   Downloaded APK: {apk.pkg_path}")
    return apk


def run_data_setup(
    game_version: str,
    country_code: str,
    apk_path: Path | None,
    force_download_apk: bool,
    force_extract: bool,
    force_server_files: bool,
    workspace_root: Path | None = None,
) -> int:
    apk = create_or_load_apk(
        game_version=game_version,
        country_code=country_code,
        apk_path=apk_path,
        force_download_apk=force_download_apk,
        workspace_root=workspace_root,
    )

    print(f"\n   Version: {apk.game_version} / Country: {apk.country_code}")

    print("\n3. Extracting APK...")
    extract_res = apk.extract(force=force_extract)
    if not extract_res:
        print(f"   Extract failed: {extract_res.error}")
        return 1

    print("\n4. Fixing XAPK sub-APKs (if needed)...")
    fix_xapk_extraction(apk)

    server_path = apk.get_server_path()
    server_path.generate_dirs()
    server_pack_count_now = 0
    if server_path.exists():
        server_pack_count_now = sum(
            1 for p in server_path.get_files() if str(p).endswith(".pack")
        )
    force_dl = force_server_files or (server_pack_count_now == 0)
    if force_dl and not force_server_files:
        print("   (Server folder empty; forcing download regardless of server_latest.json)")
    print("\n5. Downloading server files...")
    print(f"   Server path: {server_path}")
    try:
        dl_res = apk.download_server_files(
            force=force_dl,
            display=True,
        )
    except Exception as e:
        print(f"   Server download error: {e}")
        print("   Tip: Check network, game version, or try --force-server-files")
        return 1
    if not dl_res:
        print(f"   Server download failed: {dl_res.error}")
        print("   Tip: Try --force-server-files or check game version support.")
        return 1

    print("\n6. Verifying game packs (local + server)...")
    pack_location = apk.get_pack_location()
    server_path = apk.get_server_path()
    local_pack_files = list(pack_location.get_files()) if pack_location.exists() else []
    server_pack_files = list(server_path.get_files()) if server_path.exists() else []
    local_count = sum(1 for p in local_pack_files if str(p).endswith(".pack"))
    server_count = sum(1 for p in server_pack_files if str(p).endswith(".pack"))
    total_packs = local_count + server_count

    game_packs = apk.get_game_packs()
    print(f"   Local packs:  {local_count} (in {pack_location})")
    print(f"   Server packs: {server_count} (in {server_path})")
    print(f"   Total packs:  {total_packs} (loaded: {len(game_packs.packs)})")
    if total_packs < 50:
        print("   Warning: Expected ~90+ packs for full data. Try --force-server-files if server packs are missing.")
    local_packs = [n for n in game_packs.packs if "local" in n.lower()]
    print(f"   Local pack names (sample): {local_packs[:5]}")
    print(f"   is_java: {apk.is_java()}")
    print(f"   arcs: {apk.get_architectures()}")
    print(f"\n   Output directory: {apk.output_path}")
    print("   Data download completed.")
    return 0


def run_extract_packs_only(
    workspace_root: Path,
    country_code: str,
    game_version: str,
) -> int:
    """
    이미 다운로드된 데이터(팩)가 있는 버전 폴더에서만 팩을 풀어 decompiled/ 생성.
    스프라이트 편집에서 즉시 로드하려면 이 단계가 필요함.
    """
    pkg = PACKAGE_BY_SERVER.get(country_code, "jp.co.ponos.battlecatskr")
    version_folder = workspace_root / "BCData" / "apks" / pkg / f"{game_version}{country_code}"
    if not version_folder.exists():
        print(f"버전 폴더가 없습니다: {version_folder}")
        print("먼저 [데이터 다운로드]를 실행하세요.")
        return 1

    print(f"1. Loading game packs from {version_folder}...")
    try:
        cc = tbcml.CountryCode.from_code(country_code)
        gv = tbcml.GameVersion.from_string(game_version)
    except Exception as e:
        print(f"   서버/버전 변환 실패: {e}")
        return 1

    apk = tbcml.Apk(
        game_version=gv,
        country_code=cc,
        apk_folder=str(version_folder.parent),
        create_dirs=False,
    )
    try:
        game_packs = apk.get_game_packs()
    except Exception as e:
        print(f"   GamePacks 로드 실패: {e}")
        return 1

    decompiled_dir = version_folder / "decompiled"
    decompiled_dir.mkdir(parents=True, exist_ok=True)
    print("2. Extracting all packs to decompiled/...")
    try:
        game_packs.extract(str(decompiled_dir), clear=True)
        print(f"   Done: {decompiled_dir}")
    except Exception as e:
        print(f"   Extract failed: {e}")
        return 1
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="냥코대전쟁 앱 + 서버 데이터 data setup 스크립트"
    )
    parser.add_argument(
        "--game-version",
        default=DEFAULT_GAME_VERSION,
        help=f"게임 버전 (기본값: {DEFAULT_GAME_VERSION})",
    )
    parser.add_argument(
        "--country-code",
        default=DEFAULT_COUNTRY_CODE,
        help=f"국가 코드 (기본값: {DEFAULT_COUNTRY_CODE})",
    )
    parser.add_argument(
        "--apk-path",
        type=str,
        default=None,
        help="이미 다운로드된 APK/XAPK 경로 (지정하지 않으면 tbcml이 자동 다운로드)",
    )
    parser.add_argument(
        "--force-download-apk",
        action="store_true",
        help="APK가 이미 있어도 항상 다시 다운로드",
    )
    parser.add_argument(
        "--force-extract",
        action="store_true",
        help="이미 추출된 경우에도 APK를 다시 추출",
    )
    parser.add_argument(
        "--force-server-files",
        action="store_true",
        help="서버 데이터가 있어도 항상 다시 다운로드",
    )
    parser.add_argument(
        "--workspace",
        type=str,
        default=None,
        help="Workspace 루트 경로 (BCData, projects 위치). 미지정 시 프로젝트 루트 기준.",
    )
    parser.add_argument(
        "--extract-packs-only",
        action="store_true",
        help="다운로드는 건너뛰고, 기존 버전 폴더의 팩만 decompiled/ 로 추출.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    workspace_root = Path(args.workspace) if args.workspace else None
    if args.extract_packs_only:
        if not workspace_root or not workspace_root.is_dir():
            print("--extract-packs-only 사용 시 --workspace (워크스페이스 경로)가 필요합니다.")
            return 1
        return run_extract_packs_only(
            workspace_root=workspace_root,
            country_code=args.country_code,
            game_version=args.game_version,
        )
    apk_path = Path(args.apk_path) if args.apk_path is not None else None
    return run_data_setup(
        game_version=args.game_version,
        country_code=args.country_code,
        apk_path=apk_path,
        force_download_apk=args.force_download_apk,
        force_extract=args.force_extract,
        force_server_files=args.force_server_files,
        workspace_root=workspace_root,
    )


if __name__ == "__main__":
    raise SystemExit(main())
