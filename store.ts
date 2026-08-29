import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Where this app keeps what is its own.
 *
 * One file lives here — `checklists.json`, holding every checklist somebody made
 * and every tick filed on one against every target — and the directory is beside
 * the program rather than inside any host's data. That is the whole of what "an
 * app" means here: somebody can copy this directory to another machine, run it,
 * and have their checklists, with nothing else installed and nothing else
 * running.
 *
 * There used to be three, because there used to be three kinds of list.
 * `checklist.json` held EDITS to a list this program shipped, `ticks.json` held
 * what had been ticked against a reference, and `papers.json` held the
 * hand-written list for one paper. The shipped list is gone and so are the first
 * two. `papers.json` may still be here, and is read — once, never written — by
 * `list/checklists.ts`, to bring what somebody typed into the one store.
 *
 * `CHECKLIST_DATA` moves it, and it is deliberately NOT `ROADMAP_DATA`. That
 * variable belongs to a different program: honouring it would make this app's
 * store follow a host that may not be running, may not exist, and certainly did
 * not agree to hold anything of ours. One store, one owner, one name.
 *
 * Resolved at call time and not at import, so a test — or a deployment that sets
 * the variable in a wrapper — does not depend on which module happened to be
 * loaded first. `mkdirSync` is on this path rather than at startup because every
 * reader tolerates an absent file and none of them tolerates an absent
 * directory; making it here means the first write cannot fail on something the
 * program could simply have done.
 *
 * ## Why the fallback is the working directory and no longer `import.meta.dir`
 *
 * It used to be `join(import.meta.dir, 'data')`, which is the most direct way to
 * say "beside the program" and was right in the program this came from: that one
 * was `bun run server.ts`, and this file was where it said it was.
 *
 * It cannot stay, and the failure is worth recording because it is silent in the
 * worst way. The doors are now middleware inside Vite's config, and Vite BUNDLES
 * its config: `vite.config.ts` and everything it imports are compiled into a
 * single throwaway file under `node_modules/.vite-temp/`. So `import.meta.dir`
 * in that bundle is `node_modules/.vite-temp` — and under Node it is not even
 * that, because `import.meta.dir` is a Bun extension and evaluates to
 * `undefined`, which is how this surfaced at all: `join(undefined, 'data')`
 * threw on the first read. Had it merely been the wrong string, this app would
 * have started cleanly, found no `checklist.json`, reported the list as
 * untouched, and written a new store into a temporary directory Vite deletes.
 * That is every tick and every rewording gone, with a page that looked fine.
 *
 * So the fallback is `process.cwd()`, and `run.sh` is what makes it exact: it
 * does `cd "$(dirname "$0")"` before starting anything and then sets
 * `CHECKLIST_DATA` explicitly, so the store is beside the program however the
 * script was invoked and whatever a bundler does to the module graph. The
 * environment variable is now the primary answer rather than the override, which
 * is the honest arrangement: a location a bundler cannot move is worth more than
 * one that reads more elegantly.
 */
export function dataDir(): string {
  const dir = process.env.CHECKLIST_DATA ?? join(process.cwd(), 'data')
  mkdirSync(dir, { recursive: true })
  return dir
}
