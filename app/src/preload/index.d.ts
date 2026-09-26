import { ElectronAPI } from '@electron-toolkit/preload'

export interface UpdateInfo {
  currentVersion: string
  latestVersion: string | null
  hasUpdate: boolean
  url: string | null
  notes: string | null
  error: string | null
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      serverBase: string
      isElectron: boolean
      checkUpdate: () => Promise<UpdateInfo>
    }
  }
}
