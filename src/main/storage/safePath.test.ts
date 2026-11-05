import { describe, expect, it } from 'vitest'
import { join, resolve } from 'path'
import { assertSafeId, resolveInside } from './safePath'

describe('resolveInside', () => {
  const base = resolve('/data/library/songs')

  it('accepts plain and nested relative names', () => {
    expect(resolveInside(base, 'a.json')).toBe(join(base, 'a.json'))
    expect(resolveInside(base, 'backgrounds/x.jpg')).toBe(join(base, 'backgrounds', 'x.jpg'))
  })

  it('accepts `..` that stays inside the base', () => {
    expect(resolveInside(base, 'sub/../a.json')).toBe(join(base, 'a.json'))
  })

  it('rejects traversal out of the base', () => {
    expect(resolveInside(base, '../settings.json')).toBeNull()
    expect(resolveInside(base, '../../../etc/passwd')).toBeNull()
    expect(resolveInside(base, 'sub/../../x.json')).toBeNull()
  })

  it('rejects absolute paths', () => {
    expect(resolveInside(base, resolve('/etc/passwd'))).toBeNull()
  })

  it('rejects a sibling that merely shares the prefix', () => {
    expect(resolveInside(base, '../songs-evil/a.json')).toBeNull()
  })

  it('rejects the base itself', () => {
    expect(resolveInside(base, '')).toBeNull()
    expect(resolveInside(base, '.')).toBeNull()
  })
})

describe('assertSafeId', () => {
  it('accepts uuids and theme slugs', () => {
    expect(assertSafeId('3f2b8c1e-9d4a-4b7e-8f1a-0c2d3e4f5a6b')).toBe(
      '3f2b8c1e-9d4a-4b7e-8f1a-0c2d3e4f5a6b'
    )
    expect(assertSafeId('default')).toBe('default')
    expect(assertSafeId('my_theme-2')).toBe('my_theme-2')
  })

  it('rejects traversal, separators, and non-strings', () => {
    for (const bad of ['../settings', '..', 'a/b', 'a\\b', '', 'a.json', ' x', null, 42, undefined]) {
      expect(() => assertSafeId(bad)).toThrow(/Invalid id/)
    }
  })
})
