import { ThumbsUp } from "lucide-react";

export const BRAND_NAME = "MightGuy";

type BrandMarkProps = {
  /** Badge size in pixels; the icon scales with it. */
  size?: number;
  className?: string;
};

/**
 * MightGuy's logo: his green jumpsuit as the badge, the orange leg warmers as
 * the accent stripe, and the "nice guy" thumbs-up.
 */
export default function BrandMark({ size = 32, className = "" }: BrandMarkProps) {
  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden bg-gradient-to-br from-[#3fb950] to-[#1a7f37] text-white shadow-lg shadow-black/40 ${className}`}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.26) }}
    >
      <ThumbsUp size={Math.round(size * 0.55)} strokeWidth={2.4} />
      <span className="absolute inset-x-0 bottom-0 bg-[#ff8a1f]" style={{ height: Math.max(2, Math.round(size * 0.1)) }} />
    </span>
  );
}
