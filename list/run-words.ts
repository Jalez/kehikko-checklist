import type { RunResultState } from 'kehikot-module-protocol'

/*
 * The words of an automatic item, said the same on the page and at the MCP door. No node module
 * here: the page imports this for its values (`list/runs.ts`, which reads the disk, only as types).
 */

/** The item's own words. */
export function runItemText(label: string): string {
  return `Tests pass: ${label}`
}

/** The words of each state, as a person reads them beside the item. */
export const RUN_STATE_WORDS: Record<RunResultState, string> = {
  queued: 'Queued',
  running: 'Running',
  passed: 'Passed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

/** Where an item came from, said on it so it is never read as a line somebody typed. */
export const FROM_A_RUN = 'from a test run'

/** Why there is no box to tick: the run decides, and the way to change it is to run it again. */
export const NO_HAND_TICK = 'Ticked by the test run, not by hand: it is ticked while the newest run of it passed. Run it again to change it.'
