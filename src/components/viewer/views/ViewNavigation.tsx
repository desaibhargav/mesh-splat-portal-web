import { useEffect, useRef } from "react";
import { Mat4, Vec3, ViewCube } from "playcanvas";
import type { SelectionHandle } from "../selection/types";
import type { Viewport } from "../viewports/ViewerViewports";

export function ViewNavigation({ handle, panel }: { handle: SelectionHandle; panel: Viewport }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const cube = new ViewCube(), camera = panel.camera, previous = new Mat4();
    container.current!.appendChild(cube.dom);
    // Accessibility labels follow the pinned native widget's construction order.
    const directions = ["Left", "Bottom", "Front", "Right", "Top", "Back"];
    cube.dom.querySelectorAll("circle").forEach((circle, index) => {
      circle.setAttribute("aria-label", `Look from ${directions[index]}`);
      circle.setAttribute("role", "button"); circle.setAttribute("tabindex", "0");
      circle.addEventListener("keydown", event => {
        if ((event as KeyboardEvent).key === "Enter" || (event as KeyboardEvent).key === " ") {
          event.preventDefault(); circle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        }
      });
    });
    cube.on(ViewCube.EVENT_CAMERAALIGN, (normal: Vec3) => {
      const label = Math.abs(normal.x) === 1 ? normal.x > 0 ? "Right" : "Left" :
        Math.abs(normal.y) === 1 ? normal.y > 0 ? "Top" : "Bottom" : normal.z > 0 ? "Back" : "Front";
      handle.viewports.align(panel, normal, label);
    });
    const update = () => {
      const matrix = camera.entity.getWorldTransform();
      if (!previous.equals(matrix)) { cube.update(matrix); previous.copy(matrix); }
    };
    update(); handle.app.on("prerender", update);
    let disposed = false;
    const dispose = () => {
      if (disposed) return; disposed = true;
      handle.app.off("prerender", update); handle.app.off("destroy", dispose); cube.destroy();
    };
    handle.app.on("destroy", dispose); return dispose;
  }, [handle, panel]);
  return <div ref={container} className="view-navigation" role="group" aria-label="World viewpoints" />;
}
