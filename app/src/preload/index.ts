import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// 渲染进程通过 additionalArguments 拿不到，这里直接读命令行参数
const arg = process.argv.find((a) => a.startsWith('--server-base='))
const serverBase = arg ? arg.slice('--server-base='.length) : 'http://127.0.0.1:8765'

const api = {
  serverBase,
  isElectron: true,
  /** 检查 GitHub 上的新版本（主进程发起请求，返回版本对比结果） */
  checkUpdate: (): Promise<{
    currentVersion: string
    latestVersion: string | null
    hasUpdate: boolean
    url: string | null
    notes: string | null
    error: string | null
  }> => ipcRenderer.invoke('check-update')
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
