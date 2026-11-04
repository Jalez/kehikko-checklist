import { LIMITS, type FooterItemInput } from 'kehikot-module-protocol'

import { countRows } from '../../list/shapes.ts'

/**
 * This page's footer, as the host draws it (`kehikot.footer`, protocol 2.38.0): what is going on
 * now, as readouts. What went wrong, and how far the lists in front have got.
 *
 * The rule the rows follow: the header is how the module is set up (which screen, which angle,
 * starting a copy), the footer is what is going on now. So the footer has no buttons of its own:
 * "Manage checklists" and "Storage" are the header's View switch, and "Copy from another project"
 * is the header's Run item. Folded to two rows, a container shows its header and this footer, so
 * the count is what a person reads there.
 *
 * Declared only when the host says it draws a footer (`drawsFooter === true`); with any other host
 * the page draws its own rows exactly as before. The page owns every bit of state: the host draws
 * the latest list. Pure, so what is declared is what is tested.
 *
 * The edit page and the storage page keep their own rows: those are part of what they edit, not a
 * status line. The edit page names the list open on it, the one thing a person glances for there.
 */

export interface Tally {
  /** How many checklists are drawn. */
  lists: number
  /** Items ticked passed, failed and not applicable, over every list drawn, and how many there are. */
  passed: number
  failed: number
  na: number
  total: number
}

/** The tally of the lists drawn: every row of every instance, counted the way each list's own count is. */
export function tallyOf(instances: readonly { rows: { done: { state?: 'passed' | 'failed' | 'na' } | null }[]; total: number }[]): Tally {
  const tally: Tally = { lists: instances.length, passed: 0, failed: 0, na: 0, total: 0 }
  for (const one of instances) {
    const counts = countRows(one.rows)
    tally.passed += counts.passed
    tally.failed += counts.failed
    tally.na += counts.na
    tally.total += one.total
  }
  return tally
}

export interface FooterState {
  /** The screen on show; the import screen counts as `edit`. */
  view: 'here' | 'all' | 'edit' | 'storage'
  /** The last thing that went wrong, said in words, or null. */
  trouble: string | null
  /** The reading page: the lists drawn, and how far they have got. Null before the first answer. */
  tally: Tally | null
  /** The manager: how many checklists the project has, or null before they are read. */
  lists: number | null
  /** The edit page: the name of the list open on it, or null. */
  editing: string | null
  /** The reading page's sentence about lists put aside, or null. */
  aside: string | null
  /** Whether this screen shows the trouble in a bar of its own (the manager, composed as an overlay, shows it in the bar; flowing, it is inline in the form). */
  troubleInBar: boolean
}

const clip = (text: string, most: number) => {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length <= most ? one : `${one.slice(0, most - 1)}…`
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** What the reading page's count says: lists, then passed of all, then failed and not applicable. */
export function tallySaid(tally: Tally): string {
  const parts = [plural(tally.lists, 'checklist')]
  if (tally.total > 0) parts.push(`${tally.passed}/${tally.total} passed`)
  if (tally.failed) parts.push(`${tally.failed} failed`)
  if (tally.na) parts.push(`${tally.na} n/a`)
  return parts.join(' · ')
}

/** The footer's items for a state; `[]` when the screen has no row. */
export function footerItems(state: FooterState): FooterItemInput[] {
  const items: FooterItemInput[] = []
  const { view } = state
  if (view === 'storage') return items
  if (state.trouble && view !== 'edit' && (view === 'here' || state.troubleInBar)) {
    items.push({ kind: 'text', id: 'trouble', text: clip(state.trouble, LIMITS.FOOTER_TEXT), level: 'critical', tooltip: clip(state.trouble, LIMITS.FOOTER_TOOLTIP) })
  }
  if (view === 'here' && state.tally) {
    const said = tallySaid(state.tally)
    const { passed, failed, na, total } = state.tally
    const finished = total > 0 && passed + na === total && failed === 0
    items.push({
      kind: 'text',
      id: 'count',
      text: clip(finished ? `${said} · done` : said, LIMITS.FOOTER_TEXT),
      level: failed ? 'warn' : 'normal',
      align: 'end',
      tooltip: clip(state.aside ? `${said}. ${state.aside}` : `${said}.`, LIMITS.FOOTER_TOOLTIP),
    })
  } else if (view === 'all' && state.lists !== null) {
    items.push({ kind: 'text', id: 'count', text: `${plural(state.lists, 'checklist')} in this project`, align: 'end' })
  } else if (view === 'edit' && state.editing) {
    items.push({
      kind: 'text',
      id: 'editing',
      text: clip(`Editing ${state.editing}`, LIMITS.FOOTER_TEXT),
      tooltip: clip(`Editing the checklist ${state.editing}.`, LIMITS.FOOTER_TOOLTIP),
    })
  }
  return items
}
