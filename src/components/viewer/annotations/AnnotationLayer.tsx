import { useEffect, useRef, useState } from "react";
import { Color, Entity } from "playcanvas";
import { Annotation, AnnotationManager } from "playcanvas/scripts/esm/annotations.mjs";
import type { SelectionHandle } from "../selection/types";
import type { AnnotationRecord } from "./Annotations";

// Confine the engine example's DOM to the canvas, including embedded/fullscreen
// layouts. All hotspot rendering, tooltip text, and interaction remain upstream.
class ViewerAnnotationManager extends AnnotationManager {
  static scriptName = "viewerAnnotationManager";
  container!: HTMLElement;
  viewCamera!: Entity;
  initialize() {
    this._parentDom = this.container; this._camera = this.viewCamera;
    super.initialize();
  }
}

export function AnnotationLayer({ handle, records, interactive }: {
  handle: SelectionHandle; records: readonly AnnotationRecord[]; interactive: boolean;
}) {
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
      entity.script!.create(ViewerAnnotationManager, { properties: {
        container: container.current!, viewCamera: handle.camera().entity, hotspotColor: color, hoverColor: Color.WHITE
      } });
      setReady(value => value + 1);
    });
    const destroy = () => {
      cancelAnimationFrame(frame); root.current?.destroy(); entities.current.clear(); root.current = null;
    };
    handle.app.on("destroy", destroy);
    return () => { handle.app.off("destroy", destroy); destroy(); };
  }, [handle]);
  useEffect(() => {
    if (!root.current) return;
    for (const [id, entity] of entities.current) if (!records.some(record => record.id === id)) {
      entity.destroy(); entities.current.delete(id);
    }
    for (const record of records) {
      let entity = entities.current.get(record.id);
      if (!entity) {
        entity = new Entity("Annotation"); root.current.addChild(entity); entity.addComponent("script");
        entity.script!.create(Annotation, { properties: { label: String(record.id), title: record.title, text: record.text } });
        entities.current.set(record.id, entity);
      }
      entity.setPosition(record.position);
      const annotation = entity.script!.get("annotation") as unknown as Annotation;
      annotation.title = record.title; annotation.text = record.text;
    }
  }, [handle, records, ready]);
  return <div ref={container} className="annotation-overlay" data-interactive={interactive} />;
}
