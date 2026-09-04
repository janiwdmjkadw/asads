'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

export interface VideoSource {
  src: string;
  /** Media query picking this cut. List the narrowest first. */
  media?: string;
  type?: string;
}

export interface VideoProps {
  sources: readonly VideoSource[];
  /** Frame shown before playback starts. Match it to the video's own
      first frame so nothing flashes when the decode lands. */
  poster: string;
  /** Still shown INSTEAD of the video when `respectReducedMotion` is on
      and the viewer asks for reduced motion. Defaults to `poster`; a
      play-once video wants its LAST frame here, since that is the state
      a motion-tolerant viewer ends up looking at. */
  stillSrc?: string;
  /** Opt IN to swapping the video for `stillSrc` under
      `prefers-reduced-motion: reduce`. Off by default — see the policy
      note above. */
  respectReducedMotion?: boolean;
  loop?: boolean;
  objectFit?: 'cover' | 'contain';
  className?: string;
}

/**
 * Decorative background video. Autoplays muted and inline, but only
 * while it is actually on screen — an IntersectionObserver pauses it
 * below/above the fold so a page of loops costs one decode, not six.
 *
 * `sources` is a media-query cascade (the browser takes the first match
 * at load time), so the mobile cut must come first.
 *
 * REDUCED-MOTION POLICY, and it differs by primitive. Videos PLAY
 * REGARDLESS by default: the landing's videos are the product itself,
 * and holding them on a still frame reads as footage that failed to
 * load rather than as restraint. Pass `respectReducedMotion` to opt a
 * given video back into the `stillSrc` swap. Shaders take the other
 * route — `MeshGround` / `SmokeGround` keep rendering, frozen on one
 * frame (`speed: 0`).
 *
 * A non-looping video plays exactly ONCE. Scrolling it out of view and
 * back does not restart it — the observer only resumes a video that has
 * not finished.
 */
export function Video({
  sources,
  poster,
  stillSrc,
  respectReducedMotion = false,
  loop = false,
  objectFit = 'cover',
  className,
}: VideoProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const still = respectReducedMotion && reducedMotion;
  const fitClass = objectFit === 'contain' ? 'object-contain' : 'object-cover';

  useEffect(() => {
    const el = ref.current;
    if (!el || still) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) {
          /* Play-once means once: a finished non-looping video must not
             restart when it scrolls back into view. */
          if (!loop && el.ended) return;
          /* Autoplay can still be refused (power saving, policy); the
             page is decorative either way, so swallow the rejection. */
          void el.play().catch(() => undefined);
        } else {
          el.pause();
        }
      },
      { threshold: 0.25 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [still, loop]);

  if (still) {
    return (
      <img src={stillSrc ?? poster} alt="" aria-hidden className={cn('block h-full w-full', fitClass, className)} />
    );
  }

  return (
    <video
      ref={ref}
      poster={poster}
      loop={loop}
      muted
      playsInline
      autoPlay
      preload="metadata"
      aria-hidden
      className={cn('block h-full w-full', fitClass, className)}
    >
      {sources.map((source) => (
        <source key={`${source.media ?? 'default'}:${source.src}`} src={source.src} media={source.media} type={source.type ?? 'video/mp4'} />
      ))}
    </video>
  );
}
