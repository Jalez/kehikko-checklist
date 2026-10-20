import type { HeaderItemInput } from 'kehikot-module-protocol'

/**
 * This page's header, as the host draws it (`kehikot.header`): one View switch.
 *
 * `storage` is the option id a host looks for to open a module's own storage
 * view (the host's Storage overview presses a `switch` or `go` option with
 * exactly that id), so it is spelled exactly that and is a test.
 *
 * Not marked for agents: an agent reads storage with the `storage` tool at
 * this module's MCP door, and purging is a person's on this page. A switch
 * cannot name that tool, because the same switch also opens the reading page
 * and the list of every checklist.
 */
export const VIEWS = [
  { id: 'here', label: 'In front' },
  { id: 'all', label: 'All checklists' },
  { id: 'storage', label: 'Storage' },
] as const
export type HeaderView = (typeof VIEWS)[number]['id']

/** The header for the view the page is on. The edit page counts as the view it was opened from. */
export function headerFor(view: HeaderView): HeaderItemInput[] {
  return [
    {
      kind: 'switch',
      id: 'view',
      label: 'View',
      options: VIEWS.map((one) => ({ id: one.id, label: one.label })),
      value: view,
      agents: false,
    },
  ]
}

/** The view a press asks for, or a sentence saying why not. */
export function viewPressed(press: { item: string; value?: string | boolean }): HeaderView | string {
  if (press.item !== 'view') return `There is no "${press.item}" here. What can be pressed: view.`
  const wanted = VIEWS.find((one) => one.id === press.value)
  return wanted ? wanted.id : `"view" takes one of: ${VIEWS.map((one) => one.id).join(', ')}.`
}
