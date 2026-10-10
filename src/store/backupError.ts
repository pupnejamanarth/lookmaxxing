export type BackupErrorCode =
  | 'weak_passphrase'
  | 'bad_magic'
  | 'unsupported_version'
  | 'wrong_passphrase_or_corrupt'
  | 'too_large'
  | 'invalid_content'
  | 'kdf_params_out_of_range'

/** Shown when the caller gives no more specific text. Never contains data from the file. */
const DEFAULT_MESSAGES: Record<BackupErrorCode, string> = {
  weak_passphrase: 'Choose a stronger passphrase.',
  bad_magic: 'This is not a Lookmaxing backup file.',
  unsupported_version: 'This backup was made by a different version of the app and cannot be opened.',
  // GCM cannot tell the two apart, and neither can we.
  wrong_passphrase_or_corrupt: 'Wrong passphrase, or the backup file is damaged.',
  too_large: 'This backup is too large to handle on this device.',
  invalid_content: 'The backup could not be read because its contents are not valid.',
  kdf_params_out_of_range: 'This backup uses unsafe encryption settings and was not opened.',
}

export class BackupError extends Error {
  readonly code: BackupErrorCode

  constructor(code: BackupErrorCode, message?: string) {
    super(message ?? DEFAULT_MESSAGES[code])
    this.name = 'BackupError'
    this.code = code
  }
}
