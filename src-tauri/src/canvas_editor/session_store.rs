use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use super::state::Editor;

static STORE: OnceLock<Mutex<HashMap<String, Editor>>> = OnceLock::new();

fn store() -> &'static Mutex<HashMap<String, Editor>> {
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn with_editor_mut<R, F>(session_id: &str, f: F) -> Result<R, String>
where
    F: FnOnce(&mut Editor) -> R,
{
    let mut guard = store()
        .lock()
        .map_err(|_| "canvas editor lock poisoned".to_string())?;
    let Some(editor) = guard.get_mut(session_id) else {
        return Err(format!("canvas session not found: {session_id}"));
    };
    Ok(f(editor))
}

pub(crate) fn create_editor_session(
    session_id: String,
    width: u32,
    height: u32,
) -> Result<super::types::EditorStatus, String> {
    if width == 0 || height == 0 {
        return Err("width/height must be > 0".into());
    }
    let mut guard = store()
        .lock()
        .map_err(|_| "canvas editor lock poisoned".to_string())?;
    guard.insert(session_id.clone(), Editor::new(width, height));
    Ok(guard
        .get(&session_id)
        .ok_or("failed to create session".to_string())?
        .status())
}
