export function ResetButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick(): void }) {
  return <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick}>
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4v6h6M4 10a8 8 0 1 1 1 8" />
    </svg>
  </button>;
}
