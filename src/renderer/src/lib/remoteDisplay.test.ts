import { describe, expect, it } from 'vitest'
import { cleanIpcError, failureText, parsePort, sourceLabel } from './remoteDisplay'

describe('remoteDisplay', () => {
  it('words every failure plainly', () => {
    expect(failureText('no-service')).toBe('No service running')
    expect(failureText('paused')).toBe('Paused in Service Mode')
    expect(failureText('not-found')).toBe('No such section or item')
    expect(failureText('not-a-song')).toBe("Current item isn't a song")
    expect(failureText('timeout')).toBe("Present didn't answer in time")
    expect(failureText('invalid')).toBe("Couldn't run that cue")
  })
  it('labels sources', () => {
    expect(sourceLabel('midi')).toBe('MIDI')
    expect(sourceLabel('http')).toBe('Web')
  })
  it('parses ports 1024-65535', () => {
    expect(parsePort('39218')).toBe(39218)
    expect(parsePort(' 1024 ')).toBe(1024)
    expect(parsePort('65535')).toBe(65535)
    expect(parsePort('1023')).toBeNull()
    expect(parsePort('65536')).toBeNull()
    expect(parsePort('')).toBeNull()
    expect(parsePort('12a')).toBeNull()
  })
  it('strips the IPC wrapper', () => {
    expect(cleanIpcError(new Error("Error invoking remote method 'remote:update': Error: Port in use"))).toBe('Port in use')
    expect(cleanIpcError(new Error('plain'))).toBe('plain')
  })
})
