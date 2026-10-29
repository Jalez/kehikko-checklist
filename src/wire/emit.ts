import { answered, ask, subscribe } from 'kehikot-module-protocol/client'

import { FORMAT } from '../../manifest.ts'

/**
 * Telling a host that an agent came through this app's MCP door.
 *
 * ## The gap this closes, and why it needs a pump at all
 *
 * `events.emit` is a wire call: a `postMessage` from this FRAME to the host's
 * page. The MCP door is not in the frame. It is middleware in the node process
 * that serves this page, reached by an agent over HTTP, with no window and no
 * conversation. So the half of this app that knows a tool was called cannot
 * say so, and the half that can say so does not know.
 *
 * `list/outbox.ts` is the join. The door writes down what it did; this is told
 * what has happened since it last heard and emits one event per entry.
 *
 * ## Told, rather than polled
 *
 * This used to ask `/api/announcements` every two seconds, on the argument that
 * a held stream meant a long-lived connection from a page usually hidden behind
 * another canvas, a reconnect path, and a second way of being "connected", for
 * a queue that is empty almost always. Each of those is now the protocol's
 * (`events` on the server, `subscribe` here, 2.32.0) rather than this app's: the
 * reconnect, and noticing that this app's own server has stopped (`probe`, what
 * the poll's failures used to tell), are done once for every module. And the
 * poll's cost was never the one request, it was 1800 of them an hour from every
 * open page, nearly all answering `{ announcements: [] }`.
 *
 * So the page holds one stream (`/api/announcements/events`), and the server
 * sends each announcement as the door writes it down. The cursor is kept, and
 * it is what makes a held line as safe as the poll was. The page reads it once
 * as it loads (`/api/announcements`, the seek below) and opens the stream from
 * it; every time the stream opens, its first message is everything after that
 * cursor (`since`), so what happened while the line was down — a dropped
 * connection, the server restarting — is delivered when it comes back, and
 * anything heard twice is told apart by `seq` and emitted once.
 *
 * It stays open while the page is hidden (`whileHidden`), which is what the poll
 * did too: what this relays goes to the host, and the host is not hidden because
 * one canvas is. An idle stream asks nothing.
 *
 * The stream runs only while a host is there to be told. An unframed page has
 * nobody to emit to.
 *
 * ## Where the epic comes from, and why an announcement is sometimes dropped
 *
 * `kehikot.notifications@1` requires an `epic`, and requires it to be a slug.
 * The MCP door has no idea which epic anything is about — an agent calls it
 * with a ref, and a ref is not an epic. The page does know: `kehikot.context`
 * says which epic the canvas is on.
 *
 * So the epic is the CANVAS's, supplied here, and when the canvas is on no
 * epic the announcement is dropped rather than sent with something invented.
 * That is the honest handling and it is worth being plain about the cost: tool
 * calls made while no epic is open are never announced anywhere. The
 * alternative — a placeholder slug — would put lines on a shared panel filed
 * under an epic nobody chose, which is worse than silence because it is wrong
 * rather than missing. The drop is reported to the console, which is where
 * whoever can act on it is looking.
 */

interface Announcement {
  seq: number
  tool: string
  refs: string[]
  /** The epic the call named, where it named one. See `list/outbox.ts`. */
  epic?: string | null
  message: string
  level: string
}

/** What the stream sends: the backlog as it opens, then a batch of one per announcement. */
export interface Told {
  announcements?: Announcement[]
  cursor?: number
}

/** How the pump hears the stream from a cursor. Returns the way to stop. A test passes its own. */
export type Listen = (query: Record<string, string>, onTold: (told: Told) => void) => () => void

export const listen: Listen = (query, onTold) =>
  subscribe<Told>('/api/announcements/events', (told) => told && typeof told === 'object' && onTold(told), {
    query,
    probe: true,
    whileHidden: true,
  })

/** Where the outbox is now: the seek, read once as the page loads. Null when nothing answered. */
export const seek = async (): Promise<number | null> => {
  try {
    const body = answered(await ask<{ cursor?: number }>('/api/announcements', { query: { since: 0 } }))
    return typeof body?.cursor === 'number' ? body.cursor : null
  } catch {
    return null
  }
}

/**
 * Start pumping, and hand back the way to stop.
 *
 * @param request  How to ask the host something. Injected rather than reached
 *                 for, because everything this file decides is testable without
 *                 a browser and that has to keep being true.
 * @param epic     Read at each announcement rather than captured, because the
 *                 canvas moves and an announcement is filed under the epic that
 *                 was open when it was SENT — which is the nearest this app can
 *                 honestly get to when it happened.
 * @param heard    Told about every batch this pump takes in, after the seek.
 *                 Optional, and it exists so that the ONE stream already open
 *                 here can also be what keeps the page current: an agent adding
 *                 an item to a paper checklist over MCP changes what this page is
 *                 drawing, and the page has no other way to find out. A second
 *                 stream for that would be a second answer to "what has happened"
 *                 that could disagree with this one.
 *
 *                 It is called with the announcements as heard, whether or not
 *                 any of them could be emitted: whether a host will carry an
 *                 event has nothing to do with whether this app's own store has
 *                 moved.
 */
export function pump(
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  epic: () => string | null,
  heard?: (announcements: Announcement[]) => void,
  hear: Listen = listen,
  where: () => Promise<number | null> = seek,
): () => void {
  let cursor = 0
  let live = true
  /**
   * Whether the page knows where the outbox is.
   *
   * Until it does, the pump SEEKS TO THE END rather than emitting: the first
   * thing it learns is the outbox's current cursor, adopted with nothing
   * announced — from the one read as the page loads, or, when that found
   * nobody, from the first message of a stream opened without a cursor (which
   * then opens again from it, so that its reopenings ask from somewhere).
   *
   * That is not a nicety, it is a bug this cost us in measurement. Without it a
   * fresh page starts at cursor 0 and re-emits the whole outbox — so every
   * reload of the host, every hot reload of this app, and every switch between
   * canvases announced every MCP call the process had ever seen, again. On the
   * panel at the other end that is indistinguishable from an agent having done
   * the same thing four times, which is precisely the lie a notification panel
   * must not tell. Measured: one tool call, three reloads, six lines.
   *
   * The announcements skipped this way are genuinely lost, and that is right
   * rather than merely acceptable. They happened while no page was framed, so
   * there was no wire to carry them and nothing was ever going to. The protocol
   * says the same thing about events themselves: delivery is best-effort, and a
   * receiver that wants history keeps its own — which the notifications module
   * does, and which is why what it already holds survives this.
   */
  let primed = false
  let stop: () => void = () => {}

  /*
   * One batch at a time, in order. Messages arrive while an emit is still on its
   * way to the host; queued behind it rather than run beside it, so two batches
   * can never interleave on the panel.
   */
  let chain: Promise<void> = Promise.resolve()

  const take = async (told: Told) => {
    if (!live) return
    const all = Array.isArray(told.announcements) ? told.announcements : []
    const at = typeof told.cursor === 'number' ? told.cursor : null

    /* A stream opened without a cursor: its first message is the seek, not a delivery. See `primed`. */
    if (!primed) {
      if (at === null) return
      primed = true
      cursor = at
      stop()
      open(cursor)
      return
    }

    /* A server whose cursor is behind this page's is another process: it counts from 1 again, and
       everything it holds is new to this page. */
    if (at !== null && at < cursor) cursor = 0
    /* What was heard already — a backlog overlapping what the stream had sent — is emitted once. */
    const announcements = all.filter((one) => typeof one?.seq === 'number' && one.seq > cursor)
    /* The cursor moves whether or not anything is emitted below. An
       announcement dropped for want of an epic is dropped, not retried: it
       would be no more filable a second later. */
    cursor = Math.max(cursor, at ?? 0, ...announcements.map((one) => one.seq))
    if (!announcements.length) return

    /*
     * The canvas's epic, which is now the FALLBACK rather than the answer.
     *
     * An announcement that names its own epic is filed under that one — the
     * paper tools are addressed by epic and therefore know, and what they know
     * beats what the canvas happens to be showing. Everything else still takes
     * the canvas's, because a ref is not an epic and the page is the only half
     * of this app that has been told where the reader is standing.
     *
     * So the drop below is per announcement rather than for the whole batch:
     * with no epic open, a paper call is still filable and a `check_mr` still
     * is not, and refusing both would throw away the one that was never in
     * doubt.
     */
    /* Before any emitting, and outside the epic question entirely. A page
       that only refreshed itself when a host was there to be told would be a
       page that goes stale in exactly the case this app was built for: nothing
       framing it, an agent working its store over MCP. */
    if (heard) heard(announcements)

    const canvas = epic()
    let dropped = 0

    for (const announcement of announcements) {
      if (!live) return
      const slug = announcement.epic ?? canvas
      if (!slug) {
        dropped += 1
        continue
      }
      try {
        await request('events.emit', {
          extension: FORMAT,
          payload: {
            epic: slug,
            message: announcement.message,
            level: announcement.level,
            refs: announcement.refs,
          },
        })
      } catch (error) {
        /* A refused emit is the host's word and worth reading: it is where a
           rate limit says it has stopped carrying these, and it is the only
           place that says so. Reported and not retried — an event held back
           until a storm passed would arrive describing the past, which is
           precisely what the host refuses to do on its own side. */
        console.info('kehikko-checklist: the host did not carry an event.', error)
      }
    }

    if (dropped) {
      console.info(
        `kehikko-checklist: ${dropped} MCP call(s) not announced — this canvas is on no epic, they named none ` +
          'themselves, and kehikot.notifications@1 files a line under one. Nothing was invented.',
      )
    }
  }

  const open = (from: number | null) => {
    if (!live) return
    stop = hear(from === null ? {} : { since: String(from) }, (told) => {
      chain = chain.then(() => take(told)).catch(() => {})
    })
  }

  void where().then((at) => {
    if (at !== null) {
      primed = true
      cursor = at
    }
    open(at)
  })

  return () => {
    live = false
    stop()
  }
}
