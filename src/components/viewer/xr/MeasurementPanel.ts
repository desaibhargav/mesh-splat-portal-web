import { Vec3, type AppBase, type Entity } from "playcanvas";
import { tools } from "../toolDefinitions";
import { toolAppearance } from "../toolAppearance";
import { formatDistance, type MeasurementRecord } from "../measurement/Measurement";
import { measurementAdjustments } from "../measurement/measurementFields";
import { defaultMeasurementStyle, type MeasurementStyle } from "../measurement/measurementStyle";
import { SpatialPanel } from "./SpatialPanel";
import { SpatialUiAnchor } from "./SpatialUiAnchor";

interface PanelState {
  active: boolean; records: readonly MeasurementRecord[]; selectedId: number | null;
  name: string; message: string; style: MeasurementStyle; busy: boolean;
}
interface PanelActions {
  tool(active: boolean): void; open(id: number): void; remove(id: number): void;
  name(value: string): void; save(): void; clear(): void;
  style(value: MeasurementStyle): void;
}

// A device presentation of the existing Measurement form. Values and actions
// go straight to the shared Measurement document; no XR copy of the records.
export class MeasurementPanel {
  private readonly anchor: SpatialUiAnchor;
  private readonly toolbar: SpatialPanel;
  private readonly options: SpatialPanel;
  private readonly keyboard: SpatialPanel;
  private collapsed = false;
  private typing = false;
  private upper = false;
  private savedScroll = 0;
  private state: PanelState | null = null;
  private readonly font: string;
  private readonly gold: string;
  private readonly saveColor: string;
  private readonly resetColor: string;
  private readonly theme: ReturnType<typeof toolAppearance>;

  constructor(app: AppBase, camera: Entity, private readonly actions: PanelActions) {
    this.theme = toolAppearance(app.graphicsDevice.canvas as HTMLCanvasElement);
    this.font = this.theme.font; this.gold = this.theme.gold;
    this.saveColor = this.theme.save; this.resetColor = this.theme.reset;
    this.anchor = new SpatialUiAnchor(app, camera, () => this.targeted ||
      !!app.xr?.input.inputSources.some(source => source.selecting || source.squeezing));
    const redraw = () => { if (this.state) this.render(this.state); };
    this.toolbar = new SpatialPanel(app, "XR tool bar", 116, new Vec3(-.07, .25, -.8), this.anchor.root, redraw);
    this.options = new SpatialPanel(app, "XR measurement options", 270, new Vec3(.10, -.35, -.8), this.anchor.root, redraw, true);
    this.keyboard = new SpatialPanel(app, "XR text keyboard", 350, new Vec3(-.23, -.19, -.65), this.anchor.root, redraw);
    this.options.enabled = this.keyboard.enabled = false;
  }
  get targeted() { return this.toolbar.isTargeted || this.options.isTargeted || this.keyboard.isTargeted; }

  private text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size = 12, color = this.theme.text) {
    ctx.font = `${size}px ${this.font}`; ctx.fillStyle = color;
    ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.fillText(value, x, y);
  }
  private box(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number,
    color = this.theme.button, border = this.theme.border, radius = 3) {
    ctx.fillStyle = color; ctx.strokeStyle = border; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x + .5, y + .5, width - 1, height - 1, radius); ctx.fill(); ctx.stroke();
  }
  private button(panel: SpatialPanel, label: string, x: number, y: number, width: number, height: number,
    action: () => void, options: { color?: string; disabled?: boolean; left?: boolean; text?: string } = {}) {
    const ctx = panel.context;
    ctx.save(); ctx.globalAlpha = options.disabled ? .45 : 1;
    this.box(ctx, x, y, width, height, options.color ?? this.theme.button, panel.isHovered(label) ? this.gold : this.theme.border);
    ctx.beginPath(); ctx.rect(x + 4, y + 2, width - 8, height - 4); ctx.clip();
    this.text(ctx, options.text ?? label, x + 8, y + height / 2);
    ctx.restore();
    if (!options.disabled) panel.controls.push({ label, x, y, width, height, activate: action });
  }
  private centered(panel: SpatialPanel, label: string, x: number, y: number, width: number, height: number,
    action: () => void, color?: string, disabled = false, caption = label, textColor?: string) {
    const ctx = panel.context;
    ctx.save(); ctx.globalAlpha = disabled ? .45 : 1;
    this.box(ctx, x, y, width, height, color ?? this.theme.button, panel.isHovered(label) ? this.gold : this.theme.border);
    ctx.font = `12px ${this.font}`; ctx.textBaseline = "middle"; ctx.textAlign = "center";
    ctx.fillStyle = textColor ?? (color ? "#fff" : this.theme.text); ctx.fillText(caption, x + width / 2, y + height / 2); ctx.restore();
    if (!disabled) panel.controls.push({ label, x, y, width, height, activate: action });
  }

  render(state: PanelState) {
    this.state = state;
    if (!state.active || state.selectedId === null) this.typing = false;
    const bar = this.toolbar, ctx = bar.begin(50);
    ctx.fillStyle = this.theme.toolbar; ctx.fillRect(0, 0, 116, 50);
    tools.filter(item => item.tool === "navigate" || item.tool === "measure").forEach((item, index) => {
      const x = 11 + index * 49, selected = state.active === (item.tool === "measure");
      this.box(ctx, x, 7, 42, 36, this.theme.button, selected || bar.isHovered(item.label) ? this.gold : this.theme.border);
      ctx.save(); ctx.translate(x + 10, 14); ctx.scale(21 / 24, 21 / 24);
      ctx.strokeStyle = selected ? this.gold : this.theme.text; ctx.lineWidth = 1.7; ctx.lineJoin = "round";
      ctx.stroke(new Path2D(item.path)); ctx.restore();
      bar.controls.push({ label: item.label, x, y: 7, width: 42, height: 36,
        activate: () => { this.typing = false; this.collapsed = false; this.actions.tool(item.tool === "measure"); } });
    });
    bar.finish();
    this.options.enabled = state.active;
    this.keyboard.enabled = state.active && this.typing && !this.collapsed;
    if (!state.active) return;
    this.drawOptions(state);
    if (this.keyboard.enabled) this.drawKeyboard(state.name);
  }

  private drawOptions(state: PanelState) {
    const selected = state.records.find(record => record.id === state.selectedId);
    const allSaved = state.records.filter(record => record.saved);
    this.savedScroll = Math.min(this.savedScroll, Math.max(0, allSaved.length - 3));
    const saved = allSaved.slice(this.savedScroll, this.savedScroll + 3);
    const savedHeight = saved.length ? 34 + saved.length * 36 : 0;
    const formHeight = selected ? 280 : 170;
    const height = this.collapsed ? 18 : savedHeight + formHeight + 18;
    const panel = this.options, ctx = panel.begin(height);
    if (!this.collapsed) {
      if (saved.length) {
        this.box(ctx, 0, 0, 270, savedHeight - 8, this.theme.panel, "#555", 4);
        this.text(ctx, "Measurements", 8, 16, 12);
        saved.forEach((record, index) => {
          const y = 29 + index * 36;
          this.button(panel, record.name, 8, y, 216, 30, () => this.actions.open(record.id), { left: true });
          this.centered(panel, `Delete measurement ${record.name}`, 230, y, allSaved.length > 3 ? 22 : 32, 30,
            () => this.actions.remove(record.id), undefined, state.busy, "−", "#ff7474");
          if (record.id === selected?.id) { ctx.strokeStyle = this.gold; ctx.strokeRect(8.5, y + .5, 215, 29); }
        });
        if (allSaved.length > 3) {
          ctx.fillStyle = "#181818"; ctx.fillRect(257, 29, 5, 102);
          ctx.fillStyle = "#777"; ctx.fillRect(257, 29 + this.savedScroll / (allSaved.length - 3) * 74, 5, 28);
          panel.controls.push({ label: "Scroll saved measurements", x: 254, y: 29, width: 12, height: 102, axis: "y", drag: true,
            activate: fraction => { this.savedScroll = Math.round(fraction * (allSaved.length - 3)); this.render(this.state!); } });
        }
      }
      let y = savedHeight;
      this.box(ctx, 0, y, 270, formHeight, this.theme.panel, "#555", 4); y += 18;
      const message = state.message || (!selected ? "Click the first surface point or choose a saved measurement" :
        selected.points.length === 1 ? "Click the second surface point" : "Drag endpoint handles to adjust");
      const words = message.split(" "); let line = "", lines = 0;
      ctx.font = `12px ${this.font}`;
      for (const word of words) {
        if (ctx.measureText(`${line} ${word}`).width > 248 && line) {
          this.text(ctx, line, 8, y + lines++ * 15); line = word;
        } else line += `${line ? " " : ""}${word}`;
      }
      this.text(ctx, line, 8, y + lines * 15); y += 33;
      if (selected) {
        if (selected.points.length === 2) this.text(ctx, formatDistance(selected.points[0]!.distance(selected.points[1]!)), 8, y, 16, "#fff");
        y += 23;
        this.text(ctx, "Measurement name", 8, y); y += 12;
        this.button(panel, "Measurement name", 8, y, 254, 30, () => {
          this.typing = true; this.render(state);
        }, { left: true, text: state.name, color: this.theme.input }); y += 36;
        this.centered(panel, selected.saved ? "Update measurement" : "Save measurement", 8, y, 254, 32,
          this.actions.save, this.saveColor, state.busy || selected.points.length !== 2 || !state.name.trim()); y += 40;
      }
      for (const { key, label, min, max } of measurementAdjustments) {
        this.text(ctx, `${label}:`, 8, y + 11);
        const x = 91, width = 112, fraction = (state.style[key] - min) / (max - min);
        ctx.fillStyle = "#ddd"; ctx.beginPath(); ctx.roundRect(x, y + 9, width, 5, 3); ctx.fill();
        ctx.fillStyle = "#077cf4"; ctx.fillRect(x, y + 9, width * fraction, 5);
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x + width * fraction, y + 11, 7, 0, Math.PI * 2); ctx.fill();
        this.text(ctx, `${state.style[key]}`, 215, y + 11);
        panel.controls.push({ label, x, y, width, height: 24, drag: true, activate: fraction =>
          this.actions.style({ ...this.state!.style, [key]: Math.round(min + fraction * (max - min)) }) });
        this.centered(panel, `Reset ${label.toLowerCase()}`, 239, y, 23, 23,
          () => this.actions.style({ ...state.style, [key]: defaultMeasurementStyle[key] }), undefined,
          state.style[key] === defaultMeasurementStyle[key], "↺");
        y += 29;
      }
      this.centered(panel, "Clear measurements", 8, y, 254, 32, this.actions.clear, this.resetColor,
        state.busy || !state.records.length); y += 43;
      this.text(ctx, "Measurements last until you leave this asset.", 8, y, 10, "#bbb");
    }
    const y = height - 18, x = 180;
    ctx.fillStyle = this.theme.toolbar; ctx.strokeStyle = "#806d43"; ctx.beginPath();
    ctx.moveTo(x + 12, y); ctx.lineTo(258, y); ctx.lineTo(270, height); ctx.lineTo(x, height); ctx.closePath(); ctx.fill(); ctx.stroke();
    this.text(ctx, this.collapsed ? "‹" : "›", 222, y + 9, 20, this.gold);
    panel.controls.push({ label: this.collapsed ? "Expand tool options" : "Collapse tool options", x, y, width: 90, height: 18,
      activate: () => { this.collapsed = !this.collapsed; this.render(this.state!); } });
    panel.finish();
  }

  private drawKeyboard(value: string) {
    const panel = this.keyboard, ctx = panel.begin(190);
    this.box(ctx, 0, 0, 350, 190, this.theme.panel, "#555", 4);
    this.text(ctx, "Measurement name", 8, 15);
    this.box(ctx, 8, 28, 334, 28, this.theme.input); this.text(ctx, `${value}|`, 14, 42);
    const rows = ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm"];
    rows.forEach((row, index) => [...row].forEach((char, column) => {
      const key = this.upper ? char.toUpperCase() : char;
      this.centered(panel, key, 8 + column * 33 + (index > 1 ? (index - 1) * 12 : 0), 62 + index * 25, 30, 23,
        () => this.actions.name(`${this.state!.name}${key}`));
    }));
    this.centered(panel, "Shift", 8, 164, 55, 23, () => { this.upper = !this.upper; this.render(this.state!); });
    this.centered(panel, "Space", 68, 164, 100, 23, () => this.actions.name(`${this.state!.name} `));
    this.centered(panel, "⌫", 173, 164, 55, 23, () => this.actions.name(this.state!.name.slice(0, -1)));
    this.centered(panel, "Done", 233, 164, 109, 23, () => { this.typing = false; this.render(this.state!); }, this.saveColor);
    panel.finish();
  }
  destroy() { this.toolbar.destroy(); this.options.destroy(); this.keyboard.destroy(); this.anchor.destroy(); }
}
