"use client"

import { useContext } from "react"
import { Toaster as Sonner } from "sonner"

import { ThemeContext } from "@/components/listen/theme/ThemeContext"

type ToasterProps = React.ComponentProps<typeof Sonner>

/**
 * Project deviation from the stock shadcn Sonner: this app does not use
 * `next-themes`, it has its own `ThemeProvider` (see
 * `components/listen/theme`). We read that context directly (without
 * throwing when absent) and map the active palette to sonner's
 * light/dark mode — the parchment `zen` theme renders light, every
 * other theme renders dark. Mounted inside `.listen-root`, the toaster
 * inherits the theme-scoped tokens via the `bg-popover` / `border` /
 * `text-popover-foreground` classes below.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const ctx = useContext(ThemeContext)
  const mode: ToasterProps["theme"] = ctx?.theme.id === "zen" ? "light" : "dark"

  return (
    <Sonner
      theme={mode}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            /*
             * PAPER, like every other portalled surface. A toast renders at
             * the document root, so it reads `--popover` from `.listen-root`
             * — the black terminal's value — no matter which converted page
             * raised it.
             */
            "group toast group-[.toaster]:bg-[var(--ui-paper)] group-[.toaster]:text-[var(--ui-ink)] group-[.toaster]:border-[var(--ui-line)] group-[.toaster]:shadow-[var(--ui-shadow)]",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
