"""
repacking.py

mods/ 폴더에 넣어둔 수정된 리소스들을
게임 팩에 주입하고, 모드가 적용된 새 APK를 빌드하는 "repacking" 스크립트.

역할:
  1. BCData/apks/... 에 있는 원본 APK를 tbcml로 로드.
  2. ModLoader를 초기화하고, 게임 팩(GamePacks)을 불러온다.
  3. mods/ 아래의 파일들을 (파일명 기준으로) 대응되는 게임 파일에 교체한다.
  4. tbcml.Mod 를 적용해 새 APK를 리패킹하고 서명한다.
  5. 최종 APK 경로와 크기, 적용된 파일 수를 출력한다.

사용 워크플로:
  1) decompiled/ 에서 원본 파일을 보고 필요 파일명을 파악한다.
  2) 수정한 파일을 mods/ 에, 원본과 동일한 이름으로 저장한다.
     예: mods/076_u.png, mods/000_c.imgcut
  3) python repacking.py
  4) 출력된 모드 APK를 기기에 설치한다.
"""

from __future__ import annotations

import io
import os
import sys
import time
import types
import zipfile
from pathlib import Path

# 프로젝트에 포함된 tbcml 소스를 우선 사용하도록 sys.path 를 조정한다.
_bc_lab_root = Path(__file__).resolve().parent
_tbcml_src = _bc_lab_root / "tbcml" / "src"
if _tbcml_src.exists():
    sys.path.insert(0, str(_tbcml_src))

import tbcml


# bc-lab 루트 기준
bc_lab = Path(__file__).resolve().parent

# data setup 단계에서 사용한 APK를 그대로 사용한다.
APK_PATH = (
    bc_lab
    / "BCData"
    / "apks"
    / "jp.co.ponos.battlecatskr"
    / "15.1.0kr"
    / "jp.co.ponos.battlecatskr-original.apk"
)
PKG_FOLDER = APK_PATH.parent.parent  # tbcml.Apk.from_pkg_path 에 전달할 루트 폴더
MODS_DIR = bc_lab / "mods"


# ---------------------------------------------------------------------------
# 공용 유틸
# ---------------------------------------------------------------------------

def log(msg: str) -> None:
    """stdout에 즉시 flush 하면서 로그를 찍는 간단한 헬퍼."""
    print(msg, flush=True)


# ---------------------------------------------------------------------------
# XAPK 보정 (repacking에서도 안전하게 한 번 더 체크)
# ---------------------------------------------------------------------------

def fix_xapk_if_needed(apk: tbcml.Apk) -> None:
    """
    XAPK 인데 로컬 팩(.pack)이 없으면, XAPK 내부의 sub-APK들을
    extracted/ 및 original_extracted/ 로 다시 풀어 넣어 로컬 팩을 복원한다.

    data setup 단계에서 이미 처리되었을 가능성이 높지만,
    안전을 위해 여기서도 한 번 더 검사한다.
    """
    if not apk.is_xapk():
        return

    pack_loc = apk.get_pack_location()
    pack_loc_path = Path(pack_loc.path)
    if pack_loc_path.exists() and any(
        name.endswith(".pack") for name in os.listdir(pack_loc.path)
    ):
        return

    xapk_path = Path(apk.pkg_path.path)
    if not xapk_path.exists():
        return

    import shutil

    with zipfile.ZipFile(str(xapk_path)) as z:
        for sub_name in (n for n in z.namelist() if n.endswith(".apk")):
            sub_data = z.read(sub_name)
            folder_name = sub_name.replace(".apk", "")

            for base_dir in [apk.extracted_path, apk.original_extracted_path]:
                target = Path(base_dir.path) / folder_name
                if target.exists():
                    shutil.rmtree(target)
                target.mkdir(parents=True, exist_ok=True)

                with zipfile.ZipFile(io.BytesIO(sub_data)) as sub_z:
                    sub_z.extractall(str(target))

    log("   XAPK sub-APK restored (local packs)")


# ---------------------------------------------------------------------------
# 서명 도구가 없을 때 jarsigner 우회
# ---------------------------------------------------------------------------

def patch_sign_to_jarsigner(apk: tbcml.Apk) -> bool:
    """
    시스템에 apksigner/zipalign 이 설치되어 있지 않은 경우,
    tbcml.Apk.sign() 을 jarsigner 기반으로 강제로 우회하기 위한 패치.

    반환값:
      - True  : jarsigner 우회를 사용함
      - False : 원래 apksigner/zipalign 경로를 그대로 사용함
    """
    if apk.apksigner_installed and apk.zipalign_installed:
        return False

    original_sign = type(apk).sign

    def _patched(self, use_jarsigner: bool = False, zip_align: bool = True, **kwargs):
        # 항상 jarsigner만 사용하고, zipalign은 생략한다.
        return original_sign(self, use_jarsigner=True, zip_align=False, **kwargs)

    apk.sign = types.MethodType(_patched, apk)
    return True


# ---------------------------------------------------------------------------
# ModLoader 초기화 및 GamePacks 로딩
# ---------------------------------------------------------------------------

def init_loader() -> tbcml.ModLoader:
    """
    BCData/... 에 있는 APK를 기반으로 tbcml.ModLoader 를 초기화한다.

    - APK 경로가 없으면 에러를 발생시킨다.
    - from_pkg_path 로 APK 메타데이터를 맞춰 로드한다.
    - ModLoader.initialize_apk() 를 호출해 게임 팩을 준비한다.
    - XAPK 인 경우 로컬 팩을 복원한 뒤, loader.game_packs 를 다시 로드한다.
    """
    if not APK_PATH.exists():
        raise FileNotFoundError(f"APK not found: {APK_PATH}")

    apk, res = tbcml.Apk.from_pkg_path(
        str(APK_PATH),
        cc_overwrite="kr",
        gv_overwrite="15.1.0",
        pkg_folder=str(PKG_FOLDER),
        skip_signature_check=True,
        overwrite_pkg=False,
    )
    if apk is None:
        raise RuntimeError(res.error)

    loader = tbcml.ModLoader.from_pkg(apk)
    result = loader.initialize_apk(
        apk=apk,
        download_server_files=False,
        force_download_server_files=False,
        download_progress=tbcml.Apk.progress,
    )
    if not result:
        raise RuntimeError(result.error)

    # XAPK 인 경우 로컬 팩을 복원하고, game_packs 를 다시 읽어 온다.
    fix_xapk_if_needed(loader.get_apk())
    loader.game_packs = loader.get_apk().get_game_packs()
    return loader


def ensure_lang(game_packs: tbcml.GamePacks, lang: str = "ko") -> None:
    """
    localizable 문자열에 lang 키가 없으면 "ko" 등으로 기본 언어를 강제로 설정한다.
    (일부 환경에서 언어 키가 비어 있을 때, 텍스트 로드 문제를 피하기 위함)
    """
    loc = game_packs.localizable
    if loc.strings is None:
        loc.strings = {}
    if loc.get_string("lang") is None:
        loc.set_string("lang", lang)


# ---------------------------------------------------------------------------
# mods/ 폴더의 교체 파일 수집 및 적용
# ---------------------------------------------------------------------------

def collect_mod_files(mods_dir: Path) -> list[Path]:
    """
    mods/ 디렉터리 아래의 모든 파일을 재귀적으로 수집한다.
    디렉터리가 없거나 비어 있으면 빈 리스트를 반환한다.
    """
    if not mods_dir.is_dir():
        return []
    return [p for p in mods_dir.rglob("*") if p.is_file()]


def apply_mod_files(game_packs: tbcml.GamePacks, mod_files: list[Path]) -> tuple[int, int]:
    """
    mods/ 에서 읽어온 파일들을 게임 팩에 주입한다.

    동작:
      - 각 파일에 대해 파일명(예: 076_u.png, 000_c.imgcut) 기준으로
        game_packs.set_file(file_name, data) 를 호출한다.
      - 성공/실패 건수를 로그와 함께 집계해 반환한다.

    반환:
      (replaced_count, failed_count)
    """
    replaced = 0
    failed = 0

    log("\n[3/5] Replacing files in game packs...")
    for f in mod_files:
        file_name = f.name
        data = tbcml.Data.from_file(tbcml.Path(str(f)))
        try:
            game_file = game_packs.set_file(file_name, data)
            pack_name = game_file.pack_name if game_file else "?"
            log(f"   OK   {file_name} -> {pack_name}  ({f.stat().st_size:,} bytes)")
            replaced += 1
        except FileNotFoundError:
            log(f"   SKIP {file_name}: not found in any pack")
            failed += 1

    return replaced, failed


# ---------------------------------------------------------------------------
# 메인 파이프라인 (repacking)
# ---------------------------------------------------------------------------

def main() -> int:
    # 1. mods/ 파일 수집
    mod_files = collect_mod_files(MODS_DIR)
    if not mod_files:
        log(f"mods/ folder is empty or does not exist: {MODS_DIR}")
        log("")
        log("Usage (repacking 로직):")
        log(f"  1. Create {MODS_DIR} and place replacement files inside.")
        log("     e.g. mods/076_u.png  (check decompiled/ for originals)")
        log("  2. Run: python repacking.py")
        return 1

    log(f"[1/5] Found {len(mod_files)} file(s) to replace:")
    for f in mod_files:
        log(f"   {f.name}  ({f.stat().st_size:,} bytes)")

    # 2. APK / GamePacks 로딩
    log("\n[2/5] Loading APK and game packs...")
    t0 = time.time()
    loader = init_loader()
    game_packs = loader.get_game_packs()
    ensure_lang(game_packs, "ko")
    n_packs = len(game_packs.packs)
    log(f"   {n_packs} packs loaded ({time.time() - t0:.1f}s)")
    if n_packs < 90:
        log(f"   WARNING: expected 93 packs, only {n_packs} loaded.")

    apk = loader.get_apk()

    # apksigner/zipalign 이 없으면 jarsigner로 우회
    used_jarsigner = patch_sign_to_jarsigner(apk)
    if used_jarsigner:
        log("   apksigner/zipalign not found -> using jarsigner fallback")

    # 3. mods/ 파일 적용
    replaced, failed = apply_mod_files(game_packs, mod_files)

    if replaced == 0:
        log("\nNo files were replaced. Nothing to repack.")
        return 1

    # 4. APK 리패킹
    log(f"\n[4/5] Repacking APK ({replaced} replaced, {failed} skipped)...")
    t1 = time.time()
    mod = tbcml.Mod(name="custom_repack", authors="bc-lab")
    result = loader.apply(mod)
    if not result:
        log(f"   FAILED: {result.error}")
        return 1

    elapsed = time.time() - t1
    out = apk.final_pkg_path
    log(f"   Repack done ({elapsed:.1f}s)")

    # 5. 결과 요약
    log(f"\n[5/5] Modded APK ready:")
    log(f"   {out}")
    out_size = Path(out.path).stat().st_size / (1024 * 1024)
    log(f"   Size: {out_size:.1f} MB")
    total = time.time() - t0
    log(f"\n   Total: {total:.1f}s | {replaced} file(s) applied")
    return 0


if __name__ == "__main__":
    # 한글 로그 깨짐 방지 (Windows)
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())