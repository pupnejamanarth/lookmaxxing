import Dexie, { type Table } from 'dexie'
import type { Measurement, MetricScore, OverallScore, PhotoRecord, ScanRecord } from '../domain/types'
import type { AuditEntry, KVRow, Profile, WhitelistItem } from '../types'

/**
 * A personal baseline: the user's own first value for a metric that has no norm anchor. Write-once per
 * metric; later scans are scored against it. `scanId` / `setAt` only record where it came from.
 */
export interface BaselineRow {
  metricId: string
  value: number
  setAt: number
  scanId: string
}

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
  declare scans: Table<ScanRecord, string>
  declare photos: Table<PhotoRecord, string>
  declare measurements: Table<Measurement, string>
  declare scores: Table<MetricScore, string>
  declare overall: Table<OverallScore, string>
  declare baselines: Table<BaselineRow, string>

  constructor(name = 'lookmaxxing') {
    super(name)
    this.version(1).stores({
      profile: 'id',
      whitelist: 'id, category, active, addedAt',
      audit: '++id, ts, event',
      kv: 'key',
    })
    // M1: purely additive, so the v1 tables and their rows are carried over untouched (no upgrade function).
    this.version(2).stores({
      scans: 'id, takenAt, kind',
      photos: 'id, scanId, shot',
      measurements: 'id, scanId, metricId',
      scores: 'id, scanId, metricId',
      overall: 'scanId',
      baselines: 'metricId',
    })
  }
}

export const db = new LookmaxxingDB()
