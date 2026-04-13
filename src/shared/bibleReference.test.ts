import { describe, it, expect } from 'vitest'
import { parseReference, formatReference } from './bibleReference'

describe('parseReference', () => {
  it('returns null for empty input', () => {
    expect(parseReference('')).toBeNull()
    expect(parseReference('   ')).toBeNull()
  })

  it('parses a single verse', () => {
    expect(parseReference('John 3:16')).toEqual({
      bookId: 'JHN',
      bookName: 'John',
      chapter: 3,
      verseStart: 16,
      verseEnd: undefined
    })
  })

  it('parses a verse range', () => {
    expect(parseReference('John 3:16-18')).toEqual({
      bookId: 'JHN',
      bookName: 'John',
      chapter: 3,
      verseStart: 16,
      verseEnd: 18
    })
  })

  it('parses a whole chapter', () => {
    expect(parseReference('Romans 12')).toEqual({
      bookId: 'ROM',
      bookName: 'Romans',
      chapter: 12,
      verseStart: undefined,
      verseEnd: undefined
    })
  })

  it('is case insensitive', () => {
    expect(parseReference('john 3:16')?.bookId).toBe('JHN')
    expect(parseReference('JOHN 3:16')?.bookId).toBe('JHN')
    expect(parseReference('JoHn 3:16')?.bookId).toBe('JHN')
  })

  it('handles common abbreviations', () => {
    expect(parseReference('jn 3:16')?.bookId).toBe('JHN')
    expect(parseReference('jhn 3:16')?.bookId).toBe('JHN')
    expect(parseReference('rom 8:28')?.bookId).toBe('ROM')
    expect(parseReference('ps 23')?.bookId).toBe('PSA')
    expect(parseReference('gen 1:1')?.bookId).toBe('GEN')
    expect(parseReference('rev 21:4')?.bookId).toBe('REV')
  })

  it('handles numbered books with space', () => {
    expect(parseReference('1 John 4:8')).toEqual({
      bookId: '1JN',
      bookName: '1 John',
      chapter: 4,
      verseStart: 8,
      verseEnd: undefined
    })
    expect(parseReference('1 Corinthians 13:4-7')?.bookId).toBe('1CO')
    expect(parseReference('2 Samuel 7:14')?.bookId).toBe('2SA')
  })

  it('handles numbered books without space', () => {
    expect(parseReference('1john 4:8')?.bookId).toBe('1JN')
    expect(parseReference('1cor 13:4')?.bookId).toBe('1CO')
    expect(parseReference('2pe 1:5')?.bookId).toBe('2PE')
  })

  it('handles numbered book abbreviations', () => {
    expect(parseReference('1 cor 13:4-7')?.bookId).toBe('1CO')
    expect(parseReference('1 thess 4:13')?.bookId).toBe('1TH')
    expect(parseReference('2 tim 3:16')?.bookId).toBe('2TI')
  })

  it('disambiguates 1 John from John', () => {
    // The longest-alias-first ordering ensures "1 john" matches before
    // "john" attempts to match the substring.
    const oneJohn = parseReference('1 John 3:16')
    const john = parseReference('John 3:16')
    expect(oneJohn?.bookId).toBe('1JN')
    expect(john?.bookId).toBe('JHN')
  })

  it('tolerates extra whitespace', () => {
    expect(parseReference('  John  3 : 16  ')?.bookId).toBe('JHN')
    expect(parseReference('John  3:16-18')?.verseEnd).toBe(18)
  })

  it('parses Psalms / Psalm interchangeably', () => {
    expect(parseReference('Psalm 23:1')?.bookId).toBe('PSA')
    expect(parseReference('Psalms 23:1')?.bookId).toBe('PSA')
    expect(parseReference('Ps 23')?.bookId).toBe('PSA')
  })

  it('parses Song of Solomon variants', () => {
    expect(parseReference('Song of Solomon 2:1')?.bookId).toBe('SNG')
    expect(parseReference('Song of Songs 2:1')?.bookId).toBe('SNG')
    expect(parseReference('Song 2:1')?.bookId).toBe('SNG')
  })

  it('returns null for unknown books', () => {
    expect(parseReference('Hezekiah 3:1')).toBeNull()
    expect(parseReference('xyz 1:1')).toBeNull()
    expect(parseReference('foo bar 1:1')).toBeNull()
  })

  it('returns null for malformed chapter/verse', () => {
    expect(parseReference('John')).toBeNull()
    expect(parseReference('John abc')).toBeNull()
    expect(parseReference('John 3:abc')).toBeNull()
    expect(parseReference('John 3:16-')).toBeNull()
    expect(parseReference('John -3:16')).toBeNull()
  })

  it('returns null when verseEnd < verseStart', () => {
    expect(parseReference('John 3:18-16')).toBeNull()
  })

  it('returns null for chapter 0 or verse 0', () => {
    expect(parseReference('John 0:1')).toBeNull()
    expect(parseReference('John 3:0')).toBeNull()
  })
})

describe('formatReference', () => {
  it('formats a single verse', () => {
    expect(
      formatReference({ bookId: 'JHN', bookName: 'John', chapter: 3, verseStart: 16 })
    ).toBe('John 3:16')
  })

  it('formats a verse range', () => {
    expect(
      formatReference({
        bookId: 'JHN',
        bookName: 'John',
        chapter: 3,
        verseStart: 16,
        verseEnd: 18
      })
    ).toBe('John 3:16-18')
  })

  it('formats a whole chapter', () => {
    expect(
      formatReference({ bookId: 'ROM', bookName: 'Romans', chapter: 12 })
    ).toBe('Romans 12')
  })

  it('collapses verseEnd === verseStart to a single verse', () => {
    expect(
      formatReference({
        bookId: 'JHN',
        bookName: 'John',
        chapter: 3,
        verseStart: 16,
        verseEnd: 16
      })
    ).toBe('John 3:16')
  })

  it('round-trips through parse', () => {
    const cases = ['John 3:16', 'Romans 12', '1 Corinthians 13:4-7', 'Psalms 23']
    for (const ref of cases) {
      const parsed = parseReference(ref)
      expect(parsed).not.toBeNull()
      expect(formatReference(parsed!)).toBe(ref)
    }
  })
})
