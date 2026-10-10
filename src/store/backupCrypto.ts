/**
 * Encrypted backup file: framing, key derivation and AES-GCM. Web Crypto only, no dependencies.
 *
 *   'LMXBK001' (8 bytes) | uint32 BE header length | header (UTF-8 JSON) | ciphertext (AES-GCM, tag included)
 *
 * The header bytes are the GCM additionalData, so changing a single header byte (even whitespace, or the
 * unused trailing bits of a base64 digit) makes decryption fail instead of being silently accepted.
 * The header is read before any key is derived, which lets a hostile file be refused without spending
 * 600 000 PBKDF2 rounds on it.
 */
import { BackupError } from './backupError'

export const MAGIC = new TextEncoder().encode('LMXBK001')
export const FORMAT_VERSION = 1
export const KDF_ITERATIONS = 600_000
export const KDF_ITERATIONS_MIN = 600_000
export const KDF_ITERATIONS_MAX = 5_000_000
export const SALT_BYTES = 16
export const IV_BYTES = 12
export const TAG_BYTES = 16
/** Hard cap on the whole file, enforced on export and (before reading it) on import. */
/**
 * Export holds the rows, the packed container, the ciphertext and the Blob at once, and import holds the
 * ciphertext, the plaintext and per-file copies, so peak memory is several times the file size. iOS Safari
 * kills the tab at a few hundred MB, hence 200 MB rather than the 600 MB first specified.
 */
export const MAX_BACKUP_BYTES = 200 * 1024 * 1024

const LENGTH_BYTES = 4
const PREFIX_BYTES = 8 + LENGTH_BYTES
const MAX_HEADER_BYTES = 4096
/** Largest instant a Date can hold; keeps new Date(createdAt) valid. */
const MAX_TIME = 8.64e15

export interface BackupHeader {
  formatVersion: number
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string }
  cipher: { name: 'AES-GCM'; iv: string }
  createdAt: number
  appVersion: string
}

export interface ByteSource {
  readonly size: number
  read(start: number, end: number): Promise<Uint8Array<ArrayBuffer>>
}

export function toByteSource(input: Blob | ArrayBuffer | Uint8Array): ByteSource {
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return { size: input.size, read: async (start, end) => new Uint8Array(await input.slice(start, end).arrayBuffer()) }
  }
  let bytes: Uint8Array
  if (ArrayBuffer.isView(input)) bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  // Tag check rather than instanceof: an ArrayBuffer from another realm (iframe, worker) is still one.
  else if (Object.prototype.toString.call(input) === '[object ArrayBuffer]') bytes = new Uint8Array(input as ArrayBuffer)
  else throw new BackupError('bad_magic')
  return {
    size: bytes.byteLength,
    // Web Crypto refuses SharedArrayBuffer-backed views, so a view that reaches it is ArrayBuffer-backed.
    read: async (start, end) => bytes.subarray(start, end) as Uint8Array<ArrayBuffer>,
  }
}

// ───────────────────────────── small codecs ─────────────────────────────

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Strict: exactly `length` bytes and canonical text, so no two spellings decode to the same bytes. */
function fromBase64(text: unknown, length: number): Uint8Array<ArrayBuffer> | null {
  if (typeof text !== 'string') return null
  let binary: string
  try {
    binary = atob(text)
  } catch {
    return null
  }
  if (binary.length !== length) return null
  const out = new Uint8Array(length)
  for (let i = 0; i < length; i++) out[i] = binary.charCodeAt(i)
  return toBase64(out) === text ? out : null
}

function u32(value: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(LENGTH_BYTES)
  new DataView(out.buffer).setUint32(0, value)
  return out
}

function random(length: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(length))
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const corrupt = (): BackupError =>
  new BackupError('wrong_passphrase_or_corrupt', 'The backup file is damaged or incomplete, or the passphrase is wrong.')

// ───────────────────────────── header ─────────────────────────────

export interface ReadHeader {
  header: BackupHeader
  headerBytes: Uint8Array<ArrayBuffer>
  salt: Uint8Array<ArrayBuffer>
  iv: Uint8Array<ArrayBuffer>
  /** Offset of the ciphertext. */
  bodyStart: number
}

/** Magic, size cap and every header field are checked here, before any key derivation. */
export async function readHeader(source: ByteSource, maxBytes = MAX_BACKUP_BYTES): Promise<ReadHeader> {
  const prefix = await source.read(0, Math.min(PREFIX_BYTES, source.size))
  if (prefix.length < MAGIC.length || !MAGIC.every((byte, i) => prefix[i] === byte)) throw new BackupError('bad_magic')
  if (source.size > maxBytes) throw new BackupError('too_large', 'This backup is too large to restore on this device.')
  if (prefix.length < PREFIX_BYTES) throw corrupt()

  const headerLength = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength).getUint32(MAGIC.length)
  const bodyStart = PREFIX_BYTES + headerLength
  if (headerLength === 0 || headerLength > MAX_HEADER_BYTES || bodyStart + TAG_BYTES > source.size) throw corrupt()

  const headerBytes = await source.read(PREFIX_BYTES, bodyStart)
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(headerBytes))
  } catch {
    throw corrupt()
  }
  return { ...parseHeader(json), headerBytes, bodyStart }
}

function parseHeader(json: unknown): Pick<ReadHeader, 'header' | 'salt' | 'iv'> {
  if (!isRecord(json)) throw corrupt()
  const { formatVersion, kdf, cipher, createdAt, appVersion } = json
  if (typeof formatVersion !== 'number' || !Number.isInteger(formatVersion) || formatVersion < 1) throw corrupt()
  if (formatVersion !== FORMAT_VERSION) {
    throw new BackupError(
      'unsupported_version',
      formatVersion > FORMAT_VERSION
        ? 'This backup was made by a newer version of the app. Update the app, then try again.'
        : 'This backup uses an old format that this version of the app cannot open.',
    )
  }
  if (!isRecord(kdf) || kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256') throw corrupt()
  if (!isRecord(cipher) || cipher.name !== 'AES-GCM') throw corrupt()
  const { iterations } = kdf
  if (typeof iterations !== 'number' || !Number.isInteger(iterations)) throw corrupt()
  if (iterations < KDF_ITERATIONS_MIN || iterations > KDF_ITERATIONS_MAX) throw new BackupError('kdf_params_out_of_range')
  const salt = fromBase64(kdf.salt, SALT_BYTES)
  const iv = fromBase64(cipher.iv, IV_BYTES)
  if (!salt || !iv) throw corrupt()
  if (typeof createdAt !== 'number' || !Number.isInteger(createdAt) || createdAt < 0 || createdAt > MAX_TIME) throw corrupt()
  if (typeof appVersion !== 'string' || appVersion.length > 64) throw corrupt()

  const header: BackupHeader = {
    formatVersion,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: kdf.salt as string },
    cipher: { name: 'AES-GCM', iv: cipher.iv as string },
    createdAt,
    appVersion,
  }
  return { header, salt, iv }
}

// ───────────────────────────── key + cipher ─────────────────────────────

function subtle(): SubtleCrypto {
  const api = globalThis.crypto?.subtle
  if (!api) throw new Error('Web Crypto is not available here (it needs a secure context).')
  return api
}

/** NFKC so the same passphrase typed on another keyboard or OS derives the same key. */
export const normalizePassphrase = (passphrase: string): string => passphrase.normalize('NFKC')

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number, usage: KeyUsage[]): Promise<CryptoKey> {
  const api = subtle()
  const material = await api.importKey('raw', new TextEncoder().encode(normalizePassphrase(passphrase)), 'PBKDF2', false, [
    'deriveKey',
  ])
  return api.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, usage)
}

export const framedSize = (headerLength: number, plaintextLength: number): number =>
  PREFIX_BYTES + headerLength + plaintextLength + TAG_BYTES

/** Fresh random salt and IV every call, so two exports of the same data never share a key or nonce. */
export async function seal(
  plaintext: Uint8Array<ArrayBuffer>,
  passphrase: string,
  meta: { createdAt: number; appVersion: string },
  maxBytes = MAX_BACKUP_BYTES,
): Promise<Blob> {
  const salt = random(SALT_BYTES)
  const iv = random(IV_BYTES)
  const header: BackupHeader = {
    formatVersion: FORMAT_VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: KDF_ITERATIONS, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    createdAt: meta.createdAt,
    appVersion: meta.appVersion,
  }
  const headerBytes = new TextEncoder().encode(JSON.stringify(header))
  if (framedSize(headerBytes.length, plaintext.length) > maxBytes) {
    throw new BackupError('too_large', 'Your data is too large to back up in one file.')
  }
  const key = await deriveKey(passphrase, salt, KDF_ITERATIONS, ['encrypt'])
  const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: headerBytes, tagLength: TAG_BYTES * 8 }, key, plaintext)
  return new Blob([MAGIC, u32(headerBytes.length), headerBytes, ciphertext], { type: 'application/octet-stream' })
}

export async function open(
  input: Blob | ArrayBuffer | Uint8Array,
  passphrase: string,
  maxBytes = MAX_BACKUP_BYTES,
): Promise<{ header: BackupHeader; plaintext: Uint8Array<ArrayBuffer> }> {
  const source = toByteSource(input)
  const { header, headerBytes, salt, iv, bodyStart } = await readHeader(source, maxBytes)
  if (typeof passphrase !== 'string' || passphrase.length === 0) throw corrupt()

  const ciphertext = await source.read(bodyStart, source.size)
  const key = await deriveKey(passphrase, salt, header.kdf.iterations, ['decrypt'])
  try {
    // `ciphertext` goes out of scope on return, so only the plaintext stays alive for the caller.
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: headerBytes, tagLength: TAG_BYTES * 8 }, key, ciphertext)
    return { header, plaintext: new Uint8Array(plain) }
  } catch {
    // A wrong passphrase and a flipped bit are the same failure under GCM.
    throw corrupt()
  }
}
