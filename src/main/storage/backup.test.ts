import { describe, expect, it, vi } from 'vitest'

// backup.ts imports `app` from electron at module load; the functions
// under test never touch it, so an empty stub is enough.
vi.mock('electron', () => ({ app: {} }))

import { autoBackupFilename, selectAutoBackupsToRotate } from './backup'

describe('autoBackupFilename', () => {
  it('prefixes the timestamped backup name with auto-', () => {
    expect(autoBackupFilename(new Date(2026, 3, 15, 9, 30, 22))).toBe(
      'auto-backup-20260415-093022.zip'
    )
  })
})

describe('selectAutoBackupsToRotate', () => {
  const autos = [
    'auto-backup-20260101-000000.zip',
    'auto-backup-20260102-000000.zip',
    'auto-backup-20260103-000000.zip'
  ]

  it('deletes the oldest auto backups beyond `keep`', () => {
    expect(selectAutoBackupsToRotate([...autos].reverse(), 1)).toEqual(autos.slice(0, 2))
  })

  it('deletes nothing when within `keep`', () => {
    expect(selectAutoBackupsToRotate(autos, 3)).toEqual([])
    expect(selectAutoBackupsToRotate(autos, 7)).toEqual([])
  })

  it('never selects manual, legacy, safety, or non-zip files', () => {
    const others = [
      'backup-20250101-000000.zip', // manual "Back up now" or pre-prefix auto backup
      'pre-import-backup-20250101-000000.zip',
      'auto-backup-state.json'
    ]
    expect(selectAutoBackupsToRotate([...others, ...autos], 0)).toEqual(autos)
    expect(selectAutoBackupsToRotate(others, 0)).toEqual([])
  })
})
