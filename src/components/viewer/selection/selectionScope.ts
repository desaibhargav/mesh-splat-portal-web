// Primitive IDs stay in the published geometry's address space. A workspace
// limits eligibility without copying vertices, remapping IDs, or changing tools.
export type SelectionScope = readonly Uint8Array[] | null;

export function constrainMask(mask: Uint8Array, scope: Uint8Array | undefined): number {
  let count = 0;
  for (let i = 0; i < mask.length; i++) {
    if (scope && !scope[i]) mask[i] = 0;
    if (mask[i]) count++;
  }
  return count;
}
