/**
 * What a checklist is held AGAINST, and how this app writes that down.
 *
 * ## The one idea this file exists for
 *
 * A checklist is a list of things somebody wrote. A **target** is the thing that
 * has to satisfy them. Ticks belong to the pair, not to either half: the same
 * list held against `gh#105` and against `gh#106` keeps two independent sets of
 * ticks, because those are two pieces of work and finishing one says nothing
 * about the other.
 *
 * That is the whole of what the derived, ref-scoped machinery this module used
 * to carry was actually giving anybody. It is kept. What is gone is the part
 * that decided, in code, WHICH items a target owes — see the essay in
 * `list/checklists.ts`.
 *
 * ## Two kinds, because the user named two
 *
 * > "each issue or mr or a paper page for instance needs to fulfil a specific
 * > list of requirements"
 *
 * So a target is either a **tracker reference** — an issue, a merge request, a
 * pull request, spelled the way every other module in this workspace spells one
 * (`gh#105`, `!44`, `#12`) — or a **place in a paper**, which is a document an
 * epic is aimed at.
 *
 * A third kind is deliberately not offered. "Anything you like, as a string"
 * would make this app unable to say what it is showing, unable to offer a
 * sensible list of candidates, and unable to tell a typo from a new target.
 * The third kind that did arrive later is not that: it is one module's
 * container on one kehikko, named by two ids the protocol spells, and the
 * argument for it is on `Target` below (Jalez/kehikko-checklist#27).
 *
 * ## What a paper target actually IS, which is the hard half
 *
 * A paper has no stable notion of a "page". `kehikko-paper` reads `.tex`,
 * renders it, and a page number is an artefact of that rendering: add a
 * paragraph to chapter two and everything after it is on a different page.
 * Keying ticks on a page number would mean a paragraph somebody typed silently
 * re-pointed every tick in the document at different prose. That is the failure
 * this file exists to refuse.
 *
 * A heading is barely better. Headings are reworded constantly — rewording is
 * half of what writing a paper IS — and a tick keyed to the words of a heading
 * is a tick that disappears the first time somebody sharpens it.
 *
 * So a paper target is **the epic plus a section id**, where the section id is a
 * name somebody chose to be stable: a `\label{}`, the stem of a chapter file,
 * the id an outline already uses. This file stores the name it is given and has
 * no opinion about where it came from.
 *
 * ## One sentence here used to be broader than it is now
 *
 * It read: *"This app does not read the paper, does not invent the id, and does
 * not check that it exists."* Two of those three are still true and the middle
 * one is not. This app now **does** open a `.tex` file — through its own fence,
 * with its own small scanner, because the reader's container has to follow them
 * between the files and sections of a paper (`file/sections.ts`, `list/scope.ts`)
 * — and where the reader is standing inside one, it **derives** the id rather
 * than waiting to be handed one.
 *
 * What has not changed is the shape of the id or who it belongs to. The
 * derivation prefers the author's own `\label{}` over anything this program
 * could invent, falls back to the file's path when there is no heading above the
 * reader, and refuses to narrow at all rather than mint an id it would have to
 * truncate. It is not a page number and it is not a byte range, which is what
 * every paragraph below is about. And it is still never CHECKED: nothing here
 * asks whether a stored id still names a section, because a target with ticks on
 * it is a record of work done and not a claim about today's document.
 *
 * The other half of that old sentence — that this app must not become a second,
 * worse copy of `kehikko-paper` — is exactly why the scanner is forty lines that
 * find headings and nothing else, and why the alternative (asking the paper
 * module) was refused rather than taken. The argument is at the top of
 * `file/sections.ts`.
 *
 * **What breaks, said plainly, because a scheme that is honest about its failure
 * is worth more than one that pretends not to have one:**
 *
 * - **The section is renamed or deleted.** The ticks stay under the old id and
 *   nothing points at them any more. They are not lost and they are not wrong;
 *   they are a record of work done against a section that no longer has that
 *   name. The page lists every target a checklist has ticks against, so they
 *   remain findable rather than becoming invisible rows in a file.
 * - **The section id is REUSED for different prose.** This is the bad one, and
 *   it is bad in the way this file cannot fix: the ticks now describe text
 *   nobody ticked. Nothing here can detect it, because nothing here reads the
 *   paper. What this app does instead is refuse to make it likelier — it never
 *   generates a section id, never falls back to a positional one, and every tick
 *   records who made it and when, so the dates are the evidence when somebody
 *   asks.
 * - **The section is omitted entirely.** Then the target is the whole paper for
 *   that epic, which is a perfectly good thing to hold a list against and is the
 *   default the page offers when a canvas is on an epic. It is a DIFFERENT
 *   target from any section inside it, deliberately: "the paper owes an abstract"
 *   and "section 3 owes a citation" are not the same claim.
 *
 * The alternative that was considered and rejected: hashing the section's text,
 * so a rename keeps the ticks and an edit drops them. It fails the other way
 * round — every ordinary edit to a section, which is the thing writing a paper
 * consists of, would silently drop every tick on it, and a checklist that empties
 * itself when you work on the document is a checklist nobody will use twice.
 */

import { KEHIKKO_KEY, MODULE_ID } from 'kehikot-module-protocol'

import { migrateStanding, normalRoles, ruleName, ruleOf, ITEM_TYPES, NO_TASKS, ROLES, USABLE_TYPES, type ItemType, type Role } from './standing.ts'

/** As long as the protocol's own epic slug bound, and as long as a ref may be. */
export const MAX_TARGET_PART = 80

/**
 * A target, as the rest of this app passes it around.
 *
 * A discriminated union rather than a string, everywhere above the store, so
 * that a function taking a target cannot be handed a ref where a paper was meant
 * — the storage key below is a string and strings are interchangeable.
 */
export type Target =
  | { kind: 'ref'; ref: string }
  | { kind: 'paper'; epic: string; section: string | null }
  /**
   * One module's container on one kehikko, whichever epic is open
   * (Jalez/kehikko-checklist#27).
   *
   * ## The third kind, and why it is not "anything you like"
   *
   * Some lists are about how a module's work is RUN, in every epic: "what an
   * epic's issue flows owe before somebody reads the epic's state from them"
   * is owed wherever the Flows container is, on the Journey kehikko, whichever
   * epic that kehikko is showing. Neither kind above can say so. A ref is one
   * piece of work and a paper is one epic's, so such a list had to be held
   * against every epic's paper by hand, again for every new epic, and an epic
   * with no paper could not be given it at all.
   *
   * The owner said what the scope is: *"the pair (kehikko, module), not a ref,
   * not one epic's paper, and not 'every epic' in general. A Flows container
   * on some other kind of kehikko would not get the list."* So the target is
   * that pair. The kehikko is its `key` — the protocol's identity for one
   * canvas, which outlives a rename and the host's database (`kehikkoSchema`)
   * — and never its row number or its name. The module is its id, as the
   * host spells it in `context.containers`.
   *
   * A kehikko in the host is a layout and the epic is the project's: switching
   * epic does not switch the kehikko. That is exactly why the pair follows the
   * open epic without anything here having to.
   *
   * ## Held against the pair, ticked against one epic
   *
   * `epic` is null on the HOLD: the list is held against the container,
   * whichever epic is open. It is set on the INSTANCE a reader sees and an
   * agent ticks: the ticks for epic A's run say nothing about epic B's, for the
   * reason the ticks against `gh#105` say nothing about `gh#106`. Holding or
   * releasing one epic's run is holding or releasing the pair (`heldAs`), so
   * there is one hold per pair however many epics have been run through it.
   */
  | { kind: 'kehikko'; kehikko: string; module: string; epic: string | null }
  /**
   * A RULE: every item of some types, read from some roles, across the project
   * or the refs one epic names (`list/standing.ts`). Jalez/kehikko-checklist#31
   * began this as "every issue / every change", which is this with any role.
   *
   * ## A standing hold, and why it is not a ref
   *
   * An issue checklist is meant for every issue and a review checklist for
   * every merge request a person reviews. Held one ref at a time, coverage was
   * only as complete as whoever last went through the tracker, and every new
   * issue started uncovered.
   *
   * So this is held once and never fanned out: it lives on the list in
   * `lists.json` (`applies` in `list/shapes.ts`), and an item is in front with
   * the list when its type and the angle it is read from match. It is NEVER
   * what a tick is filed under. The ticks on `gh#105` are filed under
   * `ref:gh#105` exactly as a held ref's are, so `gh#105` and `gh#106` keep two
   * sets, and removing the rule keeps them, as releasing any target does.
   */
  | { kind: 'rule'; types: ItemType[]; roles: Role[]; epic: string | null }

/**
 * One component of a target key, bounded rather than matched against a grammar
 * this app does not own.
 *
 * A host spells epic slugs; a tracker spells refs; somebody's `.tex` spells
 * labels. A positive grammar here — `[a-z0-9-]+` — would refuse a perfectly good
 * name the day any of those three widened, and the refusal would look like a bug
 * in this container. So what is refused is the shapes that are not names at all:
 * empty, over the bound, or carrying whitespace, a path separator or a control
 * character.
 *
 * The path separator is not fussiness. `/` is the delimiter the key below is
 * built with, so a component containing one could shape a key rather than
 * naming something in it — `paper:mine/../ref:gh#1` would otherwise be a
 * spelling of somebody else's target.
 */
export function part(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (!name || name.length > MAX_TARGET_PART) return null
  if (/[\s/\\]/.test(name)) return null
  /* Control characters by code point rather than as a regex literal, so no
     literal control byte ends up in this file for an editor to lose. */
  for (let i = 0; i < name.length; i += 1) {
    const code = name.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return null
  }
  return name
}

/**
 * The string a target is filed under.
 *
 * Prefixed with the kind, so `ref:gh#105` and a paper that happened to be called
 * `gh#105` are two different rows rather than one. Delimited with `/`, which is
 * the one character `part()` refuses inside every component — which is what makes
 * the encoding unambiguous rather than merely unlikely to collide.
 */
export function targetKey(target: Target): string {
  if (target.kind === 'ref') return `ref:${target.ref}`
  if (target.kind === 'rule') return `rule:${target.types.join('+')}/${target.roles.join('+')}${target.epic ? `/${target.epic}` : ''}`
  if (target.kind === 'kehikko') {
    return `kehikko:${target.kehikko}/${target.module}${target.epic ? `/${target.epic}` : ''}`
  }
  return target.section ? `paper:${target.epic}/${target.section}` : `paper:${target.epic}`
}

/**
 * The target a key names, or null when the string is not one this app wrote.
 *
 * Every caller has to handle null: the keys live in a JSON file somebody can
 * edit, and a key this version cannot read is an ordinary thing to find rather
 * than a reason to fail to draw a page.
 */
export function readKey(key: string): Target | null {
  if (key.startsWith('ref:')) {
    const ref = part(key.slice(4))
    return ref ? { kind: 'ref', ref } : null
  }
  if (key.startsWith('paper:')) {
    const rest = key.slice(6)
    const cut = rest.indexOf('/')
    const epic = part(cut === -1 ? rest : rest.slice(0, cut))
    if (!epic) return null
    if (cut === -1) return { kind: 'paper', epic, section: null }
    const section = part(rest.slice(cut + 1))
    return section ? { kind: 'paper', epic, section } : null
  }
  if (key.startsWith('rule:')) {
    const [types, roles, epic, extra] = key.slice(5).split('/')
    if (extra !== undefined || !types || !roles) return null
    const rule = ruleOf({ types: types.split('+'), roles: roles.split('+') })
    if (!rule) return null
    if (epic === undefined) return { kind: 'rule', ...rule, epic: null }
    const named = part(epic)
    return named ? { kind: 'rule', ...rule, epic: named } : null
  }
  /* Jalez/kehikko-checklist#31's spelling, read as the rule it became. */
  if (key.startsWith('every:')) {
    const [of, epic, extra] = key.slice(6).split('/')
    if (extra !== undefined || (of !== 'issue' && of !== 'change')) return null
    const named = epic === undefined ? null : part(epic)
    if (epic !== undefined && !named) return null
    const [stored] = migrateStanding([{ of, since: '' }])
    return { kind: 'rule', ...(ruleOf(stored!) as { types: ItemType[]; roles: Role[] }), epic: named }
  }
  if (key.startsWith('kehikko:')) {
    const [kehikko, module, epic, extra] = key.slice(8).split('/')
    if (extra !== undefined) return null
    const target = readKehikko({ kehikko, module, epic: epic ?? null })
    /* `kehikko:k/m/` is not a spelling this app writes, and an empty epic is not read as none. */
    return target && (epic === undefined || target.epic !== null) ? target : null
  }
  return null
}

/**
 * The kehikko-and-module target a door was handed, or null.
 *
 * Held to the protocol's own patterns for a kehikko key and a module id
 * rather than to `part()` alone: both are names somebody else spells, and
 * both have one spelling on the wire, so a string that is not that spelling
 * names no container this list could ever be in front of.
 */
function readKehikko(input: { kehikko?: unknown; module?: unknown; epic?: unknown }): Extract<Target, { kind: 'kehikko' }> | null {
  const kehikko = part(input.kehikko)
  const module = part(input.module)
  if (!kehikko || !KEHIKKO_KEY.test(kehikko) || !module || !MODULE_ID.test(module)) return null
  const given = input.epic !== undefined && input.epic !== null && input.epic !== ''
  const epic = given ? part(input.epic) : null
  if (given && !epic) return null
  return { kind: 'kehikko', kehikko, module, epic }
}

/**
 * What holding or releasing a target holds or releases.
 *
 * Itself, except one epic's run of a kehikko's container, which is held as the
 * container: a list is held against the pair whichever epic is open, and a
 * hold made while reading epic A must not be a hold that only epic A sees.
 */
export function heldAs(target: Target): Target {
  return target.kind === 'kehikko' && target.epic ? { ...target, epic: null } : target
}

/**
 * A target built from whatever a door was handed, or null.
 *
 * One function for the page and the MCP door both, so the two cannot end up
 * accepting different spellings of the same thing — the split this module keeps
 * everywhere is that a door bounds and a store decides, and target identity is
 * the store's business even though both doors need it.
 */
export function readTarget(input: {
  ref?: unknown
  epic?: unknown
  section?: unknown
  kehikko?: unknown
  module?: unknown
  every?: unknown
  types?: unknown
  roles?: unknown
}): Target | null {
  const ref = part(input.ref)
  if (ref) return { kind: 'ref', ref }
  /* Some types of item × some roles — or Jalez/kehikko-checklist#31's `every`,
     which is that with any role — the epic beside it narrowing to the refs that
     epic names. Refused whole when it names no type it can use, rather than
     falling through to the epic's paper: somebody who named types did not mean
     a paper. */
  if (given(input.types) || given(input.every)) {
    const rule = ruleNamed(input)
    if (!rule) return null
    const epicGiven = given(input.epic)
    const epic = epicGiven ? part(input.epic) : null
    if (epicGiven && !epic) return null
    return { kind: 'rule', ...rule, epic }
  }
  /* A kehikko named is a container named, and the epic beside it is then the
     run being ticked rather than a paper: refused whole when the pair is not
     one, rather than falling through to a paper nobody asked about. */
  if (input.kehikko !== undefined && input.kehikko !== null && input.kehikko !== '') {
    return readKehikko(input)
  }
  const epic = part(input.epic)
  if (!epic) return null
  const section = input.section === undefined || input.section === null || input.section === '' ? null : part(input.section)
  /* A section that was given and is not a name is refused rather than dropped.
     Silently ticking the whole paper because somebody's section id had a space in
     it would file work against the wrong target and say nothing. */
  if (input.section !== undefined && input.section !== null && input.section !== '' && !section) return null
  return { kind: 'paper', epic, section }
}

/** What a target is called on a row, in this app's own words. */
export function targetName(target: Target): string {
  if (target.kind === 'ref') return target.ref
  if (target.kind === 'rule') return ruleName(target)
  if (target.kind === 'kehikko') {
    const where = `${target.module} on kehikko ${target.kehikko}`
    return target.epic ? `${where} · ${target.epic}` : `${where}, whichever epic is open`
  }
  return target.section ? `${target.epic} · ${target.section}` : `${target.epic} (the paper)`
}

/**
 * The words for what KIND of thing it is, article and all.
 *
 * ## The article belongs here, and it is not a style choice
 *
 * This used to hand back two of its three branches WITH their article — `a
 * paper`, `a section of a paper` — and the third without one, while both callers
 * wrote `A {targetNoun(target)}` in front of whatever came back. On screen that
 * read "A a section of a paper", which is what the owner saw and reported. The
 * obvious repair — strip the article from the two that carry one — breaks the
 * third instead, because that one takes *an*, and a caller writing one fixed
 * word in front of a phrase it cannot see is guessing.
 *
 * English picks the article from the sound the noun starts with, so only the
 * thing that knows the noun can pick it, and that is here. Every branch carries
 * its own, no caller prepends one, and a fourth kind of target added later
 * cannot quietly inherit the wrong word from a call site nobody re-read.
 *
 * This is the phrase for a SENTENCE — "held against an issue, merge request or
 * pull request" — and not a label for a row. A row prints `targetName`, which is
 * the thing's own name and never takes an article at all.
 */
export function targetNoun(target: Target): string {
  if (target.kind === 'ref') return 'an issue, merge request or pull request'
  if (target.kind === 'rule') {
    return target.epic ? 'every item of some types in one epic, from some roles' : 'every item of some types, from some roles'
  }
  if (target.kind === 'kehikko') {
    return target.epic
      ? 'a module’s container on one kehikko, for the epic open there'
      : 'a module’s container on one kehikko, whichever epic is open'
  }
  return target.section ? 'a section of a paper' : 'a paper'
}

/** Whether a door was handed something, rather than nothing, null or an empty string. */
function given(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0)
}

/** A list of words, as an array or one string with commas or pluses between them. */
function words(value: unknown): string[] | null {
  if (typeof value === 'string') return value.split(/[,+\s]+/).filter(Boolean)
  if (Array.isArray(value) && value.every((one) => typeof one === 'string')) return value as string[]
  return null
}

/**
 * The types and roles a door was handed, or null when they are not ones this
 * app can use. `every: "issue" | "change"` is Jalez/kehikko-checklist#31's
 * spelling and reads as the rule it became; `types` wins when both are given.
 */
function ruleNamed(input: { types?: unknown; roles?: unknown; every?: unknown }): { types: ItemType[]; roles: Role[] } | null {
  let types: string[] | null
  if (given(input.types)) {
    types = words(input.types)
  } else {
    const [stored] = migrateStanding([{ of: String(input.every), since: '' }])
    types = stored ? stored.types : null
  }
  if (!types || !types.length || types.some((type) => !(ITEM_TYPES as readonly string[]).includes(type))) return null
  if (types.some((type) => !USABLE_TYPES.includes(type as ItemType))) return null
  const roles = given(input.roles) ? words(input.roles) : ['any']
  if (!roles || roles.some((role) => !(ROLES as readonly string[]).includes(role))) return null
  return { types: USABLE_TYPES.filter((type) => types.includes(type)), roles: normalRoles(roles) }
}

/** Why a set of types or roles a door was handed is not one: for the refusal. */
export function ruleRefusal(input: { types?: unknown; roles?: unknown }): string {
  const types = words(input.types) ?? []
  if (types.includes('task') && !USABLE_TYPES.includes('task')) return NO_TASKS
  return (
    `types is one or more of ${USABLE_TYPES.join(', ')} (mr is a merge request, pr a pull request), and roles one or more `
    + `of ${ROLES.join(', ')} — any is every role at once.`
  )
}
