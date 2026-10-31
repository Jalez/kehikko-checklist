import { LIMITS, type FooterItemInput } from 'kehikot-module-protocol'

/**
 * This page's footer, as the host draws it (`kehikot.footer`, protocol 2.38.0): the bottom rows the
 * page drew itself — what went wrong, and the few buttons that end each screen — as items.
 *
 * Declared only when the host says it draws a footer (`drawsFooter === true`); with any other host
 * the page draws its own rows exactly as before. The page owns every bit of state: the host draws
 * the latest list and reports a press. Pure, so what is declared is what is tested.
 *
 * Two screens end in a bar: the reading page ("Manage checklists") and the manager (copying a list
 * in from another project, and Storage). The edit page and the storage page keep their own rows:
 * those are part of what they edit, not a status line.
 */

/** The ids of what can be pressed in the footer. */
export const FOOT = {
  MANAGE: 'manage',
  IMPORT: 'import',
  STORAGE: 'storage',
} as const

export interface FooterState {
  /** The screen on show; the edit page counts as the one it was opened from, and has no footer of its own. */
  view: 'here' | 'all' | 'edit' | 'storage'
  /** The last thing that went wrong, said in words, or null. */
  trouble: string | null
  busy: boolean
  /** The manager: the person is being asked which project, or the other project is being read. */
  importing: boolean
  /** The manager can open Storage. */
  canStorage: boolean
  /** The reading page's hint on "Manage checklists" about lists put aside, or null. */
  aside: string | null
  /** Whether this screen shows the trouble in a bar of its own (the manager, composed as an overlay, shows it in the bar; flowing, it is inline in the form). */
  troubleInBar: boolean
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
  if (view === 'here') {
    items.push({
      kind: 'run',
      id: FOOT.MANAGE,
      label: 'Manage checklists',
      align: 'end',
      ...(state.aside ? { tooltip: clip(state.aside, LIMITS.FOOTER_TOOLTIP) } : {}),
    })
  } else {
    items.push({
      kind: 'run',
      id: FOOT.IMPORT,
      label: state.importing ? 'Choosing…' : 'Copy from another project',
      align: 'start',
      tooltip: 'Copy a checklist from another project.',
      disabled: state.importing ? 'Choosing a project already.' : state.busy ? 'Working on something else.' : null,
    })
    if (state.canStorage) {
      items.push({ kind: 'run', id: FOOT.STORAGE, label: 'Storage', align: 'end', optional: true, tooltip: 'What the checklists take up on disk, and purging old ones.' })
    }
  }
  return items
}

/** What a press in the footer asks for, or a sentence saying why not. */
export type FooterPress = 'manage' | 'import' | 'storage'

export function footerPressed(item: string, state: FooterState): FooterPress | string {
  if (item === FOOT.MANAGE) return state.view === 'here' ? 'manage' : 'That is not here now.'
  if (item === FOOT.IMPORT) {
    if (state.view !== 'all') return 'That is not here now.'
    if (state.importing) return 'Choosing a project already.'
    if (state.busy) return 'Working on something else.'
    return 'import'
  }
  if (item === FOOT.STORAGE) return state.view === 'all' && state.canStorage ? 'storage' : 'That is not here now.'
  return 'That is not something here.'
}
