import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  CHANNELS,
  type PresentApi,
  type CreateSongInput,
  type UpdateSongPatch,
  type CreateSetlistInput,
  type UpdateSetlistPatch,
  type UpdateThemePatch,
  type UpdateSettingsPatch,
  type SlidePayload,
  type OutputMode,
  type PickFileKind,
  type VideoControl,
  type VideoTimeUpdate,
  type LowerThirdsContent,
  type StageContext,
  type BackupImportMode
} from '@shared/ipc-contract'
import type { CanvaImportProgress } from '@shared/canva'
import type { Theme, ThemeOverride } from '@shared/types'

/**
 * `window.api` — the single typed surface the renderer uses to talk to the
 * main process. Every call is a thin wrapper around `ipcRenderer.invoke`
 * with a CHANNELS name from the shared contract. No loose channel strings.
 */
const api: PresentApi = {
  songs: {
    list: () => ipcRenderer.invoke(CHANNELS.songs.list),
    get: (id: string) => ipcRenderer.invoke(CHANNELS.songs.get, id),
    create: (input: CreateSongInput) => ipcRenderer.invoke(CHANNELS.songs.create, input),
    update: (id: string, patch: UpdateSongPatch) =>
      ipcRenderer.invoke(CHANNELS.songs.update, id, patch),
    delete: (id: string) => ipcRenderer.invoke(CHANNELS.songs.delete, id),
    exportText: (id: string) => ipcRenderer.invoke(CHANNELS.songs.exportText, id)
  },
  setlists: {
    list: () => ipcRenderer.invoke(CHANNELS.setlists.list),
    get: (id: string) => ipcRenderer.invoke(CHANNELS.setlists.get, id),
    create: (input: CreateSetlistInput) =>
      ipcRenderer.invoke(CHANNELS.setlists.create, input),
    update: (id: string, patch: UpdateSetlistPatch) =>
      ipcRenderer.invoke(CHANNELS.setlists.update, id, patch),
    delete: (id: string) => ipcRenderer.invoke(CHANNELS.setlists.delete, id),
    clone: (sourceId: string, newName: string, newDate: string) =>
      ipcRenderer.invoke(CHANNELS.setlists.clone, sourceId, newName, newDate)
  },
  theme: {
    list: () => ipcRenderer.invoke(CHANNELS.theme.list),
    get: (id: string) => ipcRenderer.invoke(CHANNELS.theme.get, id),
    update: (id: string, patch: UpdateThemePatch) =>
      ipcRenderer.invoke(CHANNELS.theme.update, id, patch),
    onChange: (callback: (theme: Theme) => void): (() => void) => {
      const listener = (_: IpcRendererEvent, theme: Theme): void => callback(theme)
      ipcRenderer.on(CHANNELS.theme.eventChange, listener)
      return () => ipcRenderer.removeListener(CHANNELS.theme.eventChange, listener)
    }
  },
  settings: {
    get: () => ipcRenderer.invoke(CHANNELS.settings.get),
    update: (patch: UpdateSettingsPatch) =>
      ipcRenderer.invoke(CHANNELS.settings.update, patch)
  },
  // Handlers for system/files arrive with the pre-flight main-process task;
  // the bridge is declared here so PresentApi stays fully implemented.
  system: {
    getPreflight: (setlistId: string | null) =>
      ipcRenderer.invoke(CHANNELS.system.getPreflight, setlistId),
    openExternal: (url: string) => ipcRenderer.invoke(CHANNELS.system.openExternal, url)
  },
  files: {
    checkExists: (paths: string[]) => ipcRenderer.invoke(CHANNELS.files.checkExists, paths)
  },
  dialog: {
    pickFile: (kind: PickFileKind) =>
      ipcRenderer.invoke(CHANNELS.dialog.pickFile, kind)
  },
  fonts: {
    list: () => ipcRenderer.invoke(CHANNELS.fonts.list),
    upload: () => ipcRenderer.invoke(CHANNELS.fonts.upload),
    delete: (family: string) =>
      ipcRenderer.invoke(CHANNELS.fonts.delete, family)
  },
  backup: {
    exportNow: () => ipcRenderer.invoke(CHANNELS.backup.exportNow),
    list: () => ipcRenderer.invoke(CHANNELS.backup.list),
    restore: (absolutePath: string, mode: BackupImportMode) =>
      ipcRenderer.invoke(CHANNELS.backup.restore, absolutePath, mode),
    delete: (absolutePath: string) =>
      ipcRenderer.invoke(CHANNELS.backup.delete, absolutePath),
    openFolder: () => ipcRenderer.invoke(CHANNELS.backup.openFolder),
    importFromFile: (mode: BackupImportMode) =>
      ipcRenderer.invoke(CHANNELS.backup.importFromFile, mode)
  },
  updater: {
    getVersion: () => ipcRenderer.invoke(CHANNELS.updater.getVersion),
    checkNow: () => ipcRenderer.invoke(CHANNELS.updater.checkNow)
  },
  bible: {
    listTranslations: () => ipcRenderer.invoke(CHANNELS.bible.listTranslations),
    listBooks: (translationId: string) =>
      ipcRenderer.invoke(CHANNELS.bible.listBooks, translationId),
    getChapter: (translationId: string, bookId: string, chapter: number) =>
      ipcRenderer.invoke(CHANNELS.bible.getChapter, translationId, bookId, chapter),
    lookup: (translationId: string, reference: string) =>
      ipcRenderer.invoke(CHANNELS.bible.lookup, translationId, reference)
  },
  canva: {
    getState: () => ipcRenderer.invoke(CHANNELS.canva.getState),
    connect: () => ipcRenderer.invoke(CHANNELS.canva.connect),
    disconnect: () => ipcRenderer.invoke(CHANNELS.canva.disconnect),
    listDesigns: (query: string | null, continuation: string | null) =>
      ipcRenderer.invoke(CHANNELS.canva.listDesigns, query, continuation),
    importDesign: (designId: string, title: string) =>
      ipcRenderer.invoke(CHANNELS.canva.importDesign, designId, title),
    checkStale: (items: { designId: string; designUpdatedAt: string }[]) =>
      ipcRenderer.invoke(CHANNELS.canva.checkStale, items),
    deletePdf: (absPath: string) => ipcRenderer.invoke(CHANNELS.canva.deletePdf, absPath),
    onImportProgress: (callback: (p: CanvaImportProgress) => void): (() => void) => {
      const listener = (_: IpcRendererEvent, p: CanvaImportProgress): void => callback(p)
      ipcRenderer.on(CHANNELS.canva.eventImportProgress, listener)
      return () => ipcRenderer.removeListener(CHANNELS.canva.eventImportProgress, listener)
    }
  },
  output: {
    setSlide: (payload: SlidePayload) =>
      ipcRenderer.invoke(CHANNELS.output.setSlide, payload),
    setBlack: () => ipcRenderer.invoke(CHANNELS.output.setBlack),
    setLogo: () => ipcRenderer.invoke(CHANNELS.output.setLogo),
    setLive: () => ipcRenderer.invoke(CHANNELS.output.setLive),
    setItemThemeOverride: (override: ThemeOverride | null) =>
      ipcRenderer.invoke(CHANNELS.output.setItemThemeOverride, override),
    setVideoControl: (control: VideoControl) =>
      ipcRenderer.invoke(CHANNELS.output.setVideoControl, control),
    setVideoTimeUpdate: (update: VideoTimeUpdate) =>
      ipcRenderer.invoke(CHANNELS.output.setVideoTimeUpdate, update),
    setVideoEnded: (payload: { videoPath: string }) =>
      ipcRenderer.invoke(CHANNELS.output.setVideoEnded, payload),
    getCaptureSourceId: () => ipcRenderer.invoke(CHANNELS.output.getCaptureSourceId),
    listDisplays: () => ipcRenderer.invoke(CHANNELS.output.listDisplays),
    setDisplay: (displayId: number | null) =>
      ipcRenderer.invoke(CHANNELS.output.setDisplay, displayId),
    setStageMonitorEnabled: (enabled: boolean) =>
      ipcRenderer.invoke(CHANNELS.output.setStageMonitorEnabled, enabled),
    setStageMonitorDisplay: (displayId: number | null) =>
      ipcRenderer.invoke(CHANNELS.output.setStageMonitorDisplay, displayId),
    setLowerThirdsEnabled: (enabled: boolean) =>
      ipcRenderer.invoke(CHANNELS.output.setLowerThirdsEnabled, enabled),
    setLowerThirdsDisplay: (displayId: number | null) =>
      ipcRenderer.invoke(CHANNELS.output.setLowerThirdsDisplay, displayId),
    setLowerThirdsContent: (content: LowerThirdsContent) =>
      ipcRenderer.invoke(CHANNELS.output.setLowerThirdsContent, content),
    setStageContext: (context: StageContext) =>
      ipcRenderer.invoke(CHANNELS.output.setStageContext, context),

    // Subscription helpers — used by the OUTPUT renderer only. Return
    // an unsubscribe function so React effects can clean up naturally.
    onSlide: (callback: (payload: SlidePayload) => void): (() => void) => {
      const listener = (_: IpcRendererEvent, payload: SlidePayload): void =>
        callback(payload)
      ipcRenderer.on(CHANNELS.output.eventSlide, listener)
      return () => ipcRenderer.removeListener(CHANNELS.output.eventSlide, listener)
    },
    onMode: (callback: (mode: OutputMode) => void): (() => void) => {
      const listener = (_: IpcRendererEvent, mode: OutputMode): void =>
        callback(mode)
      ipcRenderer.on(CHANNELS.output.eventMode, listener)
      return () => ipcRenderer.removeListener(CHANNELS.output.eventMode, listener)
    },
    onItemThemeOverride: (
      callback: (override: ThemeOverride | null) => void
    ): (() => void) => {
      const listener = (
        _: IpcRendererEvent,
        override: ThemeOverride | null
      ): void => callback(override)
      ipcRenderer.on(CHANNELS.output.eventItemThemeOverride, listener)
      return () =>
        ipcRenderer.removeListener(CHANNELS.output.eventItemThemeOverride, listener)
    },
    onVideoControl: (
      callback: (control: VideoControl) => void
    ): (() => void) => {
      const listener = (_: IpcRendererEvent, control: VideoControl): void =>
        callback(control)
      ipcRenderer.on(CHANNELS.output.eventVideoControl, listener)
      return () =>
        ipcRenderer.removeListener(CHANNELS.output.eventVideoControl, listener)
    },
    onVideoTimeUpdate: (
      callback: (update: VideoTimeUpdate) => void
    ): (() => void) => {
      const listener = (_: IpcRendererEvent, update: VideoTimeUpdate): void =>
        callback(update)
      ipcRenderer.on(CHANNELS.output.eventVideoTimeUpdate, listener)
      return () =>
        ipcRenderer.removeListener(CHANNELS.output.eventVideoTimeUpdate, listener)
    },
    onVideoEnded: (
      callback: (payload: { videoPath: string }) => void
    ): (() => void) => {
      const listener = (
        _: IpcRendererEvent,
        payload: { videoPath: string }
      ): void => callback(payload)
      ipcRenderer.on(CHANNELS.output.eventVideoEnded, listener)
      return () =>
        ipcRenderer.removeListener(CHANNELS.output.eventVideoEnded, listener)
    },
    onLowerThirdsContent: (
      callback: (content: LowerThirdsContent) => void
    ): (() => void) => {
      const listener = (
        _: IpcRendererEvent,
        content: LowerThirdsContent
      ): void => callback(content)
      ipcRenderer.on(CHANNELS.output.eventLowerThirdsContent, listener)
      return () =>
        ipcRenderer.removeListener(
          CHANNELS.output.eventLowerThirdsContent,
          listener
        )
    },
    onStageContext: (
      callback: (context: StageContext) => void
    ): (() => void) => {
      const listener = (_: IpcRendererEvent, context: StageContext): void =>
        callback(context)
      ipcRenderer.on(CHANNELS.output.eventStageContext, listener)
      return () =>
        ipcRenderer.removeListener(CHANNELS.output.eventStageContext, listener)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
