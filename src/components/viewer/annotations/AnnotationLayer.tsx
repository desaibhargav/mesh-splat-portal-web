import { useEffect, useRef, useState } from "react";
import { Color, Entity } from "playcanvas";
import { Annotation, AnnotationManager } from "playcanvas/scripts/esm/annotations.mjs";
import type { SelectionHandle } from "../selection/types";
import { useAnnotationHover } from "./useAnnotationHover";
import type { AnnotationRecord } from "./Annotations";

// Confine the engine example's DOM to the canvas, including embedded/fullscreen
// layouts. All hotspot rendering, tooltip text, and interaction remain upstream.
class ViewerAnnotationManager extends AnnotationManager {
  static scriptName = "viewerAnnotationManager";
  container!: HTMLElement;
  viewCamera!: Entity;
  shades = new Map<Annotation, Color>();
  regionAnnotation: Annotation | null = null;
  _setAnnotationHover(annotation: Annotation, hover: boolean) {
    super._setAnnotationHover(annotation, hover);
    const color = hover ? this.hoverColor : this.shades.get(annotation) ?? this.hotspotColor;
    for (const material of this._annotationResources.get(annotation)?.materials ?? []) {
      material.emissive.copy(color);
      material.update();
    }
  }
  showRegion(annotation: Annotation | null) {
    if (this.regionAnnotation === annotation) return;
    if (this.regionAnnotation && this._activeAnnotation === this.regionAnnotation) this._hideTooltip(this.regionAnnotation);
    this.regionAnnotation = annotation;
    if (annotation) this._showTooltip(annotation);
  }
  initialize() {
    this._parentDom = this.container; this._camera = this.viewCamera;
    super.initialize();
  }
}

export function AnnotationLayer({ handle, records, interactive }: {
  handle: SelectionHandle; records: readonly AnnotationRecord[]; interactive: boolean;
}) {
  const { hovered, error } = useAnnotationHover(handle, records, interactive);
  const manager = useRef<ViewerAnnotationManager | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const entities = useRef(new Map<number, Entity>());
  const root = useRef<Entity | null>(null);
  const [ready, setReady] = useState(0);
  useEffect(() => {
    // The React camera applies its initial layer list in an effect. Attach the
    // manager on the next frame so that initialization cannot overwrite its layers.
    const frame = requestAnimationFrame(() => {
      const entity = new Entity("Annotations"); root.current = entity;
      handle.app.root.addChild(entity); entity.addComponent("script");
      const color = new Color().fromString(getComputedStyle(container.current!).getPropertyValue("--gold").trim());
      manager.current = entity.script!.create(ViewerAnnotationManager, { properties: {
        container: container.current!, viewCamera: handle.camera().entity, hotspotColor: color, hoverColor: Color.WHITE
      } }) as unknown as ViewerAnnotationManager;
      setReady(value => value + 1);
    });
    const destroy = () => {
      cancelAnimationFrame(frame); root.current?.destroy(); entities.current.clear(); root.current = null; manager.current = null;
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
      entity.setPosition(record.position);
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
  return <><div ref={container} className="annotation-overlay" data-interactive={interactive} />
    {error && <div className="selection-error" role="alert">Annotation hover: {error}</div>}</>;
}
