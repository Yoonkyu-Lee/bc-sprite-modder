import { createContext, useCallback, useContext, useState, ReactNode } from "react";

export type UnitFormEntry = {
  unit_id: string;
  form: string;
  form_label: string;
  display: string;
  is_enraged: boolean;
};

export type SpriteEditorState = {
  unitForms: UnitFormEntry[];
  selectedUnitId: string | null;
  selectedForm: string | null;
  searchQuery: string;
};

type SpriteEditorContextValue = SpriteEditorState & {
  setSelected: (unitId: string, form: string) => void;
  setSearchQuery: (q: string) => void;
  setUnitForms: (list: UnitFormEntry[]) => void;
};

const SpriteEditorContext = createContext<SpriteEditorContextValue | null>(null);

const initialState: SpriteEditorState = {
  unitForms: [],
  selectedUnitId: null,
  selectedForm: null,
  searchQuery: "",
};

export function SpriteEditorProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SpriteEditorState>(initialState);

  const setSelected = useCallback((unitId: string, form: string) => {
    setState((s) => ({ ...s, selectedUnitId: unitId, selectedForm: form }));
  }, []);
  const setSearchQuery = useCallback((searchQuery: string) => {
    setState((s) => ({ ...s, searchQuery }));
  }, []);
  const setUnitForms = useCallback((unitForms: UnitFormEntry[]) => {
    setState((s) => ({ ...s, unitForms }));
  }, []);

  const value: SpriteEditorContextValue = {
    ...state,
    setSelected,
    setSearchQuery,
    setUnitForms,
  };

  return (
    <SpriteEditorContext.Provider value={value}>
      {children}
    </SpriteEditorContext.Provider>
  );
}

export function useSpriteEditor() {
  const ctx = useContext(SpriteEditorContext);
  if (!ctx) throw new Error("useSpriteEditor must be used within SpriteEditorProvider");
  return ctx;
}
