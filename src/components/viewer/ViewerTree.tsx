import { useState } from "react";

export interface ViewerTreeItem { id: number; name: string; visible?: boolean }
export interface ViewerTreeGroup {
  id: string; label: string; items: readonly ViewerTreeItem[];
  onOpen(id: number): void; onRename(id: number, name: string): void; onVisible?(id: number, visible: boolean): void;
}

export function ViewerTree({ groups }: { groups: readonly ViewerTreeGroup[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<{ group: string; item: number; name: string } | null>(null);

  function commit(group: ViewerTreeGroup) {
    if (editing?.name.trim()) group.onRename(editing.item, editing.name);
    setEditing(null);
  }

  return <aside className="viewer-tree" data-open={open}>
    <button className="viewer-tree-toggle" onClick={() => setOpen(value => !value)} aria-expanded={open} title="Model tree">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4v16m0-12h5m-5 8h5M11 6h8v4h-8zm0 8h8v4h-8z" /></svg>
      {open && <span>Model tree</span>}
    </button>
    {open && <div className="viewer-tree-content">
      {groups.map(group => <details key={group.id} open>
        <summary>{group.label}<span>{group.items.length}</span></summary>
        {group.items.length ? <ul>{group.items.map(item => <li key={item.id}>
          {group.onVisible && <button className="viewer-tree-eye" onClick={() => group.onVisible!(item.id, !item.visible)}
            aria-label={`${item.visible ? "Hide" : "Show"} ${item.name}`} aria-pressed={item.visible} title={item.visible ? "Hide" : "Show"}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" /></svg>
          </button>}
          {editing?.group === group.id && editing.item === item.id ?
            <input autoFocus value={editing.name}
              onChange={event => setEditing({ ...editing, name: event.target.value })}
              onKeyDown={event => {
                if (event.key === "Enter") event.currentTarget.blur();
                else if (event.key === "Escape") setEditing(null);
              }} onBlur={() => commit(group)} aria-label={`Rename ${item.name}`} /> :
            <button className="viewer-tree-name" title={`Open and frame ${item.name}`}
              onClick={() => group.onOpen(item.id)}>{item.name}</button>}
          <button className="viewer-tree-rename" title={`Rename ${item.name}`} aria-label={`Rename ${item.name}`}
            onClick={() => setEditing({ group: group.id, item: item.id, name: item.name })}>✎</button>
        </li>)}</ul> : <p>None</p>}
      </details>)}
    </div>}
  </aside>;
}
