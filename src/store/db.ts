import Dexie, { type Table } from 'dexie'
import type { AuditEntry, KVRow, Profile, WhitelistItem } from '../types'

/**
 * The single local IndexedDB. Nothing in here ever leaves the device.
 *
 * Schema changes: never edit a released version in place – add `this.version(n + 1)` with an
 * upgrade function. 'active' is indexed per the store contract, but booleans are not valid
 * IndexedDB keys, so that index stays empty: filter on `active` in memory, never with where().
 */
export class LookmaxxingDB extends Dexie {
  // `declare` emits nothing, so the class fields cannot shadow the tables Dexie installs.
  declare profile: Table<Profile, string>
  declare whitelist: Table<WhitelistItem, string>
  declare audit: Table<AuditEntry, number>
  declare kv: Table<KVRow, string>

  constructor(name = 'lookmaxxing') {
    super(name)
    this.version(1).stores({
      profile: 'id',
      whitelist: 'id, category, active, addedAt',
      audit: '++id, ts, event',
      kv: 'key',
    })
  }
}

export const db = new LookmaxxingDB()
