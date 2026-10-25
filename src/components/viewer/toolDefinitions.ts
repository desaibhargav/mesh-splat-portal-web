import type { SelectionTool } from "./selection/types";

// One icon/label definition for the desktop and immersive toolbars.
export const tools: { tool: SelectionTool; label: string; path: string }[] = [
  { tool: "navigate", label: "Navigate (Q)", path: "M5 3l14 10-7 1-3 7z" },
  { tool: "select", label: "Select", path: "M4 4h16v16H4z" },
  { tool: "segment", label: "Segment", path: "M9 8l11 12M9 16L20 4M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 13a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" },
  { tool: "measure", label: "Measure distance", path: "M3 16L16 3l5 5L8 21zM7 12l3 3m0-6 3 3m0-6 3 3" },
  { tool: "annotate", label: "Annotate", path: "M4 4h16v12H9l-5 5zM8 8h8m-8 4h5" },
  { tool: "views", label: "Views", path: "M12 12V3m0 9 8 5m-8-5-8 5M9 6l3-3 3 3m2 5 3 6-6-1M4 11v6l6-1" },
  { tool: "section", label: "Cross section", path: "M3 8l9-5 9 5-9 5zM3 8v9l9 4 9-4V8M12 13v8M2 14l20-5" },
  { tool: "capture", label: "Capture view", path: "M4 7h4l2-2h4l2 2h4v12H4zM8 13a4 4 0 1 0 8 0 4 4 0 0 0-8 0z" }
];
