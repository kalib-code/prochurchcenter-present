import { describe, expect, it } from 'vitest'
import { fromMediaUrl, toMediaUrl } from './mediaUrl'

describe('toMediaUrl / fromMediaUrl', () => {
  const posix = [
    '/Users/rose/Media/bg.jpg',
    '/Users/rose/Media/Paint Sweeps.png',
    '/Users/rose/Videos/Song #2.mp4',
    '/Users/rose/Videos/what?.mov',
    '/Users/rose/Videos/100% joy.mp4',
    '/Users/rose/Videos/a%20literal.mp4',
    '/Users/rose/Músika/Pagsamba — ñ 讚美.mp4',
    '/Users/rose/odd/back\\slash.png',
    "/Users/rose/odd/&+=,;@$!'()[]{}.png"
  ]

  it.each(posix)('round-trips POSIX path %s', (p) => {
    expect(fromMediaUrl(toMediaUrl(p))).toBe(p)
  })

  const windows: Array<[string, string]> = [
    ['C:\\Users\\x\\a b#.mp4', 'C:/Users/x/a b#.mp4'],
    ['D:\\Media\\Song #2?.mp4', 'D:/Media/Song #2?.mp4'],
    ['C:\\Users\\x\\100% ñ 讚美.png', 'C:/Users/x/100% ñ 讚美.png'],
    ['C:/Users/x/forward.mp4', 'C:/Users/x/forward.mp4'],
    ['\\\\server\\share\\a b.mp4', '//server/share/a b.mp4']
  ]

  it.each(windows)('round-trips Windows path %s', (input, expected) => {
    expect(fromMediaUrl(toMediaUrl(input))).toBe(expected)
  })

  it('keeps the drive letter as the first path segment', () => {
    const url = toMediaUrl('C:\\Users\\x\\a.mp4')
    expect(url.startsWith('present-media://local/C%3A/Users/x/')).toBe(true)
    expect(new URL(url).host).toBe('local')
  })

  it('escapes # and ? so they stay part of the path', () => {
    const url = new URL(toMediaUrl('/m/Song #2?.mp4'))
    expect(url.hash).toBe('')
    expect(url.search).toBe('')
  })

  it('leaves a fragment appended by the caller intact', () => {
    // MediaPreview appends `#t=0.1` to seek video thumbnails.
    expect(fromMediaUrl(`${toMediaUrl('/m/Song #2.mp4')}#t=0.1`)).toBe('/m/Song #2.mp4')
  })

  it('matches the old encodeURI output for plain paths', () => {
    expect(toMediaUrl('/Users/rose/Media/Paint Sweeps.png')).toBe(
      'present-media://local/Users/rose/Media/Paint%20Sweeps.png'
    )
  })

  it('still decodes legacy encodeURI-built URLs', () => {
    const legacy = `present-media://local${encodeURI('/Users/rose/a b ñ.png')}`
    expect(fromMediaUrl(legacy)).toBe('/Users/rose/a b ñ.png')
  })

  it('rejects foreign or malformed URLs', () => {
    expect(fromMediaUrl('https://example.com/a.png')).toBeNull()
    expect(fromMediaUrl('not a url')).toBeNull()
    expect(fromMediaUrl('present-media://local/bad%E0%A4%A.png')).toBeNull()
  })
})
