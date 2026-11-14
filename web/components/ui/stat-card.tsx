import { ChevronRight } from "lucide-react";
import { cn } from "cn";

import { interactiveCard } from "@/components/ui/overlay";

/**
 * A number with a label. With onClick it becomes a button that lifts on hover
 * and opens the records behind the number.
 */
export function StatCard({
  label,
  value,
  note,
  hero,
  accent,
  compact,
  dot,
  pressed,
  onClick,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  note?: React.ReactNode;
  /** The headline figure: tinted surface, larger number. */
  hero?: boolean;
  /** Number in the primary colour. */
  accent?: boolean;
  /** Smaller padding and number, for a row of five. */
  compact?: boolean;
  /** A small colour dot before the label (e.g. a band). */
  dot?: string;
  /** Shown as selected (for cards that filter). */
  pressed?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {dot && <span className={cn("size-2 rounded-full", dot)} />}
        {label}
        {onClick && <ChevronRight aria-hidden className="ml-auto size-3.5 opacity-0 transition-opacity group-hover/stat:opacity-60 group-focus-visible/stat:opacity-60" />}
      </span>
      <span className={cn("font-semibold tracking-tight tabular-nums", hero ? "text-4xl text-primary" : compact ? "text-2xl" : "text-3xl", accent && "text-primary")}>{value}</span>
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </>
  );
  const cls = cn(
    "group/stat flex flex-col gap-1 rounded-xl shadow-xs ring-1",
    compact ? "p-3" : "p-4",
    hero ? "bg-primary/5 ring-primary/25" : "bg-card ring-foreground/10",
    pressed && "ring-2 ring-primary",
    className,
  );
  return onClick ? (
    <button type="button" onClick={onClick} aria-pressed={pressed} className={cn(cls, interactiveCard)}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}
