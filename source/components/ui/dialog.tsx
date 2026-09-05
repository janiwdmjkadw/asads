'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * shadcn (new-york) Dialog primitives — vendored with one
 * intentional deviation: the underlying Radix Portal mounts inside
 * the nearest `.listen-root` element instead of `document.body`.
 *
 * The deviation matters because every theme token (`--background`,
 * `--foreground`, `--primary`, `--ring`, …) is declared on
 * `.listen-root`, and the active theme is set via `data-theme-id`
 * on the same element. Defaulting to `document.body` would render
 * the dialog OUTSIDE the theme cascade, locking it to whichever
 * fallback hex literals the Tailwind config declares (the default
 * dark-cyan look) and breaking the zen / hotpink / etc. variants.
 *
 * The `useListenRootContainer` hook degrades to `undefined` until
 * mount, which matches Radix's default (body portal) and avoids the
 * hydration mismatch that an explicit body ref would create.
 */

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogClose = DialogPrimitive.Close;

function useListenRootContainer(): HTMLElement | undefined {
  const [el, setEl] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.querySelector<HTMLElement>('.listen-root');
    setEl(root);
  }, []);
  return el ?? undefined;
}

type DialogPortalProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Portal>;

function DialogPortal({ container, ...props }: DialogPortalProps): React.ReactElement {
  const listenRoot = useListenRootContainer();
  return (
    <DialogPrimitive.Portal
      {...props}
      container={container ?? listenRoot}
    />
  );
}

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    style={{ background: 'var(--modal-backdrop, rgba(0,0,0,0.7))', backdropFilter: 'var(--modal-blur, blur(3px))' }}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  /**
   * Hide the built-in top-right close affordance. Used by forced
   * surfaces (e.g. the first-run onboarding modal) that own their
   * own advance/dismiss controls and must not be escapable via the
   * default `X`.
   */
  hideCloseButton?: boolean;
};

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, hideCloseButton = false, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        /*
         * PAPER, on the primitive. `bg-background` resolves through the
         * app's tokens, which are the black terminal's, and a dialog
         * PORTALS to the document root — so the palettes each converted
         * surface declares on itself never reach it. Every modal on a
         * white page came up dark: the chart's Settings and Indicators
         * are just the two that surfaced it.
         *
         * Same fix as the popover, the hover card, the tooltip and the
         * toasts: state it where every dialog in the app shares it.
         */
        'fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 border border-[rgba(11,14,20,0.1)] bg-white p-6 text-[#0b0e14] shadow-[0_24px_60px_rgba(11,14,20,0.2)] duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-lg',
        className,
      )}
      style={{ boxShadow: 'var(--shadow-modal, 0 24px 60px rgba(0,0,0,0.45))' }}
      {...props}
    >
      {children}
      {hideCloseButton ? null : (
        <DialogPrimitive.Close
          /* `focus-visible`, not `focus`. Clicking the close button gives it
             focus, so a plain `focus:ring` painted the themed ring — a blue
             halo — across the whole close animation, every time anyone shut
             a dialog with the mouse. `focus-visible` shows it for keyboard
             users, who need it, and never for a pointer, which does not.
             The ring is white here too: it is chrome on a monochrome
             surface, and the theme accent has no business marking focus. */
          className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-0 disabled:pointer-events-none"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)}
      {...props}
    />
  );
}
DialogHeader.displayName = 'DialogHeader';

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
      {...props}
    />
  );
}
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold leading-none tracking-tight', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
