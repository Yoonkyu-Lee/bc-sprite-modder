# 캔버스 모듈 WASM 마이그레이션 계획

## 목적

현재 캔버스 에디터는 **Tauri 분리 프로세스 구조**로 동작한다. 픽셀 데이터는 Rust 백엔드 프로세스에 살고, 렌더링은 JS 렌더러 프로세스에서 일어난다. 모든 에디터 조작(드로우, 이레이즈, 선택, 이동)이 두 프로세스 사이의 IPC 왕복을 요구한다.

이 구조는 두 가지 핵심 문제를 일으킨다.

**1. 드로우 레이턴시**

붓질 한 획마다 `invoke()` 비동기 IPC가 발생하고, 그 결과를 받아야 화면이 갱신된다. Tauri IPC 왕복은 최소 5~20ms 소요된다. 이는 유저가 체감하는 스트로크 딜레이로 나타난다.

**2. 멀티레이어 렌더링 정합성 문제**

JS 프론트엔드는 합쳐진 단일 composite bitmap만 들고 있고, 개별 레이어 픽셀은 모른다. IPC로 받은 패치(`PixelPatch`)는 특정 레이어의 픽셀 변화분인데, 이걸 composite bitmap에 그냥 덮어쓰면 다른 레이어의 픽셀이 지워진다.

이 문제를 해결하기 위해 `applyPatchWithComposites()`, `drawCompositesRef`, `prefetchDrawComposites`, `latestStatusRef`, `enqueue 직렬화 큐`, `hadMovePreview` 분기, `getSnapshot()` 후처리 등 다량의 보정 코드가 추가되었다. 이 코드들은 비즈니스 로직이 아니라 **"프로세스 경계로 인한 부정확성을 수작업으로 보정"** 하기 위해 존재한다.

**해결책: 캔버스 엔진을 WASM으로 렌더러 프로세스 안으로 이사**

렌더러 프로세스 내부에서 WASM으로 돌리면 IPC가 사라지고, 레이어 픽셀이 WASM 메모리에 바로 있으므로 보정 코드도 전부 불필요해진다.

---

## 현재 구조

### 프로세스 경계

```
┌─────────────────────────────────────────┐    ┌──────────────────────────────────────┐
│         Renderer Process (JS)           │    │       Backend Process (Rust)         │
│                                         │    │                                      │
│  React UI                               │    │  canvas_editor/                      │
│  hooks/useCanvasInputController.ts      │    │    state.rs       - Editor 구조체     │
│  hooks/useCanvasActions.ts              │◄──►│    history.rs     - undo/redo 스택   │
│  hooks/useCanvasRenderBridge.ts         │IPC │    input.rs       - 입력 라우팅       │
│  backend.ts (invoke() 래퍼)             │    │    tools_draw.rs  - 드로우/이레이즈   │
│                                         │    │    tools_select.rs - 선택 도구       │
│  보유 데이터:                            │    │    tools_move.rs  - 이동 도구        │
│  - bitmap: Uint8ClampedArray (합성본)   │    │    shortcuts.rs   - 단축키           │
│  - status: EditorStatus (메타데이터)    │    │    types.rs       - 공유 타입        │
│  - movePreview: MovePreviewState        │    │    api.rs         - IPC용 퍼블릭 API │
│                                         │    │    session_store.rs - 전역 세션 맵   │
│  레이어 픽셀 없음                        │    │                                      │
│                                         │    │  레이어 픽셀 전부 여기               │
└─────────────────────────────────────────┘    └──────────────────────────────────────┘
```

### 백엔드 파일별 역할

| 파일 | 역할 | Tauri 의존 |
|------|------|-----------|
| `state.rs` | `Editor` 구조체, 레이어 배열, `FloatingLayer`, 합성 로직 | 없음 |
| `history.rs` | `HistoryStack`, undo/redo, `PixelChange` | 없음 |
| `input.rs` | 포인터/단축키 이벤트를 tool 메서드로 라우팅 | 없음 |
| `tools.rs` | 공통 툴 trait/helpers | 없음 |
| `tools_draw.rs` | 드로우, 이레이즈, fill, pick 구현 | 없음 |
| `tools_select.rs` | rect/lasso 선택, 선택 확정 | 없음 |
| `tools_move.rs` | FloatingLayer 생성/이동/커밋/취소 | 없음 |
| `shortcuts.rs` | 키보드 단축키 처리 | 없음 |
| `types.rs` | `EditorStatus`, `PixelPatch`, `MovePreviewData` 등 serde 타입 | 없음 |
| `api.rs` | `impl Editor` 메서드들 (base64 인코딩), 세션 관리 래퍼 함수들 | `session_store`, `base64` |
| `session_store.rs` | `static Mutex<HashMap<String, Editor>>` 전역 세션 저장소 | 없음 (Rust std만) |
| `mod.rs` | pub use 재출력 | 없음 |
| `commands/canvas_editor.rs` | 22개 `#[tauri::command]` 핸들러 | **Tauri 전용** |

**핵심 관찰**: `state.rs`부터 `types.rs`까지 8개 파일은 `tauri::` import가 전혀 없는 순수 Rust 라이브러리 코드다. WASM 타깃에서도 코드 변경 없이 그대로 컴파일된다.

### 프론트엔드 파일별 역할

| 파일 | 역할 | 마이그레이션 후 |
|------|------|--------------|
| `backend.ts` | 22개 `invoke()` 래퍼 + `applyPatch` + `applyPatchWithComposites` + `decodeRgbaBase64` | **전체 삭제** |
| `hooks/useCanvasSessionQueue.ts` | Promise 체인 직렬화 큐 (`enqueue`) | **전체 삭제** |
| `hooks/useCanvasRenderBridge.ts` | 세션 초기화 + 렌더 루프 | **init 부분만 재작성** |
| `hooks/useCanvasInputController.ts` | 드로우/이동/선택 입력 처리 (~650줄) | **대폭 단순화 (~200줄)** |
| `hooks/useCanvasActions.ts` | 레이어 조작 훅 (전부 async) | **sync로 재작성 (~100줄)** |
| `hooks/usePaletteController.ts` | 팔레트/색상 관리 | 소폭 수정 |
| `panel/movePreview.ts` | `MovePreviewState` 빌더 | 유지 |
| `panel/status.ts` | 초기 상태 fallback | 유지 |
| `render.ts` | `CanvasRenderer` (WebGL/Canvas 렌더링) | **변경 없음** |
| `types.ts` | TypeScript 타입 정의 | 유지 |
| `components/*.tsx` | UI 컴포넌트 | **변경 없음** |

### 현재 드로우 흐름

```
pointerMove 이벤트
  └─ enqueue(async () => {               // 직렬화 큐
       const result = await invoke(       // IPC 왕복 (~5-20ms)
         "canvas_editor_dispatch_pointer", ...
       );
       // cacheKey 체크 → composites 없으면 또 IPC
       if (!drawCompositesRef.current) {
         const composites = await invoke("canvas_editor_get_layer_composites", ...);
         // decodeRgbaBase64 × 2
       }
       applyPatchWithComposites(          // 수작업 보정 합성
         bitmap, patch, underlay, overlay
       );
       setBitmapVersion(v => v + 1);
     });
```

### 현재 move finalize 흐름

```
pointerUp (hadMovePreview = true)
  └─ enqueue(async () => {
       const result = await invoke("canvas_editor_dispatch_pointer", ...);
       // applyPatch를 쓰면 다른 레이어 픽셀 날아감
       // → snapshot 전체를 다시 받아야 함
       const snap = await invoke("canvas_editor_get_snapshot", ...);
       decodeRgbaBase64(snap.rgbaBase64);  // base64 디코딩
       setBitmap(...);
     });
```

---

## 목표 구조

### 프로세스 구조

```
┌──────────────────────────────────────────────────────────┐
│                  Renderer Process                        │
│                                                          │
│  React UI                                                │
│     ↕ (동기 함수 호출)                                   │
│  canvas-engine (WASM 모듈)                               │
│     - Layer 1 bitmap  ─┐                                 │
│     - Layer 2 bitmap  ─┼─ WASM linear memory            │
│     - Layer 3 bitmap  ─┘   (JS에서 ArrayBuffer로 접근)  │
│     - undo/redo 스택                                     │
│     - 합성 연산                                          │
│     ↓ (Uint8Array view, 복사 없음)                       │
│  CanvasRenderer (WebGL/Canvas)                           │
└──────────────────────────────────────────────────────────┘
         ↕ (파일 저장/불러오기만)
┌──────────────────────────────────────────────────────────┐
│              Tauri Backend Process                       │
│  - 프로젝트 파일 관리                                    │
│  - PNG/스프라이트 저장·불러오기                          │
│  - canvas 관련 IPC 커맨드 없음                           │
└──────────────────────────────────────────────────────────┘
```

### 목표 파일 구조

```
the-battle-cats-sprite-modder/
├── src-tauri/
│   ├── canvas-engine/                  ← 신규 독립 크레이트
│   │   ├── Cargo.toml                  [lib] crate-type = ["cdylib", "rlib"]
│   │   └── src/
│   │       ├── lib.rs                  pub mod 진입점
│   │       ├── state.rs                ← 이동 (변경 없음)
│   │       ├── history.rs              ← 이동 (변경 없음)
│   │       ├── input.rs                ← 이동 (변경 없음)
│   │       ├── tools.rs                ← 이동 (변경 없음)
│   │       ├── tools_draw.rs           ← 이동 (변경 없음)
│   │       ├── tools_select.rs         ← 이동 (변경 없음)
│   │       ├── tools_move.rs           ← 이동 (변경 없음)
│   │       ├── shortcuts.rs            ← 이동 (변경 없음)
│   │       ├── types.rs                ← 이동 (base64 관련 타입 제거)
│   │       └── wasm_api.rs             ← 신규 (~150줄)
│   │
│   └── src/
│       ├── canvas_editor/              ← 전체 삭제
│       └── commands/
│           └── canvas_editor.rs        ← 삭제
│
├── src/
│   ├── wasm/
│   │   └── canvas-engine/              ← wasm-pack 빌드 출력물
│   │       ├── canvas_engine.js
│   │       ├── canvas_engine_bg.wasm
│   │       └── canvas_engine.d.ts
│   │
│   └── features/canvas-editor/
│       ├── engine.ts                   ← 신규 (WASM 래퍼, ~20줄)
│       ├── backend.ts                  ← 삭제
│       ├── types.ts                    ← 유지
│       ├── render.ts                   ← 변경 없음
│       ├── panel/
│       │   ├── movePreview.ts          ← 유지
│       │   ├── status.ts               ← 유지
│       │   └── color.ts                ← 유지
│       ├── hooks/
│       │   ├── useCanvasSessionQueue.ts    ← 삭제
│       │   ├── useCanvasRenderBridge.ts    ← init 부분 재작성
│       │   ├── useCanvasInputController.ts ← 대폭 단순화
│       │   ├── useCanvasActions.ts         ← sync로 재작성
│       │   └── usePaletteController.ts     ← 소폭 수정
│       └── components/                 ← 변경 없음
```

### 목표 드로우 흐름

```
pointerMove 이벤트
  └─ const result = editorRef.current.dispatch_pointer("move", x, y, -1);
     // 동기, ~0.01ms
     applyPatch(bitmap, result.patch);
     setBitmapVersion(v => v + 1);
```

### 목표 move finalize 흐름

```
pointerUp
  └─ const result = editorRef.current.dispatch_pointer("up", x, y, 0);
     // 동기, 합성 결과가 즉시 정확함
     // getSnapshot IPC 불필요
     const newBitmap = editorRef.current.get_composite_bitmap();
     setBitmap(new Uint8ClampedArray(newBitmap));
```

---

## 삭제되는 보정 코드 목록

WASM 마이그레이션 완료 시 아래 코드들은 모두 존재 이유가 사라져 삭제된다.

| 코드 | 존재 이유 | 삭제 이유 |
|------|-----------|-----------|
| `applyPatchWithComposites()` | IPC 패치를 언더레이/오버레이로 재합성 | WASM이 정확한 composite 직접 반환 |
| `applyPatch()` | 합성 없이 raw 패치 적용 | 위와 동일 |
| `decodeRgbaBase64()` | base64 → Uint8ClampedArray | WASM이 binary 직접 반환 |
| `drawCompositesRef` | 드로우 중 언더레이/오버레이 캐싱 | WASM 메모리에 항상 있음 |
| `prefetchDrawComposites()` | 레이어 변경 후 첫 스트로크 레이턴시 숨기기 | IPC가 없으니 레이턴시 자체가 없음 |
| `latestStatusRef` 패턴 | async 콜백 안에서 최신 status 접근 | async 콜백 자체가 사라짐 |
| `enqueue()` 직렬화 큐 | 비동기 IPC 경쟁 조건 방지 | WASM 호출은 동기, 경쟁 없음 |
| `hadMovePreview` 분기 | snapshot vs applyPatch 중 선택 | WASM은 항상 정확, 분기 불필요 |
| `getSnapshot()` after move | applyPatch가 다른 레이어 덮어써서 | WASM composite가 즉시 정확함 |
| `sessionIdRef` | IPC마다 세션 ID 전달 | 세션 ID 개념 사라짐 |
| `useCanvasSessionQueue.ts` | Promise 큐 | 전체 파일 삭제 |
| `backend.ts` (invoke 래퍼 전체) | IPC 추상화 | 전체 파일 삭제 |
| `commands/canvas_editor.rs` | 22개 Tauri 커맨드 | 전체 파일 삭제 |
| `canvas_editor/session_store.rs` | 전역 세션 HashMap | 전체 파일 삭제 |
| `canvas_editor/api.rs` (base64 메서드) | IPC 직렬화용 | WASM API로 대체 |

---

## 마이그레이션 단계

### Phase 0 — 빌드 툴링

- `wasm-pack` 설치
- `vite-plugin-wasm`, `vite-plugin-top-level-await` 추가
- `canvas-engine/` 크레이트 뼈대 생성 및 `cargo check --target wasm32-unknown-unknown` 통과 확인

### Phase 1 — 엔진 크레이트 추출

- `state.rs`, `history.rs`, `input.rs`, `tools*.rs`, `shortcuts.rs`, `types.rs`를 `canvas-engine/src/`로 이동 (코드 변경 없음)
- Tauri 빌드는 `canvas-engine`을 path 의존성으로 참조하여 기존과 동일하게 작동

### Phase 2 — WASM 바인딩 작성

`wasm_api.rs` 신규 작성. `session_store` + `api.rs`의 역할을 대체.

```rust
#[wasm_bindgen]
pub struct CanvasEditor { inner: Editor }

#[wasm_bindgen]
impl CanvasEditor {
    #[wasm_bindgen(constructor)]
    pub fn new(width: u32, height: u32) -> CanvasEditor;

    // 모두 동기 함수, JsValue로 EditorStatus 반환 (serde-wasm-bindgen)
    pub fn dispatch_pointer(&mut self, kind: &str, x: i32, y: i32, button: i32) -> JsValue;
    pub fn dispatch_shortcut(&mut self, key: &str, ctrl: bool, shift: bool, alt: bool) -> JsValue;
    pub fn set_tool(&mut self, tool: &str) -> JsValue;
    // ... 레이어 조작 메서드들

    // 픽셀 데이터 접근 (base64 없음)
    pub fn get_composite_bitmap(&self) -> Vec<u8>;   // → JS Uint8Array
    pub fn get_layer_bitmap(&self, layer_id: u32) -> Vec<u8>;
    pub fn load_layer_pixels(&mut self, layer_id: u32, data: &[u8]);
    pub fn get_move_preview_data(&mut self) -> JsValue; // ArrayBuffer 직접
}
```

### Phase 3 — JS 프론트엔드 재작성

- `backend.ts` 삭제, `engine.ts` 신규 작성
- `useCanvasSessionQueue.ts` 삭제
- `useCanvasInputController.ts`: 650줄 → ~200줄 (async/enqueue/composites 보정 코드 전체 제거)
- `useCanvasActions.ts`: ~190줄 → ~100줄 (모두 동기 호출)
- `useCanvasRenderBridge.ts`: `createSession` + `getSnapshot` IPC → `new CanvasEditor()` + `get_composite_bitmap()`

### Phase 4 — Tauri 백엔드 정리

- `src/canvas_editor/` 전체 삭제
- `commands/canvas_editor.rs` 삭제
- `lib.rs`의 22개 커맨드 등록 제거
- 파일 저장/불러오기 커맨드만 남김

### Phase 5 — 렌더 파이프라인 연결

- `CanvasRenderer` 자체는 변경 없음
- 데이터 공급원만 IPC 응답 → WASM 직접 호출로 교체
- 버전 카운터 (`bitmapVersion` 등) 패턴 유지

---

## 주의사항

**Windows `wasm-pack` 경로**: Phase 0에서 빌드 검증을 먼저 완료한 후 Phase 1을 시작한다.

**composite 전체 복사 비용**: `get_composite_bitmap()`은 매번 `Vec<u8>`을 복사해서 반환한다. 레이어 변경/undo/redo처럼 전체 합성이 바뀌는 경우에만 호출하고, 드로우 스트로크 중에는 기존 `applyPatch` 패턴(변경된 픽셀만 업데이트)을 유지한다.

**단계별 병행 운용**: Phase 1~2는 기존 Tauri IPC 경로와 공존한다. Phase 3에서 JS를 전환하고 Phase 4에서 Tauri 커맨드를 정리한다. 각 Phase 완료 후 앱이 정상 동작하는지 확인하면서 진행할 수 있다.
