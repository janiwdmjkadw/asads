import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * shadcn-style class composer. Combines clsx (conditional class
 * stringification) with tailwind-merge (de-duplicates conflicting
 * Tailwind utilities, last-write-wins). Used by the generated
 * shadcn components under `components/ui/*`.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function ago(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  return Math.floor(s / 3600) + 'h';
}

export function agoColor(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s <= 2) return 'text-emerald-400';
  if (s <= 7) return 'text-amber-400';
  return 'text-red-400';
}

export function scoreCls(score: number | null): string {
  if (score == null) return 'border-white/[0.08] bg-white/[0.04] text-zinc-500';
  if (score >= 8) return 'border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-400 shadow-[inset_0_0_8px_rgba(52,211,153,0.08)]';
  if (score >= 6) return 'border-amber-500/25 bg-amber-500/[0.08] text-amber-400 shadow-[inset_0_0_8px_rgba(251,191,36,0.08)]';
  return 'border-red-500/25 bg-red-500/[0.08] text-red-400 shadow-[inset_0_0_8px_rgba(248,113,113,0.08)]';
}

export function tierCls(tier: number): string {
  if (tier <= 1) return 'border-emerald-500/25 bg-emerald-500/[0.08] text-emerald-400 shadow-[inset_0_0_8px_rgba(52,211,153,0.08)]';
  if (tier <= 2) return 'border-blue-500/25 bg-blue-500/[0.08] text-blue-400 shadow-[inset_0_0_8px_rgba(96,165,250,0.08)]';
  if (tier <= 3) return 'border-amber-500/25 bg-amber-500/[0.08] text-amber-400 shadow-[inset_0_0_8px_rgba(251,191,36,0.08)]';
  return 'border-white/[0.08] bg-white/[0.04] text-zinc-500';
}

export function tierShadow(tier: number): string {
  if (tier <= 1) return 'hover:shadow-glow-emerald';
  if (tier <= 2) return 'hover:shadow-glow-blue';
  if (tier <= 3) return 'hover:shadow-glow-amber';
  return '';
}

export function toXUrl(url: string): string {
  return url.replace('twitter.com/', 'x.com/');
}

export function extractHandle(url: string | null | undefined): string {
  if (!url) return '';
  const m = url.match(/(?:x|twitter)\.com\/([^/?]+)/i);
  return m?.[1] ?? '';
}

export function parseTweet(text: string): { main: string; quoted: string } {
  const qm = text.match(/\[quoted:\s*([\s\S]*)\]$/);
  if (qm) return { main: text.slice(0, qm.index).trim(), quoted: qm[1].trim() };
  return { main: text, quoted: '' };
}

/* [REDACTED FOR EXPORT] A client-side mirror of a server trading heuristic
   (an account allowlist, a keyword test and a per-tier sizing rule) lived
   here. It is proprietary and unused by any UI in this export, so it has
   been removed rather than stubbed. */
