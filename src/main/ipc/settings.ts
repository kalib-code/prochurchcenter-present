import { ipcMain } from 'electron'
import { CHANNELS, type UpdateSettingsPatch } from '@shared/ipc-contract'
import { getSettings, updateSettings } from '../storage/settings'

export function registerSettingsHandlers(): void {
  ipcMain.handle(CHANNELS.settings.get, async () => getSettings())

  ipcMain.handle(CHANNELS.settings.update, async (_, patch: UpdateSettingsPatch) =>
    updateSettings(patch)
  )
}
