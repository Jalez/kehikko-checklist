import type { RowState } from '../../derive/standing.ts'

import { cn } from '@/lib/utils.ts'

/**
 * The seven verdicts, each drawn and each named.
 *
 * ## Why the word is always there and never only the colour
 *
 * A mark is the fastest thing on the row to read and the easiest to misread. Two
 * of these seven differ in a way that no glyph can carry on its own — `unasked`
 * and `unknown` look like the same shrug and mean opposite things — so the word
 * is on the row beside the mark, in the `title` for a pointer, and in the
 * screen-reader text. Colour is the third channel, never the first, because a
 * reader who cannot separate red from green would otherwise be looking at
 * sixteen identical circles.
 *
 * ## Seven rather than four, which is this module's whole argument
 *
 * The built-in checklist had four verdicts for a derived item: done, failed,
 * pending, unknown, where `unknown` meant "the tracker was read and had nothing
 * to say about this". Standing alone, this app meets a fifth thing constantly:
 * nobody has ever shown it a tracker state at all. That is not `unknown`.
 * `unknown` is an answer arrived at by looking; `unasked` is not having looked,
 * and the remedy is completely different — one is a repository with no checks
 * configured, the other is a pane nothing has selected a reference into.
 * Flattening them would be the single most dishonest thing this page could do:
 * every derived item on every reference would read "the tracker has nothing to
 * say", which is a statement about a tracker, made by a program that has never
 * spoken to one.
 *
 * `stale` is the sixth for the same kind of reason: the round of review DID
 * happen, and what the next reader needs is to look at the new head rather than
 * to run the whole thing again.
 */
const SAID: Record<RowState, { mark: string; word: string; why: string; tone: string }> = {
  done: { mark: '✓', word: 'done', why: 'This one is satisfied.', tone: 'text-done border-done/40' },
  failed: {
    mark: '!',
    word: 'failed',
    why: 'The tracker was read and this is not satisfied.',
    tone: 'text-failed border-failed/40',
  },
  pending: {
    mark: '·',
    word: 'pending',
    why: 'The tracker was read and this is not settled yet.',
    tone: 'text-pending border-pending/40',
  },
  unknown: {
    mark: '?',
    word: 'no answer',
    why: 'The tracker was read and had nothing to say about this. That is an answer, and it is not a failure.',
    tone: 'text-unknown border-unknown/40',
  },
  unasked: {
    mark: '◌',
    word: 'not asked',
    why: 'Nothing has shown this app what a tracker says about this reference, so it has not been read rather than read and found wanting.',
    tone: 'text-unasked border-dashed border-unasked/50',
  },
  stale: {
    mark: '~',
    word: 'stale',
    why: 'It was ticked, and the head has moved since. A review of the code before the fix is not a review of the fix.',
    tone: 'text-stale border-stale/40',
  },
  todo: { mark: '', word: 'to do', why: 'Nobody has asserted this yet.', tone: 'text-todo border-todo/50' },
}

export function stateWord(state: RowState): string {
  return SAID[state].word
}

export function StateMark({ state, className }: { state: RowState; className?: string }) {
  const said = SAID[state]
  return (
    <span
      /* `title` for a pointer and the visually-hidden span for a reader; neither
         is the only place the word appears, because the row prints it too. */
      title={`${said.word} — ${said.why}`}
      className={cn(
        'mt-px inline-flex size-4 shrink-0 items-center justify-center rounded-full border text-[0.7rem] leading-none font-bold',
        said.tone,
        className,
      )}
    >
      <span aria-hidden="true">{said.mark}</span>
      <span className="sr-only">{said.word}</span>
    </span>
  )
}
