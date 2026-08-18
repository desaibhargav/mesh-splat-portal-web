interface SearchBarProps {
  value: string;
  onChange(value: string): void;
}

export function SearchBar({ value, onChange }: SearchBarProps) {
  return (
    <label className="search-field">
      <span className="visually-hidden">Search artifacts</span>
      <input
        type="search"
        value={value}
        placeholder="Search the collection by title or description"
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
