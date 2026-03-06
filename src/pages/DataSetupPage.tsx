import { useState, useEffect, useRef, useCallback } from "react";
import { useWorkspace } from "../stores/workspaceStore";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

type Dataset = { server: string; version: string; path: string };

type ScannedDataset = {
  server: string;
  version: string;
  path: string;
  hasExtracted: boolean;
  hasManifest: boolean;
};

type DataSetupPageProps = {
  onDatasetReady?: (dataset: Dataset) => void;
};

export function DataSetupPage({ onDatasetReady }: DataSetupPageProps) {
  const { workspacePath } = useWorkspace();
  const [server, setServer] = useState("kr");
  const [version, setVersion] = useState("15.1.0");
  const [apkSource, setApkSource] = useState<"auto" | "file">("auto");
  const [apkPath, setApkPath] = useState("");
  const [forceServer, setForceServer] = useState(false);
  const [forceExtract, setForceExtract] = useState(false);
  const [forceDownloadApk, setForceDownloadApk] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [lastDataset, setLastDataset] = useState<Dataset | null>(null);
  const [scannedDatasets, setScannedDatasets] = useState<ScannedDataset[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  const scrollLogToEnd = useCallback(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollLogToEnd();
  }, [logLines, scrollLogToEnd]);

  useEffect(() => {
    const unsubLog = listen<string>("data-setup-log", (e) => {
      const payload = String(e.payload ?? "");
      const lines = payload.split(/\r?\n/).map((s) => s.trimEnd());
      setLogLines((prev) => [...prev, ...(lines.length ? lines : [payload])]);
    });
    const unsubFinished = listen<{ exitCode?: number; dataset?: Dataset | null }>(
      "data-setup-finished",
      (e) => {
        setRunning(false);
        if (e.payload.exitCode === 0) {
          if (e.payload.dataset) setLastDataset(e.payload.dataset);
          // 다운로드 또는 팩 추출 완료 시 스캔 목록 갱신
          if (workspacePath) {
            invoke<ScannedDataset[]>("scan_datasets", { workspacePath })
              .then(setScannedDatasets)
              .catch(() => {});
          }
        } else {
          setLastDataset(null);
        }
      }
    );
    return () => {
      unsubLog.then((u) => u());
      unsubFinished.then((u) => u());
    };
  }, [workspacePath]);

  const handleBrowseApk = async () => {
    const selected = await open({
      multiple: false,
      title: "APK/XAPK 선택",
      filters: [{ name: "APK", extensions: ["apk", "xapk"] }],
    });
    if (selected && !Array.isArray(selected)) setApkPath(selected);
  };

  const handleRun = async () => {
    if (!workspacePath) return;
    setLogLines([`> 데이터 다운로드 (${server}, ${version})...`]);
    setLastDataset(null);
    setRunning(true);
    try {
      await invoke("run_data_setup", {
        args: {
          workspacePath,
          server,
          version,
          apkPath: apkSource === "file" && apkPath ? apkPath : null,
          forceServerFiles: forceServer,
          forceExtract,
          forceDownloadApk,
        },
      });
    } catch (e) {
      setLogLines((prev) => [...prev, `Error: ${e}`]);
      setRunning(false);
    }
  };

  const handleScan = async () => {
    if (!workspacePath) return;
    try {
      const list = await invoke<ScannedDataset[]>("scan_datasets", { workspacePath });
      setScannedDatasets(list);
      setLogLines((prev) => [...prev, `> 스캔 완료: ${list.length}개 데이터 셋`]);
    } catch (e) {
      setLogLines((prev) => [...prev, `스캔 오류: ${e}`]);
    }
  };

  const handleExtractPacks = async (s: string, v: string) => {
    if (!workspacePath) return;
    setRunning(true);
    setLogLines((prev) => [...prev, `> 팩 추출 (${s}, ${v})...`]);
    try {
      await invoke("extract_packs", {
        args: { workspacePath, server: s, version: v },
      });
    } catch (e) {
      setLogLines((prev) => [...prev, `Error: ${e}`]);
      setRunning(false);
    }
  };

  const handleBuildManifest = async (datasetPath: string) => {
    if (!workspacePath) return;
    setRunning(true);
    setLogLines((prev) => [...prev, `> 에셋 인덱스 생성 중...`]);
    try {
      const result = await invoke<{ fileCount: number }>("build_manifest", {
        args: { workspacePath, datasetPath },
      });
      setLogLines((prev) => [
        ...prev,
        `> 인덱스 완료: ${result.fileCount}개 파일`,
      ]);
      const list = await invoke<ScannedDataset[]>("scan_datasets", { workspacePath });
      setScannedDatasets(list);
    } catch (e) {
      setLogLines((prev) => [...prev, `Error: ${e}`]);
    } finally {
      setRunning(false);
    }
  };

  const handleCreateProject = () => {
    if (lastDataset && onDatasetReady) {
      onDatasetReady(lastDataset);
    }
  };

  return (
    <div className="page data-setup-page">
      <h2>데이터 준비</h2>

      <div className="form-row">
        <label>
          서버:
          <select value={server} onChange={(e) => setServer(e.target.value)}>
            <option value="kr">한국 (KR)</option>
            <option value="jp">일본 (JP)</option>
            <option value="en">영어 (EN)</option>
            <option value="tw">대만 (TW)</option>
          </select>
        </label>
        <label>
          게임 버전:
          <input
            type="text"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="예: 15.1.0"
          />
        </label>
      </div>

      <fieldset className="apk-group">
        <legend>APK</legend>
        <label>
          <input
            type="radio"
            checked={apkSource === "auto"}
            onChange={() => setApkSource("auto")}
          />
          자동 다운로드
        </label>
        <label>
          <input
            type="radio"
            checked={apkSource === "file"}
            onChange={() => setApkSource("file")}
          />
          파일 지정
        </label>
        {apkSource === "file" && (
          <>
            <input
              type="text"
              value={apkPath}
              onChange={(e) => setApkPath(e.target.value)}
              placeholder="APK/XAPK 경로..."
              className="apk-path-input"
            />
            <button type="button" onClick={handleBrowseApk}>
              파일 찾아보기
            </button>
          </>
        )}
      </fieldset>

      <fieldset className="options-group">
        <legend>옵션</legend>
        <label>
          <input
            type="checkbox"
            checked={forceServer}
            onChange={(e) => setForceServer(e.target.checked)}
          />
          서버 팩 강제 재다운로드
        </label>
        <label>
          <input
            type="checkbox"
            checked={forceExtract}
            onChange={(e) => setForceExtract(e.target.checked)}
          />
          APK 추출 강제 재실행
        </label>
        <label>
          <input
            type="checkbox"
            checked={forceDownloadApk}
            onChange={(e) => setForceDownloadApk(e.target.checked)}
          />
          APK 강제 재다운로드
        </label>
      </fieldset>

      <button
        type="button"
        className="run-btn"
        onClick={handleRun}
        disabled={!workspacePath || running}
      >
        {running ? "실행 중…" : "데이터 다운로드"}
      </button>

      <div className="log-area">
        <div className="log-content">
          {logLines.map((line, i) => (
            <div key={i} className="log-line">
              {line || "\u00A0"}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>

      <button
        type="button"
        className="create-project-btn"
        onClick={handleCreateProject}
        disabled={!lastDataset}
      >
        이 데이터 셋으로 새 프로젝트 만들기
      </button>

      <fieldset className="scan-extract-group" style={{ marginTop: "1.5rem" }}>
        <legend>데이터 스캔 / 팩 추출</legend>
        <p className="field-hint">
          워크스페이스 BCData에 있는 데이터를 스캔하고, 팩만 있는 경우 추출(extracted)하여 스프라이트 편집에서 즉시 로드할 수 있게 합니다.
        </p>
        <button
          type="button"
          className="run-btn"
          onClick={handleScan}
          disabled={!workspacePath || running}
        >
          데이터 있는지 스캔
        </button>
        {scannedDatasets.length > 0 && (
          <div className="scanned-list" style={{ marginTop: "0.75rem" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "0.25rem 0.5rem" }}>서버</th>
                  <th style={{ textAlign: "left", padding: "0.25rem 0.5rem" }}>버전</th>
                  <th style={{ textAlign: "left", padding: "0.25rem 0.5rem" }}>상태</th>
                  <th style={{ textAlign: "left", padding: "0.25rem 0.5rem" }}>경로</th>
                  <th style={{ textAlign: "left", padding: "0.25rem 0.5rem" }}></th>
                </tr>
              </thead>
              <tbody>
                {scannedDatasets.map((row, i) => {
                  const fullPath = workspacePath ? `${workspacePath}/${row.path}` : row.path;
                  return (
                    <tr key={i}>
                      <td style={{ padding: "0.25rem 0.5rem" }}>{row.server.toUpperCase()}</td>
                      <td style={{ padding: "0.25rem 0.5rem" }}>{row.version}</td>
                      <td style={{ padding: "0.25rem 0.5rem" }}>
                        {row.hasExtracted
                          ? row.hasManifest
                            ? "준비 완료"
                            : "추출됨 (인덱스 없음)"
                          : "팩만 있음"}
                      </td>
                      <td
                        style={{
                          padding: "0.25rem 0.5rem",
                          fontSize: "0.8rem",
                          maxWidth: "20rem",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={fullPath}
                      >
                        {fullPath}
                      </td>
                      <td style={{ padding: "0.25rem 0.5rem", whiteSpace: "nowrap" }}>
                        {!row.hasExtracted && (
                          <button
                            type="button"
                            onClick={() => handleExtractPacks(row.server, row.version)}
                            disabled={running}
                          >
                            팩 추출
                          </button>
                        )}
                        {row.hasExtracted && !row.hasManifest && (
                          <button
                            type="button"
                            onClick={() => handleBuildManifest(row.path)}
                            disabled={running}
                          >
                            인덱스 생성
                          </button>
                        )}
                        {row.hasExtracted && row.hasManifest && (
                          <button
                            type="button"
                            onClick={() => handleBuildManifest(row.path)}
                            disabled={running}
                            title="에셋 인덱스를 다시 생성합니다"
                          >
                            인덱스 재생성
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </fieldset>
    </div>
  );
}
