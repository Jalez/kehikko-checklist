import { events, publish } from 'kehikot-module-protocol/serve'

/**
 * What this app has done over MCP that its own page has not yet told anybody
 * about.
 *
 * ## Why an outbox exists at all
 *
 * `events.emit` is a wire call, and the wire is `postMessage` between a host's
 * page and this module's FRAME. The MCP door is not in the frame — it is
 * middleware in the node process that serves the page, reached by an agent over
 * HTTP, with no window, no host and no conversation. So the half of this app
 * that knows a tool was called is structurally unable to say so, and the half
 * that can say so does not know.
 *
 * This is the join between them, and it is the smallest one that works: the
 * door writes down what it did, the page is told over one held stream
 * (`/api/announcements/events`, protocol 2.32.0 `events`) with everything since
 * the last it saw, and the page emits. Nothing here talks to a host and nothing
 * here knows what an event is.
 *
 * ## In memory, and deliberately not on disk
 *
 * The other stores in this app are files, because a tick is a claim somebody
 * will rely on and losing one would lose work. This is the opposite kind of
 * thing. It is a queue of announcements about something that is ALREADY
 * recorded — the tick is in `data/ticks.json` whether or not anybody was told —
 * and an announcement that outlived the process would be this app, on restart,
 * telling a panel that tests passed an hour ago as though they had just passed.
 *
 * So it dies with the process, which is the honest lifetime for it: an
 * announcement nobody was there to hear is not owed to anybody later. That is
 * also exactly what the protocol says about events themselves — delivery is
 * best-effort, and a receiver that wants history keeps its own.
 *
 * ## Bounded, and the oldest go
 *
 * An agent can call this door faster than a page is told, and a queue that
 * grew without limit would be a memory leak in a program somebody leaves
 * running for a week. `KEEP` is a couple of screens' worth: past that the
 * oldest are dropped, because what a notification panel is for is what just
 * happened. `dropped` counts them so the page can say so rather than a person
 * quietly seeing fewer lines than there were calls.
 */

/** One thing worth announcing. Not an event: it has no `from`, no `at`, no kehikko. */
export interface Announcement {
  /** This app's own counter. The page asks for everything after the last it saw. */
  seq: number
  /** The tool an agent called. */
  tool: string
  /** What it was about, when the tool named something. */
  refs: string[]
  /**
   * The epic the call itself named, or null when it named none.
   *
   * `kehikot.notifications@1` files every line under an epic, and for a long
   * time the only epic this app could offer was the CANVAS's — supplied by the
   * page at the moment it emits, because the door has no context and a ref is
   * not an epic. That is still the right answer for the change tools.
   *
   * The paper tools are addressed BY epic, so they know. It is a better answer
   * than the canvas's rather than merely a different one: an agent working a
   * paper list over MCP is very often doing it while the person's canvas sits on
   * another epic, and filing that work under whatever they happened to be
   * looking at would put a true sentence under the wrong heading — which on a
   * shared panel is worse than the line being missing.
   */
  epic: string | null
  /** The sentence, in this app's own words. */
  message: string
  /** One of the four `kehikot.notifications@1` levels. */
  level: 'info' | 'attention' | 'done' | 'blocked'
}

const KEEP = 64

const queue: Announcement[] = []
let next = 1
let dropped = 0

/**
 * Write one down.
 *
 * Called from the MCP door and from nowhere else. It cannot fail and must not:
 * an agent's tool call has already done its work by the time this runs, and a
 * throw here would turn a successful tick into a transport error the agent
 * retries.
 */
export function announce(announcement: Omit<Announcement, 'seq'>): void {
  const one = { seq: next++, ...announcement }
  queue.push(one)
  while (queue.length > KEEP) {
    queue.shift()
    dropped += 1
  }
  /*
   * Told to every page following the stream, as a batch of one in the same
   * shape `since` answers with, so the page has one way to take it in. On a
   * microtask: the door announces BEFORE it does the work (see `mcp` in
   * `doors.ts`), and the page reads its store again on hearing this, so the
   * work the same call is about to do synchronously has to be done first.
   */
  queueMicrotask(() => {
    try {
      publish(ANNOUNCEMENTS_TOPIC, { announcements: [one], cursor: one.seq, dropped })
    } catch {
      /* Cannot fail, and must not: see above. */
    }
  })
}

/** The one topic: the outbox is the process's, not a project's. */
export const ANNOUNCEMENTS_TOPIC = 'announcements'

export const EVENTS_PATH = '/api/announcements/events'

/**
 * The page's stream: `/api/announcements/events?since=N`. What it opens with is
 * `since(N)` — the backlog after the cursor the page last saw, so nothing that
 * happened while the line was down is lost — and then each announcement as the
 * door writes it down. With no `since`, it opens with nothing but the cursor:
 * a page that has just loaded seeks to the end (see `since` below, and
 * `primed` in `src/wire/emit.ts`).
 */
export const announcementsStream = events((path, query) => {
  if (path !== EVENTS_PATH) return null
  const given = query.get('since')
  const cursor = given === null ? null : Number(given)
  return {
    topic: ANNOUNCEMENTS_TOPIC,
    initial: () => {
      const all = since(cursor !== null && Number.isFinite(cursor) && cursor >= 0 ? cursor : 0)
      return cursor === null ? { ...all, announcements: [] } : all
    },
  }
})

/**
 * Everything after `since`, and where the page should ask from next.
 *
 * `since` rather than "drain", for two reasons. The page is not the only
 * possible reader, and a drain loses everything if the page's own emit then
 * fails — a cursor lets a reader that got half way through ask again from where
 * it actually was.
 *
 * The second reason is what a fresh page does with it, and it is worth being
 * exact because getting it wrong was measurable. `cursor` is handed back on
 * every read INCLUDING one that returns everything, so a page that has just
 * loaded can read once, adopt the cursor, and announce nothing. That is what
 * `src/wire/emit.ts` does, and without it every reload re-announced this
 * process's whole history: one tool call, three reloads, six lines on somebody
 * else's panel. The announcements skipped that way were never deliverable —
 * they happened while no page was framed and there was no wire to carry them.
 */
export function since(cursor: number): { announcements: Announcement[]; cursor: number; dropped: number } {
  const announcements = queue.filter((a) => a.seq > cursor)
  return {
    announcements,
    /* The highest seq handed out, not the queue's length: a trimmed queue would
       otherwise walk the cursor backwards and replay everything. */
    cursor: next - 1,
    dropped,
  }
}

/** For tests, which must not inherit a queue from the file before them. */
export function forgetEverything(): void {
  queue.length = 0
  next = 1
  dropped = 0
}
