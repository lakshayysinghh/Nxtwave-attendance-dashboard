"use client";

import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { cn } from "cn";

/*
 * Shared overlays: one backdrop, one sheet (side drawer, or a bottom sheet on
 * phones) and one centred dialog. Built on Base UI Dialog, which gives focus
 * trapping, Escape, backdrop click and the starting / ending styles the
 * transitions below use. Glass and blur are for overlays only.
 */

/** Dim + soft blur behind any overlay. */
export const backdropTone = "bg-slate-950/25 backdrop-blur-[1.5px] dark:bg-black/45";

const backdropCls = cn(
  "fixed inset-0 z-50 transition-opacity duration-300 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
  backdropTone,
);

/** Overlay surface: nearly opaque card colour with a light frosted edge. */
const surfaceCls = "bg-card/95 text-card-foreground shadow-2xl ring-1 ring-foreground/10 outline-none supports-[backdrop-filter]:bg-card/90 supports-[backdrop-filter]:backdrop-blur-xl";

const ease = "ease-[cubic-bezier(0.32,0.72,0,1)]";

function CloseButton({ label }: { label: string }) {
  return (
    <Dialog.Close
      aria-label={label}
      className="-mr-1 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
    >
      <X className="size-5" />
    </Dialog.Close>
  );
}

type SheetContentProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Accessible name of the ✕ button. */
  closeLabel?: string;
  /** Which edge it slides from on wider screens. */
  side?: "right" | "left";
  /** On phones: a bottom sheet (default) or the same side drawer, full width. */
  mobile?: "bottom" | "side";
  /** Tailwind max-width on wider screens. */
  width?: string;
  /** Extra content under the title (search, filters); stays put while the body scrolls. */
  toolbar?: React.ReactNode;
  /** Pinned under the scrolling body (e.g. a link to the full page). */
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

/** The sheet itself; put it inside a Dialog.Root (or use Sheet). */
export function SheetContent({ title, description, closeLabel = "Close", side = "right", mobile = "bottom", width = "sm:max-w-md", toolbar, footer, children, className }: SheetContentProps) {
  const sideCls =
    side === "right"
      ? "sm:inset-y-0 sm:right-0 sm:left-auto sm:rounded-l-2xl sm:data-[ending-style]:translate-x-full sm:data-[starting-style]:translate-x-full"
      : "sm:inset-y-0 sm:left-0 sm:right-auto sm:rounded-r-2xl sm:data-[ending-style]:-translate-x-full sm:data-[starting-style]:-translate-x-full";
  const phoneCls =
    mobile === "bottom"
      ? "inset-x-0 bottom-0 max-h-[88dvh] rounded-t-2xl data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full sm:max-h-none sm:data-[ending-style]:translate-y-0 sm:data-[starting-style]:translate-y-0"
      : cn(
          "inset-y-0 w-full",
          side === "right" ? "right-0 data-[ending-style]:translate-x-full data-[starting-style]:translate-x-full" : "left-0 data-[ending-style]:-translate-x-full data-[starting-style]:-translate-x-full",
        );
  return (
    <Dialog.Portal>
      <Dialog.Backdrop className={backdropCls} />
      <Dialog.Popup className={cn("fixed z-50 flex flex-col transition-transform duration-300 motion-reduce:transition-none sm:w-full", ease, surfaceCls, phoneCls, sideCls, width, className)}>
        {mobile === "bottom" && <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-foreground/15 sm:hidden" />}
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0">
            <Dialog.Title className="text-base font-semibold text-foreground">{title}</Dialog.Title>
            {description && <Dialog.Description className="mt-0.5 text-xs text-muted-foreground">{description}</Dialog.Description>}
          </div>
          <CloseButton label={closeLabel} />
        </div>
        {toolbar && <div className="border-b border-border/70 px-5 pb-3">{toolbar}</div>}
        {!toolbar && <div className="border-b border-border/70" />}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {footer && <div className="border-t border-border/70 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </Dialog.Popup>
    </Dialog.Portal>
  );
}

/** A controlled sheet: side drawer on wider screens, bottom sheet on phones. */
export function Sheet({ open, onOpenChange, ...props }: SheetContentProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <SheetContent {...props} />
    </Dialog.Root>
  );
}

/** A centred dialog; Escape, the backdrop or ✕ closes it. */
export function CenteredDialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropCls} />
        <Dialog.Popup
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex max-h-[90dvh] w-[min(46rem,calc(100vw-1rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl transition-[opacity,scale] duration-200 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none",
            ease,
            surfaceCls,
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-border/70 px-5 py-3.5">
            <Dialog.Title className="text-base font-semibold text-foreground">{title}</Dialog.Title>
            <CloseButton label="Close" />
          </div>
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4 text-sm">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Hover / press feel for a card that opens something. Pair with a <button>. */
export const interactiveCard =
  "cursor-pointer text-left transition-[box-shadow,transform,--tw-ring-color] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md hover:ring-primary/35 active:translate-y-0 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:outline-none motion-reduce:transform-none";
