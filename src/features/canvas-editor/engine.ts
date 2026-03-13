// Re-export CanvasEditor from the compiled WASM module.
// vite-plugin-wasm + vite-plugin-top-level-await ensure the WASM binary is
// initialized before any module code runs, so CanvasEditor can be constructed
// synchronously (e.g. inside a useEffect).
export { CanvasEditor } from "../../wasm/canvas-engine/canvas_engine";
