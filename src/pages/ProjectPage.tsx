import { useState, useEffect, useCallback } from "react";
import { useWorkspace } from "../stores/workspaceStore";
import {
  useProject,
  listProjects,
  listDatasets,
  createProject,
  type ProjectEntry,
  type DatasetEntry,
} from "../stores/projectStore";
import type { Dataset } from "../components/AppShell";

type ProjectPageProps = {
  pendingDataset: Dataset | null;
  onProjectCreated?: () => void;
};

export function ProjectPage({ pendingDataset, onProjectCreated }: ProjectPageProps) {
  const { workspacePath } = useWorkspace();
  const { currentProjectPath, setCurrentProjectPath } = useProject();
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [datasets, setDatasets] = useState<DatasetEntry[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedDataset, setSelectedDataset] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    if (!workspacePath) return;
    setError(null);
    try {
      const [projList, dsList] = await Promise.all([
        listProjects(workspacePath),
        listDatasets(workspacePath),
      ]);
      setProjects(projList);
      setDatasets(dsList);
      setSelectedDataset((prev) => {
        if (pendingDataset) return pendingDataset;
        if (prev) return prev;
        if (dsList.length > 0)
          return {
            server: dsList[0].server,
            version: dsList[0].version,
            path: dsList[0].path,
          };
        return null;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [workspacePath, pendingDataset]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (pendingDataset) setSelectedDataset(pendingDataset);
  }, [pendingDataset]);

  const getEffectiveDataset = (): Dataset | null => {
    if (selectedDataset) return selectedDataset;
    if (datasets.length > 0) {
      const d = datasets[0];
      return { server: d.server, version: d.version, path: d.path };
    }
    return null;
  };

  const handleCreate = async () => {
    if (!workspacePath) return;
    const dataset = getEffectiveDataset();
    if (!dataset) {
      setError("데이터 셋이 없습니다. 데이터 준비 탭에서 먼저 준비하거나 BCData를 확인하세요.");
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      setError("프로젝트 이름을 입력하세요.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const path = await createProject(workspacePath, trimmed, description.trim(), dataset);
      onProjectCreated?.();
      setCurrentProjectPath(path);
      setName("");
      setDescription("");
      setSelectedDataset(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleDoubleClick = (entry: ProjectEntry) => {
    setCurrentProjectPath(entry.path);
  };

  return (
    <div className="page project-page">
      <h2>프로젝트</h2>

      <section className="project-form">
        <h3>새 프로젝트</h3>
        <div className="form-row">
          <label>
            이름:
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="프로젝트 이름"
            />
          </label>
        </div>
        <div className="form-row">
          <label>
            설명:
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="설명 (선택)"
              rows={2}
            />
          </label>
        </div>
        <div className="form-row dataset-row">
          <span className="label">데이터 셋:</span>
          {pendingDataset ? (
            <span className="dataset-display">
              선택됨: {pendingDataset.server.toUpperCase()} {pendingDataset.version} (방금 데이터 준비한 셋)
            </span>
          ) : datasets.length > 0 ? (
            <select
              value={selectedDataset ? `${selectedDataset.server}:${selectedDataset.version}` : ""}
              onChange={(e) => {
                const v = e.target.value;
                const d = datasets.find((x) => `${x.server}:${x.version}` === v);
                if (d) setSelectedDataset({ server: d.server, version: d.version, path: d.path });
              }}
            >
              {datasets.map((d) => (
                <option key={`${d.server}:${d.version}`} value={`${d.server}:${d.version}`}>
                  {d.display}
                </option>
              ))}
            </select>
          ) : (
            <span className="dataset-display">
              데이터 셋이 없습니다. [데이터 준비]에서 먼저 준비하세요.
            </span>
          )}
        </div>
        <button type="button" onClick={handleCreate} disabled={creating || !workspacePath}>
          {creating ? "생성 중…" : "프로젝트 생성"}
        </button>
      </section>

      {error && (
        <p className="error" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      <section className="project-list">
        <h3>프로젝트 목록</h3>
        <button type="button" onClick={refresh} className="refresh-btn">
          목록 새로고침
        </button>
        <ul className="project-entries">
          {projects.map((entry) => (
            <li
              key={entry.path}
              className={currentProjectPath === entry.path ? "current" : ""}
              onDoubleClick={() => handleDoubleClick(entry)}
            >
              <strong>{entry.meta.name}</strong>
              {entry.meta.description && ` — ${entry.meta.description.slice(0, 50)}${entry.meta.description.length > 50 ? "…" : ""}`}
            </li>
          ))}
        </ul>
        {currentProjectPath && (
          <p className="current-project">현재 프로젝트: {currentProjectPath}</p>
        )}
      </section>
    </div>
  );
}
