import type { GemSmokeParams, MeshGradientParams } from '@paper-design/shaders-react';

/* Live shader grounds for the landing page. Every number here is read
   straight off the Paper design (file B-4, nodes 60L-1 / 7LU-1 / 9SM-0)
   — treat this file as the transcription and change it only against the
   design.

   `back` is NOT a shader uniform: MeshGradient paints an RGBA field with
   no backdrop of its own, so the ground colour lives on the wrapper. It
   doubles as the reduced-motion still. GemSmoke does take a `colorBack`
   uniform; its `back` is the opaque page colour showing through the
   transparent `#00000000` it renders. */
export interface ShaderGround<P> {
  readonly params: P;
  readonly back: string;
}

export const meshPresets = {
  /* B3 "terminal" band — teal over the page ground. */
  teal: {
    back: '#070709',
    params: {
      speed: 0.6,
      scale: 1.5,
      distortion: 0.6,
      swirl: 0.2,
      grainMixer: 0.1,
      grainOverlay: 0.1,
      colors: ['#5EEAD4A6', '#0B1220', '#10312C', '#134E4A'],
    },
  },
  /* B5 "rewards" band — mint on white. */
  mint: {
    back: '#FFFFFF',
    params: {
      speed: 0.2,
      scale: 1.5,
      distortion: 0.4,
      swirl: 0.1,
      grainMixer: 0.1,
      grainOverlay: 0.1,
      colors: ['#AEEDDC', '#D6F0FF', '#DFFCF3', '#FFFFFF'],
    },
  },
} as const satisfies Record<string, ShaderGround<MeshGradientParams>>;

export const smokePresets = {
  /* Footer — the logo mark smoked into the dark khaki footer ground
     (Paper "footer potential" `ETX-1`). `back` reads the same token the
     footer wrapper paints, so it carries the display-p3 ground too. */
  footerSmoke: {
    back: 'var(--lp-footer-ground)',
    params: {
      speed: 0.54,
      size: 1,
      outerDistortion: 1,
      innerDistortion: 0.8,
      outerGlow: 0.55,
      innerGlow: 1,
      offset: 0.47,
      scale: 0.78,
      angle: 0,
      shape: 'diamond',
      image: '/landing/svg/mark-gem.svg',
      colors: ['#2B889F', '#57DDEE'],
      colorInner: '#52CEC6',
      colorBack: '#00000000',
    },
  },
} as const satisfies Record<string, ShaderGround<GemSmokeParams>>;

export type MeshPresetName = keyof typeof meshPresets;
export type SmokePresetName = keyof typeof smokePresets;
