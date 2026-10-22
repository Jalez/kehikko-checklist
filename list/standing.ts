import { readTrackerRef } from 'kehikot-module-protocol'

import type { Entry, StoredRule } from './shapes.ts'
import type { Target } from './targets.ts'

/**
 * A checklist that applies to a TYPE of item and a ROLE on it, across the
 * project or one epic — and how an item comes to have it in front.
 *
 * ## What the person asked for
 *
 * > "The idea in the Checklist module is that you can create checklists
 * > specific to a type (issue, paper, MR, PR, task) + role (assignee,
 * > reviewer, etc.) combination across the project, while also being able to
 * > add instance-specific checklist items on top. I don't want to see a list of
 * > specific items to pick their checklist; it should always show the
 * > checklist(s) for an item we have picked, from the angle we want."
 *
 * So a list says what it applies to as a RULE: some types × some roles,
 * optionally narrowed to the refs one epic names. It is held once, on the list
 * in `lists.json` (`applies` in `list/shapes.ts`), and never fanned out: an
 * issue opened tomorrow is covered without anybody holding it. What is ticked
 * through a rule is filed under the item's own key (`ref:gh#105`,
 * `paper:thesis`), exactly as for a list held against that item by hand, so two
 * merge requests keep two sets of ticks and the angle never splits them.
 *
 * Jalez/kehikko-checklist#31's "every issue / every change" holds were the
 * first version of this. They are this rule with the role "any": every issue
 * is `issue × any`, every change is `merge request + pull request × any`, and
 * `migrateStanding` turns one into the other on read.
 *
 * ## The type is the tracker's to say
 *
 * `gh#41` is an issue or a pull request and its spelling does not say which.
 * The host's tracker reading does: a row's `kind`, and its `tracker` tells a
 * GitLab merge request from a GitHub pull request. A GitLab spelling says it
 * itself (`!7` is a merge request, `#12` an issue). Where neither has said, the
 * type is not known and the pane says so rather than guessing.
 *
 * **Tasks are not offered yet.** A GitLab task is a work item whose type the
 * host's tracker reading does not carry (protocol 2.10.0 has `kind: issue |
 * change` and nothing finer), so a task reads as an issue and a rule for tasks
 * could never be told apart from one for issues. `TASKS_KNOWN` says so: the
 * editor shows the type and says why it cannot be chosen, and the doors refuse
 * it, until the host reads a work item's type.
 *
 * ## The role is the person's angle, not a fact about the item
 *
 * Assignee, reviewer, author — or any role. The host works out the person's
 * roles on a row (`myRoles`, protocol 2.7.0); the angle defaults to those
 * (`angleRoles` with `auto`) and the person can choose one instead. A rule for
 * any role applies under every angle; a rule for reviewers applies when the
 * angle includes reviewer. Under "any role" — which is also what an unknown
 * role is read as — only the lists for any role apply, and the ones for a
 * particular role are counted as being there under another angle
 * (`elsewhere`), so the pane can offer that angle.
 *
 * Pure: the store reads it in `inFront`, the tick reads it to decide whether a
 * tick holds the ref, and `test/standing.test.ts` is a table.
 */

/** What a checklist can apply to. `task` is listed and not yet available: see `TASKS_KNOWN`. */
export const ITEM_TYPES = ['issue', 'mr', 'pr', 'paper', 'task'] as const
export type ItemType = (typeof ITEM_TYPES)[number]

/**
 * Whether the host's tracker reading says which issues are GitLab tasks. It
 * does not (protocol 2.10.0): a row's `kind` is `issue` or `change`. Until it
 * does, `task` is refused by the doors and shown unavailable on the edit page.
 */
export const TASKS_KNOWN = false

/** Why `task` cannot be chosen, in one sentence for a person or an agent. */
export const NO_TASKS =
  'Tasks cannot be chosen yet: the host’s tracker reading does not say which GitLab issues are tasks, so a list '
  + 'for tasks could not be told from one for issues.'

/** The types that can be chosen today. */
export const USABLE_TYPES: readonly ItemType[] = ITEM_TYPES.filter((type) => type !== 'task' || TASKS_KNOWN)

/** A role a checklist is for. `any` is every role at once: the list is for whoever is looking. */
export const ROLES = ['any', 'assignee', 'reviewer', 'author'] as const
export type Role = (typeof ROLES)[number]
export type PersonRole = Exclude<Role, 'any'>
/** The roles a person can have on an item: every role but `any`. */
export const PERSON_ROLES: readonly PersonRole[] = ['assignee', 'reviewer', 'author']

/**
 * The angle a person reads from: their own roles on each item (`auto`), one
 * role, or any role. The header's switch, and the filter it is remembered by.
 */
export const ANGLES = ['auto', 'assignee', 'reviewer', 'author', 'any'] as const
export type Angle = (typeof ANGLES)[number]

/** The words for each angle, as the header's switch says them. */
export const ANGLE_LABELS: Record<Angle, string> = {
  auto: 'My role (automatic)',
  assignee: 'As assignee',
  reviewer: 'As reviewer',
  author: 'As author',
  any: 'Any role',
}

/** An angle out of whatever a host or a caller sent: anything that is not one is `auto`. */
export function angleOf(value: unknown): Angle {
  return typeof value === 'string' && (ANGLES as readonly string[]).includes(value) ? (value as Angle) : 'auto'
}

/** A rule a list applies by: some types, some roles, and the epic whose refs it is narrowed to, if any. */
export interface Rule {
  types: ItemType[]
  roles: Role[]
  epic: string | null
}

/* ------------------------------------------------------------------ *
 * Names
 * ------------------------------------------------------------------ */

const TYPE_ONE: Record<ItemType, string> = {
  issue: 'issue',
  mr: 'merge request',
  pr: 'pull request',
  paper: 'paper',
  task: 'task',
}
const TYPE_MANY: Record<ItemType, string> = {
  issue: 'issues',
  mr: 'merge requests',
  pr: 'pull requests',
  paper: 'papers',
  task: 'tasks',
}

/** What one type is called: "merge request". */
export function typeName(type: ItemType): string {
  return TYPE_ONE[type]
}

/** What the types of a rule are called together: "issues and merge requests". */
export function typesName(types: readonly ItemType[]): string {
  return andList(ITEM_TYPES.filter((type) => types.includes(type)).map((type) => TYPE_MANY[type]))
}

/** "as reviewer", "as author or reviewer", "any role". */
export function rolesPhrase(roles: readonly Role[]): string {
  if (!roles.length || roles.includes('any')) return 'any role'
  return `as ${orList(PERSON_ROLES.filter((role) => roles.includes(role)))}`
}

/** What a rule is called on a row: "issues · as reviewer", "merge requests and pull requests of thesis · any role". */
export function ruleName(rule: Rule): string {
  return `${typesName(rule.types)}${rule.epic ? ` of ${rule.epic}` : ''} · ${rolesPhrase(rule.roles)}`
}

/**
 * The line over one item: "As reviewer on !123", "Any role on gh#105",
 * "As assignee and reviewer on !7".
 */
export function angleLine(as: readonly Role[], item: string): string {
  if (!as.length || as.includes('any')) return `Any role on ${item}`
  return `As ${andList(PERSON_ROLES.filter((role) => as.includes(role)))} on ${item}`
}

/* ------------------------------------------------------------------ *
 * Rules, as stored
 * ------------------------------------------------------------------ */

/**
 * A stored rule, read leniently: types and roles this version does not know
 * are left out, `task` among them while it cannot be told apart, and a rule
 * left with no type applies to nothing. No role is `any`.
 */
export function ruleOf(stored: { types?: readonly string[]; roles?: readonly string[]; epic?: string | null }): Rule | null {
  const types = USABLE_TYPES.filter((type) => stored.types?.includes(type))
  if (!types.length) return null
  return { types, roles: normalRoles(stored.roles ?? []), epic: stored.epic || null }
}

/** Every rule a list applies by. */
export function rulesOf(list: { applies?: readonly StoredRule[] }): Rule[] {
  return (list.applies ?? []).flatMap((one) => ruleOf(one) ?? [])
}

/** Roles in their one order, with `any` alone when it is there or nothing else is. */
export function normalRoles(roles: readonly string[]): Role[] {
  if (roles.includes('any')) return ['any']
  const named = PERSON_ROLES.filter((role) => roles.includes(role))
  return named.length ? named : ['any']
}

/** Whether two rules say the same thing. */
export function sameRule(a: Rule, b: Rule): boolean {
  return a.epic === b.epic && a.types.join() === b.types.join() && a.roles.join() === b.roles.join()
}

/** A rule as the target it is named by on a door. */
export function ruleTarget(rule: Rule): Extract<Target, { kind: 'rule' }> {
  return { kind: 'rule', types: [...rule.types], roles: [...rule.roles], epic: rule.epic }
}

/**
 * Jalez/kehikko-checklist#31's standing holds, as the rules they are: every
 * issue is `issue × any`, every change is `merge request + pull request × any`,
 * each keeping its epic and when it was made.
 */
export function migrateStanding(standing: readonly { of: string; epic?: string; since: string }[]): StoredRule[] {
  return standing.flatMap((hold) => {
    const types = hold.of === 'issue' ? ['issue'] : hold.of === 'change' ? ['mr', 'pr'] : []
    return types.length ? [{ types, roles: ['any'], ...(hold.epic ? { epic: hold.epic } : {}), since: hold.since }] : []
  })
}

/* ------------------------------------------------------------------ *
 * What the tracker said, and the angle
 * ------------------------------------------------------------------ */

/** What the host's tracker reading said about the refs in front, as the page hands it to the server. */
export interface RefsRead {
  /** The type of each ref the reading had a row for: its kind, and for a change, its tracker. */
  types: Readonly<Record<string, ItemType>>
  /**
   * The person's roles on each ref, from the row's `myRoles`. A ref that is
   * not a key here has no roles known — the host does not know who the person
   * is there — which is not the same as an empty list (known: none).
   */
  roles: Readonly<Record<string, readonly Role[]>>
  /**
   * For each epic whose refs were read: those of the refs in front that the
   * epic names. An epic that is not a key here was not read, and is unknown.
   */
  epics: Readonly<Record<string, readonly string[]>>
}

/** Nothing read: what the MCP door and an unhosted page have. */
export const NOTHING_READ: RefsRead = { types: {}, roles: {}, epics: {} }

/** A tracker row's type: an issue, or a change on GitLab (merge request) or GitHub (pull request). */
export function typeOfRow(row: { kind: 'issue' | 'change'; tracker: string }): ItemType {
  if (row.kind === 'issue') return 'issue'
  return row.tracker === 'gitlab' ? 'mr' : 'pr'
}

/** The host's `myRoles` as the roles a list is for: either reviewer role is reviewer. Null when absent (unknown). */
export function rolesFromMine(mine: readonly string[] | undefined | null): PersonRole[] | null {
  if (!mine) return null
  const roles = new Set<PersonRole>()
  for (const one of mine) {
    if (one === 'reviewer-asked' || one === 'reviewer-done' || one === 'reviewer') roles.add('reviewer')
    if (one === 'assignee') roles.add('assignee')
    if (one === 'author') roles.add('author')
  }
  return PERSON_ROLES.filter((role) => roles.has(role))
}

/**
 * The roles an item is read as, from an angle: one chosen role, any role, or
 * — `auto` — the person's own roles on it, and any role when there are none or
 * they are not known.
 */
export function angleRoles(angle: Angle, mine: readonly Role[] | null | undefined): Role[] {
  if (angle !== 'auto') return [angle]
  const own = PERSON_ROLES.filter((role) => (mine ?? []).includes(role))
  return own.length ? own : ['any']
}

/** The types a ref may be: the tracker reading's, else what its spelling says, else every type a ref can be. */
export function possibleTypes(ref: string, read: RefsRead): ItemType[] {
  const said = Object.hasOwn(read.types, ref) ? read.types[ref] : undefined
  if (said) return [said]
  const spelled = readTrackerRef(ref)
  if (spelled?.tracker === 'gitlab') return [spelled.kind === 'change' ? 'mr' : 'issue']
  if (spelled?.tracker === 'github') return ['issue', 'pr']
  return ['issue', 'mr', 'pr']
}

/** A ref's type when it is known, else null. */
export function typeOf(ref: string, read: RefsRead): ItemType | null {
  const types = possibleTypes(ref, read)
  return types.length === 1 ? (types[0] as ItemType) : null
}

/* ------------------------------------------------------------------ *
 * Matching
 * ------------------------------------------------------------------ */

/**
 * The roles through which one rule applies to an item of `type` read as `as`,
 * or null when it does not: `['any']` for a rule for any role, else those of
 * the angle's roles the rule names. Its epic is decided apart.
 */
export function through(rule: Rule, type: ItemType, as: readonly Role[]): Role[] | null {
  if (!rule.types.includes(type)) return null
  if (rule.roles.includes('any')) return ['any']
  const met = PERSON_ROLES.filter((role) => rule.roles.includes(role) && as.includes(role))
  return met.length ? met : null
}

/** Whether a rule's epic is the ref's: yes with no epic, else as the epic's reading says, unknown when unread. */
export function inEpic(rule: Rule, ref: string, read: RefsRead): 'yes' | 'no' | 'unknown' {
  if (!rule.epic) return 'yes'
  const named = Object.hasOwn(read.epics, rule.epic) ? read.epics[rule.epic] : undefined
  if (!named) return 'unknown'
  return named.includes(ref) ? 'yes' : 'no'
}

/** Why a rule could not be decided for a ref: its type, or which epic it belongs to. */
export type Undecided = 'kind' | 'epic'

export type Covered =
  | { answer: 'yes'; rules: Rule[]; roles: Role[] }
  | { answer: 'no' }
  | { answer: 'unknown'; why: Undecided }

function asType(rules: readonly Rule[], type: ItemType, ref: string, read: RefsRead, as: readonly Role[]): Covered {
  const hit: Rule[] = []
  const roles = new Set<Role>()
  let unknown = false
  for (const rule of rules) {
    const met = through(rule, type, as)
    if (!met) continue
    const epic = inEpic(rule, ref, read)
    if (epic === 'unknown') unknown = true
    if (epic !== 'yes') continue
    hit.push(rule)
    for (const role of met) roles.add(role)
  }
  if (hit.length) return { answer: 'yes', rules: hit, roles: ROLES.filter((role) => roles.has(role)) }
  return unknown ? { answer: 'unknown', why: 'epic' } : { answer: 'no' }
}

/**
 * Whether a list's rules put it in front of `ref` read as `as`, through which
 * rules and roles. `unknown` says what is missing: the ref's type, or whether
 * an epic names it.
 */
export function covers(rules: readonly Rule[], ref: string, read: RefsRead, as: readonly Role[]): Covered {
  if (!rules.length) return { answer: 'no' }
  const each = possibleTypes(ref, read).map((type) => asType(rules, type, ref, read, as))
  if (each.length === 1) return each[0] as Covered
  if (each.every((one) => one.answer === 'yes')) {
    const yes = each as Extract<Covered, { answer: 'yes' }>[]
    const roles = new Set(yes.flatMap((one) => one.roles))
    return { answer: 'yes', rules: [...new Set(yes.flatMap((one) => one.rules))], roles: ROLES.filter((role) => roles.has(role)) }
  }
  if (each.every((one) => one.answer === 'no')) return { answer: 'no' }
  return { answer: 'unknown', why: 'kind' }
}

/** Whether a list's rules put it in front of an epic's paper read as `as`, through which rules and roles. */
export function coversPaper(rules: readonly Rule[], epic: string, as: readonly Role[]): Extract<Covered, { answer: 'yes' }> | null {
  const hit: Rule[] = []
  const roles = new Set<Role>()
  for (const rule of rules) {
    if (rule.epic && rule.epic !== epic) continue
    const met = through(rule, 'paper', as)
    if (!met) continue
    hit.push(rule)
    for (const role of met) roles.add(role)
  }
  return hit.length ? { answer: 'yes', rules: hit, roles: ROLES.filter((role) => roles.has(role)) } : null
}

/**
 * The roles outside the angle under which a list's rules WOULD apply to an
 * item of a known type: what the pane offers as other angles. A rule for any
 * role is never elsewhere — it applies already.
 */
export function elsewhere(rules: readonly Rule[], type: ItemType | null, as: readonly Role[], epicOk: (rule: Rule) => boolean): PersonRole[] {
  if (!type) return []
  const out = new Set<PersonRole>()
  for (const rule of rules) {
    if (!rule.types.includes(type) || rule.roles.includes('any') || !epicOk(rule)) continue
    for (const role of PERSON_ROLES) if (rule.roles.includes(role) && !as.includes(role)) out.add(role)
  }
  return PERSON_ROLES.filter((role) => out.has(role))
}

/**
 * Whether a tick on a target may be one a rule covers, under any angle: then
 * the tick does not hold the target, because the list is in front of it
 * already (or will be once the tracker says what it is), and a hold by hand
 * would keep it in front after the rule is gone. This store has no tracker
 * reading, so a ref whose spelling does not say its type is given the benefit
 * of the doubt.
 */
export function mayCover(rules: readonly Rule[], target: Target): boolean {
  if (!rules.length) return false
  if (target.kind === 'ref') {
    const types = possibleTypes(target.ref, NOTHING_READ)
    return rules.some((rule) => rule.types.some((type) => types.includes(type)))
  }
  if (target.kind === 'paper' && !target.section) {
    return rules.some((rule) => rule.types.includes('paper') && (!rule.epic || rule.epic === target.epic))
  }
  return false
}

/**
 * Whether an entry is ticks on an item, held by nobody and released by
 * nobody: what a tick through a rule leaves (`apply` in `list/checklists.ts`).
 */
export function tickedUnheld(key: string, entry: Entry): boolean {
  return (
    (key.startsWith('ref:') || (key.startsWith('paper:') && !key.includes('/')))
    && entry.since === undefined
    && entry.released === undefined
    && Boolean(entry.ticks && Object.keys(entry.ticks).length)
  )
}

/**
 * Whether a list's entry is in use through its rules: ticks on an item it
 * applies to. Storage counts it as held and Purge never takes it as released;
 * removing the last rule marks it released.
 */
export function throughStanding(list: { applies?: readonly StoredRule[] }, key: string, entry: Entry): boolean {
  return Boolean(list.applies?.length) && tickedUnheld(key, entry)
}

/** A ref the page could not decide a rule for, with the lists that would have been in front. */
export interface UndecidedRef {
  ref: string
  why: Undecided
  /** The names of the lists, once each. */
  lists: string[]
}

/**
 * The line for refs a rule could not be decided for: said on the pane,
 * because a list that may apply and is not drawn has to have a reason.
 */
export function undecidedLine(rows: readonly UndecidedRef[]): string | null {
  if (!rows.length) return null
  const refs = rows.map((row) => row.ref)
  const lists = [...new Set(rows.flatMap((row) => row.lists))].map((name) => `“${name}”`)
  const several = refs.length > 1
  const kind = rows.some((row) => row.why === 'kind')
  const what = kind
    ? `what kind of item ${andList(refs)} ${several ? 'are' : 'is'}`
    : `which epic ${andList(refs)} ${several ? 'belong' : 'belongs'} to`
  return (
    `The tracker has not said ${what}, so ${andList(lists)} ${lists.length > 1 ? 'are' : 'is'} not shown for `
    + `${several ? 'them' : 'it'} until it does.`
  )
}

/** The sentence for an item nothing applies to, from the angle it is read at. */
export function nothingLine(item: string, as: readonly Role[]): string {
  return `No checklist applies to ${item} ${rolesPhrase(as) === 'any role' ? 'for any role' : rolesPhrase(as)}.`
}

/** The sentence for a pane with nothing picked. */
export const NOTHING_PICKED = 'Pick an issue, MR, PR or paper to see its checklists.'

/** A rule as a door spells it back: `issue+mr × any of thesis`. */
export function spellRule(rule: Rule): string {
  return `${rule.types.join('+')} × ${rule.roles.join('+')}${rule.epic ? ` of ${rule.epic}` : ''}`
}

export function andList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  const all = [...names]
  const last = all.pop()
  return `${all.join(', ')} and ${last}`
}

function orList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  const all = [...names]
  const last = all.pop()
  return `${all.join(', ')} or ${last}`
}
