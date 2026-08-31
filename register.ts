#!/usr/bin/env bun
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { originFor, registerAt } from 'roadmap-module-protocol/serve'

import { ID, PREFERRED_PORT } from './manifest.ts'

/**
 * Tell a host on this machine where this app answers.
 *
 *   bun run register            # or: PORT=7861 bun run register
 *
 * A separate program from `run.sh` on purpose. Registration writes into
 * somebody's home directory and says "frame this", which is a decision a person
 * makes once; a start script that did it quietly would be making that decision on
 * their behalf every time they pressed start.
 *
 * ## The plugin writes this file too, and does not contradict the paragraph above
 *
 * `serves()` in `vite.config.ts` rewrites this registration every time the
 * server starts, which reads like precisely what that paragraph forbids. It is
 * not, and the distinction is worth being exact about, because collapsing the
 * two loses something whichever way you collapse them.
 *
 * ADOPTION is the decision a person makes once, and this program is it. Running
 * this is how an app that was not on somebody's canvas gets onto it, and
 * deleting the file is how it comes off. Nothing else here does that.
 *
 * The ADDRESS is not a decision anybody made. Nobody chose 7860; they chose to
 * be framed, and 7860 is a fact about where this process happened to bind — one
 * that changes between one start and the next when something else has the port.
 * A registration still naming the old number is one the host sweeps to find
 * nothing: it reports this app as stopped while it is running one port over, and
 * offers a Start button that would put a second writer on the same
 * `checklists.json`. Rewriting the address keeps the decision the person made
 * TRUE. It does not make one on their behalf.
 *
 * ## `dir` as well as `url`, which this program used not to write
 *
 * The url is where to talk to this app; the directory is where to START it. A
 * host holding only the first can frame a running module and can do nothing at
 * all about a stopped one — which on screen is "nothing is answering" beside a
 * Start button that is not there. With both, the host runs `run.sh` in this
 * directory, one script and no arguments, for the reason that file gives.
 *
 * It comes from this file's own location rather than from `process.cwd()`, so
 * `bun run register` works from anywhere and records where the program actually
 * is rather than where somebody happened to be standing.
 *
 * ## Where a host looks is no longer copied into this file
 *
 * The registry directory, the rule that the FILENAME carries the id — a host
 * sweeps the directory and takes the id from the name, so
 * `roadmap.checklist.json` is what makes this `roadmap.checklist` — and the shape
 * of the document are all in `roadmap-module-protocol/serve` now. This file used
 * to say the path itself, with a note explaining that the copy was deliberate so
 * the directory could stand alone; fourteen deliberate copies of one path are
 * fourteen chances to disagree by a character, and writing to the wrong
 * directory is the worst failure a module can have, because the host finds
 * nothing and finds it silently.
 *
 * `registerAt` also MERGES rather than overwrites, so a field somebody put
 * beside the url by hand survives a rewrite it had nothing to do with.
 */
const port = Number(process.env.PORT ?? PREFERRED_PORT)
const written = registerAt({
  id: ID,
  origin: originFor(port),
  dir: dirname(fileURLToPath(import.meta.url)),
})

console.log(`registered: ${written.file} -> ${written.url} (${written.dir})`)
if (written.was) console.log(`  (was ${written.was.url} in ${written.was.dir})`)
console.log('Start the app with ./run.sh, then reload the host; it sweeps the directory on every read.')
console.log(`If ${port} is taken, ./run.sh moves to the next free port and rewrites this file to match.`)
