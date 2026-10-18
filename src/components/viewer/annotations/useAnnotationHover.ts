import { useMemo } from "react";
import { usePrimitiveHover } from "../picking/usePrimitiveHover";
import { snapshotContains } from "../selection/selectionSnapshot";
import type { SelectionHandle } from "../selection/types";
import type { AnnotationRecord } from "./Annotations";

export function useAnnotationHover(handle: SelectionHandle, records: readonly AnnotationRecord[], active: boolean) {
  const enabled = active && records.some(record => record.region);
  const { hit, error } = usePrimitiveHover(handle, enabled);
  const hovered = useMemo(() => {
    if (!hit) return null;
    return records.find(record => record.region && snapshotContains(record.region, hit.part, hit.index))?.id ?? null;
  }, [hit, records]);
  return { hovered, error };
}
