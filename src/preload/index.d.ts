import { ElectronAPI } from '@electron-toolkit/preload'
import type { PresentApi } from '@shared/ipc-contract'

declare global {
  interface Window {
    electron: ElectronAPI
    api: PresentApi
  }
}
