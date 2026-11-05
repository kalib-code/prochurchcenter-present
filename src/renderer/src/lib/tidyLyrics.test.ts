import { describe, expect, it } from 'vitest'
import { isChordLine, looksUntidy, matchLabel, stripInlineChords, tidyLyrics } from './tidyLyrics'

describe('isChordLine', () => {
  it('spots chord-only lines', () => {
    expect(isChordLine('G   D/F#   Em   C')).toBe(true)
    expect(isChordLine('Am7  Fmaj7 | Csus4  G')).toBe(true)
    expect(isChordLine('(Bb)')).toBe(true)
  })
  it('leaves lyrics alone', () => {
    expect(isChordLine('Amazing grace how sweet the sound')).toBe(false)
    expect(isChordLine('Be still my soul')).toBe(false)
    expect(isChordLine('Am I a soldier')).toBe(false)
  })
})

describe('stripInlineChords', () => {
  it('drops ChordPro chords but keeps section headers', () => {
    expect(stripInlineChords('[G]Amazing [D/F#]grace')).toBe('Amazing grace')
    expect(stripInlineChords('[Chorus]')).toBe('[Chorus]')
  })
})

describe('matchLabel', () => {
  it.each([
    ['Chorus', 'Chorus'],
    ['CHORUS:', 'Chorus'],
    ['(Chorus)', 'Chorus'],
    ['Verse 2:', 'Verse 2'],
    ['[Verse 1]', 'Verse 1'],
    ['Koro', 'Chorus'],
    ['Refrain', 'Chorus'],
    ['Pre chorus', 'Pre-Chorus'],
    ['Chorus x2', 'Chorus'],
    ['Bridge (2x)', 'Bridge']
  ])('%s → %s', (line, label) => {
    expect(matchLabel(line)?.label).toBe(label)
  })

  it('splits "Chorus: lyrics" and flags repeats', () => {
    expect(matchLabel('Chorus: My chains are gone')).toEqual({
      label: 'Chorus',
      rest: 'My chains are gone',
      repeat: false
    })
    expect(matchLabel('Repeat Chorus')?.repeat).toBe(true)
  })

  it('does not treat lyrics starting with a label word as a label', () => {
    expect(matchLabel('Chorus of angels sing')).toBeNull()
    expect(matchLabel('Intro to your glory')).toBeNull()
  })
})

describe('tidyLyrics', () => {
  it('cleans a typical chord-sheet paste', () => {
    const paste = [
      'Verse 1:',
      'G        D/F#',
      'Amazing grace how sweet the sound',
      'Em       C',
      'That saved a wretch like me',
      '',
      '',
      '',
      'CHORUS',
      'My chains are gone (x2)',
      "I've been set free",
      '',
      'Verse 2',
      "'Twas grace that taught my heart to fear",
      '',
      '(Chorus)',
      '',
      'CCLI Song # 4768151',
      '© 2006 worshiptogether.com songs',
      'CCLI License # 11223344'
    ].join('\n')
    const r = tidyLyrics(paste)
    expect(r.text).toBe(
      [
        '[Verse 1]',
        'Amazing grace how sweet the sound',
        'That saved a wretch like me',
        '',
        '[Chorus]',
        'My chains are gone',
        "I've been set free",
        '',
        '[Verse 2]',
        "'Twas grace that taught my heart to fear",
        '',
        '[Chorus]',
        'My chains are gone',
        "I've been set free",
        ''
      ].join('\n')
    )
    expect(r.ccli).toBe('4768151')
    expect(r.copyright).toBe('2006 worshiptogether.com songs')
    expect(r.changes).toEqual([
      'Removed 2 chord lines',
      'Marked 4 sections',
      'Filled in 1 repeat',
      'Found CCLI 4768151'
    ])
  })

  it('turns hymn numbering into verse headers', () => {
    const r = tidyLyrics('1. Holy, holy, holy\nLord God Almighty\n\n2. Holy, holy, holy\nAll the saints adore Thee')
    expect(r.text).toBe(
      '[Verse 1]\nHoly, holy, holy\nLord God Almighty\n\n[Verse 2]\nHoly, holy, holy\nAll the saints adore Thee\n'
    )
  })

  it('keeps blank-line slide breaks inside a section', () => {
    expect(tidyLyrics('[Verse 1]\na\nb\n\nc\nd').text).toBe('[Verse 1]\na\nb\n\nc\nd\n')
  })

  it('leaves already-tidy lyrics unchanged', () => {
    const tidy = '[Verse 1]\nAmazing grace\n\n[Chorus]\nMy chains are gone\n'
    expect(tidyLyrics(tidy).text).toBe(tidy)
    expect(looksUntidy(tidy)).toBe(false)
  })

  it('handles empty input', () => {
    expect(tidyLyrics('').text).toBe('')
  })
})
