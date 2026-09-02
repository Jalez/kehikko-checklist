import { useState } from 'react'

import type { Summary } from '@/store/ask.ts'
import { Button } from '@/components/ui/button.tsx'
import { Sheet } from '@/view/sheet.tsx'
import type { Room } from '@/view/room.ts'
import { cn } from '@/lib/utils.ts'

/**
 * Every checklist in the project, reached on purpose.
 *
 * ## What this screen is, and what it used to be
 *
 * > "I want to be able to separately access a list of checklists available in
 * > the project."
 *
 * This is that: the way to every list, whether or not any of them is held
 * against what the reader is looking at, behind one press on the reading page
 * (`All checklists`) and never in front of it. Press a name and its edit page
 * opens; start one; copy one from another project.
 *
 * It used to be `src/view/choose.tsx`, the FIRST screen — "pick a checklist"
 * — and it carried an essay refusing to guess which list to show, on the
 * grounds that a container that opened on somebody else's list would have a
 * person ticking items off against a standard they never chose. That argument
 * was right about guessing and wrong about what the alternative was. The
 * alternative to guessing is not asking; it is the person having already said.
 * Under assignment (`targets` in `list/checklists.ts`) every list carries the
 * places it is about, chosen deliberately on its edit page, so the reading page
 * opens on exactly the lists the reader assigned to where they are standing.
 * Nothing is guessed, nothing is picked per kehikko and remembered (`list/keep.ts`
 * is gone), and this screen is no longer where anybody starts — it is where
 * they go to see everything.
 *
 * ## What each row says
 *
 * The name, wrapped and never in a nowrap badge — shadcn's `Badge` sets a
 * min-content floor far wider than a 220-pixel container, and a sibling
 * module shipped exactly that. Beside it the item count, and where there is
 * room, how many targets the list is held against. A list held against
 * nothing is shown nowhere on the reading page, and this row is the one
 * place that says so.
 *
 * ## In a small container the box to type in becomes a press
 *
 * The create box measured 147 pixels at 220 wide. In a 300-pixel frame that
 * is half the screen given to something used once, in front of the list of
 * things the screen is for. It becomes one button and the whole frame when it
 * is wanted.
 */
export function AllView({
  lists,
  onOpen,
  onCreate,
  onImport,
  onBack,
  importing,
  trouble,
  busy,
  said,
  room,
}: {
  lists: Summary[]
  /** Open one list's edit page. */
  onOpen: (id: string) => void
  onCreate: (name: string) => void
  /**
   * Start an import: ask the host to ask the person which project.
   *
   * A press rather than a menu, because this page has nothing to put in a menu.
   * It cannot list the projects on this machine and must never be able to — see
   * `pickProject` in `src/wire/use-roadmap.ts`.
   */
  onImport: () => void
  /** Back to the reading page. */
  onBack: () => void
  /** True while the person is being asked, or while the other project is being read. */
  importing: boolean
  trouble: string | null
  busy: boolean
  /**
   * A line about something that has happened, or `null` — the ordinary case,
   * which draws nothing. The one thing said here today is that a list the
   * reader was editing is gone, removed here or on another machine.
   */
  said: string | null
  room: Room
}) {
  const [typing, setTyping] = useState('')
  const [sheet, setSheet] = useState(false)
  const overlaid = room.compose === 'overlay'

  const create = () => {
    const name = typing.trim()
    if (!name) return
    /* Cleared before the answer: a refused create leaves the sentence in the
       refusal under the box, so nothing typed can be lost by clearing it, and a
       box that stayed full after a successful create is the fastest way to make
       the same list twice. */
    setTyping('')
    setSheet(false)
    onCreate(name)
  }

  const starting = (
    <div className="flex flex-col gap-1">
      {overlaid ? null : (
        <label className="text-[0.65rem] leading-4 text-muted-foreground" htmlFor="new-checklist">
          Or start one
        </label>
      )}
      <textarea
        id="new-checklist"
        aria-label="Start a checklist"
        rows={overlaid ? 4 : 2}
        value={typing}
        onChange={(e) => setTyping(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            create()
          }
        }}
        placeholder="What is this list for?"
        className="w-full resize-y rounded border bg-background px-1.5 py-1 text-[0.75rem] leading-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="button" size="container" disabled={busy || !typing.trim()} onClick={create}>
          Create
        </Button>
        <span className="min-w-0 flex-1 text-[0.65rem] leading-4 text-muted-foreground">
          Say what it is for — “what a merge request owes before review” — not what it is.
        </span>
      </div>
      {trouble ? <p className="text-[0.7rem] leading-4 text-failed">{trouble}</p> : null}
    </div>
  )

  return (
    <section
      className={cn('relative overflow-hidden', room.pinned && 'flex min-h-0 flex-1 flex-col')}
      data-all={lists.length}
      data-room={room.pinned ? 'pinned' : 'flowing'}
    >
      <div className="flex shrink-0 items-baseline gap-1.5 px-2 py-1.5">
        <h2 className="min-w-0 flex-1 text-[0.8rem] font-semibold">All checklists</h2>
        {overlaid ? (
          <Button type="button" variant="outline" size="container" data-open-create onClick={() => setSheet(true)}>
            Start one
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="container" data-back onClick={onBack} title="Back to what is in front of you.">
          Back
        </Button>
      </div>

      {said ? (
        <p
          className={cn(
            'shrink-0 border-t bg-muted/40 px-2 py-1.5 text-[0.65rem] leading-4 text-muted-foreground',
            !room.prose && 'line-clamp-2',
          )}
          title={room.prose ? undefined : said}
        >
          {said}
        </p>
      ) : null}

      {lists.length ? (
        <ul
          className={cn(
            'border-t',
            room.pinned && 'min-h-0 flex-1 overflow-y-auto',
            room.snap && 'snap-y snap-proximity',
          )}
          data-scroller={room.pinned ? 'lists' : undefined}
        >
          {lists.map((list) => (
            <li key={list.id} className={cn('border-t first:border-t-0', room.snap && 'snap-start')}>
              <button
                type="button"
                disabled={busy}
                data-checklist={list.id}
                onClick={() => onOpen(list.id)}
                className="flex w-full items-start gap-1.5 px-2 py-1.5 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                <span className="min-w-0 flex-1 break-words text-[0.8rem] leading-5">{list.name}</span>
                {/* How many things it is HELD AGAINST, where there is room for
                    the words. At 220 pixels a second number takes the width the
                    NAME needs, and the name is how somebody tells one list from
                    another. */}
                <span className="shrink-0 text-[0.7rem] tabular-nums text-muted-foreground" data-summary>
                  {list.items}
                  {room.prose ? ` item${list.items === 1 ? '' : 's'}` : ''}
                  {room.prose ? (list.targets ? `, held against ${list.targets}` : ', held against nothing') : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t px-2 py-1.5 text-[0.7rem] leading-4 text-muted-foreground">
          No checklists in this project yet.
        </p>
      )}

      {/* The other way to get a list: copy one from another project. A row of
          its own, always drawn, because the press IS the whole control here —
          everything after it happens on the host's screen. */}
      <div className="flex shrink-0 items-center gap-1.5 border-t px-2 py-1.5">
        <Button type="button" variant="ghost" size="container" disabled={busy || importing} onClick={onImport}>
          {importing ? 'Choosing…' : 'Copy from another project'}
        </Button>
      </div>

      {overlaid ? (
        <>
          {trouble && !sheet ? (
            <p className="shrink-0 border-t px-2 py-1.5 text-[0.7rem] leading-4 text-failed">{trouble}</p>
          ) : null}
          {sheet ? (
            <Sheet title="Start a checklist" onClose={() => setSheet(false)}>
              {starting}
            </Sheet>
          ) : null}
        </>
      ) : (
        <div className="border-t p-2">{starting}</div>
      )}
    </section>
  )
}
