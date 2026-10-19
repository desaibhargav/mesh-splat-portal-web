import { Entity, Gizmo, TransformGizmo, TranslateGizmo, Vec3, type CameraComponent } from "playcanvas";
import { cameraControls, type CameraControls } from "../CameraControls";
import { SurfacePicker } from "../picking/SurfacePicker";
import type { SelectionHandle } from "../selection/types";
import type { Measurement } from "./Measurement";

export interface EndpointPreview { id: number; index: number; position: Vec3 }
interface Endpoint { id: number; index: number; entity: Entity; gizmo: TranslateGizmo }
interface Drag {
  endpoint: Endpoint; camera: CameraComponent; controls: CameraControls; enabled: boolean;
  latest: { u: number; v: number } | null; position: Vec3 | null; ended: boolean; read?: ReturnType<SurfacePicker["capture"]>;
}

// Native gizmos own handle geometry and gestures; the existing GPU picker snaps
// their proposed screen position onto retained model surfaces. Commit once per drag.
export class MeasurementGizmos {
  private readonly layer;
  private readonly picker;
  private readonly endpoints = new Map<string, Endpoint>();
  private readonly projected = new Vec3();
  private camera;
  private drag: Drag | null = null;
  private pending = false;
  private frame = 0;
  private disposed = false;
  private selectedId: number | null = null;
  constructor(private readonly handle: SelectionHandle, private readonly measurement: Measurement,
    private readonly preview: (value: EndpointPreview | null) => void,
    private readonly changed: () => void, private readonly status: (busy: boolean, error: string | null) => void) {
    this.camera = handle.camera(); this.layer = Gizmo.createLayer(handle.app);
    this.picker = new SurfacePicker(handle.app, handle.selection.layers);
    // Register before native gizmos so Alt/Option remains a navigation gesture.
    handle.app.graphicsDevice.canvas.addEventListener("pointerdown", this.chooseInput, true);
    handle.app.graphicsDevice.canvas.addEventListener("pointercancel", this.cancel);
    handle.viewports.on("change", this.viewportChanged, this);
    handle.space.on("change", this.sceneChanged, this); handle.app.on("destroy", this.destroy, this);
    this.sync();
  }
  select(id: number | null) {
    if (this.selectedId !== id) this.cancel();
    this.selectedId = id; this.sync();
  }
  sync() {
    const retained = new Set<string>();
    for (const record of this.measurement.records) if (record.visible && record.id === this.selectedId) record.points.forEach((point, index) => {
      const key = `${record.id}:${index}`; retained.add(key);
      let endpoint = this.endpoints.get(key);
      if (!endpoint) {
        const entity = new Entity("Measurement handle"); this.handle.app.root.addChild(entity);
        const gizmo = new TranslateGizmo(this.camera, this.layer);
        gizmo.size = parseFloat(getComputedStyle(this.handle.app.graphicsDevice.canvas).getPropertyValue("--measurement-gizmo-scale"));
        gizmo.mouseButtons[1] = false; gizmo.mouseButtons[2] = false;
        endpoint = { id: record.id, index, entity, gizmo }; this.endpoints.set(key, endpoint);
        const target = endpoint;
        gizmo.attach([entity]);
        gizmo.on(TransformGizmo.EVENT_TRANSFORMSTART, () => this.start(target));
        gizmo.on(TransformGizmo.EVENT_TRANSFORMMOVE, () => this.queue());
        gizmo.on(TransformGizmo.EVENT_TRANSFORMEND, () => this.end(target));
      }
      if (this.drag?.endpoint !== endpoint) endpoint.entity.setPosition(this.handle.space.toWorld(point));
    });
    for (const [key, endpoint] of this.endpoints) if (!retained.has(key)) {
      if (this.drag?.endpoint === endpoint) this.cancel();
      endpoint.gizmo.destroy(); endpoint.entity.destroy(); this.endpoints.delete(key);
    }
    // Each native gizmo adds the shared layer to its camera; keep one membership.
    this.camera.layers = [...new Set([...this.camera.layers, ...(this.endpoints.size ? [this.layer.id] : [])])];
  }
  private chooseInput = (event: PointerEvent) => {
    if (this.drag) return;
    let nearest: Endpoint | null = null, distance = Infinity;
    for (const endpoint of this.endpoints.values()) {
      this.camera.worldToScreen(endpoint.entity.getPosition(), this.projected);
      const candidate = Math.hypot(this.projected.x - event.offsetX, this.projected.y - event.offsetY);
      if (candidate < distance) { nearest = endpoint; distance = candidate; }
    }
    for (const endpoint of this.endpoints.values()) endpoint.gizmo.mouseButtons[0] = !event.altKey && endpoint === nearest;
  };
  private start(endpoint: Endpoint) {
    if (this.drag) return;
    const controls = cameraControls(this.camera);
    this.drag = { endpoint, camera: this.camera, controls, enabled: controls.enabled, latest: null, position: null, ended: false };
    controls.enabled = false; this.status(true, null);
    for (const other of this.endpoints.values()) other.gizmo.mouseButtons[0] = other === endpoint;
  }
  private queue() {
    const drag = this.drag; if (!drag) return;
    drag.camera.worldToScreen(drag.endpoint.entity.getPosition(), this.projected);
    const bounds = this.handle.app.graphicsDevice.clientRect;
    drag.latest = { u: this.projected.x / bounds.width, v: this.projected.y / bounds.height };
    if (!this.pending && !this.frame) this.frame = requestAnimationFrame(() => void this.sample());
  }
  private async sample() {
    this.frame = 0;
    const drag = this.drag, point = drag?.latest;
    if (!drag || !point || this.pending) return;
    drag.latest = null; this.pending = true;
    try {
      drag.read ??= this.picker.capture(drag.camera);
      const position = await drag.read(point.u, point.v);
      if (this.drag !== drag) return;
      drag.position = position;
      this.preview(position ? { id: drag.endpoint.id, index: drag.endpoint.index, position: this.handle.space.toLocal(position) } : null);
    } catch (error) {
      if (this.drag === drag) { this.cancel(); this.status(false, error instanceof Error ? error.message : String(error)); }
    } finally {
      this.pending = false;
      if (this.drag?.latest) this.frame = requestAnimationFrame(() => void this.sample());
      else if (this.drag?.ended) this.finish();
    }
  }
  private end(endpoint: Endpoint) {
    if (this.drag?.endpoint !== endpoint) return;
    this.drag.ended = true; this.queue();
  }
  private finish() {
    const drag = this.drag!; this.drag = null;
    if (drag.position) {
      this.measurement.moveEndpoint(drag.endpoint.id, drag.endpoint.index, this.handle.space.toLocal(drag.position));
      this.changed();
    }
    this.preview(null); this.release(drag); this.sync();
    this.status(false, drag.position ? null : "Drop the endpoint on a visible surface.");
  }
  private release(drag: Drag) {
    if (drag.camera.entity.script && cameraControls(drag.camera) === drag.controls) {
      drag.controls.enabled = drag.enabled && this.handle.camera() === drag.camera;
    }
  }
  private cancel = () => {
    const drag = this.drag; if (!drag) return;
    this.drag = null; cancelAnimationFrame(this.frame); this.frame = 0;
    drag.endpoint.gizmo.detach(); drag.endpoint.gizmo.attach([drag.endpoint.entity]);
    const original = this.measurement.records.find(record => record.id === drag.endpoint.id)?.points[drag.endpoint.index];
    if (original) drag.endpoint.entity.setPosition(this.handle.space.toWorld(original));
    this.release(drag); this.preview(null); this.status(false, null);
  };
  private sceneChanged() { this.cancel(); this.sync(); }
  private viewportChanged() {
    this.cancel(); this.camera = this.handle.camera();
    for (const endpoint of this.endpoints.values()) endpoint.gizmo.camera = this.camera;
    this.sync();
  }
  destroy() {
    if (this.disposed) return; this.disposed = true;
    this.cancel(); cancelAnimationFrame(this.frame); this.picker.destroy();
    const app = this.handle.app;
    app.graphicsDevice.canvas.removeEventListener("pointerdown", this.chooseInput, true);
    app.graphicsDevice.canvas.removeEventListener("pointercancel", this.cancel);
    this.handle.viewports.off("change", this.viewportChanged, this); this.handle.space.off("change", this.sceneChanged, this);
    app.off("destroy", this.destroy, this);
    for (const endpoint of this.endpoints.values()) { endpoint.gizmo.destroy(); endpoint.entity.destroy(); }
    app.scene.layers.remove(this.layer);
  }
}
