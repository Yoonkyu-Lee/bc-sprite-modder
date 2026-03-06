import { useEffect, useRef } from "react";
import { WorkspaceProvider, useWorkspace } from "./stores/workspaceStore";
import { ProjectProvider } from "./stores/projectStore";
import { AppShell } from "./components/AppShell";

function AppContent() {
  const { workspacePath, isLoading, error, selectWorkspace, refreshWorkspace, clearError } = useWorkspace();
  const logged = useRef(false);

  useEffect(() => {
    if (!logged.current) {
      console.log("[init] AppContent: refreshWorkspace 호출 시작", new Date().toISOString());
      logged.current = true;
    }
    refreshWorkspace();
  }, [refreshWorkspace]);

  useEffect(() => {
    console.log("[init] AppContent 상태:", { isLoading, hasWorkspace: !!workspacePath, error: error ?? "(없음)" });
  }, [isLoading, workspacePath, error]);

  if (isLoading) {
    console.log("[init] 화면: 'Workspace 불러오는 중' 표시");
    return (
      <div className="app-workspace-loading">
        <p>Workspace 불러오는 중…</p>
      </div>
    );
  }

  if (!workspacePath) {
    console.log("[init] 화면: Workspace 선택(데이터 준비) 화면 표시");
    return (
      <div className="app-workspace-picker">
        <h1>Battle Cats Sprite Modder</h1>
        <p>작업할 Workspace 폴더를 선택하세요.</p>
        {error && (
          <p className="error" onClick={clearError}>
            {error}
          </p>
        )}
        <button type="button" onClick={selectWorkspace}>
          폴더 선택
        </button>
      </div>
    );
  }

  console.log("[init] 화면: 메인 앱(탭) 표시");
  return (
    <div className="app">
      <ProjectProvider>
        <AppShell />
      </ProjectProvider>
    </div>
  );
}

function App() {
  return (
    <WorkspaceProvider>
      <AppContent />
    </WorkspaceProvider>
  );
}

export default App;
