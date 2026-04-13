/**
 * Polyfills for TC39 proposals that pdf.js 5.6.x uses but Electron 34's
 * Chromium 132 doesn't ship yet.
 *
 * pdf.js rides the bleeding edge of V8 features. Every time Chromium
 * adds a new JS primitive, pdf.js eventually adopts it. When the gap
 * opens between the Chromium version Electron pins and the one pdf.js
 * targets, we fall into it — errors like "toHex is not a function" or
 * "getOrInsertComputed is not a function" surface the moment the
 * library touches those methods.
 *
 * Rather than downgrading pdf.js (and losing real bug fixes), we shim
 * the missing methods here and import this file as the first import in
 * any module that loads pdf.js. All installs are guarded by typeof
 * checks so they become no-ops once Electron bumps its Chromium past
 * the version that implements each proposal natively.
 *
 * Proposals covered:
 *
 *   1. Uint8Array hex/base64 methods (Stage 3 → Chromium 133+)
 *      - Uint8Array.fromHex / fromBase64
 *      - Uint8Array.prototype.toHex / toBase64
 *      - Uint8Array.prototype.setFromHex / setFromBase64
 *      Spec: https://github.com/tc39/proposal-arraybuffer-base64
 *
 *   2. Map/WeakMap/Set upsert methods (Stage 2 → Chromium 135+)
 *      - Map.prototype.getOrInsert(key, value)
 *      - Map.prototype.getOrInsertComputed(key, callback)
 *      Spec: https://github.com/tc39/proposal-upsert
 *
 * This file has no exports — importing it for its side effects is the
 * whole API. Import it BEFORE pdfjs-dist so the prototypes are patched
 * before pdf.js's module evaluation touches any of these methods.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Uint8ArrayHexCtor {
  fromHex?: (hex: string) => Uint8Array
  fromBase64?: (b64: string, options?: unknown) => Uint8Array
}

interface Uint8ArrayHexProto {
  toHex?: () => string
  toBase64?: (options?: unknown) => string
  setFromHex?: (hex: string) => { read: number; written: number }
  setFromBase64?: (
    b64: string,
    options?: unknown
  ) => { read: number; written: number }
}

const Ctor = Uint8Array as unknown as Uint8ArrayHexCtor
const Proto = Uint8Array.prototype as unknown as Uint8ArrayHexProto

// ── toHex ────────────────────────────────────────────────────────────────
if (typeof Proto.toHex !== 'function') {
  Proto.toHex = function toHex(this: Uint8Array): string {
    let out = ''
    for (let i = 0; i < this.length; i++) {
      const b = this[i]
      out += (b < 16 ? '0' : '') + b.toString(16)
    }
    return out
  }
}

// ── fromHex ──────────────────────────────────────────────────────────────
if (typeof Ctor.fromHex !== 'function') {
  Ctor.fromHex = function fromHex(hex: string): Uint8Array {
    if (typeof hex !== 'string') throw new TypeError('hex must be a string')
    if (hex.length % 2 !== 0) {
      throw new SyntaxError('hex string must have an even number of characters')
    }
    const out = new Uint8Array(hex.length / 2)
    for (let i = 0; i < out.length; i++) {
      const byte = parseInt(hex.substr(i * 2, 2), 16)
      if (Number.isNaN(byte)) throw new SyntaxError('invalid hex character')
      out[i] = byte
    }
    return out
  }
}

// ── setFromHex ───────────────────────────────────────────────────────────
if (typeof Proto.setFromHex !== 'function') {
  Proto.setFromHex = function setFromHex(
    this: Uint8Array,
    hex: string
  ): { read: number; written: number } {
    if (typeof hex !== 'string') throw new TypeError('hex must be a string')
    const maxBytes = Math.min(Math.floor(hex.length / 2), this.length)
    let written = 0
    for (let i = 0; i < maxBytes; i++) {
      const byte = parseInt(hex.substr(i * 2, 2), 16)
      if (Number.isNaN(byte)) throw new SyntaxError('invalid hex character')
      this[i] = byte
      written++
    }
    return { read: written * 2, written }
  }
}

// ── toBase64 ─────────────────────────────────────────────────────────────
if (typeof Proto.toBase64 !== 'function') {
  Proto.toBase64 = function toBase64(this: Uint8Array): string {
    // btoa operates on a binary string — chunk to avoid exceeding the
    // String.fromCharCode argument limit on big buffers (~100KB+).
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < this.length; i += chunk) {
      const slice = this.subarray(i, i + chunk)
      binary += String.fromCharCode(...(slice as unknown as number[]))
    }
    return btoa(binary)
  }
}

// ── fromBase64 ───────────────────────────────────────────────────────────
if (typeof Ctor.fromBase64 !== 'function') {
  Ctor.fromBase64 = function fromBase64(b64: string): Uint8Array {
    if (typeof b64 !== 'string') throw new TypeError('b64 must be a string')
    const binary = atob(b64)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
  }
}

// ── setFromBase64 ────────────────────────────────────────────────────────
if (typeof Proto.setFromBase64 !== 'function') {
  Proto.setFromBase64 = function setFromBase64(
    this: Uint8Array,
    b64: string
  ): { read: number; written: number } {
    if (typeof b64 !== 'string') throw new TypeError('b64 must be a string')
    const binary = atob(b64)
    const max = Math.min(binary.length, this.length)
    for (let i = 0; i < max; i++) this[i] = binary.charCodeAt(i)
    return { read: Math.ceil((max * 4) / 3), written: max }
  }
}

// ─── Map/WeakMap upsert proposal ─────────────────────────────────────────
// https://github.com/tc39/proposal-upsert — adds getOrInsert and
// getOrInsertComputed on Map, WeakMap (and Set via add-like semantics in
// some earlier drafts, but the current proposal only covers Map/WeakMap).
//
// pdf.js 5.6 uses these to lazily initialize per-key caches. Before the
// native methods exist the idiomatic fallback is `has` + `get/set`, so
// the polyfill is small and has identical semantics.

interface MapUpsertProto<K, V> {
  getOrInsert?: (key: K, value: V) => V
  getOrInsertComputed?: (key: K, callback: (key: K) => V) => V
}

const MapProto = Map.prototype as unknown as MapUpsertProto<unknown, unknown>
const WeakMapProto = WeakMap.prototype as unknown as MapUpsertProto<
  object,
  unknown
>

if (typeof MapProto.getOrInsert !== 'function') {
  MapProto.getOrInsert = function getOrInsert<K, V>(
    this: Map<K, V>,
    key: K,
    value: V
  ): V {
    if (this.has(key)) return this.get(key) as V
    this.set(key, value)
    return value
  } as (key: unknown, value: unknown) => unknown
}

if (typeof MapProto.getOrInsertComputed !== 'function') {
  MapProto.getOrInsertComputed = function getOrInsertComputed<K, V>(
    this: Map<K, V>,
    key: K,
    callback: (key: K) => V
  ): V {
    if (this.has(key)) return this.get(key) as V
    const computed = callback(key)
    this.set(key, computed)
    return computed
  } as (key: unknown, callback: (key: unknown) => unknown) => unknown
}

if (typeof WeakMapProto.getOrInsert !== 'function') {
  WeakMapProto.getOrInsert = function getOrInsert<K extends object, V>(
    this: WeakMap<K, V>,
    key: K,
    value: V
  ): V {
    const existing = this.get(key)
    if (existing !== undefined || this.has(key)) return existing as V
    this.set(key, value)
    return value
  } as (key: object, value: unknown) => unknown
}

if (typeof WeakMapProto.getOrInsertComputed !== 'function') {
  WeakMapProto.getOrInsertComputed = function getOrInsertComputed<
    K extends object,
    V
  >(this: WeakMap<K, V>, key: K, callback: (key: K) => V): V {
    const existing = this.get(key)
    if (existing !== undefined || this.has(key)) return existing as V
    const computed = callback(key)
    this.set(key, computed)
    return computed
  } as (key: object, callback: (key: object) => unknown) => unknown
}
