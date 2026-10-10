import { describe, expect, it } from 'vitest'
import { backupErrorMessage, formatBytes, formatDate, formatPercent, isShareCancel, judgeOrigins } from '../../src/routes/settings/helpers'
import { BackupError } from '../../src/store/backupError'

describe('settings helpers', () => {
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024)).toBe('1 MB')
    expect(formatBytes(250 * 1024 * 1024)).toBe('250 MB')
    expect(formatBytes(null)).toBe('unknown')
    expect(formatBytes(-1)).toBe('unknown')
    expect(formatBytes(Number.NaN)).toBe('unknown')
  })
  it('formats dates', () => {
    expect(formatDate(new Date(2026, 9, 10, 12).getTime())).toBe('2026-10-10')
    expect(formatDate(null)).toBe('unknown')
    expect(formatDate(Number.POSITIVE_INFINITY)).toBe('unknown')
  })
  it('formats percent', () => {
    expect(formatPercent(1, 1000)).toBe('under 1%')
    expect(formatPercent(0, 1000)).toBe('0%')
    expect(formatPercent(500, 1000)).toBe('50%')
    expect(formatPercent(null, 1000)).toBe('unknown')
  })
  it('maps backup errors', () => {
    expect(backupErrorMessage(new BackupError('bad_magic'))).toContain('not a Lookmaxing backup')
    expect(backupErrorMessage(new BackupError('wrong_passphrase_or_corrupt'))).toContain('Wrong passphrase')
    expect(backupErrorMessage(new Error('boom'))).toBe('Something went wrong. Nothing was changed.')
    expect(backupErrorMessage(null)).toBe('Something went wrong. Nothing was changed.')
  })
  it('detects share cancel', () => {
    expect(isShareCancel({ name: 'AbortError' })).toBe(true)
    expect(isShareCancel(new Error('x'))).toBe(false)
  })
  it('judges origins', () => {
    expect(judgeOrigins(1, [])).toEqual({ ok: true })
    expect(judgeOrigins(2, ['https://x.example']).ok).toBe(false)
    expect(judgeOrigins(0, []).ok).toBe(false)
  })
})

describe('tableLabel fallback', () => {
  it('humanises unknown table names', async () => {
    const { tableLabel } = await import('../../src/routes/settings/helpers')
    expect(tableLabel('kv')).toBe('Settings values')
    expect(tableLabel('measurement_sessions')).toBe('Measurement sessions')
    expect(tableLabel('photoBlobs')).toBe('Photo blobs')
  })
})
