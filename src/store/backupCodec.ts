/**
 * The plaintext inside a backup: a self-describing container of every table in the database.
 *
 *   uint32 BE manifest length | manifest (UTF-8 JSON) | manifest.blobs x [ uint32 BE length | bytes ]
 *
 * The manifest holds every table's rows as JSON. Binary values anywhere inside a row are replaced by a
 * small tagged object and their bytes are appended after the manifest, so photos never pass through JSON:
 *
 *   Blob / File          { __lmxblob: n, type, name?, lastModified? }   (name present = File)
 *   ArrayBuffer, typed   { __lmxbin: n, kind }
 *   Date                 { __lmxdate: ms | null }
 *   NaN, +-Infinity, -0  { __lmxnum: 'NaN' | 'Infinity' | '-Infinity' | '-0' }
 *   Object with a key starting '__lmx' (user data)   { __lmxobj: [[key, value], ...] }
 *
 * Known JSON limits: an undefined array element comes back as null.
 *
 * Values IndexedDB can hold but this cannot represent (Map, Set, class instances, bigint, ...) make the
 * export fail loudly instead of being silently dropped. Decoding only ever builds data: JSON.parse and the
 * constructors above, never eval. Error messages name tables, never values.
 */
import Dexie, { type Table } from 'dexie'
import { BackupError } from './backupError'

export const CONTAINER_VERSION = 1
const CONTAINER_NAME = 'lmx-container'
const RESERVED_PREFIX = '__lmx'
const MAX_DEPTH = 64
const MAX_NAME_LENGTH = 255
/** Largest instant a Date can hold. */
const MAX_TIME = 8.64e15
const LENGTH_BYTES = 4

type TypedArrayConstructor = { new (buffer: ArrayBuffer): ArrayBufferView; readonly BYTES_PER_ELEMENT: number }

const TYPED_ARRAYS: Readonly<Record<string, TypedArrayConstructor>> = {
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array,
}

const SPECIAL_NUMBERS: Readonly<Record<string, number>> = { NaN, Infinity, '-Infinity': -Infinity, '-0': -0 }

const invalid = (message: string): BackupError => new BackupError('invalid_content', message)
const tagOf = (value: unknown): string => Object.prototype.toString.call(value).slice(8, -1)
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value)
  // Prototype-less or one step above null: Object.prototype from any realm, but not a class instance.
  return proto === null || Object.getPrototypeOf(proto) === null
}

// ───────────────────────────── export side ─────────────────────────────

/** Binary bytes that are read lazily, one at a time, when the container is packed. */
export interface BinaryPart {
  readonly size: number
  read(): Promise<Uint8Array>
}

export interface TableSnapshot {
  name: string
  /** Inline primary key path, kept in the manifest for humans and future migrations. */
  primaryKey: string | string[]
  rows: unknown[]
}

export interface ManifestTable {
  primaryKey: string | string[]
  rows: unknown[]
}

export interface Manifest {
  container: typeof CONTAINER_NAME
  containerVersion: number
  /** Dexie version of the database the backup came from. */
  schemaVersion: number
  blobs: number
  tables: Record<string, ManifestTable>
}

class Encoder {
  constructor(
    private readonly parts: BinaryPart[],
    private readonly table: string,
    private readonly addBytes: (size: number) => void,
  ) {}

  private unsupported(what: string): BackupError {
    return invalid(`Table "${this.table}" holds a value that cannot be backed up (${what}).`)
  }

  private part(part: BinaryPart): number {
    this.addBytes(part.size)
    this.parts.push(part)
    return this.parts.length - 1
  }

  encode(value: unknown, depth: number): unknown {
    if (depth > MAX_DEPTH) throw this.unsupported('nested too deeply')
    switch (typeof value) {
      case 'string':
      case 'boolean':
        return value
      case 'number':
        if (Object.is(value, -0)) return { __lmxnum: '-0' }
        return Number.isFinite(value) ? value : { __lmxnum: String(value) }
      case 'object':
        break
      default:
        throw this.unsupported(typeof value)
    }
    if (value === null) return null
    if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : this.encode(item, depth + 1)))

    if (tagOf(value) === 'Date') {
      const time = (value as Date).getTime()
      return { __lmxdate: Number.isNaN(time) ? null : time }
    }
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
      const blob = value
      const index = this.part({ size: blob.size, read: async () => new Uint8Array(await blob.arrayBuffer()) })
      const ref: Record<string, unknown> = { __lmxblob: index, type: blob.type }
      if (typeof File !== 'undefined' && blob instanceof File) {
        ref.name = blob.name
        ref.lastModified = blob.lastModified
      }
      return ref
    }
    const kind = tagOf(value)
    if (kind === 'ArrayBuffer' || Object.hasOwn(TYPED_ARRAYS, kind)) {
      const bytes = ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : new Uint8Array(value as ArrayBuffer)
      return { __lmxbin: this.part({ size: bytes.byteLength, read: async () => bytes }), kind }
    }
    if (!isPlainObject(value)) throw this.unsupported(kind)

    const out: Record<string, unknown> = {}
    const escaped: [string, unknown][] = []
    for (const [key, item] of Object.entries(value)) {
      if (key === '__proto__') throw this.unsupported('reserved field name')
      if (item === undefined) continue
      const encoded = this.encode(item, depth + 1)
      out[key] = encoded
      escaped.push([key, encoded])
    }
    // User keys that collide with the codec's tags are carried as entries so they can never be mistaken for one.
    return escaped.some(([key]) => key.startsWith(RESERVED_PREFIX)) ? { __lmxobj: escaped } : out
  }
}

export function encodeSnapshot(
  tables: readonly TableSnapshot[],
  schemaVersion: number,
  maxBytes: number,
): { manifest: Manifest; parts: BinaryPart[] } {
  const parts: BinaryPart[] = []
  let total = 0
  const addBytes = (size: number): void => {
    total += size
    if (total > maxBytes) throw new BackupError('too_large', 'Your data is too large to back up in one file.')
  }
  const encoded: Record<string, ManifestTable> = {}
  for (const table of tables) {
    const encoder = new Encoder(parts, table.name, addBytes)
    encoded[table.name] = { primaryKey: table.primaryKey, rows: table.rows.map((row) => encoder.encode(row, 0)) }
  }
  const manifest: Manifest = {
    container: CONTAINER_NAME,
    containerVersion: CONTAINER_VERSION,
    schemaVersion,
    blobs: parts.length,
    tables: encoded,
  }
  return { manifest, parts }
}

const writeU32 = (target: Uint8Array, offset: number, value: number): void =>
  new DataView(target.buffer, target.byteOffset, target.byteLength).setUint32(offset, value)

export async function packContainer(manifest: Manifest, parts: readonly BinaryPart[], maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest))
  const total = LENGTH_BYTES + manifestBytes.length + parts.reduce((sum, part) => sum + LENGTH_BYTES + part.size, 0)
  if (total > maxBytes) throw new BackupError('too_large', 'Your data is too large to back up in one file.')

  const out = new Uint8Array(total)
  writeU32(out, 0, manifestBytes.length)
  out.set(manifestBytes, LENGTH_BYTES)
  let offset = LENGTH_BYTES + manifestBytes.length
  for (const part of parts) {
    const bytes = await part.read()
    if (bytes.byteLength !== part.size) throw new Error('A stored file changed while the backup was being made. Try again.')
    writeU32(out, offset, part.size)
    out.set(bytes, offset + LENGTH_BYTES)
    offset += LENGTH_BYTES + part.size
  }
  return out
}

// ───────────────────────────── import side ─────────────────────────────

export function unpackContainer(plaintext: Uint8Array<ArrayBuffer>): { manifest: Manifest; parts: Uint8Array<ArrayBuffer>[] } {
  const view = new DataView(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength)
  const readLength = (offset: number): number => {
    if (offset + LENGTH_BYTES > plaintext.length) throw invalid('The backup content is cut short.')
    return view.getUint32(offset)
  }

  const manifestLength = readLength(0)
  let offset = LENGTH_BYTES
  if (manifestLength > plaintext.length - offset) throw invalid('The backup content is cut short.')
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext.subarray(offset, offset + manifestLength)))
  } catch {
    throw invalid('The backup content could not be parsed.')
  }
  offset += manifestLength

  if (!isRecord(json) || json.container !== CONTAINER_NAME) throw invalid('The backup content is not a backup container.')
  const { containerVersion, schemaVersion, blobs, tables } = json
  if (typeof containerVersion !== 'number' || !Number.isInteger(containerVersion) || containerVersion < 1) {
    throw invalid('The backup content has no valid version.')
  }
  if (containerVersion !== CONTAINER_VERSION) {
    throw new BackupError('unsupported_version', 'This backup was made by a different version of the app and cannot be opened.')
  }
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion) || schemaVersion < 0) throw invalid('The backup content has no valid schema version.')
  if (typeof blobs !== 'number' || !Number.isInteger(blobs) || blobs < 0 || blobs * LENGTH_BYTES > plaintext.length - offset) {
    throw invalid('The backup content has an invalid file count.')
  }
  if (!isRecord(tables)) throw invalid('The backup content has no tables.')

  const parts: Uint8Array<ArrayBuffer>[] = []
  for (let i = 0; i < blobs; i++) {
    const length = readLength(offset)
    offset += LENGTH_BYTES
    if (length > plaintext.length - offset) throw invalid('The backup content is cut short.')
    parts.push(plaintext.subarray(offset, offset + length))
    offset += length
  }
  if (offset !== plaintext.length) throw invalid('The backup content has unexpected trailing data.')
  return { manifest: json as unknown as Manifest, parts }
}

class Decoder {
  constructor(
    private readonly parts: readonly Uint8Array<ArrayBuffer>[],
    private readonly used: Set<number>,
    private readonly table: string,
  ) {}

  fail(why: string): BackupError {
    return invalid(`Table "${this.table}": ${why}.`)
  }

  private bytes(index: unknown): Uint8Array<ArrayBuffer> {
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= this.parts.length) {
      throw this.fail('a file reference is out of range')
    }
    this.used.add(index)
    return this.parts[index]!
  }

  revive(value: unknown, depth: number): unknown {
    if (depth > MAX_DEPTH) throw this.fail('data is nested too deeply')
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value
    if (Array.isArray(value)) return value.map((item) => this.revive(item, depth + 1))
    if (!isRecord(value)) throw this.fail('contains an unsupported value')

    const keys = Object.keys(value)
    const tag = keys.find((key) => key.startsWith(RESERVED_PREFIX))
    if (tag !== undefined) return this.reviveTagged(tag, value, keys)
    const out: Record<string, unknown> = {}
    for (const key of keys) {
      // JSON.parse makes "__proto__" an ordinary own key; assigning it would swap the prototype.
      if (key === '__proto__') throw this.fail('contains a forbidden field name')
      out[key] = this.revive(value[key], depth + 1)
    }
    return out
  }

  private reviveTagged(tag: string, value: Record<string, unknown>, keys: string[]): unknown {
    const only = (...allowed: string[]): void => {
      if (!keys.every((key) => allowed.includes(key))) throw this.fail('contains a malformed tagged value')
    }
    switch (tag) {
      case '__lmxblob': {
        only('__lmxblob', 'type', 'name', 'lastModified')
        const { type, name, lastModified } = value
        if (typeof type !== 'string' || type.length > MAX_NAME_LENGTH) throw this.fail('contains a malformed file')
        const bytes = this.bytes(value.__lmxblob)
        if (name === undefined && lastModified === undefined) return new Blob([bytes], { type })
        if (typeof name !== 'string' || name.length > MAX_NAME_LENGTH) throw this.fail('contains a malformed file')
        if (lastModified !== undefined && (typeof lastModified !== 'number' || !Number.isFinite(lastModified))) {
          throw this.fail('contains a malformed file')
        }
        return new File([bytes], name, { type, lastModified: lastModified as number | undefined })
      }
      case '__lmxbin': {
        only('__lmxbin', 'kind')
        const kind = value.kind
        if (typeof kind !== 'string') throw this.fail('contains a malformed binary value')
        const bytes = this.bytes(value.__lmxbin).slice()
        if (kind === 'ArrayBuffer') return bytes.buffer
        if (!Object.hasOwn(TYPED_ARRAYS, kind)) throw this.fail('contains a malformed binary value')
        const Ctor = TYPED_ARRAYS[kind]!
        if (bytes.byteLength % Ctor.BYTES_PER_ELEMENT !== 0) throw this.fail('contains a malformed binary value')
        return new Ctor(bytes.buffer)
      }
      case '__lmxdate': {
        only('__lmxdate')
        const time = value.__lmxdate
        if (time === null) return new Date(NaN)
        if (typeof time !== 'number' || !Number.isFinite(time) || Math.abs(time) > MAX_TIME) throw this.fail('contains a malformed date')
        return new Date(time)
      }
      case '__lmxobj': {
        only('__lmxobj')
        const entries = value.__lmxobj
        if (!Array.isArray(entries)) throw this.fail('contains a malformed object')
        const out: Record<string, unknown> = {}
        for (const entry of entries as unknown[]) {
          if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || entry[0] === '__proto__') {
            throw this.fail('contains a malformed object')
          }
          out[entry[0]] = this.revive(entry[1], 1)
        }
        return out
      }
      case '__lmxnum': {
        only('__lmxnum')
        const text = value.__lmxnum
        if (typeof text !== 'string' || !Object.hasOwn(SPECIAL_NUMBERS, text)) throw this.fail('contains a malformed number')
        return SPECIAL_NUMBERS[text]
      }
      default:
        throw this.fail('contains an unknown tagged value')
    }
  }
}

/** Whether `key` can be an IndexedDB primary key that came out of JSON (string, finite number, Date, or an array of those). */
function isValidKey(key: unknown, depth = 0): boolean {
  if (typeof key === 'string') return true
  if (typeof key === 'number') return Number.isFinite(key)
  if (key instanceof Date) return !Number.isNaN(key.getTime())
  return Array.isArray(key) && depth < 8 && key.length > 0 && key.every((part) => isValidKey(part, depth + 1))
}

function keyToken(key: unknown): string {
  if (typeof key === 'string') return `s${JSON.stringify(key)}`
  if (typeof key === 'number') return `n${key}`
  if (key instanceof Date) return `d${key.getTime()}`
  return `a[${(key as unknown[]).map(keyToken).join(',')}]`
}

export interface RestorePlan {
  /** One entry per current table that the backup contains. Tables the backup lacks are simply cleared. */
  tables: { table: Table; rows: Record<string, unknown>[] }[]
  counts: Record<string, number>
  /** Names of backup tables that this version of the app does not have. */
  ignoredTables: string[]
  blobCount: number
  blobBytes: number
}

/**
 * Validates and rebuilds everything the restore will write, touching nothing. Shared by inspect and
 * restore so "inspect said fine" and "restore accepts it" cannot drift apart.
 */
export function planRestore(
  manifest: Manifest,
  parts: readonly Uint8Array<ArrayBuffer>[],
  database: { readonly tables: Table[] },
): RestorePlan {
  const used = new Set<number>()
  const plan: RestorePlan = { tables: [], counts: {}, ignoredTables: [], blobCount: 0, blobBytes: 0 }

  for (const table of database.tables) {
    if (!Object.hasOwn(manifest.tables, table.name)) continue
    const entry: unknown = manifest.tables[table.name]
    if (!isRecord(entry) || !Array.isArray(entry.rows)) throw invalid(`Table "${table.name}" is malformed.`)
    const keyPath = table.schema.primKey.keyPath
    if (!keyPath || keyPath.length === 0) throw invalid(`Table "${table.name}" has no inline primary key.`)

    const decoder = new Decoder(parts, used, table.name)
    const seen = new Set<string>()
    const rows = entry.rows.map((raw: unknown, i): Record<string, unknown> => {
      const row = decoder.revive(raw, 0)
      if (!isRecord(row) || tagOf(row) !== 'Object') throw decoder.fail(`row ${i + 1} is not an object`)
      const key: unknown = Dexie.getByKeyPath(row, keyPath)
      if (!isValidKey(key)) throw decoder.fail(`row ${i + 1} has no usable primary key`)
      const token = keyToken(key)
      if (seen.has(token)) throw decoder.fail(`row ${i + 1} repeats a primary key`)
      seen.add(token)
      return row
    })
    plan.tables.push({ table, rows })
    plan.counts[table.name] = rows.length
  }

  const current = new Set(database.tables.map((table) => table.name))
  plan.ignoredTables = Object.keys(manifest.tables)
    .filter((name) => !current.has(name))
    .map((name) => name.slice(0, 64))
  plan.blobCount = used.size
  for (const index of used) plan.blobBytes += parts[index]!.byteLength
  return plan
}
