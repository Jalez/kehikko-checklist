/**
 * Wearing the theme the host asked for.
 *
 * ## What was already right, and was measured to be right before anything moved
 *
 * The report was "Checklist doesn't seem to realize I changed the mode from dark
 * to light", and the obvious remedy — make it apply the theme — would have been
 * a change to something that worked. The two class toggles below are what every
 * module in this workspace does and they were already here, unchanged;
 * `dev/theme.probe.mjs` is what established that, by framing this app against a
 * host that says `dark` and then says `light` mid-session, with the MACHINE set
 * each way in turn, and reading the computed colours back out. All four
 * combinations came out as the host asked, including the one that matters — a
 * machine set to dark and a host that says light — because `index.css` guards
 * its `prefers-color-scheme` block on `:root:not(.light)`.
 *
 * The reported fault was upstream, and is fixed there: the host returned early
 * from sending context to a PINNED container, so a pinned module heard nothing
 * after its greeting, and the theme travels in the context. Checklist and
 * Learning were the two containers that happened to be pinned. Nothing in this
 * file would have helped, and a module that had "fixed" it here would have
 * shipped a second theme mechanism to explain the symptom of somebody else's
 * bug.
 *
 * `light` is set as a class and not merely as the absence of `dark`, and that
 * is the whole of why the hard case works. A module that only added and removed
 * `dark` would have nothing to write down when a host says light, so the OS
 * would answer instead — and the OS setting is not the choice the person made
 * in the host.
 *
 * ## What was missing, and it is the half a browser draws
 *
 * `color-scheme`. Colours this app paints itself are CSS variables and follow
 * the classes. Everything the BROWSER paints — the scrollbar, the caret, the
 * highlight on selected text, the inner shell of a textarea, autofill — follows
 * `color-scheme`, and with none declared that is the machine's setting and
 * nothing else. On a machine set to dark, in a host set to light, this module
 * drew a light card with a dark scrollbar down the side of it.
 *
 * That was worth almost nothing until this app grew a scroll area of its own —
 * see `src/view/room.ts` — and a permanent dark bar beside a white list is
 * exactly what "it hasn't noticed I changed the mode" looks like.
 *
 * It is set as an inline style on the root rather than in the stylesheet
 * because it must beat both the base rule and the media query without either
 * of them needing to know it exists, and because it is the same act as the
 * classes: one function, called from one place, so the two halves of "what
 * theme is this" cannot be changed apart.
 */
export function wearTheme(root: HTMLElement, theme: 'light' | 'dark'): void {
  root.classList.toggle('dark', theme === 'dark')
  root.classList.toggle('light', theme === 'light')
  root.style.colorScheme = theme
}
