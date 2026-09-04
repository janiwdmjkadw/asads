import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Visual variant.
   *   `nav`        — UPPERCASE pill used by TopNav and the DEV filter.
   *   `range`      — compact mono pill used by chart range selectors.
   *   `accent`     — accent-tinted CTA pill (e.g. Instant Trade).
   */
  variant?: 'nav' | 'range' | 'accent';
  active?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  children: ReactNode;
}

/**
 * Generic pill button. Replaces the four near-duplicate inline pill
 * implementations (TopNav tabs, range pills, DEV filter, Instant Trade).
 * Style comes from the `.tab-pill` class for `nav` and inline rules for
 * `range`/`accent` since those have distinct sizing.
 */
export function Pill({
  variant = 'nav',
  active,
  leadingIcon,
  trailingIcon,
  children,
  type = 'button',
  className,
  style,
  ...rest
}: Props) {
  if (variant === 'nav') {
    const cls = `tab-pill${active ? ' active' : ''}${className ? ` ${className}` : ''}`;
    return (
      <button type={type} className={cls} style={style} {...rest}>
        {leadingIcon}
        {children}
        {trailingIcon}
      </button>
    );
  }

  if (variant === 'range') {
    return (
      <button
        type={type}
        className={className}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 22,
          minWidth: 28,
          padding: '0 8px',
          borderRadius: 5,
          fontFamily: 'var(--mono)',
          fontSize: 11,
          fontVariantNumeric: 'tabular-nums',
          color: active ? 'var(--ink-0)' : 'var(--ink-3)',
          background: active ? 'rgba(255,255,255,0.05)' : 'transparent',
          border: `1px solid ${active ? 'var(--hairline-2)' : 'transparent'}`,
          cursor: 'pointer',
          ...style,
        }}
        {...rest}
      >
        {leadingIcon}
        {children}
        {trailingIcon}
      </button>
    );
  }

  // accent
  return (
    <button
      type={type}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 22,
        padding: '0 10px',
        borderRadius: 5,
        fontFamily: 'var(--sans)',
        fontSize: 11,
        color: 'var(--accent-primary)',
        background: 'color-mix(in srgb, var(--accent-primary) 8%, transparent)',
        border: '1px solid color-mix(in srgb, var(--accent-primary) 25%, transparent)',
        cursor: 'pointer',
        ...style,
      }}
      {...rest}
    >
      {leadingIcon}
      {children}
      {trailingIcon}
    </button>
  );
}
