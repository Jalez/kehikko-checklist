import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

import { KEHIKOT_DIR, moduleDir, moduleFile, withKehikotIgnored, within } from 'roadmap-module-protocol'

import { ID } from './manifest.ts'

/**
 * Where this app keeps what is its own — which is inside the project now, and
 * not beside this program.
 *
 * ## What moved, and the sentences that moved it
 *
 * There used to be a `data/` directory next to this app holding
 * `checklists.json` — every checklist anybody made and every tick filed on one,
 * for every project at once, in one file beside the program. The user's sentence
 * retired it:
 *
 * > "Each of the modules should hold their data inside the project itself,
 * > mostly as text files inside a kehikko-folder (or json). Checklist, journeys,
 * > notes… That way everything is transparent etc and easily usable by others in
 * > the project."
 *
 * And a second sentence gave it its shape:
 *
 * > "I think it'd be best if each module has their own folder inside the
 * > .kehikot folder."
 *
 * So: `<projectPath>/.kehikot/checklist/checklists.json`, with this app's other
 * file — the `papers.json` it migrates from — beside it in the same folder. The
 * folder names and the joins belong to `roadmap-module-protocol` rather than to
 * this file, deliberately, because four modules answering "where does my data
 * live" separately is four answers and the disagreement has no symptom worth the
 * name — every module starts, every module saves, every screen looks right, and
 * a person finds their checklists in one folder and their notes in another with
 * nothing anywhere to say why.
 *
 * `.kehikot` and not `.kehikko`: **kehikot is the app, and a kehikko is one
 * canvas inside it.** This app knows both words and they mean different things
 * here — `list/keep.ts` remembers a pick per *kehikko*, and that has nothing to
 * do with where the file is. The folder takes the app's name because what is in
 * it belongs to every canvas a person has rather than to one of them. Neither
 * spelling appears as a literal anywhere in this file; both come from the
 * protocol package, which is the one place either is written down.
 *
 * ## The folder is named after this module, and the name is not typed here
 *
 * `moduleDir(project, ID)` is `<project>/.kehikot/checklist` — the `roadmap.`
 * prefix comes off the id, because a folder called `roadmap.checklist` inside a
 * folder already named after the program is the program saying its own name
 * twice in somebody else's repository.
 *
 * `ID` is imported from `manifest.ts` rather than spelled again. One id, one
 * source: a module whose manifest said `roadmap.checklist` and whose store wrote
 * to a folder called something else would be a module that works perfectly and
 * puts its data where nobody looking for it would look.
 *
 * ## The path is the partition, so nothing here is keyed by project
 *
 * The store this opens is already one project's. That REPLACES per-project
 * keying rather than sitting on top of it: there is no outer `projects` map in
 * `list/checklists.ts` and there must never be one, because a store that has
 * never heard of a project has no way to show one project's lists under
 * another's name. Switching project is opening a different file rather than
 * filtering a bigger one.
 *
 * The claim this file used to make about this app — that `data/` can be copied
 * to another machine and be somebody's checklists — is not lost, it has moved,
 * and it is better where it is. The thing that travels is the PROJECT with
 * `.kehikot/checklist/` inside it: somebody who clones a repository and
 * un-ignores the folder gets the checklists that belong to that work, and nobody
 * has to know this app's directory layout to find them. `rm -r
 * .kehikot/checklist` is a sentence somebody can say, which is most of what a
 * folder per module actually buys.
 *
 * ## Null is a place a person can be, and never a guess
 *
 * `projectPath` is nullable on the wire — no project is open, or the host is
 * older than protocol 0.8 and has no field to say it in. This answers `null` for
 * that, and every caller has to say so on screen.
 *
 * What it does NOT do is fall back to `process.cwd()`, to this app's own folder,
 * or to anything else. That failure has already happened once here, and the
 * essay it earned in the file this one replaces is worth carrying over rather
 * than losing to a rewrite. The doors are middleware inside Vite's config, and
 * Vite BUNDLES its config: `vite.config.ts` and everything it imports are
 * compiled into a single throwaway file under `node_modules/.vite-temp/`. So
 * `import.meta.dir` in that bundle named a directory Vite deletes — and under
 * Node it was not even that, because `import.meta.dir` is a Bun extension and
 * evaluates to `undefined`. The only reason it surfaced at all is that
 * `join(undefined, 'data')` throws. Had it merely been the wrong string, this app
 * would have started cleanly, found no `checklists.json`, reported that nobody
 * had made a list, and written a new store into a temporary directory. Every
 * tick and every rewording gone, with a page that looked fine.
 *
 * The lesson generalises past `import.meta.dir`, and it is the reason there is no
 * fallback anywhere in this file: **a silently wrong location is worse than a
 * loud absent one.** A module that guessed a folder would be writing somebody's
 * checklists into a directory they will never open, under a screen saying the
 * list was saved.
 *
 * ## The fence, which matters more here than it did before
 *
 * `CHECKLIST_DATA` was a string set by whoever started this program.
 * `projectPath` arrives OVER THE WIRE, from a host, into functions that are
 * about to create directories and write files. That is a different kind of
 * string and it gets a different kind of treatment: it is resolved with
 * `realpathSync`, and the folder it lands in is checked to be under the project
 * it claims to be under AFTER that resolution — because a `.kehikot` that is a
 * symlink pointing somewhere else is exactly the case a string comparison
 * misses, and a fence built on unresolved strings is one a symlink walks
 * straight through.
 *
 * There are two levels to that now and both are checked, even though the second
 * check subsumes the first: `realpathSync` follows the whole chain, so a
 * `.kehikot` that points out of the project is caught anyway when the
 * `checklist/` inside it is resolved. It is still checked on its own, because
 * the refusal then names the folder that is actually wrong rather than one a
 * level below it.
 *
 * `within()` from the protocol package is the comparison and explicitly not the
 * check; see its own note. The check is `escapes()` below, and it runs again
 * after `mkdirSync` as well as before, because the only honest moment to ask
 * where a directory actually is, is once it is there.
 *
 * The file NAME is a constant in this file and is never a string from a request.
 * No door here takes a filename, nothing derives one from an id, a slug or a
 * target, and `moduleFile` throws rather than returning null if anything ever
 * tries — a loud throw rather than a quiet `null`, because "there is no project"
 * is a state a person can be in and "this module asked for a file called
 * `../../etc/passwd`" is a program being wrong.
 */

/** This app's own file, inside its own folder. A constant, never an argument. */
export const FILE = 'checklists'

/**
 * How long a project path may be before it stops being one.
 *
 * 4096 because that is Linux's `PATH_MAX` and the protocol package's own
 * `LIMITS.PATH`, which is the larger of the two numbers a host is likely to be
 * standing on. Taking the larger means this never refuses a path an operating
 * system was willing to hand out; a path too long for THIS platform is refused
 * by the platform, which is the thing that actually knows.
 */
const MAX_PROJECT = 4096

/**
 * How far up from a project this will look for a repository.
 *
 * A bound rather than an opinion about depth. `dirname('/')` is `/`, so the walk
 * below terminates on its own — this is here so that a path handed over the wire
 * cannot turn a loop into a hang if that ever stops being true somewhere.
 * Sixty-four is deeper than any real checkout and cheap to walk.
 */
const UPWARD = 64

/**
 * The one file, or a sentence about why there is not one.
 *
 * Three answers, and they are three because they mean three different things
 * that must not be collapsed onto one screen:
 *
 * - `{ path, trouble: null }` — here it is.
 * - `{ path: null, trouble: null }` — there is no project open. An ordinary
 *   state and not a fault: the page says so, no folder is made, nothing is
 *   written, and nothing pretends to have been read.
 * - `{ path: null, trouble }` — a project was named and this app will not work
 *   under it. The sentence is for a person and says what was refused and why.
 *
 * Reading creates nothing. `makeDir()` is what creates, and it is called on the
 * write path only, so opening a pane against a project never leaves a folder in
 * somebody's repository they did not ask for.
 */
export function dataFile(projectPath: string | null | undefined): { path: string | null; trouble: string | null } {
  const root = projectRoot(projectPath)
  if (root === null) return { path: null, trouble: null }
  if ('trouble' in root) return { path: null, trouble: root.trouble }

  /* Only what exists can be resolved, and only what exists can escape. A folder
     that is not there yet cannot be a symlink to somewhere else; it becomes one
     the moment it is created, which is why `makeDir` checks again after it.

     Both levels, outermost first, so that a `.kehikot` pointing out of the
     project is refused by its own name rather than being reported as a problem
     with the `checklist/` inside it. */
  for (const dir of [join(root.path, KEHIKOT_DIR), ours(root.path)]) {
    if (existsSync(dir)) {
      const escaped = escapes(root.path, dir)
      if (escaped) return { path: null, trouble: escaped }
    }
  }

  const path = moduleFile(root.path, ID, FILE)
  if (path !== null && existsSync(path)) {
    const escaped = escapes(root.path, path)
    if (escaped) return { path: null, trouble: escaped }
  }
  return { path, trouble: null }
}

/**
 * The old paper store, in this module's folder, read once and never written.
 *
 * `papers.json` was this app's second file back when a paper's list was a second
 * KIND of list. It is a backup now — `list/checklists.ts` reads it on open to
 * bring anything somebody typed into the one store — and it moves with the rest,
 * because a migration that went looking for it beside the program would find
 * nothing on every machine where the data now lives in the project.
 *
 * That this app keeps TWO files is a small piece of why the convention gives
 * every module a folder rather than a flat directory: under a flat one the
 * second would have needed a name saying whose it was, which is a folder spelled
 * badly. Here they are simply two files in `checklist/`.
 *
 * It inherits `dataFile`'s fence by construction — this asks for it only after
 * `dataFile` has resolved and proved the directory, and both names are constants
 * handed to the protocol package rather than anything from a caller.
 */
export function oldPapersFile(projectPath: string | null | undefined): string | null {
  const here = dataFile(projectPath)
  if (here.path === null) return null
  const root = projectRoot(projectPath)
  if (root === null || 'trouble' in root) return null
  return moduleFile(root.path, ID, 'papers')
}

/**
 * Make this module's folder, and tell the project's `.gitignore` about it —
 * once.
 *
 * Called before a write and never before a read, so that looking at a project
 * never changes it. A person who opens a checklist pane against a repository and
 * picks nothing should find that repository exactly as they left it.
 */
export function makeDir(projectPath: string | null | undefined): { dir: string | null; trouble: string | null } {
  const root = projectRoot(projectPath)
  if (root === null) return { dir: null, trouble: null }
  if ('trouble' in root) return { dir: null, trouble: root.trouble }

  const dir = ours(root.path)
  const fresh = !existsSync(dir)
  mkdirSync(dir, { recursive: true })
  /* After the mkdir as well as before it, and on the parent as well as on ours.
     `existsSync` said nothing was there and `mkdirSync` is perfectly happy to
     have followed a symlink somebody put there in between; the only honest
     moment to ask where a directory actually is, is once it is there. */
  for (const check of [join(root.path, KEHIKOT_DIR), dir]) {
    const escaped = escapes(root.path, check)
    if (escaped) return { dir: null, trouble: escaped }
  }

  /* Only on the run that created this module's folder. A project that has
     removed the ignore rule has said something, and a program that re-added it
     on every save would be overruling them every few seconds — in a file that
     shows up in their next diff under their name. */
  if (fresh) ignore(root.path)
  return { dir, trouble: null }
}

/**
 * Append the ignore rule to the project's `.gitignore`, if the project is in a
 * repository at all.
 *
 * The user asked for this in the same breath as the move, and gave the reason:
 *
 * > "By default kehikko should however be included in the project's .gitignore
 * > because we don't want to pollute other people with our work."
 *
 * ## Why it looks UPWARD for the repository, and still writes at the project
 *
 * The obvious rule — write it only when `<project>/.git` exists — is the one
 * that was here first, and a real project broke it. A thesis at
 * `…/CS-DEGREE/05_drafts/thesis_latex` has no `.git` of its own and sits inside
 * the CS-DEGREE repository, so under that rule its `.kehikot/` would have turned
 * up in somebody's `git status` with nothing ignoring it — which is exactly the
 * pollution the user asked not to cause, in the exact shape they asked about.
 *
 * So the search walks up. The WRITE stays at the project root, and that split is
 * deliberate: git honours a `.gitignore` in any directory, so a rule placed
 * beside the folder it is about does the job, and it does it without this app
 * editing a file several levels above the project it was pointed at. Somebody
 * who opens a checklist pane on one subdirectory has not invited a program to
 * touch the root of a repository that may hold thirty others.
 *
 * A project with no `.git` anywhere above it gets nothing at all. That is a
 * folder somebody keeps outside version control, which is a decision they made,
 * and an ignore file written into it would be answering a question nobody asked.
 *
 * The text and the idempotence are `withKehikotIgnored`'s, which is append-only
 * — it never reorders, never normalises, never touches a byte that was already
 * there. That is not tidiness. This runs against repositories the user owns,
 * where every change is attributed to them, and a program that rewrote their
 * ignore file would put changes they did not make into their next commit. It
 * also carries a comment saying what the folder is and that removing the rule is
 * how you share it, because a rule somebody cannot explain is a rule they
 * delete. The rule covers the whole of `.kehikot/` rather than this module's
 * folder inside it, so the next module to be added does not need a line of its
 * own in a file nobody would remember to update.
 *
 * Every failure here is swallowed on purpose. Not being able to write somebody's
 * `.gitignore` — a read-only checkout, a permission, a `.gitignore` that is
 * somehow a directory — is not a reason to refuse to save their checklists.
 */
function ignore(root: string): void {
  try {
    if (!inRepository(root)) return
    const path = join(root, '.gitignore')
    /* A project with no `.gitignore` of its own gets one holding only this,
       which is not editing somebody's file. */
    const before = existsSync(path) ? readFileSync(path, 'utf8') : ''
    const after = withKehikotIgnored(before)
    if (after !== before) writeFileSync(path, after)
  } catch {
    /* Deliberately silent. See above. */
  }
}

/** Is this folder inside a git repository — here, or anywhere above it? */
function inRepository(root: string): boolean {
  let at = root
  for (let up = 0; up < UPWARD; up += 1) {
    /* `existsSync` rather than a directory check: `.git` is a FILE in a worktree
       and in a submodule, and refusing to notice those would put this app's
       folder into somebody's `git status` in exactly the checkouts an agent is
       most likely to be working in. */
    if (existsSync(join(at, '.git'))) return true
    const above = dirname(at)
    if (above === at) return false
    at = above
  }
  return false
}

/**
 * This module's own folder under a project that has already been resolved.
 *
 * Never null in practice and typed as never null, because `moduleDir` answers
 * null only for an absent project and every caller here has one — `projectRoot`
 * returned a path. `moduleDir` throws rather than returning null for a bad
 * module id, which is the failure worth being loud about and cannot happen from
 * a constant.
 */
function ours(root: string): string {
  return moduleDir(root, ID) as string
}

/** The project, resolved — or null for "no project", or a sentence for a refusal. */
function projectRoot(projectPath: string | null | undefined): { path: string } | { trouble: string } | null {
  if (typeof projectPath !== 'string') return null
  const raw = projectPath.trim()
  if (!raw) return null
  if (raw.length > MAX_PROJECT) {
    return { trouble: 'that project path is longer than any path on this machine can be.' }
  }
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) {
      /* A control character reads back out of JSON perfectly well and then does
         something surprising in a terminal, in a log, and in a path. No real
         path has one. */
      return { trouble: 'that project path has a control character in it, and no real path does.' }
    }
  }
  if (!isAbsolute(raw)) {
    return {
      trouble:
        `"${raw}" is not an absolute path, so this app will not work under it. A project is somewhere on this `
        + 'machine, and a relative path would be resolved against whatever directory this program happens to have '
        + 'been started in — which is this app’s own folder, and is never where somebody’s checklists belong.',
    }
  }
  let resolved: string
  try {
    resolved = realpathSync(raw)
    if (!statSync(resolved).isDirectory()) {
      return { trouble: `"${raw}" is not a folder, so there is nowhere under it to keep anything.` }
    }
  } catch {
    return { trouble: `there is no folder at "${raw}" on this machine, so nothing can be read or written under it.` }
  }
  return { path: resolved }
}

/** The fence: a sentence if `child` is not really under `root`, null if it is. */
function escapes(root: string, child: string): string | null {
  let real: string
  try {
    real = realpathSync(child)
  } catch {
    return `${child} could not be resolved, so this app will not read or write through it.`
  }
  if (within(root, real)) return null
  return (
    `${child} resolves to ${real}, which is outside the project it claims to be inside. Nothing has been read or `
    + 'written: a folder that points somewhere else is how one project’s checklists end up in another project’s '
    + 'repository, and it is refused rather than followed.'
  )
}
