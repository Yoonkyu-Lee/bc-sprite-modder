import { useCallback, useRef, useState } from "react";

export function useCanvasSessionQueue() {
  const queueRef = useRef(Promise.resolve());
  const sessionIdRef = useRef(`canvas-main-${Date.now()}-${Math.floor(Math.random() * 100000)}`);
  const [loadError, setLoadError] = useState<string | null>(null);

  const enqueue = useCallback((task: () => Promise<void>) => {
    queueRef.current = queueRef.current.then(task).catch((err) => {
      console.warn("[canvas] backend call failed", err);
      setLoadError(err instanceof Error ? err.message : String(err));
    });
  }, []);

  return {
    sessionIdRef,
    loadError,
    setLoadError,
    enqueue,
  };
}
