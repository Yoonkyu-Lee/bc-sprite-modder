import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

type WorkspaceContextValue = {
  workspacePath: string | null;
  isLoading: boolean;
  error: string | null;
  selectWorkspace: () => Promise<void>;
  refreshWorkspace: () => Promise<void>;
  clearError: () => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  console.log("[init] WorkspaceProvider 마운트", new Date().toISOString());

  const refreshWorkspace = useCallback(async () => {
    const t0 = performance.now();
    console.log("[init] Workspace: refreshWorkspace 시작");
    setIsLoading(true);
    setError(null);
    try {
      console.log("[init] Workspace: get_workspace invoke 호출 직전, 경과(ms):", (performance.now() - t0).toFixed(0));
      const result = await invoke<{ path: string | null }>("get_workspace");
      const elapsed = (performance.now() - t0).toFixed(0);
      console.log("[init] Workspace: get_workspace 반환, 경과(ms):", elapsed, "path:", result.path ?? "(없음)");
      setWorkspacePath(result.path ?? null);
    } catch (e) {
      const elapsed = (performance.now() - t0).toFixed(0);
      console.warn("[init] Workspace: get_workspace 실패, 경과(ms):", elapsed, e);
      setError(e instanceof Error ? e.message : String(e));
      setWorkspacePath(null);
    } finally {
      setIsLoading(false);
      console.log("[init] Workspace: refreshWorkspace 완료, 총 경과(ms):", (performance.now() - t0).toFixed(0));
    }
  }, []);

  const selectWorkspace = useCallback(async () => {
    setError(null);
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Workspace 폴더 선택",
    });
    if (selected === null || Array.isArray(selected)) return;
    setIsLoading(true);
    try {
      await invoke("set_workspace", { path: selected });
      await invoke("ensure_workspace_structure", { workspacePath: selected });
      setWorkspacePath(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const value: WorkspaceContextValue = {
    workspacePath,
    isLoading,
    error,
    selectWorkspace,
    refreshWorkspace,
    clearError,
  };

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
