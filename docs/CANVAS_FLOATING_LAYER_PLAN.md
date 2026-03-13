# 캔버스 플로팅 레이어 전환 계획

## 목표

현재 선택 이동 시 사용하는 "3버퍼 시뮬레이션" 방식을 포토샵의 FloatingLayer 개념에 맞게 구조 전환.
소스 레이어에 구멍(hole)을 실제로 burn하고, `composite_bitmap()`이 FloatingLayer를 직접 합성.

---

## 현재 구현의 구조적 문제

| 문제 | 현상 | 영향 |
|------|------|------|
| `composite_bitmap()`이 FloatingLayer를 모름 | move 세션 중 snapshot이 이동 전 상태 반환 | `get_snapshot`, undo, 썸네일 등에서 잘못된 이미지 |
| 레이어 opacity가 floating block에 미적용 | `selected_block`은 raw RGBA, underlay는 opacity 적용됨 | 활성 레이어 opacity < 255일 때 floating block이 다른 투명도로 렌더됨 |

---

## 전환 후 아키텍처

### 새 구조체: `FloatingLayer`

```rust
pub(crate) struct FloatingLayer {
    pub(crate) source_layer_id: u32,       // 원본 레이어
    pub(crate) bitmap: Vec<u8>,            // 선택된 픽셀 (canvas 좌표 기준 full-size)
    pub(crate) selected_indices: Vec<u32>, // 선택 픽셀 인덱스
    pub(crate) offset: Point,              // 현재 이동 오프셋
    pub(crate) bounds: Rect,               // 원본 바운딩박스
    pub(crate) opacity: u8,                // 소스 레이어에서 복사 (opacity 버그 수정)
    pub(crate) original_pixels: Vec<u8>,   // hole 복원용 스냅샷 (선택 픽셀만, ~N*4바이트)
}
```

### `Editor`에 추가

```rust
pub(crate) floating_layer: Option<FloatingLayer>,
```

### `PointerSession`에서 제거

```rust
// 제거
move_base_bitmap: Option<Vec<u8>>,     // FloatingLayer.original_pixels로 대체 (전체 레이어 → 선택 픽셀만)
move_selected_mask: Vec<u8>,           // FloatingLayer 내부로
move_selection_bounds: Option<Rect>,   // FloatingLayer.bounds로
move_current_delta: Point,             // FloatingLayer.offset으로
```

---

## `composite_bitmap()` 변경

기존 레이어 합성 후 FloatingLayer를 오프셋 적용해서 합성. 약 20줄 추가.

```rust
pub(crate) fn composite_bitmap(&self) -> Vec<u8> {
    let mut out = vec![0u8; (self.width * self.height * 4) as usize];

    // 기존: 일반 레이어 합성 (소스 레이어는 hole이 burn된 상태)
    for layer in &self.layers { ... }

    // 추가: FloatingLayer를 offset 적용해서 합성
    if let Some(ref fl) = self.floating_layer {
        for idx in &fl.selected_indices {
            let src_x = (*idx % self.width) as i32 + fl.offset.x;
            let src_y = (*idx / self.width) as i32 + fl.offset.y;
            if src_x < 0 || src_y < 0 || src_x >= self.width as i32 || src_y >= self.height as i32 {
                continue;
            }
            let dst_idx = src_y as u32 * self.width + src_x as u32;
            let src_raw = Self::rgba_at(&fl.bitmap, *idx);
            let src = [src_raw[0], src_raw[1], src_raw[2],
                       ((src_raw[3] as u16 * fl.opacity as u16) / 255) as u8];
            let dst = Self::rgba_at(&out, dst_idx);
            Self::set_rgba(&mut out, dst_idx, Self::alpha_blend(src, dst));
        }
    }
    out
}
```

---

## Move 세션 흐름 변경

### 시작 (`handle_pointer_down` Move)

```
현재: move_base_bitmap = active_bitmap().to_vec()  (전체 레이어 ~4MB 복사)
변경: FloatingLayer 생성 + 소스 레이어에 hole burn
```

1. `selected_indices`로 FloatingLayer 생성 (bitmap, original_pixels 복사)
2. 소스 레이어의 선택 픽셀을 투명으로 burn
3. `self.floating_layer = Some(fl)`

### 이동 중 (`update_move_preview_state`)

```
현재: move_current_delta 업데이트 → selection.move_delta 업데이트
변경: floating_layer.offset 업데이트 → selection.move_delta 업데이트
```

### 커밋 (`finalize_move_session`)

```
현재: move_base_bitmap에서 선택 영역 지우고, offset 위치에 픽셀 기록 → PixelPatch
변경: source_layer hole + FloatingLayer offset 위치 픽셀을 합쳐서 PixelPatch 생성
```

`before`: source_layer_id 기준 hole 픽셀들 + offset 위치 기존 픽셀들
`after`: hole은 투명, offset 위치에 FloatingLayer 픽셀 합성

### 취소 (`cancel_move_session`)

```
현재: move_base_bitmap으로 active_bitmap 전체 복원
변경: original_pixels로 선택 픽셀만 복원 (훨씬 가볍고 명확)
```

---

## 프론트엔드 렌더링

3버퍼 WebGL 렌더링(`underlay / floating / overlay`)은 **성능상 그대로 유지**.
`composite_bitmap()` 정확도와 프론트엔드 실시간 렌더링은 독립적으로 공존.

변경 사항:
- `MovePreviewData`에 `opacity: u8` 필드 추가
- WebGL 렌더러에서 floating block 그릴 때 해당 opacity 적용

---

## 변경 범위 요약

| 파일 | 변경 내용 |
|------|---------|
| `state.rs` | `FloatingLayer` 구조체 추가, `PointerSession` move 필드 제거, `Editor.floating_layer` 추가 |
| `api.rs` | `composite_bitmap()` FloatingLayer 합성 추가, `build_move_preview_cache()` opacity 전달 |
| `input.rs` | Move 세션 시작(burn), `update_move_preview_state` offset 업데이트 |
| `history.rs` | undo/redo: `cancel_move_session` 취소 후 진행 (로직 동일, 구현만 변경) |
| 타입 파일 | `MovePreviewData`에 `opacity` 추가 |
| 프론트엔드 훅/WebGL | opacity 필드 수신 및 floating 렌더 시 적용 |

## 유지되는 것

| 항목 | 이유 |
|------|------|
| `MovePreviewCache.underlay` / `overlay` | 렌더링 성능 캐시, 동일하게 활용 |
| `build_move_preview_cache()` 프리패치 구조 | 성능 최적화 그대로 |
| `PixelPatch` undo/redo 시스템 | 동일하게 활용 |
| `alpha_blend()` | 수식 동일 |
| `selected_indices: HashSet<u32>` | 선택 SoT 동일 |
| 프론트엔드 3버퍼 WebGL 렌더링 | 실시간 성능, 그대로 유지 |
