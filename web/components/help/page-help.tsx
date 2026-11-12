"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Tooltip } from "@base-ui/react/tooltip";
import { Info, X } from "lucide-react";
import { Fragment, useState } from "react";

import { guides, visibleSections, type Guide, type GuideId, type Line, type Role, type Row, type Section } from "@/components/help/guides";

/** Renders **bold** and `code` inside a help string. */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <b key={i} className="font-semibold text-foreground">
            {p.slice(2, -2)}
          </b>
        ) : p.startsWith("`") && p.endsWith("`") ? (
          <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
            {p.slice(1, -1)}
          </code>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

const lineText = (l: Line) => (typeof l === "string" ? l : l.text);
const rowCells = (r: Row) => (Array.isArray(r) ? r : r.cells);

function SectionView({ s, role }: { s: Section; role: Role }) {
  const keep = <T extends Line | Row>(xs: T[] | undefined) =>
    (xs ?? []).filter((x) => typeof x === "string" || Array.isArray(x) || !x.roles || x.roles.includes(role));
  const List = s.steps ? "ol" : "ul";
  const items = keep(s.steps ?? s.points);
  const rows = keep(s.table?.rows);
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-sm font-semibold text-primary">{s.title}</h3>
      {s.text && (
        <p>
          <Rich text={s.text} />
        </p>
      )}
      {items.length > 0 && (
        <List className={`flex flex-col gap-1 pl-5 ${s.steps ? "list-decimal" : "list-disc"}`}>
          {items.map((l, i) => (
            <li key={i}>
              <Rich text={lineText(l)} />
            </li>
          ))}
        </List>
      )}
      {s.table && rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr>
                <th className="px-2.5 py-1.5 font-medium">{s.table.head[0]}</th>
                <th className="px-2.5 py-1.5 font-medium">{s.table.head[1]}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const [a, b] = rowCells(r);
                return (
                  <tr key={i} className="border-t border-border align-top">
                    <td className="w-2/5 px-2.5 py-1.5">
                      <Rich text={a} />
                    </td>
                    <td className="px-2.5 py-1.5">
                      <Rich text={b} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** A guide's sections for one role. */
export function GuideBody({ guide, role }: { guide: Guide; role: Role }) {
  return (
    <div className="flex flex-col gap-4 text-sm text-slate-700">
      {visibleSections(guide, role).map((s) => (
        <SectionView key={s.title} s={s} role={role} />
      ))}
    </div>
  );
}

/**
 * The ⓘ button beside a page title. It opens that page's guide in a side
 * panel (full width on a phone); Escape, the backdrop or ✕ closes it.
 */
export function PageHelp({ id, role }: { id: GuideId; role: Role }) {
  const [open, setOpen] = useState(false);
  const guide = guides[id];
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Tooltip.Root>
        <Tooltip.Trigger
          delay={150}
          render={
            <Dialog.Trigger
              aria-label={`About this page: ${guide.title}`}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
            />
          }
        >
          <Info className="size-[18px]" />
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner side="bottom" sideOffset={6} className="z-50">
            <Tooltip.Popup className="rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow">About this page</Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-slate-900/30" />
        <Dialog.Popup className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-xl outline-none">
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <Dialog.Title className="text-base font-semibold text-primary">{guide.title}</Dialog.Title>
              <Dialog.Description className="text-xs text-muted-foreground">How to use this page</Dialog.Description>
            </div>
            <Dialog.Close aria-label="Close guide" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <GuideBody guide={guide} role={role} />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
