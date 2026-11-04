import { ITEM_TYPES, USABLE_TYPES, rulesOf, typeName, typesName, type ItemType } from './standing.ts'

/**
 * ONE standing checklist per type of item.
 *
 * ## What the person asked for
 *
 * > "In a project, or inside that kehikko, users should select a single checklist for each item
 * > type, so every item of the same type gets the same checklist. Checklist by default is meant to be
 * > generic, overarching guidelines to make sure all features are accounted for."
 *
 * So a project keeps, for each type of item (merge request, pull request, issue, task, paper), the
 * id of the ONE standing checklist every item of that type is read against: `choices` in
 * `lists.json`. A kehikko may override it for itself, in the host's per-container kept state (the
 * page's `useKept`, never this store). There is no stacking: two standing checklists for merge
 * requests is one chosen and one unassigned, and the role an item is read from no longer decides
 * which standard is in front (`applies` keeps its roles for back-compat, read by nobody here).
 *
 * - **Choosing is the person's.** On the page — the header's Checklist menu, or the item's own
 *   "Use …" press. Never through the MCP door (`CHOOSING_IS_THE_PERSONS`).
 * - **No choice, no list.** A type nobody chose for has no standard in front; the item says
 *   "Pick a checklist for merge requests" and offers the starter. Nothing is assigned by itself.
 * - **Making one for a type is choosing it when none is.** A standard the person makes or adopts
 *   for a type that has no choice yet becomes its choice (`claimFree`): a person who presses "New
 *   checklist for merge requests" has said which one merge requests use.
 * - **Existing data** (`migrateChoices`): a project whose `lists.json` has no `choices` yet takes,
 *   for each type, the standard that applied to it; where several did, the one most recently used,
 *   and the rest are unassigned standards. Once, and written.
 *
 * Pure: `list/checklists.ts` has the store.
 */

/** Which list each type of item uses: a list id per type, absent when none is chosen. */
export type Choices = Partial<Record<ItemType, string>>

/** The choices as `lists.json` or the kept state carried them, read leniently: unknown types and non-strings dropped. */
export function choicesOf(raw: unknown): Choices {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const out: Choices = {}
  for (const type of ITEM_TYPES) {
    const id = (raw as Record<string, unknown>)[type]
    if (typeof id === 'string' && id.trim()) out[type] = id.trim().slice(0, 64)
  }
  return out
}

/** The kehikko's choices over the project's: a type the kehikko chose for uses that, every other the project's. */
export function effective(project: Choices, kehikko: Choices | null | undefined): Choices {
  return { ...project, ...(kehikko ?? {}) }
}

/** The list a type uses, among the lists there are; null when none is chosen or the chosen one is gone. */
export function chosenFor(choices: Choices, type: ItemType, lists: Readonly<Record<string, unknown>>): string | null {
  const id = choices[type]
  return id && Object.hasOwn(lists, id) ? id : null
}

/**
 * The one list an item whose type may be one of `types` uses: the choice when every possible type
 * agrees, `none` when none of them has one, `unknown` when they differ (the tracker has not said
 * what the item is, and the answer depends on it).
 */
export function chosenForAny(
  choices: Choices,
  types: readonly ItemType[],
  lists: Readonly<Record<string, unknown>>,
): { answer: 'one'; id: string; type: ItemType } | { answer: 'none' } | { answer: 'unknown'; ids: string[] } {
  const each = types.map((type) => ({ type, id: chosenFor(choices, type, lists) }))
  const ids = [...new Set(each.map((one) => one.id))]
  if (ids.length === 1) {
    const id = ids[0]
    return id ? { answer: 'one', id, type: each[0]!.type } : { answer: 'none' }
  }
  return { answer: 'unknown', ids: ids.filter((one): one is string => one !== null) }
}

/** Whether a list may be a type's choice: a list a person named (not one item's own lines). */
export function choosable(list: { only?: string }): boolean {
  return !list.only
}

/** The types a list was made for (its rules' types), which is what the picker offers it under first. */
export function madeFor(list: { applies?: readonly { types?: readonly string[]; roles?: readonly string[]; epic?: string; since: string }[] }): ItemType[] {
  const types = new Set(rulesOf(list as Parameters<typeof rulesOf>[0]).flatMap((rule) => rule.types))
  return USABLE_TYPES.filter((type) => types.has(type))
}

/** Every type a list is the choice for. */
export function typesChoosing(choices: Choices, id: string): ItemType[] {
  return USABLE_TYPES.filter((type) => choices[type] === id)
}

/**
 * Migration: for each type, the standard to keep as its choice out of the lists that applied to it,
 * by when each was last used (`usedAt`, an ISO time, or ''), latest first; ties by name. A list with
 * no rules for a type, or one item's own lines, is never chosen.
 */
export function migrateChoices(
  lists: readonly { id: string; name: string; only?: string; applies?: readonly { types?: readonly string[]; since: string }[] }[],
  usedAt: (id: string) => string,
): Choices {
  const out: Choices = {}
  for (const type of USABLE_TYPES) {
    const candidates = lists.filter((list) => choosable(list) && madeFor(list as never).includes(type))
    if (!candidates.length) continue
    candidates.sort((a, b) => {
      const at = usedAt(b.id).localeCompare(usedAt(a.id))
      return at || a.name.localeCompare(b.name)
    })
    out[type] = candidates[0]!.id
  }
  return out
}

/** What an agent is told when it would choose a type's checklist: it is the person's, on the page. */
export function choosingIsThePersons(type: ItemType): string {
  return (
    `Which checklist every ${typeName(type)} uses is the person's choice, made on the Checklist page `
    + `(the header's Checklist menu: "Checklist for ${typesName([type])}"). Tell them which one fits. Nothing was changed.`
  )
}

/** The line for a type nobody chose for: what the item says, and the way to choose. */
export function noChoiceLine(type: ItemType): string {
  return `No checklist is chosen for ${typesName([type])}. Pick a checklist for ${typesName([type])} in the header’s Checklist menu.`
}

/** The header label of one type's picker. */
export function pickerLabel(type: ItemType): string {
  return `Checklist for ${typesName([type])}`
}

/** What a picker option that is a starter, not yet a list, is called. */
export function starterLabel(name: string): string {
  return `Starter: ${name}`
}

/**
 * The sentence for a migration that left standards unassigned — said in the help, once, not on
 * every item: where several standing checklists applied to one type, the most recently used was
 * kept and the others are unassigned.
 */
export const MIGRATED =
  'Where several standing checklists applied to one type before, the one most recently used was kept as that type’s '
  + 'checklist; the others are listed under Manage checklists as unassigned standards, to choose or remove.'
