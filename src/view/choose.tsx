import { useState } from 'react'

import type { Summary } from '@/store/ask.ts'
import { Button } from '@/components/ui/button.tsx'

/**
 * The first screen: pick a checklist that exists, or make one.
 *
 * ## Why there is no default and no guess
 *
 * The user asked for this in one sentence:
 *
 * > "when user looks at the checklist for the first time in a kehikko they are
 * > supposed to pick an existing checklist or create their own checklist"
 *
 * The alternative — open on the first list alphabetically, or the most recently
 * used anywhere — is worse than it looks. A checklist held against work is a
 * claim about what that work owes, and a pane that opened on somebody else's
 * list would have a person ticking items off against a standard they never
 * chose. There is no correct guess here, so there is no guess: the pane says
 * what it has and waits.
 *
 * ## Nothing is in a Badge
 *
 * shadcn's `Badge` carries `whitespace-nowrap` in its base, which is right for
 * the two or three words it is used for and would be catastrophic here. A
 * checklist name is up to 120 characters of whatever somebody typed, and a long
 * string in a nowrap box sets a min-content floor far wider than the pane — a
 * sibling module shipped exactly that, with a 407-character string and an
 * 1187-pixel floor under a 220-pixel pane, and the pane scrolled sideways for
 * the rest of the day. So every name here is wrapped prose in a `min-w-0`
 * column, and the counts beside them are the only fixed-width things on a row.
 */
export function Choose({
  lists,
  onPick,
  onCreate,
  trouble,
  busy,
  said,
}: {
  lists: Summary[]
  onPick: (id: string) => void
  onCreate: (name: string) => void
  /** What went wrong the last time anything was pressed, if anything. */
  trouble: string | null
  busy: boolean
  /** The sentence at the top, which differs by why we are on this screen. */
  said: string
}) {
  const [typing, setTyping] = useState('')

  const create = () => {
    const name = typing.trim()
    if (!name) return
    /* Cleared before the answer, and this is the one optimistic thing on the
       screen. It is safe: a refused create leaves the sentence in the refusal
       under the box, so nothing typed can be lost by clearing it, and a box that
       stayed full after a successful create is the fastest way to make the same
       list twice. */
    setTyping('')
    onCreate(name)
  }

  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <h2 className="px-2 py-1.5 text-[0.8rem] font-semibold">Pick a checklist</h2>
      <p className="border-t bg-muted/40 px-2 py-1.5 text-[0.65rem] leading-4 text-muted-foreground">{said}</p>

      {lists.length ? (
        <ul className="border-t">
          {lists.map((list) => (
            <li key={list.id} className="border-t first:border-t-0">
              <button
                type="button"
                disabled={busy}
                data-checklist={list.id}
                onClick={() => onPick(list.id)}
                className="flex w-full items-start gap-1.5 px-2 py-1.5 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                {/* `min-w-0` and `break-words` together are what keep a long name,
                    or an unbroken URL somebody pasted into one, inside a 220px
                    pane. Never a Badge and never `truncate`: the name IS how
                    somebody tells one list from another. */}
                <span className="min-w-0 flex-1 break-words text-[0.8rem] leading-5">{list.name}</span>
                <span className="shrink-0 text-[0.7rem] tabular-nums text-muted-foreground">
                  {list.items} item{list.items === 1 ? '' : 's'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t px-2 py-1.5 text-[0.7rem] leading-4 text-muted-foreground">
          There are no checklists here yet, and that is not a gap this app can fill for you. Nothing ships a list —
          what a piece of work owes is a judgement, and the first one starts below.
        </p>
      )}

      <div className="flex flex-col gap-1 border-t p-2">
        <label className="text-[0.65rem] leading-4 text-muted-foreground" htmlFor="new-checklist">
          Or start one
        </label>
        <textarea
          id="new-checklist"
          rows={2}
          value={typing}
          onChange={(e) => setTyping(e.target.value)}
          onKeyDown={(e) => {
            /* Enter files it and shift-enter is a newline, which is the pair
               every message box on this machine already uses. A textarea rather
               than an input because a name that says what a list is FOR is often
               a phrase, and a single-line box that scrolls sideways hides the
               middle of it. */
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              create()
            }
          }}
          placeholder="What is this list for?"
          className="w-full resize-y rounded border bg-background px-1.5 py-1 text-[0.75rem] leading-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex items-center gap-1.5">
          <Button type="button" size="pane" disabled={busy || !typing.trim()} onClick={create}>
            Create
          </Button>
          <span className="min-w-0 flex-1 text-[0.65rem] leading-4 text-muted-foreground">
            Say what it is for — “what a merge request owes before review” — not what it is.
          </span>
        </div>
        {trouble ? <p className="text-[0.7rem] leading-4 text-failed">{trouble}</p> : null}
      </div>
    </section>
  )
}

/**
 * The screen for a pane that cannot tell which kehikko it is on.
 *
 * `context.kehikko` is nullable and null is a REAL state: a host need not have
 * canvases at all, and a module's page is loaded once and shown on whichever one
 * asks for it, so it genuinely cannot work out where it is standing. This app
 * keys its remembered choice by exactly that, so with no kehikko there is
 * nothing to key by.
 *
 * The wrong answers, both of which were considered: remember the choice under
 * some placeholder id, which would make every unplaced canvas share one memory
 * and quietly hand a reader somebody else's list; or refuse to work at all,
 * which would make a perfectly usable checklist unreachable because of a field
 * the host declined to fill in.
 *
 * So the honest answer is the third: say which state this is, in words, and then
 * work anyway for as long as the page is open. The choice holds for the session
 * and is not written down, and the screen says that rather than letting somebody
 * discover it on the next reload.
 */
export function Unplaced({ children }: { children: React.ReactNode }) {
  return (
    <>
      <p
        data-unplaced="yes"
        className="rounded border border-pending/40 bg-pending/5 px-2 py-1.5 text-[0.7rem] leading-4 text-muted-foreground"
      >
        This pane cannot tell which kehikko it is on — the host did not say, which is allowed and happens when a host
        has no canvases. A checklist is remembered per kehikko, so there is nothing here to remember one against:
        pick a list and it holds until this page is reloaded, then you will be asked again.
      </p>
      {children}
    </>
  )
}
