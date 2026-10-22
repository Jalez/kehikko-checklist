import type { FilterGroup, HeaderItemInput } from 'kehikot-module-protocol'

import { ANGLE_LABELS, ANGLES, type Angle } from '../../list/standing.ts'

/**
 * This page's header, as the host draws it (`kehikot.header`): the View
 * switch, and the angle the picked items are read from.
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

/** The header for the view the page is on and the angle it reads from. The edit page counts as the view it was opened from. */
export function headerFor(view: HeaderView, angle: Angle = 'auto'): HeaderItemInput[] {
  return [
    {
      kind: 'switch',
      id: 'view',
      label: 'View',
      group: 'Page',
      options: VIEWS.map((one) => ({ id: one.id, label: one.label })),
      value: view,
      agents: false,
    },
    {
      kind: 'switch',
      id: 'angle',
      label: 'Angle',
      group: 'Angle',
      options: ANGLES.map((one) => ({ id: one, label: ANGLE_LABELS[one] })),
      value: angle,
      agents: false,
    },
  ]
}

/** What a press in the header asks for. */
export type Pressed = { view: HeaderView } | { angle: Angle }

/** The view or the angle a press asks for, or a sentence saying why not. */
export function pressed(press: { item: string; value?: string | boolean }): Pressed | string {
  if (press.item === 'angle') {
    const wanted = ANGLES.find((one) => one === press.value)
    return wanted ? { angle: wanted } : `"angle" takes one of: ${ANGLES.join(', ')}.`
  }
  const view = viewPressed(press)
  return VIEWS.some((one) => one.id === view) ? { view: view as HeaderView } : view
}

/** The view a press asks for, or a sentence saying why not. */
export function viewPressed(press: { item: string; value?: string | boolean }): HeaderView | string {
  if (press.item !== 'view') return `There is no "${press.item}" here. What can be pressed: view, angle.`
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
