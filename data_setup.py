"""
data_setup.py

냥코대전쟁 앱(APK) 및 서버 데이터 다운로드를 담당하는 "data setup" 스크립트.

역할:
  1. tbcml을 사용해 냥코대전쟁 APK를 다운로드하거나,
     이미 받은 APK(XAPK)를 지정된 경로에서 로드한다.
  2. APK를 추출(extract)한다.
  3. XAPK인 경우, sub-APK(InstallPack, config.arm64_v8a 등)를 추출해서
     extracted/ 및 original_extracted/ 구조를 자동으로 보정한다.
  4. 서버 데이터(download_server_files)를 다운로드한다.

이 스크립트는 "데이터 환경을 준비"하는 것에 집중한다.
(앱 설치/실행, 모드 리패킹은 포함하지 않는다.)
"""

from __future__ import annotations

import argparse
import io
import os
import sys
import zipfile
import shutil
from pathlib import Path

# 프로젝트에 포함된 tbcml 소스를 우선 사용하도록 sys.path 를 조정한다.
_bc_lab_root = Path(__file__).resolve().parent
_tbcml_src = _bc_lab_root / "tbcml" / "src"
if _tbcml_src.exists():
    sys.path.insert(0, str(_tbcml_src))

import tbcml


# bc-lab 루트 기준 경로
bc_lab = Path(__file__).resolve().parent

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

    동작:
      1. apk.get_pack_location() 에 .pack 파일이 이미 있으면 아무 것도 하지 않음.
      2. XAPK 실제 파일(apk.pkg_path)을 zip 으로 열어서 *.apk 엔트리를 찾는다.
      3. 각 sub-APK 를 다시 unzip 해서
         - extracted/<sub_name_without_ext>/
         - original_extracted/<sub_name_without_ext>/
         아래에 풀어 넣는다.
      4. 최종적으로 pack 위치에 .pack 이 얼마나 생겼는지 출력한다.
    """
    # XAPK가 아니면 아무 것도 하지 않는다.
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

    # XAPK(zip) 안에서 *.apk 엔트리를 찾아 다시 풀어 넣는다.
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
    """
    APK 객체를 준비한다.

    - apk_path 가 지정된 경우:
        → 해당 경로를 XAPK/APK 로 보고 from_pkg_path 로 로드 (수동 다운로드 모드)
    - apk_path 가 없으면:
        → tbcml.Apk(...) 를 생성하고 apk.download() 로 자동 다운로드 (자동 다운로드 모드)
    - workspace_root: BCData 가 위치할 루트. None 이면 스크립트 기준 bc_lab 사용.
    """
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

    # 자동 다운로드 모드: workspace/BCData/apks/... 또는 bc_lab 기준
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
    """
    전체 data setup 파이프라인:

      1) APK 준비 (수동 로드 또는 자동 다운로드)
      2) APK 추출 (extract)
      3) XAPK 보정 (sub-APK → local packs 복원)
      4) 서버 데이터 다운로드 (download_server_files)
      5) 결과 요약 출력
    """
    apk = create_or_load_apk(
        game_version=game_version,
        country_code=country_code,
        apk_path=apk_path,
        force_download_apk=force_download_apk,
        workspace_root=workspace_root,
    )

    print(f"\n   Version: {apk.game_version} / Country: {apk.country_code}")

    # 2. APK 추출
    print("\n3. Extracting APK...")
    extract_res = apk.extract(force=force_extract)
    if not extract_res:
        print(f"   Extract failed: {extract_res.error}")
        return 1

    # 3. XAPK 보정
    print("\n4. Fixing XAPK sub-APKs (if needed)...")
    fix_xapk_extraction(apk)

    # 4. 서버 데이터 다운로드 (완전한 데이터 = 로컬 팩 + 서버 팩)
    server_path = apk.get_server_path()
    server_path.generate_dirs()
    # tbcml은 "이미 받음" 여부를 사용자 문서 폴더의 server_latest.json에 저장함.
    # 이 워크스페이스의 kr_server가 비어 있으면 강제로 받도록 force=True 사용.
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

    # 5. 검증/요약 (로컬 + 서버 팩 개수로 완전한 데이터 여부 확인)
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
    print("   Data setup completed.")
    return 0


# ---------------------------------------------------------------------------
# CLI 엔트리포인트
# ---------------------------------------------------------------------------

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
        help="Workspace 루트 경로 (BCData, projects 위치). 미지정 시 스크립트 디렉터리 기준.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    apk_path = Path(args.apk_path) if args.apk_path is not None else None
    workspace_root = Path(args.workspace) if args.workspace else None
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