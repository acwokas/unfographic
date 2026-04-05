export default function Logo({ className = '' }: { className?: string }) {
  return (
    <span
      className={`font-heading font-bold tracking-[-0.03em] ${className}`}
    >
      <span className="text-primary">Un</span>
      <span className="text-foreground">fographic</span>
    </span>
  );
}
