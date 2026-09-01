import { useMemo, useState } from 'react'

import type { Summary } from '@/store/ask.ts'
import { Button } from '@/components/ui/button.tsx'
import type { Room } from '@/view/room.ts'
import { cn } from '@/lib/utils.ts'

/**
 * The second half of an import: which list, out of the project somebody picked.
 *
 * ## The first half is not here, and cannot be
 *
 * Choosing the PROJECT happens on the host's screen, in a dialog this module
 * never sees. It has to: a checklist lives in the project it is about, so
 * reusing one is inherently cross-project, and this module is told exactly one
 * `projectPath` and may read what it was told. A picker of projects drawn here
 * would need a list of them, and a module that can ask what projects exist has
 * been handed the disk. See `pickProject` in `src/wire/use-roadmap.ts` and the
 * protocol's `projects:pick`.
 *
 * So by the time this screen exists, a person has already answered the only
 * question this module could not ask: here is one folder, and only this one.
 * What is left is an ordinary choice out of an ordinary list.
 *
 * ## It replaces the pick screen rather than sitting over it
 *
 * At 220 pixels an overlay and a screen are the same thing, and this one is not
 * a small task done beside something else — it is a different list of names, of
 * the same shape, and drawing it in the same place is what makes the swap read
 * as "now you are looking at that project's". `Sheet` is for a control that is
 * wanted for eight seconds; this is a screen.
 *
 * ## Filtering, which is what "a combobox could do the trick" actually asked for
 *
 * The user suggested a shadcn combobox. What a combobox is — type to narrow,
 * press to choose — is a box and a list, and that is what this is. The component
 * itself is `cmdk` inside a popover, which at this width would be a menu the
 * size of the screen inside a screen, and a dependency to draw a filtered list.
 * The box appears only when there is enough of a list to be worth narrowing,
 * because an input above three names is a control that costs a name.
 */
export function Importing({
  from,
  lists,
  onImport,
  onCancel,
  trouble,
  busy,
  reading,
  room,
}: {
  /** What the project a person picked is called, in the host's words. */
  from: string
  /** Every checklist in that project, as its own store answered. */
  lists: Summary[]
  onImport: (id: string) => void
  onCancel: () => void
  trouble: string | null
  busy: boolean
  /** True while that project's checklists are still being read. */
  reading: boolean
  room: Room
}) {
  const [typing, setTyping] = useState('')

  const shown = useMemo(() => {
    const wanted = typing.trim().toLowerCase()
    if (!wanted) return lists
    return lists.filter((list) => list.name.toLowerCase().includes(wanted))
  }, [lists, typing])

  return (
    <section
      /* `relative` and the pinned column, for the reasons given at length on the
         same element in `choose.tsx`: an `sr-only` label escapes a scroller that
         is not its containing block, and no card, because the host drew the
         container already. */
      className={cn('relative overflow-hidden', room.pinned && 'flex min-h-0 flex-1 flex-col')}
      data-importing={from}
    >
      <div className="flex shrink-0 items-baseline gap-1.5 px-2 py-1.5">
        {/* The project's name is the heading, because it is the one thing that
            makes this screen different from the one it replaced. Wrapped and
            never clipped: a folder name is how somebody knows they picked the
            right one. */}
        <h2 className="min-w-0 flex-1 break-words text-[0.8rem] font-semibold">Copy from {from}</h2>
        <Button type="button" variant="ghost" size="container" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {lists.length > 6 ? (
        <div className="shrink-0 border-t px-2 py-1.5">
          <input
            type="search"
            value={typing}
            onChange={(e) => setTyping(e.target.value)}
            placeholder="Filter"
            aria-label="Filter that project’s checklists"
            className="w-full rounded border bg-background px-1.5 py-1 text-[0.75rem] leading-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      ) : null}

      {reading ? (
        <p className="border-t px-2 py-1.5 text-[0.7rem] leading-4 text-muted-foreground">
          Reading that project’s checklists.
        </p>
      ) : lists.length === 0 ? (
        /* A real and ordinary answer: that project has this module's folder and
           nothing in it, or has never had a checklist at all. Said plainly,
           because the remedy is to pick a different project and the Cancel is
           right above. */
        <p className="border-t px-2 py-1.5 text-[0.7rem] leading-4 text-muted-foreground">
          No checklists in {from}.
        </p>
      ) : shown.length === 0 ? (
        <p className="border-t px-2 py-1.5 text-[0.7rem] leading-4 text-muted-foreground">
          Nothing there matches “{typing.trim()}”.
        </p>
      ) : (
        <ul
          className={cn(
            'border-t',
            room.pinned && 'min-h-0 flex-1 overflow-y-auto',
            room.snap && 'snap-y snap-proximity',
          )}
          data-scroller={room.pinned ? 'importable' : undefined}
        >
          {shown.map((list) => (
            <li key={list.id} className={cn('border-t first:border-t-0', room.snap && 'snap-start')}>
              <button
                type="button"
                disabled={busy}
                data-importable={list.id}
                onClick={() => onImport(list.id)}
                className="flex w-full items-start gap-1.5 px-2 py-1.5 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                {/* Never a Badge and never `truncate`, for the reason set out in
                    `choose.tsx`: the name IS how somebody tells one list from
                    another, and a nowrap box sets a min-content floor wider than
                    this container. */}
                <span className="min-w-0 flex-1 break-words text-[0.8rem] leading-5">{list.name}</span>
                <span className="shrink-0 text-[0.7rem] tabular-nums text-muted-foreground">
                  {list.items}
                  {room.prose ? ` item${list.items === 1 ? '' : 's'}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* The one thing about a copy that is not obvious from pressing a name,
          and the reason it is drawn rather than left to be discovered: somebody
          importing a list they have half finished elsewhere would otherwise
          reasonably expect the ticks to come with it. They do not, and the
          argument is in `list/checklists.ts` — a tick is a fact about the
          project it was made in. */}
      <p className="shrink-0 border-t px-2 py-1.5 text-[0.65rem] leading-4 text-muted-foreground">
        The items are copied. The ticks are not.
      </p>

      {trouble ? (
        <p className="shrink-0 border-t px-2 py-1.5 text-[0.7rem] leading-4 text-failed">{trouble}</p>
      ) : null}
    </section>
  )
}
