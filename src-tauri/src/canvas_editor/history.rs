use std::collections::HashMap;

use super::state::{Editor, PixelChange};
use super::types::{EditorEventResult, PixelPatch};

impl Editor {
    fn reversed_patch(patch: &PixelPatch) -> PixelPatch {
        PixelPatch {
            changed_indices: patch.changed_indices.clone(),
            before: patch.after.clone(),
            after: patch.before.clone(),
        }
    }

    pub(crate) fn patch_from_changes(changes: &HashMap<u32, PixelChange>) -> Option<PixelPatch> {
        if changes.is_empty() {
            return None;
        }
        let mut changed_indices = Vec::with_capacity(changes.len());
        let mut before = Vec::with_capacity(changes.len() * 4);
        let mut after = Vec::with_capacity(changes.len() * 4);
        for (idx, c) in changes {
            changed_indices.push(*idx);
            before.extend_from_slice(&c.before);
            after.extend_from_slice(&c.after);
        }
        Some(PixelPatch {
            changed_indices,
            before,
            after,
        })
    }

    pub(crate) fn apply_patch(&mut self, patch: &PixelPatch, undo: bool) {
        let src = if undo { &patch.before } else { &patch.after };
        for (n, idx) in patch.changed_indices.iter().enumerate() {
            let j = n * 4;
            Self::set_rgba(&mut self.bitmap, *idx, [src[j], src[j + 1], src[j + 2], src[j + 3]]);
        }
    }

    pub(crate) fn push_history(&mut self, patch: PixelPatch) {
        const MAX_HISTORY: usize = 128;
        self.undo_stack.push(patch);
        if self.undo_stack.len() > MAX_HISTORY {
            self.undo_stack.remove(0);
        }
        self.redo_stack.clear();
    }

    pub(crate) fn undo(&mut self) -> EditorEventResult {
        if self.pointer.move_base_bitmap.is_some() {
            self.cancel_move_session();
        }
        let patch = self.undo_stack.pop();
        let mut applied_patch = None;
        if let Some(ref pch) = patch {
            self.apply_patch(pch, true);
            self.redo_stack.push(pch.clone());
            applied_patch = Some(Self::reversed_patch(pch));
            self.message = Some("UNDO".into());
        }
        EditorEventResult {
            status: self.status(),
            patch: applied_patch,
            consumed: true,
        }
    }

    pub(crate) fn redo(&mut self) -> EditorEventResult {
        if self.pointer.move_base_bitmap.is_some() {
            self.cancel_move_session();
        }
        let patch = self.redo_stack.pop();
        if let Some(ref pch) = patch {
            self.apply_patch(pch, false);
            self.undo_stack.push(pch.clone());
            self.message = Some("REDO".into());
        }
        EditorEventResult {
            status: self.status(),
            patch,
            consumed: true,
        }
    }
}
