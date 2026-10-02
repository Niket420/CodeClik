export const BRAND_NAME = "CodeClik";

type BrandMarkProps = {
  /** Badge size in pixels; the glyph scales with it. */
  size?: number;
  className?: string;
};

/**
 * CodeClik's logo: a code bracket next to a cursor — "code" + "click".
 * Static copies for the README and browser tab live in public/logo.svg and
 * app/icon.svg.
 */
export default function BrandMark({ size = 32, className = "" }: BrandMarkProps) {
  return (
    <span
      className={`grid shrink-0 place-items-center bg-white text-black shadow-lg shadow-black/40 ${className}`}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.26) }}
    >
      <svg width={Math.round(size * 0.68)} height={Math.round(size * 0.68)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M9 7 4 12l5 5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        {/* Cursor (Lucide mouse-pointer-2, ISC), scaled into the right half. */}
        <path
          transform="translate(9.6 6.8) scale(0.55)"
          d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
