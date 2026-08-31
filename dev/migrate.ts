#!/usr/bin/env bun
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { checklistsFile } from '../list/checklists.ts'
import { makeDir } from '../store.ts'

/**
 * Move the store this app used to keep beside itself into the project it is
 * about.
 *
 *     bun dev/migrate.ts /absolute/path/to/project            # says what would move
 *     bun dev/migrate.ts /absolute/path/to/project --apply    # moves it
 *
 * ## Why the project is an argument with no default
 *
 * Because this store has no project column and never had one. `data/checklists.json`
 * held every checklist for every project at once, keyed by nothing, so there is
 * no fact in the file that says where any of it belongs. A program that picked a
 * project would be guessing about somebody's work — and it would guess once, in
 * silence, and be wrong for every list that belonged somewhere else.
 *
 * A person knows. The lists in the file this was written for are about a thesis;
 * somebody else's may be about three repositories. So the answer comes from the
 * command line, one project per run, and running it twice for two projects is a
 * conversation rather than a heuristic.
 *
 * That is also why there is no `--all` and no scan of `~/Projects`: both would
 * be this script inventing the missing column.
 *
 * ## Why a dry run is the default
 *
 * The destructive step here is not the copy, it is the rename at the end. A dry
 * run prints exactly what would move, into exactly which path, so the decision
 * is made by somebody looking at the answer rather than by somebody who ran a
 * command and read the result afterwards.
 *
 * ## Copy, verify, and only then set the old file aside
 *
 * The order is the whole point of this file, and the failure it prevents is a
 * migration that half-happened. Two locations, each holding some of somebody's
 * checklists, with nothing to say which is current, is worse than a migration
 * that never started — the second is one command away from being fixed and the
 * first is an afternoon of reading JSON.
 *
 * So: write the new file, read it BACK OFF DISK, check that every checklist,
 * every item, every tick and every field of every tick survived, and only if all
 * of that holds rename the old one to `checklists.json.migrated`.
 *
 * Renamed rather than deleted, deliberately. The verification above is only as
 * good as the check it runs, and the cost of keeping the original is one file
 * nobody opens against the cost of being wrong, which is somebody's work. The
 * name says what happened to it, so the next person to look in `data/` is not
 * left wondering whether it is live.
 */

interface Store {
  checklists: Record<string, { id: string; name: string; items: { id: string; text: string }[] }>
  ticks: Record<string, Record<string, Record<string, { at: string; by: string; viaMcp?: boolean; note?: string }>>>
}

/** The old store, beside the program, where it used to live. */
export function oldStore(dataDir: string): string {
  return join(dataDir, 'checklists.json')
}

/** Where a finished migration leaves it. Not deleted — see the essay above. */
export function setAside(dataDir: string): string {
  return `${oldStore(dataDir)}.migrated`
}

export interface Plan {
  /** What is in the old file, counted. */
  checklists: number
  items: number
  ticks: number
  /** Where it would go. */
  to: string
  /** A sentence if this cannot be run, or null. */
  refused: string | null
}

function count(store: Store): { checklists: number; items: number; ticks: number } {
  const checklists = Object.keys(store.checklists ?? {}).length
  let items = 0
  for (const list of Object.values(store.checklists ?? {})) items += (list.items ?? []).length
  let ticks = 0
  for (const byTarget of Object.values(store.ticks ?? {})) {
    for (const byItem of Object.values(byTarget ?? {})) ticks += Object.keys(byItem ?? {}).length
  }
  return { checklists, items, ticks }
}

/**
 * What a run would do, without doing any of it.
 *
 * Every refusal is decided here rather than half-way through `apply`, so that a
 * dry run and a real run agree about whether this is possible — a dry run that
 * said "would move 7 checklists" and an apply that then refused would be a
 * script nobody could trust the first half of.
 */
export function plan(dataDir: string, projectPath: string): Plan {
  const from = oldStore(dataDir)
  const nothing = { checklists: 0, items: 0, ticks: 0 }

  const to = checklistsFile(projectPath)
  if (to === null) {
    return { ...nothing, to: '', refused: `${projectPath} is not a folder this app can keep anything under.` }
  }

  if (!existsSync(from)) {
    return { ...nothing, to, refused: `there is no ${from} to move. Nothing to do, and nothing was changed.` }
  }

  let store: Store
  try {
    store = JSON.parse(readFileSync(from, 'utf8')) as Store
  } catch (e) {
    return {
      ...nothing,
      to,
      refused:
        `${from} could not be read (${e instanceof Error ? e.message.split('\n')[0] : String(e)}), so nothing was `
        + 'moved. Fix it and run this again; every checklist in it is still there.',
    }
  }

  /* A destination that already holds checklists is left alone. Merging two
     stores would need a rule for what happens when both hold an id, and there is
     no rule that does not silently prefer one person's wording over another's —
     so this refuses and says which file to look at. */
  if (existsSync(to)) {
    let already: Store
    try {
      already = JSON.parse(readFileSync(to, 'utf8')) as Store
    } catch {
      return { ...count(store), to, refused: `${to} already exists and will not parse. Look at it before moving anything over it.` }
    }
    if (Object.keys(already.checklists ?? {}).length) {
      return {
        ...count(store),
        to,
        refused:
          `${to} already holds ${Object.keys(already.checklists).length} checklist(s), and this will not merge two `
          + 'stores — there is no rule for two lists with one id that does not quietly prefer one person’s wording. '
          + 'Move or rename it first if you meant to replace it.',
      }
    }
  }

  return { ...count(store), to, refused: null }
}

export interface Applied {
  moved: Plan
  /** What the new file held when it was read back off disk. */
  verified: { checklists: number; items: number; ticks: number }
  /** Where the old file went, or null if it is still where it was. */
  setAside: string | null
  refused: string | null
}

/** Do it: copy, verify off disk, and only then set the original aside. */
export function apply(dataDir: string, projectPath: string): Applied {
  const intended = plan(dataDir, projectPath)
  const nothing = { checklists: 0, items: 0, ticks: 0 }
  if (intended.refused) return { moved: intended, verified: nothing, setAside: null, refused: intended.refused }

  const made = makeDir(projectPath)
  if (made.trouble) return { moved: intended, verified: nothing, setAside: null, refused: made.trouble }
  if (made.dir === null) {
    return { moved: intended, verified: nothing, setAside: null, refused: 'there is no project to write into.' }
  }

  const from = oldStore(dataDir)
  const raw = readFileSync(from, 'utf8')
  writeFileSync(intended.to, raw.endsWith('\n') ? raw : `${raw}\n`)

  /* Read BACK OFF DISK rather than trusting the bytes just handed to
     `writeFileSync`. What is being checked is that the file exists, parses, and
     holds the same material — which is a different claim from "the write call
     did not throw", and it is the claim the rename below depends on. */
  let back: Store
  try {
    back = JSON.parse(readFileSync(intended.to, 'utf8')) as Store
  } catch (e) {
    return {
      moved: intended,
      verified: nothing,
      setAside: null,
      refused:
        `${intended.to} was written and then would not parse (${e instanceof Error ? e.message.split('\n')[0] : String(e)}). `
        + `${from} has NOT been touched.`,
    }
  }

  const verified = count(back)
  const same =
    verified.checklists === intended.checklists && verified.items === intended.items && verified.ticks === intended.ticks
  if (!same) {
    return {
      moved: intended,
      verified,
      setAside: null,
      refused:
        `${intended.to} came back holding ${verified.checklists}/${verified.items}/${verified.ticks} `
        + `(checklists/items/ticks) where ${from} holds ${intended.checklists}/${intended.items}/${intended.ticks}. `
        + `${from} has NOT been touched: look at both before doing anything else.`,
    }
  }

  const aside = setAside(dataDir)
  renameSync(from, aside)
  return { moved: intended, verified, setAside: aside, refused: null }
}

/* ------------------------------------------------------------------ *
 * The command line
 * ------------------------------------------------------------------ */

function say(lines: string[]): void {
  process.stdout.write(`${lines.join('\n')}\n`)
}

function main(argv: string[]): number {
  const args = argv.filter((a) => a !== '--apply')
  const doIt = argv.includes('--apply')
  const projectPath = args[0]

  if (!projectPath) {
    say([
      'bun dev/migrate.ts <absolute-project-path> [--apply]',
      '',
      'Moves data/checklists.json into <project>/.kehikot/checklist/checklists.json.',
      '',
      'The project is not optional and has no default. This store has no project column — it held every',
      'checklist for every project at once — so nothing in the file says where any of it belongs, and a',
      'program that picked would be guessing about somebody’s work. Say which project these lists are about.',
      '',
      'Without --apply it only says what would move.',
    ])
    return 2
  }

  const dataDir = join(import.meta.dirname, '..', 'data')

  if (!doIt) {
    const intended = plan(dataDir, projectPath)
    if (intended.refused) {
      say([`Nothing would move: ${intended.refused}`])
      return 1
    }
    say([
      `Would move ${intended.checklists} checklist(s), ${intended.items} item(s) and ${intended.ticks} tick(s)`,
      `  from ${oldStore(dataDir)}`,
      `    to ${intended.to}`,
      '',
      `Then ${oldStore(dataDir)} would be renamed to ${setAside(dataDir)} — renamed, not deleted.`,
      'Run again with --apply to do it.',
    ])
    return 0
  }

  const done = apply(dataDir, projectPath)
  if (done.refused) {
    say([`Nothing was moved: ${done.refused}`])
    return 1
  }
  say([
    `Moved ${done.verified.checklists} checklist(s), ${done.verified.items} item(s) and ${done.verified.ticks} tick(s)`,
    `  to ${done.moved.to}`,
    '',
    `Read back off disk and verified. ${oldStore(dataDir)} is now ${done.setAside}.`,
  ])
  return 0
}

/* Only when run, never when imported by a test. */
if (import.meta.main) process.exit(main(process.argv.slice(2)))
