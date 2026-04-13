import { ipcMain } from 'electron'
import {
  CHANNELS,
  type CreateSongInput,
  type UpdateSongPatch
} from '@shared/ipc-contract'
import {
  listSongs,
  getSong,
  createSong,
  updateSong,
  deleteSong
} from '../storage/songs'

export function registerSongHandlers(): void {
  ipcMain.handle(CHANNELS.songs.list, async () => listSongs())

  ipcMain.handle(CHANNELS.songs.get, async (_, id: string) => getSong(id))

  ipcMain.handle(CHANNELS.songs.create, async (_, input: CreateSongInput) =>
    createSong(input)
  )

  ipcMain.handle(
    CHANNELS.songs.update,
    async (_, id: string, patch: UpdateSongPatch) => updateSong(id, patch)
  )

  ipcMain.handle(CHANNELS.songs.delete, async (_, id: string) => deleteSong(id))

  ipcMain.handle(CHANNELS.songs.exportText, async (_, id: string) => {
    const song = await getSong(id)
    if (!song) throw new Error(`Song not found: ${id}`)
    return song.rawText
  })
}
