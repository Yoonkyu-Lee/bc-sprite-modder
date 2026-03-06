# BCData 기준 스프라이트 접근 경로

앱이 스프라이트(이미지/애니 데이터)에 어떻게 접근하는지 **BCData 폴더 구조** 기준으로 정리한 문서입니다.

---

## 1. 경로의 출발점: Workspace와 데이터 셋

- **Workspace** = 사용자가 고른 작업 루트 (예: `example_workspace` 또는 프로젝트 루트).
- **BCData**는 항상 **Workspace 아래**에 있습니다.
  ```
  <Workspace>/
    BCData/
    projects/
  ```
- **데이터 셋** = “어떤 버전의 게임 데이터를 쓸지”를 가리키는 메타.
  - 프로젝트의 `project.json` → `dataset.path` 예: `"BCData/apks/jp.co.ponos.battlecatskr/15.1.0kr"`.
  - 즉 “이 프로젝트는 **BCData/apks/.../15.1.0kr** 이 디렉터리를 데이터 소스로 쓴다”는 뜻.

---

## 2. BCData 아래 실제 디렉터리 구조

데이터 셋 경로 `BCData/apks/<패키지>/<버전폴더>` 가 가리키는 곳은 대략 다음과 같습니다.

```
BCData/
  apks/
    jp.co.ponos.battlecatskr/          ← 패키지(서버별 앱)
      15.1.0kr/                         ← 버전 폴더 (game_version + country_code)
        extracted/                      ← APK 추출 결과 (실제로 스프라이트를 읽는 위치)
          InstallPack/
            assets/                     ← ★ 팩 파일(.pack / .list) 위치
              resLocal.pack
              resLocal.list
              NumberLocal.pack
              NumberLocal.list
              ...
        original_extracted/              ← 원본 추출 (비교/복원용)
        modified_packs/                 ← 리패킹 시 수정된 팩 출력
    kr_server/                          ← 서버 전용 팩 (같은 apks 레벨)
      ...
  (projects는 Workspace 바로 아래, BCData와 형제)
```

- **스프라이트가 “파일 하나씩” 있는 게 아니라**,  
  **`extracted/InstallPack/assets/` 안의 `.pack` / `.list` 쌍** 안에 여러 파일이 묶여 있습니다.
- 따라서 **디스크에는 `bg.png` 같은 단일 파일이 보이지 않고**,  
  `resLocal.pack` 같은 팩 파일 **안**에 `bg.png` 등이 암호화된 채로 들어 있습니다.

---

## 3. 앱이 사용하는 경로 (tbcml Apk/Pkg)

우리 앱은 **tbcml**의 `Apk` + `get_game_packs()`로 이 구조에 접근합니다.

1. **데이터 셋 경로 해석**
   - `workspace_root` + `dataset.path`  
     → `full = workspace/BCData/apks/jp.co.ponos.battlecatskr/15.1.0kr`
   - tbcml에 넘기는 **apk_folder** = `full`의 **부모**  
     → `workspace/BCData/apks/jp.co.ponos.battlecatskr`

2. **tbcml Apk 내부 경로 (Pkg.init_paths)**
   - `output_path` = `apk_folder / "15.1.0kr"`  
     = `BCData/apks/jp.co.ponos.battlecatskr/15.1.0kr`
   - `extracted_path` = `output_path / "extracted"`
   - **팩 위치** (`get_pack_location()`)  
     = `extracted_path / "InstallPack" / "assets"`  
     = **`BCData/apks/.../15.1.0kr/extracted/InstallPack/assets`**

3. **팩 목록 수집**
   - `get_packs_lists()`가 위 `assets` 폴더에서 `*.pack`을 찾고,  
     같은 이름의 `*.list`와 짝지어 **(pack_path, list_path)** 리스트를 만듦.
   - 필요 시 **서버 팩**도 같은 방식으로 `get_server_path()`(예: `BCData/apks/kr_server`)에서 가져옴.

즉, **BCData 기준으로 보면**  
“스프라이트를 읽는다” = **`BCData/apks/<패키지>/<버전>/extracted/InstallPack/assets/` 안의 `.pack`/`.list`**를 tbcml이 읽고, 그 안의 항목(예: `bg.png`)을 복호화해 메모리에서 다루는 것입니다.

---

## 4. 스프라이트 “파일”이 나오는 과정

1. **팩 로드 (get_game_packs)**
   - `assets/` 아래 모든 `.pack`/`.list` 쌍에 대해:
     - `list` 파일을 읽어 복호화 → 파일 목록(인덱스) 파싱.
     - `pack` 파일에서 해당하는 구간을 읽어 복호화 → **GameFile** (이름 + `dec_data` 등) 생성.
   - 이렇게 만든 **PackFile**들을 모아 **GamePacks** 하나로 반환.

2. **목록/이미지 접근 (우리 앱)**
   - **목록:** `game_packs.packs` → 각 `PackFile.get_files()` → `file_name`이 `.png`/`.imgcut`인 것만 필터 → 브라우저 목록.
   - **단일 이미지:** `game_packs.get_img("bg.png")`  
     → 내부적으로 `find_file("bg.png")`로 해당 **GameFile**을 찾고,  
     → `dec_data`를 base64로 넘겨 **BCImage** 생성.
   - **imgcut(프레임 여러 개):**  
     같은 GamePacks에서 `xxx.png` + `xxx.imgcut`를 **Texture**로 읽고,  
     `get_cuts()`로 잘린 이미지(BCImage) 리스트를 얻음.

정리하면, **BCData 쪽에는**  
- **물리 경로:** `BCData/apks/.../15.1.0kr/extracted/InstallPack/assets/*.pack`, `*.list`  
- **논리적 접근:** 위 팩들을 tbcml이 복호화·파싱한 **GamePacks** → `get_img()`, `get_csv()`, Texture 등으로 **파일명 단위**로 접근합니다.

---

## 5. 한 줄 요약

| 단계 | BCData 기준 경로 / 동작 |
|------|--------------------------|
| 데이터 셋 루트 | `BCData/apks/<패키지>/<버전폴더>` (예: `15.1.0kr`) |
| 스프라이트가 들어 있는 디스크 위치 | `.../15.1.0kr/extracted/InstallPack/assets/` 안의 **.pack / .list** |
| 앱이 쓰는 접근 | tbcml이 위 팩들을 읽어 **GamePacks**로 만든 뒤, **파일명**(예: `bg.png`)으로 `get_img()` 등 호출 |

즉, **BCData를 기준으로 하면** 스프라이트는 “폴더 안의 png 파일”이 아니라 **`extracted/InstallPack/assets/` 아래 팩 파일(.pack/.list) 안에 들어 있는 항목**으로 접근하고, 앱은 그 팩을 tbcml로 열어 **이름으로만** 접근합니다.
