import { beforeEach, describe, expect, test } from 'bun:test'

import { wearTheme } from '../src/wire/theme.ts'

/**
 * The theme, held against the complaint that produced this file:
 *
 * > "Neither Learning or Checklist seem to realize I changed the mode from dark
 * > to light."
 *
 * The class half of this was already right and is verified end to end by
 * `dev/theme.probe.mjs`, which drives a real host both ways at two machine
 * settings. What is asserted here is the part a headless probe reads least
 * reliably and a reader notices first: that a CHANGE is a change, and that the
 * scrollbar goes with it.
 */
describe('wearing the theme the host asked for', () => {
  let root: HTMLElement

  beforeEach(() => {
    root = document.createElement('html')
  })

  test('dark is written down, and so is the scheme the browser paints from', () => {
    wearTheme(root, 'dark')
    expect(root.classList.contains('dark')).toBe(true)
    expect(root.classList.contains('light')).toBe(false)
    expect(root.style.colorScheme).toBe('dark')
  })

  test('light is WRITTEN DOWN rather than left as the absence of dark', () => {
    /* The whole of the hard case. A module that only added and removed `dark`
       has nothing to say when a host asks for light, so the machine answers
       instead — and on a machine set to dark that is the module ignoring the
       choice the person made in the host. `index.css` guards its
       prefers-color-scheme block on `:root:not(.light)`, and this is the class
       that guard is looking for. */
    wearTheme(root, 'light')
    expect(root.classList.contains('light')).toBe(true)
    expect(root.classList.contains('dark')).toBe(false)
    expect(root.style.colorScheme).toBe('light')
  })

  test('dark to light in a running session takes the old theme off with it', () => {
    /* The reported failure exactly: the mode was changed while the page was
       open. A load-time-only implementation passes every test above and fails
       this one. */
    wearTheme(root, 'dark')
    wearTheme(root, 'light')
    expect(root.classList.contains('dark')).toBe(false)
    expect(root.classList.contains('light')).toBe(true)
    expect(root.style.colorScheme).toBe('light')
  })

  test('and back again, because a person may change their mind twice', () => {
    wearTheme(root, 'dark')
    wearTheme(root, 'light')
    wearTheme(root, 'dark')
    expect(root.classList.contains('dark')).toBe(true)
    expect(root.classList.contains('light')).toBe(false)
    expect(root.style.colorScheme).toBe('dark')
  })
})
