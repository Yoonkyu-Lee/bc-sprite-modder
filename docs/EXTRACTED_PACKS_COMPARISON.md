# decompiled 폴더 비교

**완전한 예시 (bc-lab)** vs **우리 프로젝트 셋업 결과** 비교.

---

## 하위 폴더 개수

| 경로 | 개수 |
|------|------|
| `bc-lab\decompiled` (완전한 데이터) | **93개** |
| `the-battle-cats-sprite-modder\decompiled` (우리 셋업) | **8개** |

---

## 공통 (둘 다 있음, 8개)

- **DataLocal**
- **DownloadLocal**
- **ImageDataLocal**
- **ImageLocal**
- **MapLocal**
- **NumberLocal**
- **UnitLocal**
- **resLocal**

→ APK 추출 시 나오는 **Local** 팩 + **resLocal**. 우리 셋업은 이것만 있음.

---

## bc-lab에만 있음 (우리 셋업에 없음, 85개)

**서버에서 받는 팩들 (\*Server)** 전부 누락.

- **AMapServer**, **ANumberServer**, **AUnitServer**
- **BNumberServer**, **BUnitServer**
- **CImageServer**, **CMapServer**, **CNumberServer**, **CUnitServer**
- **DImageServer** ~ **DUnitServer**
- **E** ~ **V** 알파벳 조합 (ImageServer, MapServer, NumberServer, UnitServer)
- **ImageServer**, **MapServer**
- **SImageDataServer**, **WImageDataServer**
- … 등 **85개** \*Server 폴더

---

## 우리 셋업에만 있음

- **0개** (bc-lab에 없는 항목 없음)

---

## 원인 정리

tbcml이 팩을 읽는 위치는 두 곳입니다.

1. **로컬 팩 (APK 추출 결과)**  
   `BCData/apks/<패키지>/<버전>/extracted/InstallPack/assets/`  
   → 여기서 **Local** + **resLocal** 읽음 ✅ 우리는 있음.

2. **서버 팩**  
   `BCData/apks/<country>_server/`  
   예: `BCData/apks/kr_server/`  
   → `data_setup.py`의 **download_server_files()** 로 받아와야 함.

우리 프로젝트에서는 **서버 팩이 받아지지 않았거나**, **다른 경로에만 있어서**  
`get_game_packs()`가 **Local 팩만** 읽고, Server 팩 85개는 포함되지 않은 상태입니다.

---

## 다음에 할 일

1. **데이터 준비** 실행 시 **서버 데이터 다운로드**가 실제로 성공하는지 확인.
2. **서버 팩 경로** 확인:  
   `BCData/apks/kr_server/` (또는 사용 중인 country_code에 맞는 `*_server`) 에  
   `.pack` / `.list` 파일이 생성되는지 확인.
3. 필요하면 `data_setup.py` 또는 tbcml의 `download_server_files` 동작/경로를 점검.

이렇게 하면 bc-lab처럼 **93개 팩(로컬 8 + 서버 85)** 이 모두 채워질 수 있습니다.
