import { useState } from "react";
import { DataSetupPage } from "../pages/DataSetupPage";
import { ProjectPage } from "../pages/ProjectPage";
import { SpritePage } from "../pages/SpritePage";
import { RepackPage } from "../pages/RepackPage";

export type Dataset = { server: string; version: string; path: string };

type TabId = "data-setup" | "project" | "sprite" | "repack";

export function AppShell() {
  const [activeTab, setActiveTab] = useState<TabId>("data-setup");
  const [pendingDataset, setPendingDataset] = useState<Dataset | null>(null);

  const tabs: { id: TabId; label: string }[] = [
    { id: "data-setup", label: "데이터 준비" },
    { id: "project", label: "프로젝트" },
    { id: "sprite", label: "스프라이트 편집" },
    { id: "repack", label: "리패킹" },
  ];

  const handleDatasetReady = (dataset: Dataset) => {
    setPendingDataset(dataset);
    setActiveTab("project");
  };

  return (
    <div className="app-shell">
      <header className="app-shell-header">
        <h1 className="app-title">Battle Cats Sprite Modder</h1>
        <nav className="app-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`tab ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="app-shell-main">
        <div
          className="tab-panel"
          role="tabpanel"
          hidden={activeTab !== "data-setup"}
          aria-hidden={activeTab !== "data-setup"}
        >
          <DataSetupPage onDatasetReady={handleDatasetReady} />
        </div>
        <div
          className="tab-panel"
          role="tabpanel"
          hidden={activeTab !== "project"}
          aria-hidden={activeTab !== "project"}
        >
          <ProjectPage
            pendingDataset={pendingDataset}
            onProjectCreated={() => setPendingDataset(null)}
          />
        </div>
        <div
          className="tab-panel"
          role="tabpanel"
          hidden={activeTab !== "sprite"}
          aria-hidden={activeTab !== "sprite"}
        >
          <SpritePage />
        </div>
        <div
          className="tab-panel"
          role="tabpanel"
          hidden={activeTab !== "repack"}
          aria-hidden={activeTab !== "repack"}
        >
          <RepackPage />
        </div>
      </main>
    </div>
  );
}
