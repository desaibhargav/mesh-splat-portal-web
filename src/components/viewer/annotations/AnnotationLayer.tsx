import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useViewports } from "../viewports/useViewports";
import { useViewportHandle } from "../viewports/useViewportHandle";
import type { Viewport } from "../viewports/ViewerViewports";
import { Color, Entity, Vec3 } from "playcanvas";
import { Annotation } from "playcanvas/scripts/esm/annotations.mjs";
import { SurfacePicker } from "../picking/SurfacePicker";
import { snapshotContains } from "../selection/selectionSnapshot";
import type { SelectionHandle } from "../selection/types";
import { useAnnotationHover } from "./useAnnotationHover";
import { ViewerAnnotationManager } from "./ViewerAnnotationManager";
import type { AnnotationRecord } from "./Annotations";

export function AnnotationLayer({ color, handle, records, interactive, hoverRegions, movingId, onMove }: {
  color: string; handle: SelectionHandle; records: readonly AnnotationRecord[]; interactive: boolean; hoverRegions: boolean;
  movingId: number | null; onMove(id: number, position: Vec3): void;
}) {
  const rig = useViewports(handle);
  const { hovered, error } = useAnnotationHover(handle, records, hoverRegions);
  return <div className="annotation-overlay" data-interactive={interactive}>
    {error && <div className="selection-error" role="alert">Annotation hover: {error}</div>}
    {rig.visible.map(panel => <AnnotationViewport color={color} key={panel.id} handle={handle} panel={panel} records={records}
      interactive={interactive} hovered={panel === rig.active ? hovered : null} movingId={movingId} onMove={onMove} />)}
  </div>;
}

function AnnotationViewport({ color, handle: shared, panel, records, interactive, hovered, movingId, onMove }: {
  color: string; handle: SelectionHandle; panel: Viewport; records: readonly AnnotationRecord[]; interactive: boolean; hovered: number | null;
  movingId: number | null; onMove(id: number, position: Vec3): void;
}) {
  const handle = useViewportHandle(shared, panel);
  const manager = useRef<ViewerAnnotationManager | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const entities = useRef(new Map<number, Entity>());
  const root = useRef<Entity | null>(null);
  const [ready, setReady] = useState(0);
  const [moveError, setMoveError] = useState<string | null>(null);
  const commitMove = useEffectEvent(onMove);
  useEffect(() => {
    const entity = new Entity("Annotations"); root.current = entity;
    handle.space.root.addChild(entity); entity.addComponent("script");
    const shade = new Color().fromString(color);
    const annotationManager = entity.script!.create(ViewerAnnotationManager, { properties: {
      container: container.current!, viewCamera: handle.camera().entity, hotspotColor: shade,
      hoverColor: Color.WHITE, behindOpacity: 1
    } }) as unknown as ViewerAnnotationManager;
    manager.current = annotationManager;
    setReady(value => value + 1);
    const hotspotAdded = (annotation: Annotation) => { if (annotation.entity.parent === root.current) setReady(value => value + 1); };
    handle.app.on("annotation:add", hotspotAdded);
    const destroy = () => {
      handle.app.off("annotation:add", hotspotAdded);
      root.current?.destroy(); entities.current.clear(); root.current = null; manager.current = null;
    };
    handle.app.on("destroy", destroy);
    return () => { handle.app.off("destroy", destroy); destroy(); };
  }, [handle]);
  useEffect(() => {
    if (!root.current) return;
    for (const [id, entity] of entities.current) if (!records.some(record => record.id === id)) {
      const annotation = entity.script!.get("annotation") as unknown as Annotation;
      if (manager.current?.regionAnnotation === annotation) manager.current.showRegion(null);
      manager.current?.shades.delete(annotation); entity.destroy(); entities.current.delete(id);
    }
    for (const [index, record] of records.entries()) {
      let entity = entities.current.get(record.id);
      if (!entity) {
        entity = new Entity("Annotation"); root.current.addChild(entity); entity.addComponent("script");
        entity.script!.create(Annotation, { properties: { label: String(index + 1), title: record.title, text: record.text } });
        entities.current.set(record.id, entity);
      }
      entity.setLocalPosition(record.position);
      const annotation = entity.script!.get("annotation") as unknown as Annotation;
      annotation.label = String(index + 1); annotation.title = record.title; annotation.text = record.text;
      if (record.color) manager.current!.shades.set(annotation, new Color().fromString(record.color));
      else manager.current!.shades.delete(annotation);
      manager.current!._setAnnotationHover(annotation, false);
    }
  }, [handle, records, ready]);
  useEffect(() => {
    const entity = hovered === null ? null : entities.current.get(hovered);
    manager.current?.showRegion(entity?.script!.get("annotation") as unknown as Annotation ?? null);
  }, [hovered, ready, records]);
  useEffect(() => {
    setMoveError(null);
    if (movingId === null || !manager.current) return;
    const entity = entities.current.get(movingId), record = records.find(item => item.id === movingId);
    if (!entity || !record) return;
    const { id, region } = record;
    const annotation = entity.script!.get("annotation") as unknown as Annotation;
    const overlay = container.current!;
    const armed = manager.current.hotspot(annotation);
    if (armed) armed.dataset.moving = "true";
    const picker = new SurfacePicker(handle.app, handle.selection.layers);
    const original = entity.getPosition().clone(), preview = new Vec3();
    const canvas = handle.app.graphicsDevice.canvas as HTMLCanvasElement;
    let pointer: number | null = null, depth = 0, cancelled = false, hotspot: HTMLDivElement | null = null;

    function coordinates(event: PointerEvent) {
      const bounds = canvas.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top,
        u: (event.clientX - bounds.left) / bounds.width, v: (event.clientY - bounds.top) / bounds.height };
    }
    function down(event: PointerEvent) {
      if (!event.isPrimary || event.button !== 0 || pointer !== null) return;
      const target = manager.current?.hotspot(annotation);
      if (!target || event.target !== target) return;
      event.preventDefault(); event.stopImmediatePropagation();
      hotspot = target;
      pointer = event.pointerId; depth = handle.camera().entity.getPosition().distance(entity!.getPosition());
      hotspot.style.cursor = "grabbing"; hotspot.setPointerCapture(pointer);
    }
    function move(event: PointerEvent) {
      if (event.pointerId !== pointer) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const point = coordinates(event);
      handle.camera().screenToWorld(point.x, point.y, depth, preview);
      entity!.setPosition(preview);
    }
    async function up(event: PointerEvent) {
      if (event.pointerId !== pointer) return;
      event.preventDefault(); event.stopImmediatePropagation();
      pointer = null; hotspot!.style.cursor = "grab";
      if (hotspot!.hasPointerCapture(event.pointerId)) hotspot!.releasePointerCapture(event.pointerId);
      const point = coordinates(event);
      try {
        const position = await picker.pick(handle.camera(), point.u, point.v);
        const hit = region && await handle.selection.primitiveAt(handle.app, handle.camera(), point.u, point.v);
        if (!position || (region && (!hit || !snapshotContains(region, hit.part, hit.index)))) {
          throw new Error(region ? "Drop the marker on its annotated selection." : "Drop the marker on the model.");
        }
        if (!cancelled) commitMove(id, handle.space.toLocal(position));
      } catch (error) {
        if (cancelled) return;
        entity!.setPosition(original);
        setMoveError(error instanceof Error ? error.message : String(error));
      }
    }
    function cancel(event: PointerEvent) {
      if (event.pointerId !== pointer) return;
      event.preventDefault(); event.stopImmediatePropagation();
      pointer = null; entity!.setPosition(original); hotspot!.style.cursor = "grab";
    }
    overlay.addEventListener("pointerdown", down, true);
    overlay.addEventListener("pointermove", move, true);
    overlay.addEventListener("pointerup", up, true);
    overlay.addEventListener("pointercancel", cancel, true);
    return () => {
      cancelled = true; picker.destroy(); entity.setPosition(original);
      if (armed) delete armed.dataset.moving;
      overlay.removeEventListener("pointerdown", down, true);
      overlay.removeEventListener("pointermove", move, true);
      overlay.removeEventListener("pointerup", up, true);
      overlay.removeEventListener("pointercancel", cancel, true);
    };
  }, [handle, records, ready, movingId]);
  const rect = panel.camera.rect;
  return <><div ref={container} className="annotation-viewport" data-interactive={interactive}
    onPointerDownCapture={() => handle.viewports.activate(panel)}
    style={{ left: `${rect.x * 100}%`, top: `${(1 - rect.y - rect.w) * 100}%`, width: `${rect.z * 100}%`, height: `${rect.w * 100}%` }} />
    {moveError && <div className="selection-error" role="alert">{moveError}</div>}</>;
}
