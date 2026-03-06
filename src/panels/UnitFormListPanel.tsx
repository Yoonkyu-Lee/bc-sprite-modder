import type { IDockviewPanelProps } from "dockview";
import { useSpriteEditor } from "../stores/spriteEditorStore";

export function UnitFormListPanel(_props: IDockviewPanelProps) {
  const { unitForms, selectedUnitId, selectedForm, searchQuery, setSelected, setSearchQuery } =
    useSpriteEditor();

  const filtered = unitForms.filter(
    (u) =>
      u.display.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.unit_id.includes(searchQuery)
  );

  return (
    <div className="unit-form-list-panel">
      <input
        type="text"
        placeholder="유닛 ID·폼 검색..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="search-input"
      />
      <ul className="unit-form-list">
        {filtered.map((u) => (
          <li
            key={`${u.unit_id}_${u.form}`}
            className={selectedUnitId === u.unit_id && selectedForm === u.form ? "selected" : ""}
            onClick={() => setSelected(u.unit_id, u.form)}
          >
            {u.display}
          </li>
        ))}
      </ul>
    </div>
  );
}
