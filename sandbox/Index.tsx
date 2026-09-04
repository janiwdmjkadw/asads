import Link from 'next/link';
import type { ReactElement } from 'react';

import { PAGE_GROUPS, type PageEntry } from './pageList';

/**
 * `/sandbox` — every surface in the bundle, with a preview of each.
 *
 * ── WHAT CHANGED, AND WHY ────────────────────────────────────────────
 *
 * It was a list of mint links on black. That was right when it was a
 * developer's bookmark bar, and wrong the moment it became the way work
 * gets shown to somebody: a name and a route tell you nothing about
 * whether the page is worth opening, so every review started with
 * clicking all eighteen.
 *
 * ── AND NO THUMBNAILS ────────────────────────────────────────────────
 *
 * They were here, showing each page's preview card. Then the preview
 * became ONE card for the whole site, which is the right call for an
 * unfurl and makes a useless thumbnail: nineteen tiles of the same image
 * says nothing about any of them. A name, a route and a line does.
 *
 * ── IT IS WHITE, LIKE THE PAGES IT POINTS AT ─────────────────────────
 *
 * And it states every colour it uses rather than reading a token. It is
 * served from outside every route group, so it has NO stylesheet: no
 * landing tokens, no terminal tokens, no Tailwind base. Anything named
 * rather than written would fall back to a browser default.
 */

/*
 * NESTED FALLBACKS, NOT A COMMA LIST.
 *
 * `var(--a), var(--b), sans-serif` looks like a font stack and is not one:
 * a single undefined custom property makes the WHOLE declaration invalid
 * at computed value time, so the element inherits and the page comes up in
 * Times. This route loads no stylesheet, so `--font-instrument-sans` is
 * genuinely absent here and that is exactly what happened.
 *
 * Each var falls back to the next INSIDE it, which is the only form that
 * degrades rather than collapses.
 */
const SANS =
  'var(--font-instrument-sans, var(--font-geist-sans, ui-sans-serif)), system-ui, -apple-system, sans-serif';

const INK = '#0b0b0b';
const BODY = '#55555a';
const FAINT = '#8a8a90';
const LINE = 'rgba(11, 11, 11, 0.13)';

function Tile({ entry }: { entry: PageEntry }): ReactElement {
  return (
    <Link
      href={entry.href}
      style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          marginTop: 16,
          fontFamily: SANS,
        }}
      >
        <span style={{ fontSize: 18, fontWeight: 500, letterSpacing: '-0.02em', color: INK }}>
          {entry.name}
        </span>
        <span style={{ fontSize: 13, color: FAINT }}>{entry.href}</span>
      </span>

      <span
        style={{
          display: 'block',
          marginTop: 6,
          maxWidth: '52ch',
          fontFamily: SANS,
          fontSize: 14.5,
          lineHeight: '22px',
          color: BODY,
        }}
      >
        {entry.note}
      </span>

      {/* Said before the click, so nobody concludes a deliberately empty
          page or a flagged off surface is a broken one. */}
      {entry.caveat ? (
        <span
          style={{
            display: 'block',
            marginTop: 5,
            maxWidth: '52ch',
            fontFamily: SANS,
            fontSize: 13.5,
            lineHeight: '21px',
            color: FAINT,
          }}
        >
          {entry.caveat}
        </span>
      ) : null}
    </Link>
  );
}

export function Index(): ReactElement {
  return (
    <main style={{ minHeight: '100vh', width: '100%', background: '#fff' }}>
      <div style={{ width: 'min(1240px, 100% - 40px)', margin: '0 auto', padding: '72px 0 120px' }}>
        <span style={{ fontFamily: SANS, fontSize: 13.5, lineHeight: '20px', color: FAINT }}>Listen</span>
        <h1
          style={{
            margin: '14px 0 0',
            maxWidth: '16ch',
            fontFamily: SANS,
            fontSize: 'clamp(30px, 5vw, 56px)',
            fontWeight: 500,
            lineHeight: 1.04,
            letterSpacing: '-0.04em',
            color: INK,
          }}
        >
          Every page, in one place.
        </h1>
        <p
          style={{
            margin: '18px 0 0',
            maxWidth: '64ch',
            fontFamily: SANS,
            fontSize: 16,
            lineHeight: '26px',
            color: BODY,
          }}
        >
          Every surface in the bundle. Anything worth knowing before you open a page is said next to
          it.
        </p>

        {PAGE_GROUPS.map((group) => (
          <section key={group.title} style={{ marginTop: 72 }}>
            <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 20 }}>
              <h2
                style={{
                  margin: 0,
                  fontFamily: SANS,
                  fontSize: 20,
                  fontWeight: 500,
                  letterSpacing: '-0.02em',
                  color: INK,
                }}
              >
                {group.title}
              </h2>
              <p
                style={{
                  margin: '6px 0 0',
                  maxWidth: '68ch',
                  fontFamily: SANS,
                  fontSize: 14.5,
                  lineHeight: '22px',
                  color: FAINT,
                }}
              >
                {group.note}
              </p>
            </div>

            {/*
              `auto-fill` with a 340 floor rather than a breakpoint: this
              page has groups of four, ten and five, and any fixed column
              count leaves one of them with an orphan on its own row.
            */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))',
                gap: '30px 40px',
                marginTop: 26,
              }}
            >
              {group.entries.map((entry) => (
                <Tile key={entry.id} entry={entry} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
