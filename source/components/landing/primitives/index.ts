/* tailwind-merge trap — read before overriding a primitive's type.
   Every size variant here ships `text-*` AND `leading-*` together. A
   className that overrides only `text-[36px]` wins the font-size group
   and leaves the variant's `leading-*` in place, so the line-height no
   longer matches the size. Whenever you override `text-*` on Headline,
   Eyebrow or Pill, restate `leading-*` (and any `tracking-*`) with it. */

export { Container, Section } from './Section';
export type { ContainerProps, SectionProps } from './Section';
export { Eyebrow } from './Eyebrow';
export type { EyebrowProps } from './Eyebrow';
export { Headline } from './Headline';
export type { HeadlineProps } from './Headline';
export { Pill } from './Pill';
export type { PillProps } from './Pill';
export { SignInPill, SignUpPill } from './AuthPill';
export type { AuthPillProps } from './AuthPill';
export { Video } from './Video';
export type { VideoProps, VideoSource } from './Video';
export { MeshGround } from './MeshGround';
export type { MeshGroundProps } from './MeshGround';
export { SocialMenu, DISCORD_URL, TWITTER_URL } from './SocialMenu';
export type { SocialMenuProps } from './SocialMenu';
export { SmokeGround } from './SmokeGround';
export type { SmokeGroundProps } from './SmokeGround';
export { useNearViewport } from './useNearViewport';
export { usePrefersReducedMotion } from './usePrefersReducedMotion';
