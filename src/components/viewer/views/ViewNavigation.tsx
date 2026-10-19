import { useEffect, useRef } from "react";
import { Mat4, PROJECTION_ORTHOGRAPHIC, PROJECTION_PERSPECTIVE, Vec3, ViewCube } from "playcanvas";
import type { SelectionHandle } from "../selection/types";
import { captureFrame, directionFrame, recallFrame } from "./viewFrame";

export function ViewNavigation({ handle }: { handle: SelectionHandle }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const cube = new ViewCube(), camera = handle.camera(), previous = new Mat4();
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
      recallFrame(camera, directionFrame(captureFrame(camera), normal));
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
  }, [handle]);
  return <div ref={container} className="view-navigation" role="group" aria-label="World viewpoints" />;
}

export function setOrthographic(handle: SelectionHandle, enabled: boolean) {
  const camera = handle.camera(), frame = captureFrame(camera);
  if (enabled) camera.orthoHeight = frame.distance * Math.tan(camera.fov * Math.PI / 360) / (camera.horizontalFov ? camera.aspectRatio : 1);
  camera.projection = enabled ? PROJECTION_ORTHOGRAPHIC : PROJECTION_PERSPECTIVE;
}
