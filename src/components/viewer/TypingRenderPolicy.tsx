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
      if (value === paused || app.xr?.active) return;
      paused = value;
      app.autoRender = !value;
      if (!value) app.renderNextFrame = true;
    };
    const onFocusIn = (event: FocusEvent) => setPaused((event.target as Element).matches(textEntry));
    const onFocusOut = () => requestAnimationFrame(() => {
      const focused = document.activeElement;
      setPaused(Boolean(focused && root.contains(focused) && focused.matches(textEntry)));
    });

    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    return () => {
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      if (paused) { app.autoRender = true; app.renderNextFrame = true; }
    };
  }, [app, scope]);

  return null;
}
