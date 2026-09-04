'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * "Is this element within ~one viewport of the fold yet?" — the gate the
 * WebGL grounds mount behind, so a page with three live shaders pays for
 * one at load instead of three.
 *
 * One-way on purpose: once true it stays true, so scrolling past a ground
 * does not tear its canvas down and re-warm it on the way back. Starts
 * `false` (server and first client paint agree) and, where
 * IntersectionObserver is missing, settles `true` immediately — i.e. the
 * old eager behaviour rather than a ground that never appears.
 */
export function useNearViewport<T extends HTMLElement>(rootMargin = '100%') {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setNear(true);
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin, near]);

  return [ref, near] as const;
}
