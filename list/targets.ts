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
  return null
}

/**
 * A target built from whatever a door was handed, or null.
 *
 * One function for the page and the MCP door both, so the two cannot end up
 * accepting different spellings of the same thing — the split this module keeps
 * everywhere is that a door bounds and a store decides, and target identity is
 * the store's business even though both doors need it.
 */
export function readTarget(input: { ref?: unknown; epic?: unknown; section?: unknown }): Target | null {
  const ref = part(input.ref)
  if (ref) return { kind: 'ref', ref }
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
  return target.section ? `${target.epic} · ${target.section}` : `${target.epic} (the paper)`
}

/** The word for what KIND of thing it is, printed beside the name. */
export function targetNoun(target: Target): string {
  if (target.kind === 'ref') return 'issue, merge request or pull request'
  return target.section ? 'a section of a paper' : 'a paper'
}
