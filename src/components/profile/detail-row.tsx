export function DetailRow({ k, v }: { k: string; v: string | null | undefined }) {
  if (!v) return null;
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{k}</dt>
      <dd className="mt-1 font-medium text-foreground break-words">{v}</dd>
    </div>
  );
}
