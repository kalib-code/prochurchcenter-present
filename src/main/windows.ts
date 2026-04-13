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

export function getOperatorWindow(): BrowserWindow | null {
  return operatorWindow
}

export function getOutputWindow(): BrowserWindow | null {
  return outputWindow
}
