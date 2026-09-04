'use client';

/**
 * `<ListenCreature />` — the animated owl.
 *
 * The component is a thin renderer over `CreatureEngine`: props are pushed
 * into the engine from effects, one rAF loop asks the engine for a frame and
 * writes exactly three transform strings to the DOM. There is deliberately
 * ZERO React state in the animation path — the creature never re-renders
 * while it moves, so many of them can share a page for free.
 *
 * Whole-character motion is a CSS transform on the `<svg>` root (compositor
 * work, no repaint); eye motion is the `transform` ATTRIBUTE on the two eye
 * groups, each of which is already centered on its own mark so it rotates
 * and scales about itself without CSS `transform-origin` semantics on SVG.
 *
 * The form channel (spec §3.4) rides the same loop: the dot and particle
 * circles are all pre-created and parked at `opacity="0"`, and a form only
 * ever changes attributes on nodes that already exist. It writes to the
 * `<g data-part="character">` group rather than the svg root, so the body's
 * morph never drags the signifiers along with it.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type CSSProperties,
} from 'react';

import { CreatureEngine } from './engine';
import { eyeLayout, resolveEyes, type EyeGeometry, type EyePresetName } from './eyes';
import { ASPECT, BODY_CENTER, BODY_PATH, VIEW_BOX } from './svg';
import {
  DEFAULT_TUNING,
  FORM_DOT_COUNT,
  FORM_PARTICLE_COUNT,
  OWL_FORM,
  type AttentionTarget,
  type CreatureFrame,
  type CreatureState,
  type CreatureTuning,
  type ExpressionName,
  type EyePose,
  type FormBody,
  type FormDot,
  type FormName,
  type NamedTargetVectors,
  type Vec2,
} from './types';

export type {
  AttentionTarget,
  CreatureState,
  ExpressionName,
  EyeGeometry,
  EyePresetName,
  FormName,
  Vec2,
};

/** How the creature is allowed to move; `auto` follows the OS preference. */
export type MotionMode = 'auto' | 'full' | 'reduced' | 'off';

/** Imperative pokes — none of them change `state`. */
export interface ListenCreatureHandle {
  hop(): void;
  twirl(): void;
  blink(): void;
  squint(): void;
  squash(): void;
  wobble(): void;
  celebrate(): void;
  /** A normalized gaze direction, a client-space px point (`{client:true}`), or a named target. */
  lookAt(target: Vec2 | AttentionTarget, opts?: { holdMs?: number; client?: boolean }): void;
  /** Wear an expression temporarily; the state's base expression returns after `holdMs`. */
  express(name: ExpressionName, holdMs?: number): void;
  /**
   * Play one form (spec §3.4). Looping forms hold until the next call;
   * one-shot forms settle and report through `onFormSettled`. Under reduced
   * motion and `motion='off'` this is a no-op that settles immediately, so a
   * sequencer outside the component never hangs waiting on it.
   */
  playForm(name: FormName): void;
  /** Drop the active form at once and go back to the ordinary owl. */
  cancelForm(): void;
}

export interface ListenCreatureProps {
  state?: CreatureState;
  /** A named target or an explicit normalized gaze direction. */
  target?: AttentionTarget | Vec2;
  /** Width in px; height is `size * 0.95`. */
  size?: number;
  /** Every random choice derives from this. */
  seed?: number;
  tuning?: Partial<CreatureTuning>;
  motion?: MotionMode;
  bodyColor?: string;
  eyeColor?: string;
  /** Override where the named attention targets live, as gaze directions. */
  targetVectors?: NamedTargetVectors;
  /** Eye geometry: a preset name, or a partial override merged over a preset. Default `'ovalL'`. */
  eyes?: EyePresetName | Partial<EyeGeometry>;
  /** Fired from the rAF loop when a one-shot form reaches its end — never during render. */
  onFormSettled?: (name: FormName) => void;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
}

/** Where the named targets sit by default, as normalized gaze (+y = down). */
const DEFAULT_TARGET_VECTORS: Record<'input' | 'response' | 'result', Vec2> = {
  input: { x: 0, y: 0.8 },
  response: { x: -0.3, y: 0.55 },
  result: { x: 0.3, y: 0.55 },
};

/** The pose the creature holds when it is not allowed to move at all. */
const NEUTRAL_FRAME: CreatureFrame = {
  body: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  left: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  right: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  form: OWL_FORM,
};

/** Index arrays for the pre-created signifier circles; module-level, so stable. */
const DOT_SLOTS = Array.from({ length: FORM_DOT_COUNT }, (_, i) => i);
const PARTICLE_SLOTS = Array.from({ length: FORM_PARTICLE_COUNT }, (_, i) => i);

/** States in which the pointer is worth listening to at all. */
const POINTER_STATES: ReadonlySet<CreatureState> = new Set<CreatureState>([
  'idle',
  'listening',
  'thinking',
  'searching',
]);

/** The transform origin of the whole character: its body center, as a %. */
const TRANSFORM_ORIGIN = `${BODY_CENTER.x}% ${((BODY_CENTER.y / 95) * 100).toFixed(2)}%`;

/** The `transform` attribute for one eye group, about that eye's own center. */
function eyeTransform(center: Vec2, pose: EyePose): string {
  return (
    `translate(${(center.x + pose.x).toFixed(3)} ${(center.y + pose.y).toFixed(3)})` +
    ` rotate(${pose.rotation.toFixed(3)})` +
    ` scale(${pose.scaleX.toFixed(4)} ${pose.scaleY.toFixed(4)})`
  );
}

/**
 * The pupil's own transform, INSIDE the eye group: it adds 0.6x of the eye's
 * translation on top of the 1x the group already carries, so the pupil travels
 * 1.6x the mark. It inherits the group's rotate/scale, so it squashes on blink.
 */
function pupilTransform(pose: EyePose): string {
  return `translate(${(pose.x * 0.6).toFixed(3)} ${(pose.y * 0.6).toFixed(3)})`;
}

/**
 * The character group's own transform: the active form's morph, about the
 * body center, on top of whatever the pose already did to the svg root.
 */
function formTransform(b: FormBody): string {
  return (
    `translate(${b.extraX.toFixed(3)} ${b.extraY.toFixed(3)})` +
    ` translate(${BODY_CENTER.x} ${BODY_CENTER.y})` +
    ` scale(${b.extraScaleX.toFixed(4)} ${b.extraScaleY.toFixed(4)})` +
    ` translate(${-BODY_CENTER.x} ${-BODY_CENTER.y})`
  );
}

/**
 * One signifier circle's state as a single cache key. Each circle is authored
 * with `r="1"`, so its radius is just the scale in its own transform — two
 * attribute writes per changed circle, and none at all for an unchanged one.
 */
function markKey(m: FormDot | undefined): string {
  if (!m || m.opacity <= 0 || m.r <= 0) return '';
  return `${m.x.toFixed(2)} ${m.y.toFixed(2)} ${m.r.toFixed(3)} ${m.opacity.toFixed(3)}`;
}

/** One pass over a pre-created circle row; an unchanged circle costs nothing. */
function writeMarks(
  nodes: ReadonlyArray<SVGCircleElement | null>,
  cache: string[],
  marks: readonly FormDot[],
): void {
  for (let i = 0; i < cache.length; i += 1) {
    const mark = marks[i];
    const key = markKey(mark);
    if (key === cache[i]) continue;
    cache[i] = key;
    const node = nodes[i];
    if (!node) continue;
    if (key === '' || !mark) {
      node.setAttribute('opacity', '0');
      continue;
    }
    node.setAttribute(
      'transform',
      `translate(${mark.x.toFixed(2)} ${mark.y.toFixed(2)}) scale(${mark.r.toFixed(3)})`,
    );
    node.setAttribute('opacity', mark.opacity.toFixed(3));
  }
}

/** Clamp a direction into the unit disc, so gaze never leaves the face. */
function clampDisc(v: Vec2): Vec2 {
  const r = Math.hypot(v.x, v.y);
  return r > 1 ? { x: v.x / r, y: v.y / r } : v;
}

export const ListenCreature = forwardRef<ListenCreatureHandle, ListenCreatureProps>(
  function ListenCreature(props, ref) {
    const {
      state = 'idle',
      target = null,
      size = 48,
      seed = 1,
      tuning,
      motion = 'auto',
      // The "final Soren" colorway (spec §3.1): ivory body, ground-colored
      // eyes, so on the product's dark canvas the marks read as cut-outs.
      bodyColor = '#DCD7E6',
      eyeColor = '#0B0B0D',
      targetVectors,
      eyes = 'ovalL',
      onFormSettled,
      className,
      style,
      'aria-label': ariaLabel,
    } = props;

    const svgRef = useRef<SVGSVGElement | null>(null);
    const characterRef = useRef<SVGGElement | null>(null);
    const eyesRef = useRef<SVGGElement | null>(null);
    const leftRef = useRef<SVGGElement | null>(null);
    const rightRef = useRef<SVGGElement | null>(null);
    const leftPupilRef = useRef<SVGGElement | null>(null);
    const rightPupilRef = useRef<SVGGElement | null>(null);
    const dotRefs = useRef<Array<SVGCircleElement | null>>([]);
    const particleRefs = useRef<Array<SVGCircleElement | null>>([]);
    const engineRef = useRef<CreatureEngine | null>(null);
    const rafRef = useRef<number | null>(null);

    // The form the loop is waiting to settle, and the callback it settles to.
    const pendingFormRef = useRef<FormName | null>(null);
    const onFormSettledRef = useRef(onFormSettled);
    onFormSettledRef.current = onFormSettled;

    // Latest props the imperative handle and the loop need, without deps.
    const latest = useRef({ size, tuning, targetVectors });
    latest.current = { size, tuning, targetVectors };

    // Loop gates. All plain refs: flipping one must not re-render.
    const mountedRef = useRef(false);
    const documentVisibleRef = useRef(true);
    const intersectingRef = useRef(true);
    const motionOffRef = useRef(motion === 'off');

    // Eye geometry is a pure rendering concern: it never restarts the engine,
    // and the loop reads the current centers off a ref.
    const eyesKey = JSON.stringify(eyes ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const geometry = useMemo(() => resolveEyes(eyes), [eyesKey]);
    const geo = useMemo(() => eyeLayout(geometry), [geometry]);
    const geoRef = useRef(geo);
    geoRef.current = geo;

    // Last strings written, so an unchanged frame touches no DOM.
    const lastBody = useRef('');
    const lastLeft = useRef('');
    const lastRight = useRef('');
    const lastLeftPupil = useRef('');
    const lastRightPupil = useRef('');
    const lastForm = useRef('');
    const lastFormOpacity = useRef('');
    const lastEyesOpacity = useRef('');
    const lastDots = useRef<string[]>(DOT_SLOTS.map(() => ''));
    const lastParticles = useRef<string[]>(PARTICLE_SLOTS.map(() => ''));

    const pointerRef = useRef<{ dx: number; dy: number } | null>(null);

    const writeFrame = useCallback((frame: CreatureFrame) => {
      const svg = svgRef.current;
      if (!svg) return;
      const k = latest.current.size / 100;
      const b = frame.body;
      const bodyString =
        `translate(${(b.x * k).toFixed(3)}px, ${(b.y * k).toFixed(3)}px)` +
        ` rotate(${b.rotation.toFixed(3)}deg)` +
        ` scale(${b.scaleX.toFixed(4)}, ${b.scaleY.toFixed(4)})`;
      if (bodyString !== lastBody.current) {
        svg.style.transform = bodyString;
        lastBody.current = bodyString;
      }
      const { leftCenter, rightCenter } = geoRef.current;
      const leftString = eyeTransform(leftCenter, frame.left);
      if (leftString !== lastLeft.current) {
        leftRef.current?.setAttribute('transform', leftString);
        lastLeft.current = leftString;
      }
      const rightString = eyeTransform(rightCenter, frame.right);
      if (rightString !== lastRight.current) {
        rightRef.current?.setAttribute('transform', rightString);
        lastRight.current = rightString;
      }
      const leftPupil = pupilTransform(frame.left);
      if (leftPupil !== lastLeftPupil.current) {
        leftPupilRef.current?.setAttribute('transform', leftPupil);
        lastLeftPupil.current = leftPupil;
      }
      const rightPupil = pupilTransform(frame.right);
      if (rightPupil !== lastRightPupil.current) {
        rightPupilRef.current?.setAttribute('transform', rightPupil);
        lastRightPupil.current = rightPupil;
      }

      const form = frame.form;
      const formString = formTransform(form.body);
      if (formString !== lastForm.current) {
        characterRef.current?.setAttribute('transform', formString);
        lastForm.current = formString;
      }
      const formOpacity = form.body.opacity.toFixed(3);
      if (formOpacity !== lastFormOpacity.current) {
        characterRef.current?.setAttribute('opacity', formOpacity);
        lastFormOpacity.current = formOpacity;
      }
      const eyesOpacity = form.eyesVisible ? '1' : '0';
      if (eyesOpacity !== lastEyesOpacity.current) {
        eyesRef.current?.setAttribute('opacity', eyesOpacity);
        lastEyesOpacity.current = eyesOpacity;
      }
      writeMarks(dotRefs.current, lastDots.current, form.dots);
      writeMarks(particleRefs.current, lastParticles.current, form.particles);
    }, []);

    /** Start or stop the loop so it matches the four gates exactly. */
    const syncLoop = useCallback(() => {
      const shouldRun =
        mountedRef.current &&
        documentVisibleRef.current &&
        intersectingRef.current &&
        !motionOffRef.current &&
        engineRef.current !== null;
      if (shouldRun) {
        if (rafRef.current !== null) return;
        const step = (now: number) => {
          rafRef.current = requestAnimationFrame(step);
          const engine = engineRef.current;
          if (!engine) return;
          const frame = engine.tick(now);
          writeFrame(frame);
          // Settling is reported from here, never from render: a one-shot
          // form is done exactly once, and a looping form never is.
          const pending = pendingFormRef.current;
          if (pending !== null && frame.form.done && frame.form.kind === pending) {
            pendingFormRef.current = null;
            onFormSettledRef.current?.(pending);
          }
        };
        rafRef.current = requestAnimationFrame(step);
        return;
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }, [writeFrame]);

    // A prop change can only ever move the creature via the engine, so the
    // cached strings are invalidated on every render — cheap, and it keeps a
    // re-render from ever pinning a stale transform.
    lastBody.current = '';
    lastLeft.current = '';
    lastRight.current = '';
    lastLeftPupil.current = '';
    lastRightPupil.current = '';
    lastForm.current = '';
    lastFormOpacity.current = '';
    lastEyesOpacity.current = '';
    lastDots.current.fill('');
    lastParticles.current.fill('');

    const prefersReduced = useCallback(
      () =>
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      [],
    );

    const resolveReduced = useCallback(
      (mode: MotionMode) => (mode === 'auto' ? prefersReduced() : mode === 'reduced'),
      [prefersReduced],
    );

    const tuningKey = JSON.stringify(tuning ?? null);
    const vectorsKey = JSON.stringify(targetVectors ?? null);
    const targetKey =
      target === null || typeof target === 'string' ? String(target) : `${target.x},${target.y}`;

    // The engine is rebuilt when the seed changes — the seed IS the creature's
    // personality, and replaying it from scratch is the only honest reset.
    useEffect(() => {
      mountedRef.current = true;
      const now = performance.now();
      const engine = new CreatureEngine({
        seed,
        tuning: latest.current.tuning,
        reducedMotion: resolveReduced(motion),
        now,
      });
      const p = props;
      if (latest.current.targetVectors) engine.setTargetVectors(latest.current.targetVectors);
      engine.setTarget(p.target ?? null);
      if (p.state && p.state !== 'idle') engine.setState(p.state, now);
      engineRef.current = engine;
      writeFrame(engine.tick(now));
      syncLoop();
      return () => {
        mountedRef.current = false;
        engineRef.current = null;
        pendingFormRef.current = null;
        syncLoop();
      };
      // Deliberately keyed on the seed alone: every other prop is pushed by
      // its own effect below, and `props`/`motion` are read fresh here.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [seed]);

    useEffect(() => {
      engineRef.current?.setState(state, performance.now());
    }, [state]);

    useEffect(() => {
      engineRef.current?.setTarget(target ?? null);
      // `targetKey` is the value identity of `target`.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [targetKey]);

    useEffect(() => {
      if (targetVectors) engineRef.current?.setTargetVectors(targetVectors);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [vectorsKey]);

    useEffect(() => {
      engineRef.current?.setTuning({ ...DEFAULT_TUNING, ...tuning });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tuningKey]);

    // Motion mode: 'off' parks the neutral frame and runs no loop at all.
    useEffect(() => {
      motionOffRef.current = motion === 'off';
      engineRef.current?.setReducedMotion(resolveReduced(motion));
      if (motion === 'off') {
        engineRef.current?.cancelForm();
        writeFrame(NEUTRAL_FRAME);
        // The loop is about to stop, so nothing else would ever settle this.
        const pending = pendingFormRef.current;
        pendingFormRef.current = null;
        if (pending !== null) onFormSettledRef.current?.(pending);
      }
      syncLoop();
      if (motion !== 'auto' || typeof window === 'undefined') return;
      if (typeof window.matchMedia !== 'function') return;
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      const onChange = (e: MediaQueryListEvent) => engineRef.current?.setReducedMotion(e.matches);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }, [motion, resolveReduced, syncLoop, writeFrame]);

    // Visibility + intersection: a creature nobody can see costs nothing.
    useEffect(() => {
      const onVisibility = () => {
        documentVisibleRef.current = document.visibilityState === 'visible';
        syncLoop();
      };
      onVisibility();
      document.addEventListener('visibilitychange', onVisibility);

      let observer: IntersectionObserver | null = null;
      const el = svgRef.current;
      if (el && typeof IntersectionObserver === 'function') {
        observer = new IntersectionObserver((entries) => {
          for (const entry of entries) intersectingRef.current = entry.isIntersecting;
          syncLoop();
        });
        observer.observe(el);
      }
      return () => {
        document.removeEventListener('visibilitychange', onVisibility);
        observer?.disconnect();
      };
    }, [syncLoop]);

    // Stop the loop for good on unmount, whatever the gates say.
    useEffect(
      () => () => {
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      },
      [],
    );

    // Pointer: one passive window listener, and only while it can matter.
    const pointerMatters = target === 'pointer' || POINTER_STATES.has(state);
    useEffect(() => {
      if (!pointerMatters || typeof window === 'undefined') return;
      let rect: DOMRect | null = null;
      let rectAt = 0;
      const onMove = (e: PointerEvent) => {
        const svg = svgRef.current;
        const engine = engineRef.current;
        if (!svg || !engine) return;
        const now = performance.now();
        if (!rect || now - rectAt > 200) {
          rect = svg.getBoundingClientRect();
          rectAt = now;
        }
        const width = latest.current.size || rect.width || 1;
        const p = {
          dx: (e.clientX - (rect.left + rect.width / 2)) / width,
          dy: (e.clientY - (rect.top + rect.height / 2)) / width,
        };
        pointerRef.current = p;
        engine.setPointer(p);
      };
      const onLeave = () => {
        pointerRef.current = null;
        engineRef.current?.setPointer(null);
      };
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerleave', onLeave);
      window.addEventListener('blur', onLeave);
      return () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerleave', onLeave);
        window.removeEventListener('blur', onLeave);
        onLeave();
      };
    }, [pointerMatters]);

    useImperativeHandle(ref, (): ListenCreatureHandle => {
      /** Turn anything `lookAt` accepts into a normalized gaze direction. */
      const toDirection = (value: Vec2 | AttentionTarget, client: boolean | undefined): Vec2 => {
        if (value === null) return { x: 0, y: 0 };
        if (typeof value === 'string') {
          if (value === 'pointer') {
            const p = pointerRef.current;
            const radius =
              (latest.current.tuning?.noticeRadius ?? DEFAULT_TUNING.noticeRadius) || 1;
            if (p) return clampDisc({ x: p.dx / radius, y: p.dy / radius });
            return DEFAULT_TARGET_VECTORS.input;
          }
          const vectors = { ...DEFAULT_TARGET_VECTORS, ...latest.current.targetVectors };
          return vectors[value];
        }
        if (!client) return clampDisc(value);
        const svg = svgRef.current;
        if (!svg) return { x: 0, y: 0 };
        const rect = svg.getBoundingClientRect();
        const radius =
          (latest.current.tuning?.noticeRadius ?? DEFAULT_TUNING.noticeRadius) *
          (latest.current.size || rect.width || 1);
        if (radius <= 0) return { x: 0, y: 0 };
        return clampDisc({
          x: (value.x - (rect.left + rect.width / 2)) / radius,
          y: (value.y - (rect.top + rect.height / 2)) / radius,
        });
      };
      return {
        hop: () => engineRef.current?.hop(),
        twirl: () => engineRef.current?.twirl(),
        blink: () => engineRef.current?.blink(),
        squint: () => engineRef.current?.squint(),
        squash: () => engineRef.current?.squash(),
        wobble: () => engineRef.current?.wobble(),
        celebrate: () => engineRef.current?.celebrate(),
        lookAt: (value, opts) =>
          engineRef.current?.lookAt(toDirection(value, opts?.client), opts?.holdMs),
        express: (name, holdMs) => engineRef.current?.express(name, holdMs),
        playForm: (name) => {
          const engine = engineRef.current;
          if (!engine) return;
          // `off` runs no loop and reduced motion refuses the form outright.
          // Either way the caller is told immediately rather than left waiting.
          if (motionOffRef.current) {
            pendingFormRef.current = null;
            onFormSettledRef.current?.(name);
            return;
          }
          engine.startForm(name);
          if (engine.form !== name) {
            pendingFormRef.current = null;
            onFormSettledRef.current?.(name);
            return;
          }
          pendingFormRef.current = name;
        },
        cancelForm: () => {
          pendingFormRef.current = null;
          engineRef.current?.cancelForm();
        },
      };
    }, []);

    const labelled = typeof ariaLabel === 'string' && ariaLabel.length > 0;

    return (
      <svg
        ref={svgRef}
        viewBox={VIEW_BOX}
        width={size}
        height={size * ASPECT}
        overflow="visible"
        className={className}
        role={labelled ? 'img' : undefined}
        aria-label={labelled ? ariaLabel : undefined}
        aria-hidden={labelled ? undefined : true}
        style={{
          display: 'inline-block',
          transformOrigin: TRANSFORM_ORIGIN,
          willChange: 'transform',
          ...style,
        }}
      >
        <g ref={characterRef} data-part="character">
          <path data-part="body" d={BODY_PATH} fill={bodyColor} />
          <g ref={eyesRef} data-part="eyes">
            <g
              ref={leftRef}
              data-part="eye-left"
              transform={`translate(${geo.leftCenter.x} ${geo.leftCenter.y})`}
            >
              <path d={geo.left} fill={eyeColor} />
              {geometry.pupil > 0 && (
                <g ref={leftPupilRef} data-part="pupil-travel" transform="translate(0 0)">
                  <circle data-part="pupil" r={geometry.pupil} fill={bodyColor} />
                </g>
              )}
            </g>
            <g
              ref={rightRef}
              data-part="eye-right"
              transform={`translate(${geo.rightCenter.x} ${geo.rightCenter.y})`}
            >
              <path d={geo.right} fill={eyeColor} />
              {geometry.pupil > 0 && (
                <g ref={rightPupilRef} data-part="pupil-travel" transform="translate(0 0)">
                  <circle data-part="pupil" r={geometry.pupil} fill={bodyColor} />
                </g>
              )}
            </g>
          </g>
        </g>
        {/*
          The form channel's signifiers. Both rows exist from the first paint
          and are parked at opacity 0 — a form only ever writes attributes on
          nodes that are already there, so no form costs a DOM mutation. Each
          circle is authored at r=1 and sized by the scale in its transform.
        */}
        <g data-part="dots">
          {DOT_SLOTS.map((i) => (
            <circle
              key={i}
              ref={(node) => {
                dotRefs.current[i] = node;
              }}
              data-part="dot"
              r={1}
              fill={bodyColor}
              opacity={0}
            />
          ))}
        </g>
        <g data-part="particles">
          {PARTICLE_SLOTS.map((i) => (
            <circle
              key={i}
              ref={(node) => {
                particleRefs.current[i] = node;
              }}
              data-part="particle"
              r={1}
              fill={bodyColor}
              opacity={0}
            />
          ))}
        </g>
      </svg>
    );
  },
);
