import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Accessible label. Mirrored to `aria-label` and `title`. */
  label: string;
  children: ReactNode;
}

/**
 * 28×28 ghost-square icon button. Wraps the `.icon-btn` CSS class so we
 * don't repeat the `aria-label`/`title` pair at every callsite, and so
 * the chart toolbar / top-nav can drop their inline `IconBtn`
 * helpers.
 */
export function IconButton({ label, children, className, type = 'button', ...rest }: Props) {
  const cls = className ? `icon-btn ${className}` : 'icon-btn';
  return (
    <button type={type} aria-label={label} title={label} className={cls} {...rest}>
      {children}
    </button>
  );
}
