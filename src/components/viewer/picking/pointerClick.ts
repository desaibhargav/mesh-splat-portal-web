const clickMovementTolerance = 4;

// Observe a click without capturing or consuming the pointer. PlayCanvas keeps
// ownership of the complete gesture; the window release remains observable even
// when its input source captures the pointer to the canvas.
export function observePointerClick<T>(element: HTMLElement,
  identify: (event: PointerEvent) => T | null, onClick: (value: T, event: PointerEvent) => void) {
  let down: { id: number; x: number; y: number; value: T } | null = null;
  function pointerDown(event: PointerEvent) {
    if (!event.isPrimary || event.button !== 0 || event.altKey) return;
    const value = identify(event);
    if (value !== null) down = { id: event.pointerId, x: event.clientX, y: event.clientY, value };
  }
  function pointerUp(event: PointerEvent) {
    if (down?.id !== event.pointerId) return;
    const click = down; down = null;
    if (Math.hypot(event.clientX - click.x, event.clientY - click.y) <= clickMovementTolerance) {
      onClick(click.value, event);
    }
  }
  const reset = () => { down = null; };
  // Snapshot the hovered target before bubbling hover handlers clear it.
  element.addEventListener("pointerdown", pointerDown, true);
  window.addEventListener("pointerup", pointerUp);
  window.addEventListener("pointercancel", reset);
  return () => {
    element.removeEventListener("pointerdown", pointerDown, true);
    window.removeEventListener("pointerup", pointerUp);
    window.removeEventListener("pointercancel", reset);
  };
}
