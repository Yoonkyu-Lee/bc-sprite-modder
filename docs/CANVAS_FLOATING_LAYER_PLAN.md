# 캔버스 플로팅 레이어 전환 계획

## 목표

현재 선택 이동 시 사용하는 "3버퍼 시뮬레이션" 방식을 포토샵의 FloatingLayer 개념에 맞게 구조 전환.

---

## 변수 분석: 현재 구현과 포토샵의 차이점

### 변수 1 (핵심): `composite_bitmap()`이 FloatingLayer를 모른다

**현재 방식:**
- Move 세션 중에도 소스 레이어의 `bitmap`은 **수정되지 않는다**
- 렌더링은 프론트엔드 WebGL이 `underlay / floating / overlay` 3버퍼로 처리
- `composite_bitmap()`은 레이어 bitmap만 합성 → move 세션 중 호출 시 **이동 전 상태** 반환
- 현재는 프론트엔드가 move 중에 `get_snapshot`을 사용하지 않아서 숨겨진 문제

**Burn 방식(포토샵식)으로 바꾸면:**
- move 시작 시 소스 레이어에 구멍(hole)을 실제로 burn
- `composite_bitmap()`은 구멍 뚫린 레이어만 보므로 **FloatingLayer를 모르면 깨진 이미지 반환**
- `get_snapshot`, undo 스택 커밋, 향후 실시간 썸네일 등 모든 composite 호출에서 FloatingLayer를 합성해야 함

**결론:** Burn 방식으로 전환하면 `composite_bitmap()`에 FloatingLayer 합성 로직 추가가 필수.

---

### 변수 2 (잠재적 버그): 레이어 opacity가 floating block에 적용되지 않음

**현재 방식:**
- `build_move_preview_cache()`에서 `selected_block`은 `active_bitmap()`의 raw RGBA를 그대로 복사
- `underlay` 계산 시에는 `layer.opacity`를 알파에 곱해서 합성
- floating block은 opacity 미적용 → **활성 레이어 opacity < 255일 때 시각적 불일치**

```
underlay: layer.opacity 적용됨  ✓
floating block: layer.opacity 미적용  ✗ ← 잠재적 버그
overlay: layer.opacity 적용됨  ✓
```

**FloatingLayer 구조체로 전환하면:**
- `FloatingLayer { opacity: u8, ... }`에 소스 레이어의 opacity를 복사
- 프론트엔드 렌더 시 해당 opacity 적용 → 자연스럽게 해결

---

## 구현 옵션

### Option A: 완전한 Burn 방식 (포토샵 원리 그대로)

move 시작 시 소스 레이어 bitmap에 즉시 구멍 burn.

```
FloatingLayer {
    source_layer_id: u32,
    bitmap: Vec<u8>,      // 선택된 픽셀들
    offset: Point,        // 현재 오프셋
    bounds: Rect,         // 원본 바운딩박스
    opacity: u8,          // 소스 레이어에서 복사
}
```

**장점:**
- 포토샵과 내부 원리 동일
- `composite_bitmap()`이 항상 정확한 상태 반환 (FloatingLayer 합성 후)
- 향후 크로스 레이어 drop target 지원 구조적으로 깔끔

**단점:**
- `composite_bitmap()`에 FloatingLayer 합성 로직 추가 필요
- move 시작 시 소스 레이어를 실제로 수정하므로 cancel 시 복원 로직 필요
- 변경 범위가 넓음

**변경 파일:**
- `state.rs`: `PointerSession` move 필드들 → `FloatingLayer` 구조체로 대체
- `api.rs`: `composite_bitmap()` → FloatingLayer 인식 추가, `build_move_preview_cache()` 수정
- `input.rs`: `handle_pointer_down` Move 세션 시작 시 burn 로직
- `history.rs`: undo/redo 중 cancel → 구멍 복원 로직 (현재와 유사)

---

### Option B: 구조만 FloatingLayer로 정리 (Lazy 방식 유지)

소스 레이어 bitmap은 건드리지 않고, 데이터를 `FloatingLayer` 구조체로 정리만 함.

```
FloatingLayer {
    source_layer_id: u32,
    bitmap: Vec<u8>,      // ← 현재 MovePreviewCache.selected_block
    offset: Point,        // ← 현재 move_current_delta
    bounds: Rect,         // ← 현재 move_selection_bounds
    opacity: u8,          // ← 현재 누락된 필드, 신규 추가
}
```

**장점:**
- `composite_bitmap()` 수정 불필요 (현재처럼 move 중에도 pre-move 상태 반환, 문제없음)
- 변경 범위 좁음: `PointerSession` 필드 재구성 + `MovePreviewCache` 일부 통합
- opacity 버그 수정 포함
- 크로스 레이어 붙여넣기도 `source_layer_id`를 추가하면 지원 가능

**단점:**
- 포토샵과 내부 원리가 완전히 같지는 않음
- 향후 "move 중 get_snapshot 정확도" 요구 시 추가 작업 필요

---

## 권장 방향

**Option B 선택 후 단계적으로 Option A로 이행.**

이유:
1. 현재 개발 단계에서 `composite_bitmap()` 리팩터는 불필요한 범위 확대
2. 구조적 정리(FloatingLayer 구조체화 + opacity 버그 수정)만으로도 목표 달성
3. 향후 크로스 레이어 기능 추가 시 그 시점에 Burn 방식으로 전환하는 것이 자연스러움

---

## 최종 구조 변경 요약 (Option B 기준)

### 제거

| 현재 위치 | 필드 | 대체 |
|----------|------|------|
| `PointerSession` | `move_selected_mask` | `FloatingLayer` 내부로 |
| `PointerSession` | `move_current_delta` | `FloatingLayer.offset` |
| `PointerSession` | `move_selection_bounds` | `FloatingLayer.bounds` |
| `PointerSession` | `move_base_bitmap` | `FloatingLayer` cancel 시 `selected_block` 복원으로 대체 |
| `MovePreviewCache` | `selected_block` | `FloatingLayer.bitmap`과 통합 |
| `MovePreviewCache` | `selected_indices_vec` | `FloatingLayer` 내부 |

### 추가

| 위치 | 내용 |
|------|------|
| `Editor` | `floating_layer: Option<FloatingLayer>` |
| `FloatingLayer` | `opacity: u8` (opacity 버그 수정) |
| `FloatingLayer` | `source_layer_id: u32` (크로스 레이어 준비) |

### 유지

| 항목 | 이유 |
|------|------|
| `MovePreviewCache.underlay` / `overlay` | 렌더링 성능 캐시, 동일하게 활용 |
| `build_move_preview_cache()` 프리패치 | 성능 최적화, 그대로 유지 |
| `composite_bitmap()` | 수정 불필요 |
| `PixelPatch` undo/redo 시스템 | 동일하게 활용 |
| `alpha_blend()` | 동일 |
| `selected_indices: HashSet<u32>` | 선택 SoT 동일 |

---

## 프론트엔드 변경 사항

- `MovePreviewData` 타입에 `opacity: u8` 필드 추가
- WebGL 렌더러에서 floating block 그릴 때 해당 opacity 적용
- 나머지 로직 변경 없음
