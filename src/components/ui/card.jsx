export function Card({ className = "", ...props }) {
  return <div className={`rounded-2xl border border-neutral-200 bg-white ${className}`.trim()} {...props} />;
}

export function CardContent({ className = "", ...props }) {
  return <div className={className} {...props} />;
}
