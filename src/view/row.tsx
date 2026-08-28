import { useState } from 'react'

import type { StandingRow } from '../../derive/standing.ts'

import { Badge } from '@/components/ui/badge.tsx'
import { cn } from '@/lib/utils.ts'
import { StateMark, stateWord } from './state-mark.tsx'

/**
 * One item, and everything that is true about it, reachable.
 *
 * ## Nothing is truncated without a way to see the whole
 *
 * A pane 220 pixels wide cannot show a label, a badge, a verdict, who said so
 * and a two-hundred-word reason at once, and the wrong answer to that is an
 * ellipsis. Every `why` on this list was argued over on a real merge request;
 * they are the material, and the reason an agent reads the list a second time
 * instead of skimming it. So the row shows the label whole — wrapped, never
 * clipped — and the reasoning is one press away in a `<details>`, which is open
 * text in the DOM rather than a tooltip that a touch device cannot summon and a
 * screen reader cannot reach.
 *
 * `<details>` rather than a Radix collapsible on purpose. It needs no JavaScript
 * to open, so it works during the first paint and inside a printed page; it is
 * keyboard-operable without anybody wiring that up; and its open state survives
 * a re-render caused by a tick landing, which a component holding its own state
 * would lose exactly when somebody was reading it.
 *
 * ## The one row that is a control
 *
 * `kind: 'human'` is the owner's item, and it is the only row on either list
 * that is a CONTROL — every other one reports something that happened somewhere
 * else. It is a button wrapping the mark and the label together, because a
 * checkbox-sized target on a row this narrow is a miss waiting to happen. It is
 * not disabled and not hidden: this app can prove a person at this machine
 * pressed it, because the press goes to this app's own server, on this app's own
 * origin, carrying a ticket this process handed out with the page. That is the
 * whole of the gate — an item asking whether a person has agreed to something,
 * which the party doing the asking can tick, is a formality with a box beside
 * it.
 *
 * An exempt or orphaned row is NOT a control even when its kind says human: an
 * exempt item does not apply here, and an orphan is a tick against something no
 * longer on the list. Both are things to read, not things to press.
 *
 * ## Withdrawing takes two presses, and it used to take a `confirm()`
 *
 * The asymmetry is deliberate and is inherited: agreeing is a considered press
 * somebody has just made, while taking it back invalidates work that may already
 * have been split on the strength of it. So ticking is one press and untucking
 * is two.
 *
 * What changed is HOW the second one is asked for, and it changed because the
 * old way was measured and found dead. The program this came from called
 * `window.confirm`, which was correct on its own page and is ignored inside a
 * host's frame:
 *
 *     [console] Ignored call to 'confirm()'. The document is sandboxed, and the
 *               'allow-modals' keyword is not set.
 *     confirm() inside the checklist frame returns: false
 *
 * The host frames this module with `allow-scripts allow-forms allow-popups
 * allow-same-origin` and no `allow-modals` — which is a reasonable sandbox and
 * not something this module should be asking to widen for one dialog. The
 * consequence was the worst shape a failure can have: `confirm` returns `false`,
 * the handler returns early, the button does nothing at all, and there is
 * nothing on screen saying why. A person would press it, watch it not move, and
 * conclude the tick could not be withdrawn.
 *
 * So the second press is asked for IN the row: the first press on a done item
 * arms it and the row says what the next press will do, and the second press
 * withdraws. It needs no permission from anybody's sandbox, it is visible rather
 * than modal, it can be abandoned by simply not pressing again, and it says the
 * same sentence the dialog used to.
 */
export function Row({
  row,
  onTick,
  trouble,
}: {
  row: StandingRow
  /** Absent on a row nobody may press — the bare list, or a reference not yet named. */
  onTick?: (row: StandingRow) => void
  /** What went wrong the last time this row was pressed, if anything. */
  trouble?: string | null
}) {
  /**
   * Whether a withdrawal has been armed by a first press.
   *
   * Reset whenever the row's own state changes, so an armed row that somebody
   * else's tick has already moved does not stay armed over a different answer.
   */
  const [arming, setArming] = useState(false)
  /**
   * A write is in flight, so a second press cannot file a second one.
   *
   * Cleared by the row's own state changing rather than by a timer or a
   * microtask: the parent repaints from the standing the server sent back, so the
   * arrival of a different `row.state` IS the write having landed. A timer would
   * be a guess at how long that takes, and a microtask would clear the guard
   * before the write had even been sent.
   */
  const [sent, setSent] = useState<string | null>(null)
  /* A refusal ends the flight too, and this clause is why the guard cannot wedge
     the button shut: a refused write leaves `row.state` exactly where it was, so
     without it the one press somebody most needs to repeat — the one that just
     failed — would be the one they could not make. */
  const pressing = sent !== null && sent === row.state && !trouble
  const pressable = Boolean(onTick) && row.kind === 'human' && !row.exempt && !row.orphan
  const armed = arming && row.state === 'done'

  /**
   * The sentence under the row, and the order is a ranking of what a reader
   * needs.
   *
   * An exemption first, because it says the row does not apply here at all and
   * everything else about it is then beside the point. Then a derived item's
   * remedy — `[!]` beside "Says which issue it is for" reports that something is
   * wrong and not which thing, and the two ways to fail it have opposite
   * remedies. Then why a tick has gone stale. Then an orphan's explanation, then
   * the note whoever ticked it left. Only if none of those exist does the row
   * fall back to the item's own reasoning, which is always available under the
   * disclosure anyway.
   */
  const said =
    row.exempt ??
    row.detail ??
    (row.state === 'stale' ? row.note : null) ??
    (row.orphan ? row.why : null) ??
    (row.note ? `${row.by}: ${row.note}` : null)

  const who = row.kind === 'derived' ? 'read' : row.kind === 'human' ? 'the owner' : 'an agent'

  const body = (
    <>
      <StateMark state={row.state} />
      <span className="min-w-0 flex-1 text-left text-[0.8rem] leading-5">
        {row.label}
        {row.orphan ? <span className="text-muted-foreground"> (no longer on the list)</span> : null}
      </span>
      <Badge variant="outline" className="mt-px">
        {who}
      </Badge>
    </>
  )

  return (
    <li
      data-item={row.id}
      data-state={row.state}
      data-kind={row.kind}
      className={cn(
        'border-t px-2 py-1.5 first:border-t-0',
        row.exempt && 'opacity-70',
        pressable && 'hover:bg-accent/60',
      )}
    >
      {pressable ? (
        <button
          type="button"
          disabled={pressing}
          aria-pressed={row.state === 'done'}
          title={
            row.state === 'done'
              ? armed
                ? 'Press again to withdraw your agreement.'
                : 'You agreed. Press to start withdrawing it.'
              : 'Only you can tick this. Press it once you have seen the finished work and it solves the issue.'
          }
          onClick={() => {
            if (row.state === 'done' && !armed) {
              setArming(true)
              return
            }
            setArming(false)
            setSent(row.state)
            onTick?.(row)
          }}
          onBlur={() => setArming(false)}
          className="flex w-full items-start gap-1.5 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          {body}
        </button>
      ) : (
        <div className="flex items-start gap-1.5">{body}</div>
      )}

      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 pl-[1.375rem] text-[0.7rem] text-muted-foreground">
        <span>{stateWord(row.state)}</span>
        {row.at ? <span>· {row.by}</span> : null}
        {row.read ? <span>· off {row.read}</span> : null}
      </div>

      {armed ? (
        <p className="mt-1 pl-[1.375rem] text-[0.7rem] leading-4 text-pending">
          Press it again to withdraw your agreement that this is solved. Anything already split out of it stays open —
          this only takes back the tick, and the agent is told to ask again.
        </p>
      ) : null}

      {said ? <p className="mt-1 pl-[1.375rem] text-[0.7rem] leading-4 text-muted-foreground">{said}</p> : null}

      {trouble ? (
        <p className="mt-1 pl-[1.375rem] text-[0.7rem] leading-4 text-failed">{trouble}</p>
      ) : null}

      {/* The reasoning, always reachable and never the thing that makes the row
          tall. An orphan's `why` is already printed above as its explanation, so
          repeating it under a disclosure would be the same sentence twice. */}
      {row.orphan ? null : (
        <details className="group mt-0.5 pl-[1.375rem]">
          <summary className="cursor-pointer list-none text-[0.7rem] text-muted-foreground underline decoration-dotted underline-offset-2 marker:content-none">
            <span className="group-open:hidden">why this is on the list</span>
            <span className="hidden group-open:inline">less</span>
          </summary>
          <p className="mt-1 text-[0.7rem] leading-4 text-muted-foreground">{row.why}</p>
        </details>
      )}
    </li>
  )
}
