import type { FilterGroup, HeaderItemInput } from 'kehikot-module-protocol'

import { ANGLE_LABELS, ANGLES, USABLE_TYPES, type Angle, type ItemType } from '../../list/standing.ts'
import { pickerLabel, starterLabel } from '../../list/choices.ts'

/**
 * This page's header, as the host draws it (`kehikot.header`): the View
 * switch, which checklist, the angle the picked items are read from, and the
 * Create menu.
 *
 * `storage` is the option id a host looks for to open a module's own storage
 * view (the host's Storage overview presses a `switch` or `go` option with
 * exactly that id), so it is spelled exactly that and is a test.
 *
 * Not marked for agents: an agent reads storage with the `storage` tool at
 * this module's MCP door, and purging is a person's on this page. A switch
 * cannot name that tool, because the same switch also opens the reading page
 * and the list of every checklist. The angle is not an agent's either: an
 * agent reads from an angle by saying `role` to `checklists`.
 */
export const VIEWS = [
  { id: 'here', label: 'In front' },
  { id: 'all', label: 'Manage checklists' },
  { id: 'storage', label: 'Storage' },
] as const
export type HeaderView = (typeof VIEWS)[number]['id']

/** The ids of the header's Create menu, and of the switch that picks one checklist. */
export const MAKE = { NEW: 'new', COPY: 'copy', ADOPT: 'adopt:' } as const
export const PICK = 'list'
/** The option of the checklist switch that shows every list in front. */
export const EVERY = 'all'

/** The ids of the per-type pickers: `choose:<type>`, and the toggle that keeps the choices for this kehikko only. */
export const CHOOSE = { PREFIX: 'choose:', NONE: 'none', STARTER: 'starter:', HERE: 'choose-here' } as const

/** What the per-type pickers offer: the project's standards, the starters, and what each type uses now. */
export interface ChoiceOffer {
  /** Every list a type may use (a standard, or any list a person named), with the types it was made for. */
  lists: readonly { id: string; name: string; madeFor: readonly ItemType[] }[]
  /** The starters, with the types each is for and whether it is adopted already. */
  starters: readonly { id: string; name: string; types: readonly ItemType[]; adopted: boolean }[]
  /** What each type uses where this container is: the kehikko's choice over the project's. */
  chosen: Partial<Record<ItemType, string>>
  /** Whether this kehikko keeps choices of its own. */
  here: boolean
}

/** What the header needs beyond the view and the angle: the lists in front to pick from, and the starters. */
export interface HeaderMore {
  /** The ONE checklist per type: the pickers in the Checklist menu. Absent: none drawn. */
  choices?: ChoiceOffer
  /** The lists in front on the reading page, in order, to pick one from. Empty elsewhere. */
  lists?: readonly { id: string; name: string }[]
  /** The list picked, or null for every list. */
  picked?: string | null
  /** The starters, and which are adopted already. */
  starters?: readonly { id: string; name: string; adopted: boolean }[]
  /** True while the person is being asked which project to copy from. */
  importing?: boolean
  busy?: boolean
}

const label = (text: string) => (text.length <= 48 ? text : `${text.slice(0, 47)}…`)

/**
 * The header, by the rule the person decided: how the module is set up. Which
 * screen (the reading page, managing checklists, storage), which checklist of
 * the ones in front, the angle, and the Create menu — a new checklist, a copy
 * from another project, a starter adopted with one press. What is going on now
 * — the item, its progress, what failed, what is being worked on — is the
 * footer's (`src/wire/footer.ts`), never both.
 */
export function headerFor(view: HeaderView, angle: Angle = 'auto', more: HeaderMore = {}): HeaderItemInput[] {
  const items: HeaderItemInput[] = [
    {
      kind: 'switch',
      id: 'view',
      label: 'View',
      group: 'Page',
      options: VIEWS.map((one) => ({ id: one.id, label: one.label })),
      value: view,
      agents: false,
    },
  ]
  /* Which checklist: offered on the reading page when more than one is in front. */
  const lists = view === 'here' ? (more.lists ?? []).slice(0, 63) : []
  if (lists.length > 1) {
    const picked = more.picked && lists.some((one) => one.id === more.picked) ? more.picked : EVERY
    items.push({
      kind: 'switch',
      id: PICK,
      label: 'Checklist',
      group: 'Checklist',
      options: [{ id: EVERY, label: 'Every checklist in front' }, ...lists.map((one) => ({ id: one.id, label: label(one.name) }))],
      value: picked,
      agents: false,
    })
  }
  void angle
  /*
   * ONE checklist per type of item (`list/choices.ts`): "Checklist for merge requests: <name>",
   * offering the project's lists (those made for the type first) and the starters for it. Choosing is
   * the person's: not for agents. Then whether this kehikko keeps choices of its own.
   */
  const offer = more.choices
  if (offer) {
    for (const type of USABLE_TYPES) {
      const mine = [...offer.lists].sort((a, b) => Number(b.madeFor.includes(type)) - Number(a.madeFor.includes(type)) || a.name.localeCompare(b.name))
      const starters = offer.starters.filter((one) => one.types.includes(type) && !one.adopted)
      const chosen = offer.chosen[type]
      const value = chosen && mine.some((one) => one.id === chosen) ? chosen : CHOOSE.NONE
      items.push({
        kind: 'switch',
        id: `${CHOOSE.PREFIX}${type}`,
        label: pickerLabel(type),
        group: 'Checklist',
        options: [
          { id: CHOOSE.NONE, label: value === CHOOSE.NONE ? `Pick a checklist for ${pickerLabel(type).slice('Checklist for '.length)}` : 'None' },
          ...mine.slice(0, 40).map((one) => ({ id: one.id, label: label(one.name) })),
          ...starters.map((one) => ({ id: `${CHOOSE.STARTER}${one.id}`, label: label(starterLabel(one.name)) })),
        ],
        value,
        agents: false,
      })
    }
    items.push({
      kind: 'toggle',
      id: CHOOSE.HERE,
      label: 'Choices for this kehikko only',
      group: 'Checklist',
      checked: offer.here,
      agents: false,
    })
  }
  items.push({ kind: 'run', id: MAKE.NEW, label: 'New checklist', group: 'Create', disabled: more.busy ? 'Working on something else.' : null })
  for (const starter of more.starters ?? []) {
    items.push({
      kind: 'run',
      id: `${MAKE.ADOPT}${starter.id}`,
      label: label(`Adopt ${starter.name}`),
      group: 'Starters',
      disabled: starter.adopted ? 'Adopted already: edit it under Manage checklists.' : more.busy ? 'Working on something else.' : null,
    })
  }
  items.push({
    kind: 'run',
    id: MAKE.COPY,
    label: more.importing ? 'Choosing…' : 'Copy from another project',
    group: 'Create',
    disabled: more.importing ? 'Choosing a project already.' : more.busy ? 'Working on something else.' : null,
  })
  return items
}

/** What a press in the header asks for. */
export type Pressed =
  | { view: HeaderView }
  | { angle: Angle }
  | { pick: string | null }
  | { make: 'new' | 'copy' }
  | { adopt: string }
  | { choose: ItemType; id: string | null; starter?: string }
  | { here: boolean }

/** The view, the angle, the checklist or the act a press asks for, or a sentence saying why not. */
export function pressed(press: { item: string; value?: string | boolean }): Pressed | string {
  if (press.item === 'angle') {
    const wanted = ANGLES.find((one) => one === press.value)
    return wanted ? { angle: wanted } : `"angle" takes one of: ${ANGLES.join(', ')}.`
  }
  if (press.item === PICK) {
    if (typeof press.value !== 'string') return '"list" takes a checklist id, or "all".'
    return { pick: press.value === EVERY ? null : press.value }
  }
  if (press.item.startsWith(CHOOSE.PREFIX)) {
    const type = USABLE_TYPES.find((one) => `${CHOOSE.PREFIX}${one}` === press.item)
    if (!type) return `There is no "${press.item.slice(0, 40)}" here.`
    if (typeof press.value !== 'string') return `"${press.item}" takes a checklist id, a starter or "none".`
    if (press.value === CHOOSE.NONE) return { choose: type, id: null }
    if (press.value.startsWith(CHOOSE.STARTER)) return { choose: type, id: null, starter: press.value.slice(CHOOSE.STARTER.length) }
    return { choose: type, id: press.value }
  }
  if (press.item === CHOOSE.HERE) return { here: press.value === true }
  if (press.item === MAKE.NEW) return { make: 'new' }
  if (press.item === MAKE.COPY) return { make: 'copy' }
  if (press.item.startsWith(MAKE.ADOPT)) return { adopt: press.item.slice(MAKE.ADOPT.length) }
  const view = viewPressed(press)
  return VIEWS.some((one) => one.id === view) ? { view: view as HeaderView } : view
}

/** The view a press asks for, or a sentence saying why not. */
export function viewPressed(press: { item: string; value?: string | boolean }): HeaderView | string {
  if (press.item !== 'view') return `There is no "${press.item}" here. What can be pressed: view, list, the checklist for each type, new, copy and the starters.`
  const wanted = VIEWS.find((one) => one.id === press.value)
  return wanted ? wanted.id : `"view" takes one of: ${VIEWS.map((one) => one.id).join(', ')}.`
}

/**
 * The angle as a filter group, offered so the host REMEMBERS it per container.
 *
 * A host draws the header and remembers nothing about it — the module owns
 * that state — and keeps one string per module, not per container
 * (`state.set`). The one thing a host keeps per container is the choice made
 * in a module's filters (`context.filters`). So the angle is offered there as
 * well, and a press of the header's switch writes it there (`filters.set`):
 * each Checklist container comes back on the angle it was left on. The host
 * draws it under the container's filter button too; the two are one value.
 */
export const ANGLE_FILTER = 'angle'
export function angleOffer(): FilterGroup[] {
  return [
    {
      id: ANGLE_FILTER,
      label: 'angle',
      options: ANGLES.map((one) => ({ id: one, label: ANGLE_LABELS[one] })),
      fallback: 'auto',
    },
  ]
}
