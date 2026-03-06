"""
BattleCats Sprite Lab — 진입점.
Workspace 선택(또는 복원) 후 메인 윈도우 표시.
"""
from __future__ import annotations

import sys
from pathlib import Path

from PySide6.QtWidgets import QApplication, QMessageBox

from lab.config import get_workspace, set_workspace
from lab.main_window import MainWindow
from lab.workspace_dialog import WorkspaceDialog, ensure_workspace_structure


def _default_workspace_path() -> Path:
    """프로젝트 루트 아래 example_workspace 를 기본값으로."""
    project_root = Path(__file__).resolve().parent
    return project_root / "example_workspace"


def main() -> int:
    app = QApplication(sys.argv)
    app.setApplicationName("BattleCats Sprite Lab")

    workspace = get_workspace()
    if workspace:
        workspace_path = Path(workspace)
        if not workspace_path.exists():
            QMessageBox.warning(
                None,
                "Workspace 없음",
                f"저장된 Workspace 경로가 없습니다:\n{workspace_path}\n새로 선택해 주세요.",
            )
            workspace_path = None
    else:
        workspace_path = None

    if not workspace_path:
        dialog = WorkspaceDialog(default_path=str(_default_workspace_path()))
        if not dialog.exec():
            return 0
        workspace_path = dialog.chosen_path()
        if not workspace_path:
            return 0
        set_workspace(str(workspace_path))
    else:
        ensure_workspace_structure(workspace_path)

    window = MainWindow(workspace_path)
    window.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
