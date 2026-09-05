'use client';

import * as React from 'react';
import { EmojiPicker as EmojiPickerPrimitive } from 'frimousse';

import { cn } from '@/lib/utils';

/**
 * Themed frimousse emoji picker, composed shadcn-style. Renders the full
 * emoji set (emojibase data) with search, category headers, keyboard
 * navigation, and a skin-tone selector. Drop inside a `PopoverContent`
 * with `p-0` for a popout selector.
 *
 * Emoji data is self-hosted from `public/emojibase/` (frimousse's default
 * is the jsdelivr CDN, which our CSP `connect-src` blocks — the picker
 * would hang on "Loading…" forever).
 *
 * ── THE VOICE ────────────────────────────────────────────────────────
 *
 * This shipped in the surface the product has since left: a search field
 * on a lifted `--input-bg` wash that lit the ACCENT on focus, category
 * names in 10px tracked capitals, and a hovered emoji sitting on an 18%
 * accent plate. Three separate places speaking in the old purple.
 *
 * Now: the same recessed near-black well every other field on the page
 * wears, category names as sentence case words, and a hovered emoji on a
 * plain white plate at 10%. Nothing here is tinted and nothing moves.
 */
function EmojiPicker({
  className,
  ...props
}: React.ComponentProps<typeof EmojiPickerPrimitive.Root>) {
  return (
    <EmojiPickerPrimitive.Root
      emojibaseUrl="/emojibase"
      locale="en"
      className={cn('isolate flex h-80 w-full flex-col', className)}
      style={{ fontFamily: 'var(--sans)' }}
      {...props}
    />
  );
}

function EmojiPickerSearch({
  className,
  ...props
}: React.ComponentProps<typeof EmojiPickerPrimitive.Search>) {
  return (
    <div className="p-2 pb-0">
      <EmojiPickerPrimitive.Search
        autoFocus
        className={cn(
          'h-9 w-full appearance-none rounded-lg border border-[rgba(11,14,20,0.12)] bg-white px-3 text-[12.5px] text-[rgba(11,14,20,0.92)] outline-none placeholder:text-[#8a9591]',
          className,
        )}
        placeholder="Search emoji…"
        {...props}
      />
    </div>
  );
}

function EmojiPickerContent({
  className,
  ...props
}: React.ComponentProps<typeof EmojiPickerPrimitive.Viewport>) {
  return (
    <EmojiPickerPrimitive.Viewport
      className={cn('relative flex-1 outline-none', className)}
      {...props}
    >
      <EmojiPickerPrimitive.Loading className="absolute inset-0 flex items-center justify-center text-[12px] text-[var(--ink-3)]">
        Loading…
      </EmojiPickerPrimitive.Loading>
      <EmojiPickerPrimitive.Empty className="absolute inset-0 flex items-center justify-center text-[12px] text-[var(--ink-3)]">
        No emoji found.
      </EmojiPickerPrimitive.Empty>
      <EmojiPickerPrimitive.List
        className="select-none pb-1.5"
        components={{
          CategoryHeader: ({ category, ...headerProps }) => (
            <div
              /* The sticky category heading rides over the emoji as they scroll
                 under it, so it needs the picker's OWN ground rather than
                 `bg-popover`, which is the app's dark token. */
              className="bg-white px-3 pb-1.5 pt-3 text-[11px] font-semibold text-[#8a9591]"
              {...headerProps}
            >
              {category.label}
            </div>
          ),
          Row: ({ children, ...rowProps }) => (
            <div className="scroll-my-1.5 px-1.5" {...rowProps}>
              {children}
            </div>
          ),
          Emoji: ({ emoji, ...emojiProps }) => (
            <button
              className="flex size-8 items-center justify-center rounded-md text-lg transition-colors data-[active]:bg-[rgba(11,14,20,0.07)]"
              {...emojiProps}
            >
              {emoji.emoji}
            </button>
          ),
        }}
      />
    </EmojiPickerPrimitive.Viewport>
  );
}

function EmojiPickerFooter({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex w-full min-w-0 items-center justify-between gap-2 border-t border-[var(--hairline)] p-2',
        className,
      )}
      {...props}
    >
      <EmojiPickerPrimitive.ActiveEmoji>
        {({ emoji }) =>
          emoji ? (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="flex size-7 flex-none items-center justify-center text-lg">
                {emoji.emoji}
              </div>
              <span className="truncate text-[11px] text-[var(--ink-2)]">
                {emoji.label}
              </span>
            </div>
          ) : (
            <span className="ml-1.5 flex h-7 items-center truncate text-[11px] text-[var(--ink-3)]">
              Select an emoji…
            </span>
          )
        }
      </EmojiPickerPrimitive.ActiveEmoji>
      <EmojiPickerPrimitive.SkinToneSelector className="flex size-7 flex-none items-center justify-center rounded-md text-lg transition-colors hover:bg-[rgba(11,14,20,0.06)]" />
    </div>
  );
}

export { EmojiPicker, EmojiPickerSearch, EmojiPickerContent, EmojiPickerFooter };
