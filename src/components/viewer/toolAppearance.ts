// Read the actual desktop styles once when constructing immersive UI. This
// keeps colours/fonts synchronized without maintaining an XR theme in parallel.
export function toolAppearance(canvas: HTMLElement) {
  const frame = canvas.closest(".viewer-frame")!;
  const panel = document.createElement("div");
  panel.className = "selection-actions measurement-actions"; panel.style.visibility = "hidden";
  const button = document.createElement("button"), input = document.createElement("input");
  panel.append(button, input); frame.append(panel);
  const sample = getComputedStyle(panel), normal = getComputedStyle(button);
  const result = {
    panel: sample.backgroundColor, text: sample.color, font: sample.fontFamily,
    button: normal.backgroundColor, border: normal.borderColor,
    input: getComputedStyle(input).backgroundColor,
    gold: getComputedStyle(canvas).getPropertyValue("--gold").trim(),
    toolbar: getComputedStyle(frame.querySelector(".selection-toolbar")!).backgroundColor,
    save: "", reset: ""
  };
  button.className = "tool-action-save"; result.save = getComputedStyle(button).backgroundColor;
  button.className = "tool-action-reset"; result.reset = getComputedStyle(button).backgroundColor;
  panel.remove(); return result;
}
