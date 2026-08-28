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
 * door writes down what it did, the page asks what has happened since it last
 * looked, and the page emits. Nothing here talks to a host and nothing here
 * knows what an event is.
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
 * An agent can call this door faster than a page polls it, and a queue that
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
  /** The sentence, in this app's own words. */
  message: string
  /** One of the four `roadmap.notifications@1` levels. */
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
  queue.push({ seq: next++, ...announcement })
  while (queue.length > KEEP) {
    queue.shift()
    dropped += 1
  }
}

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
