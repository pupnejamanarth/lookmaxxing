/**
 * Domain types shared by the store, privacy and UI layers.
 * These are the persisted shapes (IndexedDB rows). Changing a field = bump the Dexie version and migrate.
 */
import type { ProductCategory } from './catalog/schema'

export type { ProductCategory }

export type Units = 'metric' | 'imperial'

/** The single local user. There is exactly one row, id "me". No name, no email, no DOB – by design. */
export interface Profile {
  id: 'me'
  /** Only the male reference profile exists for now (ranges + weights). Field kept for a future profile. */
  sexProfile: 'male'
  heightCm: number | null
  units: Units
  /** Daily minutes the user can realistically spend on routines (feeds impact ÷ effort ranking). */
  dailyMinutes: 15 | 30 | 60
  trainingDaysPerWeek: number
  /** 0 = Sunday … 6 = Saturday – the weekday the weekly scan is due. */
  scanWeekday: number
  /** User-confirmed: opened from the Home Screen (iOS only; Safari clears site data after 7 idle days otherwise). */
  installedToHomeScreen: boolean | null
  /** Result of navigator.storage.persist(); null = never asked. */
  storagePersisted: boolean | null
  privacyChecklist: Record<string, boolean>
  equipmentChecklist: Record<string, boolean>
  onboardedAt: number | null
  createdAt: number
  updatedAt: number
}

export type PatchTestStatus = 'not_needed' | 'not_started' | 'in_progress' | 'passed' | 'failed'
export type PatchTestResult = 'no_reaction' | 'mild_irritation' | 'reaction'

export interface PatchTestEntry {
  ts: number
  result: PatchTestResult
  note: string
}

/**
 * "My current stack". The ONLY products the app may ever mention. Default list is EMPTY and the
 * app never suggests entries. A product whose patch test failed is excluded for good.
 */
export interface WhitelistItem {
  id: string
  name: string
  category: ProductCategory
  notes: string
  active: boolean
  addedAt: number
  updatedAt: number
  patchTest: {
    status: PatchTestStatus
    startedAt: number | null
    entries: PatchTestEntry[]
  }
}

export type AuditEvent =
  | 'onboarding_completed'
  | 'settings_changed'
  | 'whitelist_added'
  | 'whitelist_updated'
  | 'whitelist_toggled'
  | 'whitelist_removed'
  | 'patch_test_started'
  | 'patch_test_logged'
  | 'storage_persist_requested'
  | 'backup_exported'
  | 'backup_restored'
  | 'data_deleted'
  | 'network_blocked'

export interface AuditEntry {
  id?: number
  ts: number
  event: AuditEvent
  /** Human-readable, never contains photo data or free-form personal text beyond what the user typed into a field. */
  detail: string
}

export interface KVRow {
  key: string
  value: unknown
}

export const DEFAULT_PRIVACY_CHECKLIST_KEYS = [
  'icloud_photos_off_or_separate_album',
  'delete_source_photos_after_import',
  'disk_encryption_on',
  'no_screenshots_in_synced_albums',
] as const

export const DEFAULT_EQUIPMENT_CHECKLIST_KEYS = [
  'phone_stand_or_tripod',
  'grey_card_18pct',
  'soft_tape_measure',
  'bathroom_scale',
  'plain_wall_and_window_light',
] as const
