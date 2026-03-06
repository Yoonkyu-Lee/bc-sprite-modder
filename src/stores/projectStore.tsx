import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";

const SETTINGS_STORE = "app-settings.json";
const KEY_CURRENT_PROJECT = "current_project_path";

export type ProjectEntry = {
  path: string;
  meta: {
    name: string;
    description: string;
    created?: string;
    modified?: string;
    dataset?: unknown;
  };
};

export type DatasetEntry = {
  server: string;
  version: string;
  path: string;
  display: string;
};

type ProjectContextValue = {
  currentProjectPath: string | null;
  setCurrentProjectPath: (path: string | null) => void;
};

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [currentProjectPath, setCurrentProjectPathState] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const store = await load(SETTINGS_STORE, { autoSave: true });
        const saved = await store.get<string>(KEY_CURRENT_PROJECT);
        if (!cancelled && saved != null && saved !== "") {
          setCurrentProjectPathState(saved);
        }
      } catch {
        // Store 미사용 시 무시
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setCurrentProjectPath = useCallback(async (path: string | null) => {
    setCurrentProjectPathState(path);
    try {
      const store = await load(SETTINGS_STORE, { autoSave: true });
      if (path != null) {
        await store.set(KEY_CURRENT_PROJECT, path);
      } else {
        await store.delete(KEY_CURRENT_PROJECT);
      }
      await store.save();
    } catch {
      // 저장 실패 시 메모리 상태만 유지
    }
  }, []);

  const value: ProjectContextValue = {
    currentProjectPath,
    setCurrentProjectPath,
  };

  return (
    <ProjectContext.Provider value={value}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used within ProjectProvider");
  return ctx;
}

export async function listDatasets(workspacePath: string): Promise<DatasetEntry[]> {
  return invoke("list_datasets", { workspacePath });
}

export async function listProjects(workspacePath: string): Promise<ProjectEntry[]> {
  return invoke("list_projects", { workspacePath });
}

export async function createProject(
  workspacePath: string,
  name: string,
  description: string,
  dataset: { server: string; version: string; path?: string }
): Promise<string> {
  return invoke("create_project", {
    workspacePath,
    name,
    description,
    dataset: {
      server: dataset.server,
      version: dataset.version,
      path: dataset.path ?? null,
    },
  });
}
