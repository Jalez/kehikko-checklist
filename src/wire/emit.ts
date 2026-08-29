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
 * `list/outbox.ts` is the join. The door writes down what it did; this asks
 * what has happened since it last looked and emits one event per entry.
 *
 * ## Polled, rather than pushed
 *
 * A server-sent stream would be tidier and is not worth it here. It would mean
 * a long-lived connection from a page that is usually hidden behind another
 * canvas, a reconnect path, and a second way for this app to be "connected" —
 * for a queue that is empty almost always and holds a handful of rows when it
 * is not. Polling every couple of seconds costs one loopback request that
 * usually answers `{ announcements: [] }`, and it has exactly one failure mode:
 * an announcement is up to two seconds late. Nothing on a notification panel
 * cares about two seconds.
 *
 * The poll runs only while a host is there to be told. An unframed page has
 * nobody to emit to, and a timer firing into nothing is a program doing work
 * for no reader.
 *
 * ## Where the epic comes from, and why an announcement is sometimes dropped
 *
 * `roadmap.notifications@1` requires an `epic`, and requires it to be a slug.
 * The MCP door has no idea which epic anything is about — an agent calls it
 * with a ref, and a ref is not an epic. The page does know: `roadmap.context`
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

/** How often to ask. See the essay: two seconds is invisible on a panel. */
const EVERY_MS = 2000

interface Announcement {
  seq: number
  tool: string
  refs: string[]
  /** The epic the call named, where it named one. See `list/outbox.ts`. */
  epic?: string | null
  message: string
  level: string
}

/**
 * Start pumping, and hand back the way to stop.
 *
 * @param request  How to ask the host something. Injected rather than reached
 *                 for, because everything this file decides is testable without
 *                 a browser and that has to keep being true.
 * @param epic     Read at each tick rather than captured, because the canvas
 *                 moves and an announcement is filed under the epic that was
 *                 open when it was SENT — which is the nearest this app can
 *                 honestly get to when it happened.
 */
/**
 * @param heard  Told about every batch this pump reads, after the seek.
 *               Optional, and it exists so that the ONE poll already running
 *               here can also be what keeps the page current: an agent adding
 *               an item to a paper checklist over MCP changes what this page is
 *               drawing, and the page has no other way to find out. A second
 *               poller for that would be a second answer to "what has happened"
 *               that could disagree with this one, on the same two-second
 *               interval, for no question it could answer better.
 *
 *               It is called with the announcements as read, whether or not any
 *               of them could be emitted: whether a host will carry an event has
 *               nothing to do with whether this app's own store has moved.
 */
export function pump(
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  epic: () => string | null,
  everyMs: number = EVERY_MS,
  heard?: (announcements: Announcement[]) => void,
): () => void {
  let cursor = 0
  let live = true
  let asking = false
  /**
   * Whether the first read has happened.
   *
   * Until it has, the pump SEEKS TO THE END rather than emitting: the first
   * read adopts the outbox's current cursor and announces nothing.
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

  const tick = async () => {
    /* One in flight at a time. A slow answer must not stack requests behind it:
       two overlapping polls would both read from the same cursor and emit every
       announcement twice, which on a notification panel is indistinguishable
       from the agent having done the thing twice. */
    if (asking || !live) return
    asking = true
    try {
      const response = await fetch(`/api/announcements?since=${cursor}`, { cache: 'no-store' })
      const body = (await response.json()) as { announcements?: Announcement[]; cursor?: number }
      const announcements = Array.isArray(body.announcements) ? body.announcements : []

      /* The cursor moves whether or not anything was emitted below. An
         announcement dropped for want of an epic is dropped, not retried: it
         would be no more filable a second later, and a queue that never
         advanced past one unfilable row would stop reporting everything after
         it. */
      if (typeof body.cursor === 'number') cursor = body.cursor

      /* The first read is a seek, not a delivery. See `primed`. */
      if (!primed) {
        primed = true
        return
      }

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
      if (announcements.length && heard) heard(announcements)

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
            'themselves, and roadmap.notifications@1 files a line under one. Nothing was invented.',
        )
      }
    } catch {
      /* Loopback to our own origin, so a failure is this app's own server being
         gone. The next tick tries again; nothing is lost, because the cursor
         only moved if the read succeeded. */
    } finally {
      asking = false
    }
  }

  const timer = setInterval(() => void tick(), everyMs)
  /* One immediately, and it is the SEEK — see `primed`. Doing it now rather
     than in two seconds' time means an agent's call that lands a moment after
     this page loads is announced on the following tick rather than being caught
     in the seek and skipped. */
  void tick()

  return () => {
    live = false
    clearInterval(timer)
  }
}
