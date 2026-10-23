import { useApp } from "@playcanvas/react/hooks";
import { useEffect } from "react";
import type { RefObject } from "react";

const textEntry = "input:not([type=range]):not([type=color]):not([type=checkbox]):not([type=radio]), textarea, [contenteditable]:not([contenteditable=false])";

export function TypingRenderPolicy({ scope }: { scope: RefObject<HTMLElement | null> }) {
  const app = useApp();

  useEffect(() => {
    const root = scope.current;
    if (!root) return;
    let paused = false;

    const setPaused = (value: boolean) => {
      const next = value && !app.xr?.active;
      if (next === paused) return;
      paused = next;
      app.autoRender = !next;
      if (!next) app.renderNextFrame = true;
    };
    const onFocusIn = (event: FocusEvent) => setPaused((event.target as Element).matches(textEntry));
    const syncFocus = () => {
      const focused = document.activeElement;
      setPaused(Boolean(focused && root.contains(focused) && focused.matches(textEntry)));
    };
    const onFocusOut = () => requestAnimationFrame(syncFocus);

    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    app.xr?.on("start", syncFocus); app.xr?.on("end", syncFocus);
    return () => {
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      app.xr?.off("start", syncFocus); app.xr?.off("end", syncFocus);
      if (paused) { app.autoRender = true; app.renderNextFrame = true; }
    };
  }, [app, scope]);

  return null;
}
