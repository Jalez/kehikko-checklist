import { LIMITS, type FooterItemInput } from 'kehikot-module-protocol'

import type { Progress } from '../../list/glance.ts'

/**
 * This page's footer, as the host draws it (`kehikot.footer`, protocol 2.38.0): what is going on
 * now, at a glance — by the rule the person decided, the footer is the live state and the header is
 * how the module is set up.
 *
 * On the reading page: which item the checklists concern, its progress (a meter: answered of all),
 * how many lines failed or are blocked, and which are being worked on. A container folded to two
 * rows shows exactly this. On the manager: how many standing and one-off checklists there are. On
 * both, what went wrong. Nothing here is pressable: Manage, Storage and Copy are the header's.
 *
 * Declared only when the host says it draws a footer (`drawsFooter === true`); with any other host
 * the page draws its own bottom row exactly as before. Pure, so what is declared is what is tested.
 */

export interface FooterState {
  /** The screen on show; the edit page counts as the one it was opened from, and has no footer of its own. */
  view: 'here' | 'all' | 'edit' | 'storage'
  /** The last thing that went wrong, said in words, or null. */
  trouble: string | null
  /** Whether this screen shows the trouble in a bar of its own (the manager, composed as an overlay, shows it in the bar; flowing, it is inline in the form). */
  troubleInBar: boolean
  /**
   * The reading page: the item the lists in front concern ("Pull request gh#105 · Fix login"), and
   * how many more items are picked besides it. Null with nothing picked.
   */
  concerns?: { said: string; more: number } | null
  /** Over every line in front: answered, failed, blocked, working. */
  progress?: Progress | null
  /** The lines being worked on, latest first. */
  working?: readonly string[]
  /** The manager: how many standing checklists and one-off lists there are. */
  standing?: { standards: number; oneOff: number } | null
  /** The reading page's word about lists put aside for another module's work, or null. */
  aside?: string | null
}

const clip = (text: string, most: number) => {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length <= most ? one : `${one.slice(0, most - 1)}…`
}

/** The footer's items for a state; `[]` when the screen has no bar. */
export function footerItems(state: FooterState): FooterItemInput[] {
  const items: FooterItemInput[] = []
  const { view } = state
  if (view !== 'here' && view !== 'all') return items
  if (state.trouble && (view === 'here' || state.troubleInBar)) {
    items.push({ kind: 'text', id: 'trouble', text: clip(state.trouble, LIMITS.FOOTER_TEXT), level: 'critical', tooltip: clip(state.trouble, LIMITS.FOOTER_TOOLTIP) })
  }
  if (view === 'all') {
    const counts = state.standing
    if (counts) {
      items.push({
        kind: 'text',
        id: 'standing',
        text: `${counts.standards} standing · ${counts.oneOff} one-off`,
        tooltip: 'Standing checklists apply to every item of a kind; one-off lists are held against particular items.',
      })
    }
    return items
  }
  const concerns = state.concerns
  if (!concerns) {
    items.push({ kind: 'text', id: 'concerns', text: 'Nothing picked', tooltip: 'Pick an issue, MR, PR or paper to see its checklists.' })
    return items
  }
  const target = `${concerns.said}${concerns.more ? ` +${concerns.more}` : ''}`
  items.push({
    kind: 'text',
    id: 'concerns',
    text: clip(target, LIMITS.FOOTER_TEXT),
    tooltip: clip(
      `${concerns.said}${concerns.more ? `, and ${concerns.more} more item${concerns.more === 1 ? '' : 's'} picked` : ''}.${state.aside ? ` ${state.aside}` : ''}`,
      LIMITS.FOOTER_TOOLTIP,
    ),
  })
  const progress = state.progress
  if (progress && progress.total) {
    items.push({
      kind: 'meter',
      id: 'progress',
      label: 'Progress',
      value: progress.answered / progress.total,
      text: clip(`${progress.answered}/${progress.total}`, LIMITS.FOOTER_METER_TEXT),
      level: progress.failed ? 'critical' : progress.blocked ? 'warn' : 'normal',
      align: 'center',
      tooltip: clip(`${progress.answered} of ${progress.total} lines answered (${progress.passed} passed, ${progress.na} not applicable).`, LIMITS.FOOTER_TOOLTIP),
    })
    if (progress.failed || progress.blocked) {
      const said = [progress.failed ? `${progress.failed} failed` : '', progress.blocked ? `${progress.blocked} blocked` : ''].filter(Boolean).join(' · ')
      items.push({ kind: 'text', id: 'failing', text: said, level: progress.failed ? 'critical' : 'warn', align: 'end' })
    }
    const working = state.working ?? []
    if (working.length) {
      items.push({
        kind: 'text',
        id: 'working',
        text: clip(`Working: ${working[0]}${working.length > 1 ? ` +${working.length - 1}` : ''}`, LIMITS.FOOTER_TEXT),
        align: 'end',
        optional: true,
        tooltip: clip(`Being worked on: ${working.map((one) => `“${one}”`).join(', ')}`, LIMITS.FOOTER_TOOLTIP),
      })
    }
  }
  return items
}

/** A press in the footer: nothing here is pressable, so every one is answered in words. */
export function footerPressed(item: string): string {
  return `“${item.slice(0, 40)}” is a readout. Manage, Storage, Copy and New are in the header.`
}
