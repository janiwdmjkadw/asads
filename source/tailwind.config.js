const containerQueries = require('@tailwindcss/container-queries');

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    // The homepage modals used to be pure CSS modules; the certificate
    // invite modal is Tailwind-first, so its classes must be scanned.
    './homepage/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['Instrument Serif', 'Tiempos Headline', 'ui-serif', 'Georgia', 'serif'],
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SF Mono', 'Monaco', 'monospace'],
        // Homepage redesign — Geist (sans body) + Geist Mono (display / labels).
        geist: ['var(--font-geist)', 'Geist', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        'geist-mono': ['var(--font-geist-mono)', 'Geist Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        // next/font hashes the real family name, so the serif is only
        // reachable through the variable app/layout.tsx installs — the
        // `display` entry above names a family the browser never sees.
        'instrument-serif': ['var(--font-instrument-serif)', 'ui-serif', 'Georgia', 'serif'],
      },
      colors: {
        // shadcn semantic tokens. These point at CSS variables defined
        // inside `.listen-root` (see `components/listen/listen.css`) so
        // every shadcn component (Dialog, Slider, …) automatically
        // follows the active theme. Fallback hex literals keep the
        // global `* { @apply border-border }` rule sane for elements
        // rendered OUTSIDE `.listen-root` (html/body/Clerk widgets).
        border: 'var(--border, rgba(255,255,255,0.06))',
        background: 'var(--background, #0b0b0d)',
        foreground: 'var(--foreground, #c9c9c4)',
        input: 'var(--input, rgba(255,255,255,0.08))',
        ring: 'var(--ring, #38e1ff)',
        // Existing non-shadcn tokens — left untouched so historical
        // call sites (`bg-surface-1`, `text-ink-2`, `bg-flame`, etc.)
        // keep resolving to the same hex values.
        surface: {
          DEFAULT: '#0b0b0d',
          1: '#111114',
          2: '#1a1a20',
          3: '#22222a',
        },
        ink: {
          0: '#f6f6f4',
          1: '#c9c9c4',
          2: '#8a8a85',
          3: '#5a5a55',
          4: '#37373a',
        },
        flame: {
          DEFAULT: '#ff6a3d',
          soft: 'rgba(255,106,61,0.14)',
          glow: 'rgba(255,106,61,0.35)',
        },
        up: '#5cc88a',
        down: '#e06a6a',
        hold: '#e5b950',
        // Expanded shadcn semantic objects. `card`, `muted`, and
        // `accent` previously held flat hex pairs — we replace them
        // with CSS-var-backed pairs that match shadcn's contract
        // (`bg-card`, `text-card-foreground`, etc.). The expansion is
        // backwards-compatible for `bg-muted` / `bg-accent` /
        // `bg-card` callers because the DEFAULT key keeps the same
        // role (a tinted surface) but now flexes per theme.
        primary: {
          DEFAULT: 'var(--primary, #38e1ff)',
          foreground: 'var(--primary-foreground, #f6f6f4)',
        },
        secondary: {
          DEFAULT: 'var(--secondary, #22222a)',
          foreground: 'var(--secondary-foreground, #f6f6f4)',
        },
        muted: {
          DEFAULT: 'var(--muted, #22222a)',
          foreground: 'var(--muted-foreground, #8a8a85)',
        },
        accent: {
          // Bridges shadcn's `bg-accent` (subtle highlight) to our
          // existing `--accent-soft` token so the brand CTA color
          // continues to be addressed via `--accent` directly (and
          // shadcn's CTA via `bg-primary`).
          DEFAULT: 'var(--accent-soft, #1a1a20)',
          foreground: 'var(--ink-0, #f6f6f4)',
        },
        destructive: {
          DEFAULT: 'var(--destructive, #e06a6a)',
          foreground: 'var(--destructive-foreground, #f6f6f4)',
        },
        popover: {
          DEFAULT: 'var(--popover, #111114)',
          foreground: 'var(--popover-foreground, #f6f6f4)',
        },
        card: {
          DEFAULT: 'var(--card, #1a1a20)',
          foreground: 'var(--card-foreground, #c9c9c4)',
        },
        // shadcn Sidebar tokens — CSS-var-backed (defined in the
        // `.listen-root` theme bridge) so `bg-sidebar`, `text-sidebar-
        // foreground`, `border-sidebar-border`, etc. follow the active
        // theme instead of the CLI's stock HSL slate literals.
        sidebar: {
          DEFAULT: 'var(--sidebar, #111114)',
          foreground: 'var(--sidebar-foreground, #c9c9c4)',
          primary: 'var(--sidebar-primary, #38e1ff)',
          'primary-foreground': 'var(--sidebar-primary-foreground, #f6f6f4)',
          accent: 'var(--sidebar-accent, #1a1a20)',
          'accent-foreground': 'var(--sidebar-accent-foreground, #f6f6f4)',
          border: 'var(--sidebar-border, rgba(255,255,255,0.06))',
          ring: 'var(--sidebar-ring, #38e1ff)',
        },
        // Homepage redesign palette — dark "technical terminal" theme.
        // Authoritative values live as `--lh-*` CSS vars on the `.lh-home`
        // wrapper (see globals.css) so inline-styled diagram internals and
        // these Tailwind tokens share one source of truth; the hex literals
        // here are render fallbacks that match those vars exactly.
        homepage: {
          bg: 'var(--lh-bg, #0a0a0b)',
          panel: 'var(--lh-panel, #0f0f11)',
          panel2: 'var(--lh-panel2, #141416)',
          word: 'var(--lh-word, #e8e8e6)',
          ink: 'var(--lh-ink, #ededec)',
          ink2: 'var(--lh-ink2, #9a9a95)',
          ink3: 'var(--lh-ink3, #62625c)',
          accent: 'var(--lh-accent, #5eead4)',
          green: 'var(--lh-green, #5fb98a)',
          line: 'var(--lh-line, rgba(255,255,255,0.10))',
          line2: 'var(--lh-line2, rgba(255,255,255,0.055))',
          line3: 'var(--lh-line3, rgba(255,255,255,0.18))',
        },
        // Landing page ("listen") palette. Authoritative values are the
        // `--lp-*` vars on the `.lp` wrapper (components/landing/tokens.css);
        // these tokens only name them, so there is one source of truth and
        // nothing resolves outside that wrapper.
        lp: {
          ground: 'var(--lp-ground)',
          ink: {
            1: 'var(--lp-ink-1)',
            2: 'var(--lp-ink-2)',
            3: 'var(--lp-ink-3)',
          },
          accent: 'var(--lp-accent)',
          mint: 'var(--lp-mint)',
          'accent-ink': 'var(--lp-accent-ink)',
          hairline: 'var(--lp-hairline)',
          warm: 'var(--lp-warm)',
          ice: 'var(--lp-ice)',
          'tile-hairline': 'var(--lp-tile-hairline)',
          'dark-tile': 'var(--lp-dark-tile)',
          disclosure: 'var(--lp-disclosure)',
          'footer-ground': 'var(--lp-footer-ground)',
          'mint-band': 'var(--lp-mint-band)',
        },
      },
      backgroundImage: {
        // The landing CTA gradient: 90deg on the mobile anchor, 135deg on
        // the desktop pills (see components/landing/primitives/Pill.tsx).
        'lp-cta': 'linear-gradient(90deg, var(--lp-accent), var(--lp-mint))',
        'lp-cta-diag': 'linear-gradient(135deg, var(--lp-accent), var(--lp-mint))',
        // B3b mosaic ground (components/landing/tokens.css).
        'lp-mosaic-ground': 'var(--lp-mosaic-ground)',
      },
      spacing: {
        // Homepage rhythm tokens — the responsive section gutter and
        // top/bottom block padding, shared by the header, footer, divider
        // and every marketing section so the column lines up everywhere.
        gutter: 'clamp(20px, 5vw, 56px)',
        'block-t': 'clamp(40px, 6vh, 72px)',
        'block-b': 'clamp(56px, 8vh, 100px)',
      },
      borderRadius: {
        // shadcn semantic radii — driven off `--radius` so the system
        // can be retuned globally. The flat numeric values used by
        // the legacy `rounded-lg/md/sm` callers are preserved as
        // fallbacks (the var is only defined inside `.listen-root`).
        lg: 'var(--radius, 12px)',
        md: 'calc(var(--radius, 10px) - 2px)',
        sm: 'calc(var(--radius, 8px) - 4px)',
      },
      boxShadow: {
        'glow-flame': '0 0 20px rgba(255,106,61,0.15), 0 0 40px rgba(255,106,61,0.05)',
        'ring-flame': '0 0 0 1px rgba(255,106,61,0.30), 0 0 20px rgba(255,106,61,0.15), 0 0 40px rgba(255,106,61,0.05)',
        glass: '0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)',
        'glass-lg': '0 12px 48px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
        lift: '0 4px 20px rgba(0,0,0,0.25)',
        toast: '0 4px 24px rgba(0,0,0,0.5)',
      },
      animation: {
        'fade-slide': 'fadeSlide 0.35s ease-out',
        'pulse-dot': 'pulseDot 2s ease-in-out infinite',
        shimmer: 'shimmer 2.5s ease-in-out infinite',
        breathe: 'breathe 2s ease-in-out infinite',
        // shadcn Accordion (Radix collapsible content) transitions.
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
      keyframes: {
        fadeSlide: {
          from: { opacity: '0', transform: 'translateY(-8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        pulseDot: {
          '0%, 100%': { opacity: '0.4', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.2)' },
        },
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '50%, 100%': { transform: 'translateX(100%)' },
        },
        breathe: {
          '0%, 100%': { opacity: '0.7', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.02)' },
        },
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
    },
  },
  plugins: [containerQueries, require('tailwindcss-animate')],
};
