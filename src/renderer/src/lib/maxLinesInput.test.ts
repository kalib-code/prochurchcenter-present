import { describe, expect, it } from 'vitest'
import { parseMaxLinesInput } from './maxLinesInput'

describe('parseMaxLinesInput', () => {
  it('accepts in-range values', () => {
    expect(parseMaxLinesInput('12')).toBe(12)
    expect(parseMaxLinesInput(' 4 ')).toBe(4)
  })

  it('clamps to 2..20 and floors fractions', () => {
    expect(parseMaxLinesInput('1')).toBe(2)
    expect(parseMaxLinesInput('0')).toBe(2)
    expect(parseMaxLinesInput('99')).toBe(20)
    expect(parseMaxLinesInput('5.9')).toBe(5)
  })

  it('returns null for empty or non-numeric input so the field reverts', () => {
    expect(parseMaxLinesInput('')).toBeNull()
    expect(parseMaxLinesInput('   ')).toBeNull()
    expect(parseMaxLinesInput('abc')).toBeNull()
  })
})
