/**
 * Window registry — the main process keeps references to the two
 * BrowserWindows (operator + output) so IPC handlers can push messages
 * into them without importing main/index.ts directly (which would
 * create a circular dependency: index imports ipc which imports index).
 *
 * Usage:
 *   import { setOperatorWindow, setOutputWindow } from './windows'
 *   ...
 *   setOperatorWindow(operatorWindow)
 *   setOutputWindow(outputWindow)
 *
 * Handlers:
 *   import { getOutputWindow } from './windows'
 *   getOutputWindow()?.webContents.send('output:event:slide', payload)
 */

import type { BrowserWindow } from 'electron'

let operatorWindow: BrowserWindow | null = null
let outputWindow: BrowserWindow | null = null
let stageMonitorWindow: BrowserWindow | null = null
let lowerThirdsWindow: BrowserWindow | null = null

export function setOperatorWindow(win: BrowserWindow | null): void {
  operatorWindow = win
  if (win) {
    win.on('closed', () => {
      if (operatorWindow === win) operatorWindow = null
    })
  }
}

export function setOutputWindow(win: BrowserWindow | null): void {
  outputWindow = win
  if (win) {
    win.on('closed', () => {
      if (outputWindow === win) outputWindow = null
    })
  }
}

export function setStageMonitorWindow(win: BrowserWindow | null): void {
  stageMonitorWindow = win
  if (win) {
    win.on('closed', () => {
      if (stageMonitorWindow === win) stageMonitorWindow = null
    })
  }
}

export function setLowerThirdsWindow(win: BrowserWindow | null): void {
  lowerThirdsWindow = win
  if (win) {
    win.on('closed', () => {
      if (lowerThirdsWindow === win) lowerThirdsWindow = null
    })
  }
}

export function getOperatorWindow(): BrowserWindow | null {
  return operatorWindow
}

export function getOutputWindow(): BrowserWindow | null {
  return outputWindow
}

export function getStageMonitorWindow(): BrowserWindow | null {
  return stageMonitorWindow
}

export function getLowerThirdsWindow(): BrowserWindow | null {
  return lowerThirdsWindow
}

/**
 * All "projector-class" windows that mirror the active slide content:
 * the main output and the stage monitor (if enabled). Used by IPC
 * broadcasters that want to update every slide-receiving window in a
 * single call. Excludes the lower thirds window (it has its own
 * content channel) and the operator window (it has its own state).
 */
export function getAllProjectorWindows(): BrowserWindow[] {
  const wins: BrowserWindow[] = []
  if (outputWindow && !outputWindow.isDestroyed()) wins.push(outputWindow)
  if (stageMonitorWindow && !stageMonitorWindow.isDestroyed())
    wins.push(stageMonitorWindow)
  return wins
}
