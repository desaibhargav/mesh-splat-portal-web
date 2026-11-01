import { SavedItems } from "../SavedItems";
import { SliderControl } from "../SliderControl";
import { useEffect, useReducer } from "react";
import type { SelectionHandle } from "../selection/types";
import { defaultSectionOptions, type SectionDocument } from "./SectionDocument";
import { SectionGuide } from "./SectionGuide";

export type { NamedSection, SectionSession } from "./SectionDocument";

export function SectionControls({ handle, active, model, openRequest }: {
  openRequest: { id: number } | null; handle: SelectionHandle; active: boolean; model: SectionDocument;
}) {
  const [, refresh] = useReducer(value => value + 1, 0);
  useEffect(() => {
    const changed = () => { if (!handle.app.xr?.active) refresh(); };
    model.on("change", changed); handle.app.xr?.on("end", refresh); const detach = model.attach();
    return () => { model.off("change", changed); handle.app.xr?.off("end", refresh); detach(); };
  }, [model, handle]);
  useEffect(() => {
    if (!active) return;
    model.enter(); return () => model.leave();
  }, [active, model]);
  useEffect(() => { if (active && openRequest) model.sections.open(openRequest.id); }, [active, openRequest, model]);
  const { editing, name, source, alignment, enabled, showPlane, options } = model.state;
  const frame = model.frame, bounds = model.bounds;
  if (!active) return null;
  return <div className="annotation-panels section-panels">
    <SavedItems label="Sections" items={model.sections.records} selectedId={editing} className="section-list"
      onOpen={id => model.sections.open(id)} onRemove={id => model.sections.remove(id)} />
    <div className="selection-actions selection-options view-options section-options" role="group" aria-label="Section">
      <strong>Cross section</strong>
      <label>View<select aria-label="Section reference" value={source} disabled={!model.views.records.length} onChange={event => model.chooseView(event.target.value)}>
        <option value="camera" disabled hidden>Current camera</option>
        {model.views.records.map(view => <option key={view.id} value={view.id}>{view.name}</option>)}
        {source !== "camera" && !model.views.records.some(view => String(view.id) === source) && <option value={source} disabled hidden>Deleted view (captured)</option>}
      </select></label>
      <fieldset className="selection-shapes"><legend>Cutting-plane normal</legend>
        {(["view", "X", "Y", "Z"] as const).map(axis => <button key={axis} aria-pressed={alignment === axis}
          onClick={() => model.align(axis)}>{axis === "view" ? "View" : axis}</button>)}
      </fieldset>
      {([{key:"offset",label:"Offset",scale:100,limit:100,unit:"%"},
        {key:"tiltX",label:"Tilt 1",scale:1,limit:180,unit:"°"},
        {key:"tiltY",label:"Tilt 2",scale:1,limit:180,unit:"°"}] as const).map(({key,label,scale,limit,unit}) =>
        <SliderControl key={key} label={label} ariaLabel={key === "offset" ? "Section offset" : label} min={-limit} max={limit} unit={unit}
          value={Math.round(options[key]*scale)} defaultValue={defaultSectionOptions[key]*scale}
          onChange={value => model.options({[key]:value/scale})} />)}
      <div className="section-buttons">
        <button aria-pressed={enabled} disabled={!frame} onClick={() => enabled ? model.sections.close() : model.enable(true)}>{enabled ? "Disable section" : "Enable section"}</button>
        <button aria-pressed={options.flip} onClick={() => model.options({flip:!options.flip})}>Flip retained side</button>
        <button aria-pressed={showPlane} onClick={() => model.showPlane(!showPlane)}>Show cutting plane</button>
        <button onClick={() => model.fromCamera()}>From current camera</button>
        <button disabled={!frame} onClick={() => model.look()}>Look perpendicular to cut</button>
        <button className="tool-action-reset" onClick={() => model.options(defaultSectionOptions)}>Reset section position</button>
      </div>
      <label>Section name<input aria-label="Section name" value={name} onChange={event => model.name(event.target.value)} /></label>
      <button disabled={!enabled || !name.trim()} className="tool-action-save" onClick={() => model.save()}>{editing === null ? "Save section" : "Update section"}</button>
      {editing !== null && <button onClick={() => model.fresh()}>New section</button>}
      <small>Saved sections last until you leave this asset. Q discards unsaved section changes.</small>
      {enabled && showPlane && frame && bounds && <SectionGuide handle={handle} frame={frame} extent={bounds.halfExtents.length()} />}
    </div>
  </div>;
}
