"""
pack 파일들을 폴더에 풀어서 파일 탐색기에서 PNG/imgcut 등을 볼 수 있게 함.
실행 후 decompiled/ 아래에 ImageDataLocal, kr_server 쪽 pack 등이 풀림.

참고: 앱에서는 [데이터 준비] 탭에서 "팩 추출" 시 워크스페이스 BCData/apks/<pkg>/<version>/decompiled/
에 팩을 풀어 두며, 스프라이트 편집은 그 추출본만 사용합니다. 이 스크립트는 프로젝트 루트 기준 수동 실행용입니다.
"""
from pathlib import Path
import sys

root = Path(__file__).resolve().parent
# 프로젝트의 tbcml 소스 우선 사용 (pip 설치본은 Apk 등 구조가 다를 수 있음)
_tbcml_src = root / "tbcml" / "src"
if _tbcml_src.exists() and str(_tbcml_src) not in sys.path:
    sys.path.insert(0, str(_tbcml_src))

import tbcml

APK_PATH = root / "BCData" / "apks" / "jp.co.ponos.battlecatskr" / "15.1.0kr" / "jp.co.ponos.battlecatskr-original.apk"
PKG_FOLDER = root / "BCData" / "apks" / "jp.co.ponos.battlecatskr"
OUT_DIR = root / "decompiled"


def main():
    if not APK_PATH.exists():
        print(f"APK not found: {APK_PATH}")
        return 1
    print("1. Loading APK and initializing...")
    apk, res = tbcml.Apk.from_pkg_path(
        str(APK_PATH),
        cc_overwrite=tbcml.CountryCode.from_code("kr"),
        gv_overwrite=tbcml.GameVersion.from_string("15.1.0"),
        pkg_folder=str(PKG_FOLDER),
        skip_signature_check=True,
        overwrite_pkg=False,
    )
    if apk is None:
        print(f"   Failed: {res.error}")
        return 1

    print("\n2. Extracting all packs to folder...")
    game_packs = apk.get_game_packs()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    game_packs.extract(str(OUT_DIR), clear=True)

    print(f"\n3. Done. Open in Explorer:")
    print(f"   {OUT_DIR}")
    import subprocess
    subprocess.run(["explorer", str(OUT_DIR)], check=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
