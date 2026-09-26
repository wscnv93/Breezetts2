/// <reference types="vite/client" />

interface Window {
  // Electron preload 注入；纯浏览器开发时为 undefined
  api?: {
    serverBase: string
    isElectron: boolean
    checkUpdate: () => Promise<{
      currentVersion: string
      latestVersion: string | null
      hasUpdate: boolean
      url: string | null
      notes: string | null
      error: string | null
    }>
  }
}
