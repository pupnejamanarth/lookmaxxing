import { z } from 'zod'
import { ProductCategory } from '../catalog/schema'
import { BackupError } from './backupError'

const finite = z.number().refine(Number.isFinite)
const entry = z.looseObject({ ts: finite, result: z.enum(['no_reaction', 'mild_irritation', 'reaction']), note: z.string() })

const profile = z.looseObject({
  id: z.literal('me'),
  heightCm: finite.nullable(),
  units: z.enum(['metric', 'imperial']),
  dailyMinutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  trainingDaysPerWeek: z.number().int().min(0).max(7),
  scanWeekday: z.number().int().min(0).max(6),
  privacyChecklist: z.record(z.string(), z.boolean()),
  equipmentChecklist: z.record(z.string(), z.boolean()),
  onboardedAt: finite.nullable(),
  createdAt: finite,
  updatedAt: finite,
})

const whitelist = z.looseObject({
  id: z.string(),
  name: z.string(),
  category: ProductCategory,
  notes: z.string(),
  active: z.boolean(),
  addedAt: finite,
  updatedAt: finite,
  patchTest: z.looseObject({
    status: z.enum(['not_needed', 'not_started', 'in_progress', 'passed', 'failed']),
    startedAt: finite.nullable(),
    entries: z.array(entry),
  }),
})

const audit = z.looseObject({ ts: finite, event: z.string(), detail: z.string() })
const kv = z.looseObject({ key: z.string() })

const schemas: Record<string, z.ZodType> = { profile, whitelist, audit, kv }

/**
 * Shape-checks the rows of the tables this version knows (others pass through) and re-enforces the safety
 * invariant that an item whose patch test failed is never active. Mutates the rows it fixes.
 */
export function validateRows(tables: readonly { table: { name: string }; rows: Record<string, unknown>[] }[]): void {
  for (const { table, rows } of tables) {
    const schema = schemas[table.name]
    if (!schema) continue
    rows.forEach((row, i) => {
      if (!schema.safeParse(row).success) {
        throw new BackupError('invalid_content', `Table "${table.name}": row ${i + 1} does not have the expected shape.`)
      }
      const patchTest = row.patchTest as { status?: string } | undefined
      if (table.name === 'whitelist' && patchTest?.status === 'failed') row.active = false
    })
  }
}
