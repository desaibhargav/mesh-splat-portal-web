// A footprint in the XY plane, extruded along local +Z. `matrix` places that
// plane in world space; the asset itself stays unchanged. Both XR shapes use
// this contract and the same mesh/splat selection result masks.
export interface SelectionVolume {
  shape: "rectangle" | "lasso";
  matrix: number[];
  outline: [number, number][];
  depth: number;
}
