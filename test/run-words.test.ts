import { describe, expect, test } from 'bun:test'

import { runItemText } from '../list/run-words.ts'

describe('an automatic item\'s words', () => {
  test('a run of checks is tests; a build or another command passes by its label', () => {
    expect(runItemText('bun test', 'verify')).toBe('Tests pass: bun test')
    expect(runItemText('pre-push', 'push')).toBe('Tests pass: pre-push')
    expect(runItemText('bun test')).toBe('Tests pass: bun test')
    expect(runItemText('vite build', 'other')).toBe('Passes: vite build')
    expect(runItemText('round 2', 'review')).toBe('Passes: round 2')
  })
})
