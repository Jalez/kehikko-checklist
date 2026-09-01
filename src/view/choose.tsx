import { useState } from 'react'

import type { Summary } from '@/store/ask.ts'
import { Button } from '@/components/ui/button.tsx'
import { Sheet } from '@/view/sheet.tsx'
import type { Room } from '@/view/room.ts'
import { cn } from '@/lib/utils.ts'

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
 * claim about what that work owes, and a container that opened on somebody else's
 * list would have a person ticking items off against a standard they never
 * chose. There is no correct guess here, so there is no guess: the container says
 * what it has and waits.
 *
 * ## Nothing is in a Badge
 *
 * shadcn's `Badge` carries `whitespace-nowrap` in its base, which is right for
 * the two or three words it is used for and would be catastrophic here. A
 * checklist name is up to 120 characters of whatever somebody typed, and a long
 * string in a nowrap box sets a min-content floor far wider than the container — a
 * sibling module shipped exactly that, with a 407-character string and an
 * 1187-pixel floor under a 220-pixel container, and the container scrolled sideways for
 * the rest of the day. So every name here is wrapped prose in a `min-w-0`
 * column, and the counts beside them are the only fixed-width things on a row.
 *
 * ## In a small container the box to type in becomes a press
 *
 * The create box — a label, a two-line textarea, a button and a sentence about
 * naming — measured 147 pixels at 220 wide. In a 300-pixel frame that is half
 * the screen given to something used once, in front of the list of things the
 * screen is for. It becomes one button and the whole frame when it is wanted.
 * The names then get the rest of the frame and scroll on their own, snapping,
 * so a small scroll brings the next name fully into view rather than leaving it
 * cut through the middle.
 *
 * The sentence at the top is not dropped in a small container, and it is the one
 * piece of prose here that earns the space: three of the four things it can say
 * are the reason a reader is looking at this screen at all — most sharply "that
 * checklist is not here any more", which is the answer to the question they are
 * about to ask. It is clamped to two lines with the rest in its `title` rather
 * than cut, because the first clause of each of them carries the fact.
 */
export function Choose({
  lists,
  onPick,
  onCreate,
  trouble,
  busy,
  said,
  room,
}: {
  lists: Summary[]
  onPick: (id: string) => void
  onCreate: (name: string) => void
  /** What went wrong the last time anything was pressed, if anything. */
  trouble: string | null
  busy: boolean
  /** The sentence at the top, which differs by why we are on this screen. */
  said: string
  /** What this container has room for. See `src/view/room.ts`. */
  room: Room
}) {
  const [typing, setTyping] = useState('')
  const [sheet, setSheet] = useState(false)
  const overlaid = room.compose === 'overlay'

  const create = () => {
    const name = typing.trim()
    if (!name) return
    /* Cleared before the answer, and this is the one optimistic thing on the
       screen. It is safe: a refused create leaves the sentence in the refusal
       under the box, so nothing typed can be lost by clearing it, and a box that
       stayed full after a successful create is the fastest way to make the same
       list twice. */
    setTyping('')
    setSheet(false)
    onCreate(name)
  }

  const starting = (
    <div className="flex flex-col gap-1">
      {/* Dropped when the overlay's title already says it. See `checklist.tsx`. */}
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
      /* `relative`, for the reason set out in `checklist.tsx`: an `sr-only` label
         is `position: absolute` and escapes a scroller that is not its
         containing block, taking the page's scroll height with it.

         No `rounded-lg border bg-card`, for the reason set out at length on the
         same element in `checklist.tsx`: the host draws the container, and a
         second frame inside it is a box in a box whose padding comes out of the
         list. The rules between the names below are `border-t` and stay — they
         are what makes this a list of choices rather than a paragraph of them. */
      className={cn('relative overflow-hidden', room.pinned && 'flex min-h-0 flex-1 flex-col')}
      data-room={room.pinned ? 'pinned' : 'flowing'}
    >
      <div className="flex shrink-0 items-baseline gap-1.5 px-2 py-1.5">
        <h2 className="min-w-0 flex-1 text-[0.8rem] font-semibold">Pick a checklist</h2>
        {overlaid ? (
          <Button type="button" variant="outline" size="container" data-open-create onClick={() => setSheet(true)}>
            Start one
          </Button>
        ) : null}
      </div>
      <p
        className={cn(
          'shrink-0 border-t bg-muted/40 px-2 py-1.5 text-[0.65rem] leading-4 text-muted-foreground',
          !room.prose && 'line-clamp-2',
        )}
        title={room.prose ? undefined : said}
      >
        {said}
      </p>

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
                onClick={() => onPick(list.id)}
                className="flex w-full items-start gap-1.5 px-2 py-1.5 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              >
                {/* `min-w-0` and `break-words` together are what keep a long name,
                    or an unbroken URL somebody pasted into one, inside a 220px
                    container. Never a Badge and never `truncate`: the name IS how
                    somebody tells one list from another. */}
                <span className="min-w-0 flex-1 break-words text-[0.8rem] leading-5">{list.name}</span>
                <span className="shrink-0 text-[0.7rem] tabular-nums text-muted-foreground">
                  {list.items}
                  {room.prose ? ` item${list.items === 1 ? '' : 's'}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t px-2 py-1.5 text-[0.7rem] leading-4 text-muted-foreground">
          {room.prose
            ? 'There are no checklists here yet, and that is not a gap this app can fill for you. Nothing ships a '
              + 'list — what a piece of work owes is a judgement, and the first one starts below.'
            : 'No checklists here yet. Nothing ships a list — the first one is yours to start.'}
        </p>
      )}

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

/**
 * The screen for a container that cannot tell which kehikko it is on.
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
 *
 * ## In a small container it is one line, and the rest is in the `title`
 *
 * The paragraph is 55 words. At 220 pixels that is eleven lines above a screen
 * that is about picking from a list — a third of a 300-pixel frame spent saying
 * something a reader needs once. The short form keeps the two facts they can act
 * on: this pick is not remembered, and it lasts until reload.
 */
export function Unplaced({ children, room }: { children: React.ReactNode; room: Room }) {
  const whole =
    'This container cannot tell which kehikko it is on — the host did not say, which is allowed and happens when a '
    + 'host has no canvases. A checklist is remembered per kehikko, so there is nothing here to remember one '
    + 'against: pick a list and it holds until this page is reloaded, then you will be asked again.'

  return (
    <>
      <p
        data-unplaced="yes"
        title={room.prose ? undefined : whole}
        /* `mx-2 mt-2`: a bordered box of its own, kept off the host's edge for
           the reason given beside the store's refusal in `app.tsx` — a border
           flush against the container's border reads as the container's. */
        className="mx-2 mt-2 shrink-0 rounded border border-pending/40 bg-pending/5 px-2 py-1.5 text-[0.7rem] leading-4 text-muted-foreground"
      >
        {room.prose
          ? whole
          : 'No kehikko was named, so this pick is not remembered — it holds until this page is reloaded.'}
      </p>
      {children}
    </>
  )
}
