import type { ItemType, Role } from './standing.ts'

/**
 * Starter checklists the person can adopt with one press: a standing checklist
 * for a kind of item, with lines most projects expect, to keep, reword or drop.
 *
 * Never made by themselves and never by an agent. A list the person did not
 * choose is the "shipped list" this module took out on purpose (`list/shapes.ts`
 * says why): a starter is only words on the manager until somebody presses
 * Adopt, and after that it is their list like any other — its `origin` says
 * which starter it came from, so the same one is not adopted twice.
 */
export interface Starter {
  /** Its handle: what the press names and what `origin` keeps, as `starter:<id>`. */
  id: string
  name: string
  /** One line for the person deciding whether to adopt it. */
  summary: string
  types: ItemType[]
  roles: Role[]
  items: string[]
}

export const STARTERS: readonly Starter[] = [
  {
    id: 'changes',
    name: 'Pull and merge request standards',
    summary: 'What every pull or merge request owes before it is merged.',
    types: ['pr', 'mr'],
    roles: ['any'],
    items: [
      'Tests cover the change: added or updated, and passing.',
      'No secrets, keys, tokens or credentials in the diff or its history.',
      'Follows the patterns, naming and structure the code around it already uses.',
      'The description says why, not only what, and links the issue it closes.',
      'Nothing unrelated is mixed in: one change, reviewable on its own.',
      'Docs, notes or comments are updated where behaviour changed.',
    ],
  },
  {
    id: 'issues',
    name: 'Issue standards',
    summary: 'What an issue says before anybody starts on it.',
    types: ['issue'],
    roles: ['any'],
    items: [
      'Says what is wrong or wanted, and for whom.',
      'Has acceptance criteria somebody else could check.',
      'Is one piece of work, not several.',
      'Links the issues and changes it depends on or relates to.',
    ],
  },
  {
    id: 'papers',
    name: 'Paper standards',
    summary: 'What every chapter of a paper owes before it is sent on.',
    types: ['paper'],
    roles: ['any'],
    items: [
      'Every claim that is not common knowledge is cited.',
      'Every figure and table is referred to in the text.',
      'Terms are defined where they are first used.',
      'It compiles without warnings or unresolved references.',
    ],
  },
]

/** The starter a handle names, or undefined. */
export const starterNamed = (id: string): Starter | undefined => STARTERS.find((one) => one.id === id)

/** What a list made from a starter keeps as its `origin`. */
export const starterOrigin = (id: string): string => `starter:${id}`
