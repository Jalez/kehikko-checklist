import { WORK_QUEUE, providerOf, type ServiceProvider, type WorkQueue } from 'kehikot-module-protocol'
import { askHost } from 'kehikot-module-protocol/serve'

import { ID } from './manifest.ts'

/**
 * The work queue on this computer, as the host names it (protocol 2.81.0, `services.find` for
 * `work.queue`): whichever module provides it. Where test steps go is said in its own words — its
 * name and its tool — and with none provided, nothing this module says mentions a queue.
 *
 * Kept here and asked again when older than `WORK_QUEUE_FRESH_MS`, in the background: the doors answer
 * at once with what was last found. Nothing is asked until the server starts it (`startWorkQueue`), so
 * a test never reaches a host; a test hands its own answer with `findWorkQueueWith`.
 */

/** Asks who provides `work.queue`: the providers, `[]` for none, null when no host answered. */
export type FindProviders = () => Promise<readonly ServiceProvider[] | null>

/** How long a work queue found is used before the host is asked again. */
export const WORK_QUEUE_FRESH_MS = 5 * 60_000

let find: FindProviders | null = null
let now: () => number = Date.now
let queue: WorkQueue | null = null
let at = 0
let asking: Promise<WorkQueue | null> | null = null

/** The host's answer, from this module's server. A host before 2.81.0 provides no services: none. */
export const askedProviders: FindProviders = async () => {
  const found = await askHost('services.find', { service: WORK_QUEUE }, { module: ID })
  if (found.ok) return found.data.providers
  return found.declined === 'host-too-old' ? [] : null
}

/** Start asking the host, from the server: once now, then whenever what was found is old. */
export function startWorkQueue(with_: FindProviders = askedProviders): Promise<WorkQueue | null> {
  return findWorkQueueWith(with_)
}

/** Ask with `with_` from now on (null: never), forgetting what was found; a test's clock with `clock`. */
export function findWorkQueueWith(with_: FindProviders | null, clock: () => number = Date.now): Promise<WorkQueue | null> {
  find = with_
  now = clock
  queue = null
  at = 0
  asking = null
  return with_ ? ask() : Promise.resolve(null)
}

/** The work queue as last found, without waiting; asked again in the background when that is old. */
export function workQueueNow(): WorkQueue | null {
  if (find && (at === 0 || now() - at >= WORK_QUEUE_FRESH_MS)) void ask()
  return queue
}

function ask(): Promise<WorkQueue | null> {
  const asker = find
  if (!asker) return Promise.resolve(queue)
  asking ??= asker()
    .catch(() => null)
    .then((providers) => {
      asking = null
      /* Another finder since: its answer is the one that counts. */
      if (find !== asker) return queue
      /* No answer: what was found before stands, and it is asked again next time. */
      if (providers === null) return queue
      at = now()
      queue = providerOf(WORK_QUEUE, providers)?.descriptor ?? null
      return queue
    })
  return asking
}
