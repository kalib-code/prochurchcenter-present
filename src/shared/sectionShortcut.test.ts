import { describe, expect, it } from 'vitest'
import { knownShortcutFromLabel, shortcutFromLabel } from './sectionShortcut'

describe('knownShortcutFromLabel', () => {
  it('matches shortcutFromLabel for recognised names', () => {
    for (const l of ['Verse 1', 'Verse 12', 'Chorus 2', 'Chorus (x2)', 'Chorus-2', 'Chorus(x2)', 'Chorus2', 'Pre-Chorus', 'Prechorus', 'Pre Chorus', 'Bridge', 'Intro', 'Outro', 'Tag']) {
      expect(knownShortcutFromLabel(l)).toBe(shortcutFromLabel(l))
    }
    expect(knownShortcutFromLabel('Verse 01')).toBe('1')
  })
  it('is empty where shortcutFromLabel falls back to the first letter', () => {
    for (const l of ['Coda', 'Post-Chorus', 'Interlude', 'Breakdown', 'Turnaround', 'Instrumental', 'Channel', 'Tagalog', 'Tagalog Chorus', 'Introit', 'Choruses', '']) {
      expect(knownShortcutFromLabel(l)).toBe('')
    }
  })
})
