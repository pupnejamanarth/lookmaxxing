import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { open, withoutShare } from './helpers'

const PASS = 'correct horse battery staple'

async function addItem(page: Page, name: string) {
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/^Name/).fill(name)
  await dialog.getByRole('button', { name: 'Add product' }).click()
  await expect(dialog).toHaveCount(0)
}

test('backup: export, wipe, restore, wrong and weak passphrases', async ({ page }, info) => {
  await withoutShare(page)
  await open(page, '/whitelist')
  await addItem(page, 'Backup item one')
  await addItem(page, 'Backup item two')
  await expect(page.getByRole('article')).toHaveCount(2)

  await open(page, '/settings')
  const exportBtn = page.getByRole('button', { name: 'Export encrypted backup' })

  // Weak passphrase: rejected, export stays disabled.
  await page.getByLabel('Passphrase', { exact: true }).first().fill('short')
  await page.getByLabel('Repeat passphrase').fill('short')
  await expect(exportBtn).toBeDisabled()
  await expect(page.getByRole('alert').filter({ hasText: /12 characters/i }).first()).toBeVisible()

  // Mismatch
  await page.getByLabel('Passphrase', { exact: true }).first().fill(PASS)
  await page.getByLabel('Repeat passphrase').fill(PASS + 'x')
  await expect(page.getByText('The passphrases do not match.')).toBeVisible()
  await expect(exportBtn).toBeDisabled()

  // Export
  await page.getByLabel('Repeat passphrase').fill(PASS)
  await expect(page.getByText('Passphrase accepted.')).toBeVisible()
  const [download] = await Promise.all([page.waitForEvent('download'), exportBtn.click()])
  expect(download.suggestedFilename()).toMatch(/\.lmxbackup$/)
  const file = info.outputPath('backup.lmxbackup')
  await download.saveAs(file)
  expect(readFileSync(file).length).toBeGreaterThan(100)
  await expect(page.getByText('Backup downloaded.')).toBeVisible()
  // The file is encrypted: item names are not readable in it.
  expect(readFileSync(file).toString('latin1')).not.toContain('Backup item one')

  // Wipe
  await page.getByRole('button', { name: 'Delete all data on this device' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/Type DELETE/).fill('DELETE')
  await Promise.all([page.waitForEvent('load'), dialog.getByRole('button', { name: 'Delete everything' }).click()])
  await expect(page.getByRole('heading', { level: 1, name: 'Unmoggable' })).toBeVisible()
  await open(page, '/whitelist')
  await expect(page.getByText('No products yet')).toBeVisible()

  // Restore: wrong passphrase first
  await open(page, '/settings')
  await page.getByLabel('Backup file').setInputFiles(file)
  const restorePass = page.getByLabel('Passphrase', { exact: true }).last()
  await restorePass.fill('this is not the passphrase')
  await page.getByRole('button', { name: 'Check backup' }).click()
  await expect(page.getByText('Wrong passphrase, or the file is damaged. The app cannot tell which.')).toBeVisible()

  // Right passphrase
  await restorePass.fill(PASS)
  await page.getByRole('button', { name: 'Check backup' }).click()
  await expect(page.getByRole('heading', { name: 'This backup' })).toBeVisible()
  await expect(page.getByText('Whitelist items')).toBeVisible()
  await page.getByRole('button', { name: 'Replace everything on this device' }).click()
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('dialog').getByRole('button', { name: 'Replace everything on this device' }).click(),
  ])
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
  await open(page, '/whitelist')
  await expect(page.getByRole('article')).toHaveCount(2)
  await expect(page.getByText('Backup item one')).toBeVisible()
  await expect(page.getByText('Backup item two')).toBeVisible()
})
