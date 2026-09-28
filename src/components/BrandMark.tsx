import { Logo } from "../icons";
import { useBrandLogo, useBrandName } from "../brand";

/** Знак инсталляции (ТЗ 5.14 п.5): загруженный администратором (PNG/WebP) или знак Taskira. */
export function BrandMark({ size, variant = "mark", className = "" }: { size: number; variant?: "mark" | "app"; className?: string }) {
  const url = useBrandLogo();
  if (url) return <img src={url} width={size} height={size} alt="" className={`shrink-0 object-contain ${variant === "app" ? "rounded-[22%]" : ""} ${className}`} />;
  return <Logo size={size} variant={variant} className={className} />;
}

/** Название инсталляции — «Taskira», пока администратор не задал своё. */
export function BrandName({ className }: { className?: string }) {
  const name = useBrandName();
  return <span className={className}>{name}</span>;
}
