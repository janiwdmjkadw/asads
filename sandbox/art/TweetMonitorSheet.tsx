'use client';

import type { ReactNode } from 'react';
import './tweet-monitor.css';

/*
 * ── SHEET 6 · THE TWEET POPUP, SIX WAYS ──────────────────────────────
 *
 * The panel that pops out of the trade page, and what it is MADE of.
 *
 * The feed inside is fixed: same three posts, same row, same header
 * text, same width, same height in every one. The only variables are
 * ground, border, corner, shadow, and the join between the header and
 * the body. If two panels here read differently, the shell did it.
 *
 * They sit on a lit ground rather than the sheet's black, because two
 * of the six are glass and glass over flat black is just grey. The real
 * one has a chart behind it.
 */

interface Post {
  id: string;
  name: string;
  handle: string;
  age: string;
  text: string;
  pics: number;
  stats: [replies: string, rts: string, likes: string, views: string];
}

const POSTS: Post[] = [
  {
    id: 'a',
    name: 'mike',
    handle: 'degenmike',
    age: '3m',
    text: 'the tape does not care what you think it should do. it only cares what it is doing.',
    pics: 0,
    stats: ['96', '318', '2.1K', '88.4K'],
  },
  {
    id: 'b',
    name: 'kessel',
    handle: 'kessel',
    age: '14m',
    text: 'four charts from this morning. same setup, four different outcomes, and the only thing that changed was where people were already sitting.',
    pics: 2,
    stats: ['402', '1.2K', '6.9K', '212K'],
  },
  {
    id: 'c',
    name: 'mike',
    handle: 'degenmike',
    age: '38m',
    text: 'unpopular: most of you do not need a faster fill. you need to press fewer buttons.',
    pics: 0,
    stats: ['511', '1.6K', '7.2K', '156K'],
  },
  {
    id: 'd',
    name: 'kessel',
    handle: 'kessel',
    age: '71m',
    text: 'nothing happened today and that is also information.',
    pics: 0,
    stats: ['41', '88', '940', '22.9K'],
  },
];

const face = (seed: string) => `https://picsum.photos/seed/${seed}/96`;
const pic = (seed: string, k: number) => `https://picsum.photos/seed/${seed}-${k}/600/400`;

/* ── marks ─────────────────────────────────────────────────────────── */

function XMark() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.9 2H22l-6.8 7.8L23 22h-6.3l-4.9-6.4L6.2 22H3l7.3-8.3L2.5 2h6.4l4.4 5.8L18.9 2Zm-1.1 18h1.7L8.3 3.7H6.5L17.8 20Z" />
    </svg>
  );
}

function BellMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function CloseMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function Stat({ value, children }: { value: string; children: ReactNode }) {
  return (
    <span className="tw2-stat">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
      {value}
    </span>
  );
}

/** The row, identical in every shell. */
function Feed() {
  return (
    <>
      {POSTS.map((p) => (
        <div className="tw2" key={p.id}>
          <span className="tw2-pfp">
            <img className="tm-img" src={face(p.handle)} alt="" loading="lazy" />
          </span>
          <span className="tw2-main">
            <span className="tw2-who">
              <span className="tw2-name">{p.name}</span>
              <img className="tm-check" src="/assets/x_blue_check_icon.svg" alt="" aria-hidden />
              <span className="tw2-at">@{p.handle}</span>
              <span className="tw2-age">· {p.age}</span>
              <span className="tw2-x">
                <XMark />
              </span>
            </span>
            <p className="tw2-text">{p.text}</p>
            {p.pics > 0 ? (
              <span className="tw2-pics" data-n={p.pics}>
                {Array.from({ length: p.pics }, (_, k) => (
                  <img key={k} src={pic(p.handle, k)} alt="" loading="lazy" draggable={false} />
                ))}
              </span>
            ) : null}
            <span className="tw2-stats">
              <Stat value={p.stats[0]}>
                <path d="M20.5 12.4c0 4.1-3.8 7.4-8.5 7.4a10 10 0 0 1-2.6-.3l-5 1.9 1.6-4.2a7 7 0 0 1-2-4.8C4 8.3 7.8 5 12.5 5s8 3.3 8 7.4Z" />
              </Stat>
              <Stat value={p.stats[1]}>
                <path d="M4 8.5h11.5a3 3 0 0 1 3 3V15M4 8.5 7 5.5M4 8.5l3 3" />
                <path d="M20 15.5H8.5a3 3 0 0 1-3-3V9M20 15.5l-3 3M20 15.5l-3-3" />
              </Stat>
              <Stat value={p.stats[2]}>
                <path d="M12 19.5S4 15 4 9.9A4 4 0 0 1 12 8a4 4 0 0 1 8 1.9c0 5.1-8 9.6-8 9.6Z" />
              </Stat>
              <Stat value={p.stats[3]}>
                <path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
                <circle cx="12" cy="12" r="2.6" />
              </Stat>
            </span>
          </span>
        </div>
      ))}
    </>
  );
}

function Slot({ n, name, note, shell }: { n: number; name: string; note: string; shell: string }) {
  return (
    <div className="tm-slot">
      <div className="tm-cap">
        <b>
          {n}. {name}
        </b>
        <small>{note}</small>
      </div>
      <div className={`sh ${shell}`}>
        <div className="sh-head">
          <b>Tweets</b>
          <i>4</i>
          <span className="sh-sp" />
          <button type="button" aria-label="Mute">
            <BellMark />
          </button>
          <button type="button" aria-label="Close">
            <CloseMark />
          </button>
        </div>
        <div className="sh-feed">
          <Feed />
        </div>
      </div>
    </div>
  );
}

export function TweetMonitorSheet() {
  return (
    <section className="tm">
      <h2>The tweet popup</h2>
      <p className="tm-note">
        Six shells around one feed. The posts, the row, the header text, the width and the height
        are identical in all six, so the only thing separating them is what the panel is made of:
        the ground, the edge, the corner, the shadow, and how the header meets the body.
      </p>

      <div className="tm-rack">
        <Slot n={1} name="Glass" note="what ships now" shell="sh1" />
        <Slot n={2} name="Flat" note="one ground, one hairline, no shadow" shell="sh2" />
        <Slot n={3} name="Well" note="cut into the page, not laid on it" shell="sh3" />
        <Slot n={4} name="Card" note="no border, the shadow is the edge" shell="sh4" />
        <Slot n={5} name="Seam" note="square, one line, same as when it docks" shell="sh5" />
        <Slot n={6} name="Lifted" note="soft and borderless, no glass" shell="sh6" />
      </div>
    </section>
  );
}
