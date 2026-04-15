const variants = {
  default: "border border-black bg-black text-white hover:bg-neutral-800",
  outline: "border border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-100",
  destructive: "border border-red-600 bg-red-600 text-white hover:bg-red-700",
};

export function Button({ className = "", variant = "default", type = "button", ...props }) {
  const variantClass = variants[variant] || variants.default;

  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${variantClass} ${className}`.trim()}
      {...props}
    />
  );
}
