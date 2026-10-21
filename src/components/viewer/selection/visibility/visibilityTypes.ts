export interface VisibilityGeometry { positions: Float32Array; indices: Uint32Array }
export interface VisibilityPart { model: number[]; side: 0 | 1 | 2; visible: Uint8Array | null }
export interface VisibilityQuery {
  projection: number[]; view: number[]; parts: VisibilityPart[]; section: number[] | null;
  width: number; height: number; alpha: Uint8Array; hits: Uint8Array[];
}
