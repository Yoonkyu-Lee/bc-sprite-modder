import { useState, useEffect, useCallback } from "react";
import { useWorkspace } from "../stores/workspaceStore";
import { useProject } from "../stores/projectStore";
import { invoke } from "@tauri-apps/api/core";
import { SpriteEditorProvider, useSpriteEditor, type UnitFormEntry } from "../stores/spriteEditorStore";
import { SpriteEditorView } from "../components/SpriteEditorView";

function SpritePageContent() {
  const { workspacePath } = useWorkspace();
  const { currentProjectPath } = useProject();
  const { unitForms, setUnitForms, setSelected, setSearchQuery, selectedUnitId, selectedForm, searchQuery } =
    useSpriteEditor();
  const filteredForms = unitForms.filter(
    (u) =>
      u.display.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.unit_id.includes(searchQuery)
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadUnitForms = useCallback(async () => {
    if (!workspacePath || !currentProjectPath) return;
    console.log("[list_unit_forms] 호출", { workspacePath, currentProjectPath });
    setLoading(true);
    setError(null);
    try {
      const list = await invoke<UnitFormEntry[]>("list_unit_forms", {
        args: {
          workspacePath,
          projectDir: currentProjectPath,
        },
      });
      console.log("[list_unit_forms] 수신:", list?.length ?? 0, "개");
      setUnitForms(list ?? []);
    } catch (e) {
      console.warn("[list_unit_forms] 실패", e);
      setError(e instanceof Error ? e.message : String(e));
      setUnitForms([]);
    } finally {
      setLoading(false);
    }
  }, [workspacePath, currentProjectPath, setUnitForms]);

  // 워크스페이스/프로젝트가 바뀔 때만 목록 로드
  useEffect(() => {
    if (workspacePath && currentProjectPath) {
      loadUnitForms();
    }
  }, [workspacePath, currentProjectPath, loadUnitForms]);

  if (!currentProjectPath) {
    return (
      <div className="page">
        <h2>스프라이트 편집</h2>
        <p>프로젝트를 선택하면 유닛·폼 목록을 불러옵니다.</p>
      </div>
    );
  }

  return (
    <div className="page sprite-page">
      <h2>스프라이트 편집</h2>
      <div className="sprite-layout">
        <aside className="sprite-browser">
          <p>유닛·폼 선택 (클릭 시 편집 화면에 로드)</p>
          <button type="button" onClick={loadUnitForms} disabled={loading}>
            {loading ? "불러오는 중…" : "다시 불러오기"}
          </button>
          <input
            type="text"
            placeholder="유닛 ID·폼 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="sprite-browser-search"
          />
          {error && <p className="error">{error}</p>}
          <ul className="unit-form-browser-list">
            {filteredForms.map((u) => (
              <li
                key={`${u.unit_id}_${u.form}`}
                className={selectedUnitId === u.unit_id && selectedForm === u.form ? "selected" : ""}
                onClick={() => setSelected(u.unit_id, u.form)}
              >
                {u.display}
              </li>
            ))}
          </ul>
        </aside>
        <section className="sprite-editor-area">
          {selectedUnitId && selectedForm ? (
            <SpriteEditorView />
          ) : (
            <div className="sprite-editor-placeholder">
              <p>좌측에서 유닛·폼을 선택하면 편집 화면이 표시됩니다.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export function SpritePage() {
  return (
    <SpriteEditorProvider>
      <SpritePageContent />
    </SpriteEditorProvider>
  );
}
