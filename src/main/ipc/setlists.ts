import { ipcMain } from 'electron'
import {
  CHANNELS,
  type CreateSetlistInput,
  type UpdateSetlistPatch
} from '@shared/ipc-contract'
import {
  listSetlists,
  getSetlist,
  createSetlist,
  updateSetlist,
  deleteSetlist,
  cloneSetlist
} from '../storage/setlists'

export function registerSetlistHandlers(): void {
  ipcMain.handle(CHANNELS.setlists.list, async () => listSetlists())

  ipcMain.handle(CHANNELS.setlists.get, async (_, id: string) => getSetlist(id))

  ipcMain.handle(
    CHANNELS.setlists.create,
    async (_, input: CreateSetlistInput) => createSetlist(input)
  )

  ipcMain.handle(
    CHANNELS.setlists.update,
    async (_, id: string, patch: UpdateSetlistPatch) => updateSetlist(id, patch)
  )

  ipcMain.handle(CHANNELS.setlists.delete, async (_, id: string) =>
    deleteSetlist(id)
  )

  ipcMain.handle(
    CHANNELS.setlists.clone,
    async (_, sourceId: string, newName: string, newDate: string) =>
      cloneSetlist(sourceId, newName, newDate)
  )
}
