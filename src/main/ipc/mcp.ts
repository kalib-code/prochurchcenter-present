import { ipcMain } from 'electron'
import { CHANNELS } from '@shared/ipc-contract'
import {
  getMcpState,
  regenerateMcpToken,
  setMcpEnabled,
  setMcpPort
} from '../mcp'

export function registerMcpHandlers(): void {
  ipcMain.handle(CHANNELS.mcp.getState, () => getMcpState())
  ipcMain.handle(CHANNELS.mcp.setEnabled, (_, enabled: boolean) => setMcpEnabled(enabled === true))
  ipcMain.handle(CHANNELS.mcp.regenerateToken, () => regenerateMcpToken())
  ipcMain.handle(CHANNELS.mcp.setPort, (_, port: number) => setMcpPort(Number(port)))
}
