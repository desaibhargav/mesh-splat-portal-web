interface Item { id: number; name: string }

// Tool lists share presentation; each document model owns its save/edit behavior.
export function SavedItems({ label, items, selectedId, disabled = false, className = "", onOpen, onRemove }: {
  label: string; items: readonly Item[]; selectedId?: number | null; disabled?: boolean; className?: string;
  onOpen(id: number): void; onRemove(id: number): void;
}) {
  if (!items.length) return null;
  return <div className={`selection-actions annotation-list ${className}`} role="group" aria-label={`Saved ${label.toLowerCase()}`}>
    <strong>{label}</strong>
    <ol>{items.map(item => <li key={item.id}>
      <button className="annotation-edit" disabled={disabled} aria-pressed={selectedId === item.id} onClick={() => onOpen(item.id)}>{item.name}</button>
      <button className="annotation-delete" disabled={disabled} aria-label={`Delete ${item.name}`} onClick={() => onRemove(item.id)}>−</button>
    </li>)}</ol>
  </div>;
}
