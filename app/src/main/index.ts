import { app, shell, BrowserWindow, session, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { spawn, type ChildProcess } from 'child_process'
import { homedir } from 'os'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

const PORT = 8765
const SERVER_BASE = `http://127.0.0.1:${PORT}`
const MODEL_DIR_NAME = 'Breeze-TTS-2-mlx'
const REPO_API = 'https://api.github.com/repos/wscnv93/Breezetts2/releases/latest'
const REPO_RELEASES = 'https://github.com/wscnv93/Breezetts2/releases'

export interface UpdateInfo {
  currentVersion: string
  latestVersion: string | null
  hasUpdate: boolean
  url: string | null
  notes: string | null
  error: string | null
}

let backend: ChildProcess | null = null
let serverReady: Promise<string> | null = null

/** 应用数据目录（历史、参考音色）：统一放在 ~/.breezevoice */
function dataDir(): string {
  return join(homedir(), '.breezevoice')
}

/** 后端代码目录：打包后随 extraResources 落在 Resources/backend */
function backendDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'backend')
    : join(__dirname, '..', '..', '..', 'backend')
}

/** Python 解释器：打包后用随包的 venv，开发时用项目里的 .venv */
function pythonBin(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'backend-venv', 'bin', 'python')
    : join(backendDir(), '.venv', 'bin', 'python')
}

/** 模型目录：~/.downloadmodels 优先，其次 ~/.breezevoice 与旧版位置。
 *  仅用于启动失败时的提示；实际解析由后端完成（含设置面板指定的路径）。 */
function resolveModelPath(): string | null {
  const candidates = [
    join(homedir(), '.downloadmodels', MODEL_DIR_NAME),
    join(homedir(), '.breezevoice', 'models', MODEL_DIR_NAME),
    join(homedir(), 'Library', 'Application Support', 'BreezeVoice', 'models', MODEL_DIR_NAME),
    join(__dirname, '..', '..', '..', 'models', MODEL_DIR_NAME),
    join(process.resourcesPath ?? '', 'models', MODEL_DIR_NAME)
  ].filter(Boolean) as string[]
  return candidates.find((p) => existsSync(p)) ?? null
}

/** ffmpeg 用于参考音频转码；打包后 PATH 可能不含 homebrew */
function extraPathDirs(): string {
  return ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':')
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ---------- 更新检测 ----------

function cmpVersion(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

async function checkForUpdate(): Promise<UpdateInfo> {
  const base: UpdateInfo = {
    currentVersion: app.getVersion(),
    latestVersion: null,
    hasUpdate: false,
    url: null,
    notes: null,
    error: null
  }
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 10_000)
    const r = await fetch(REPO_API, {
      signal: ctrl.signal,
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'BreezeVoice' }
    })
    clearTimeout(t)
    if (!r.ok) return { ...base, error: `GitHub API ${r.status}` }
    const rel = (await r.json()) as {
      tag_name?: string
      html_url?: string
      body?: string
      draft?: boolean
      prerelease?: boolean
    }
    if (!rel.tag_name) return { ...base, error: '没有可用的 release' }
    const latestVersion = rel.tag_name
    const hasUpdate = cmpVersion(latestVersion, base.currentVersion) > 0
    return {
      ...base,
      latestVersion,
      hasUpdate,
      url: rel.html_url ?? REPO_RELEASES,
      notes: rel.body ?? null
    }
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : '网络错误' }
  }
}

async function autoCheckUpdate(): Promise<void> {
  const info = await checkForUpdate()
  if (!info.hasUpdate) return // 无更新或网络失败都静默
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: '发现新版本',
    message: `微风之声 ${info.latestVersion} 已发布（当前 v${info.currentVersion}）`,
    detail: '是否前往 GitHub 下载新版本？',
    buttons: ['前往下载', '以后再说'],
    defaultId: 0
  })
  if (response === 0 && info.url) void shell.openExternal(info.url)
}

async function probeHealth(timeoutMs = 800): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const r = await fetch(`${SERVER_BASE}/api/health`, { signal: ctrl.signal })
    clearTimeout(t)
    return r.ok
  } catch {
    return false
  }
}

function spawnBackend(): ChildProcess {
  const py = pythonBin()
  const dir = backendDir()

  const env = {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    PYTHONPATH: dir,
    PATH: `${extraPathDirs()}:${process.env.PATH ?? ''}`,
    BREEZE_DATA_DIR: dataDir()
  }

  console.log(`[main] 后端: python=${py} dir=${dir}`)
  console.log(`[main] 数据目录: ${dataDir()}`)

  if (!existsSync(py)) {
    throw new Error(
      `找不到 Python 解释器：${py}\n` +
        (app.isPackaged ? '应用包可能不完整，请重新构建。' : '请先在 backend/ 执行 uv sync。')
    )
  }

  const child = spawn(py, [join(dir, 'server.py'), '--port', String(PORT)], {
    env,
    cwd: dataDir(),
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const pipe =
    (mark: string, dump: (s: string) => void) =>
    (d: Buffer): void => {
      for (const line of d.toString().split('\n')) {
        if (line.trim()) dump(`[backend] ${mark}${line}`)
      }
    }
  child.stdout?.on('data', pipe('', console.log))
  child.stderr?.on('data', pipe('stderr ', console.error))
  child.on('exit', (code, signal) => {
    console.log(`[backend] exited code=${code} signal=${signal}`)
    if (backend === child) backend = null
  })
  return child
}

async function ensureBackend(): Promise<string> {
  if (await probeHealth()) return SERVER_BASE
  backend = spawnBackend()
  const deadline = Date.now() + 240_000 // 冷启动含模型加载
  while (Date.now() < deadline) {
    if (await probeHealth()) return SERVER_BASE
    if (backend.exitCode !== null) throw new Error(`后端进程提前退出 (code=${backend.exitCode})`)
    await sleep(600)
  }
  throw new Error('后端启动超时（240s），请查看主进程日志')
}

function createWindow(serverBase: string): void {
  const mainWindow = new BrowserWindow({
    width: 1220,
    height: 800,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    title: '微风之声 BreezeVoice',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      additionalArguments: [`--server-base=${serverBase}`]
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.breezevoice.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 麦克风录音权限（声音克隆录制参考音频用）
  // request 处理实际授权，check 供 Chromium 查询权限状态，两者都要放行 media
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'media'
  })
  // 下载（导出历史音频）直接落到系统下载目录
  session.defaultSession.on('will-download', (_e, item) => {
    item.setSavePath(join(app.getPath('downloads'), item.getFilename()))
  })

  // 打包后数据目录可能不存在，先建好（后端也需要写权限）
  try {
    mkdirSync(join(dataDir(), 'outputs', 'history'), { recursive: true })
    mkdirSync(join(dataDir(), 'outputs', 'refs'), { recursive: true })
  } catch (e) {
    console.error('[main] 创建数据目录失败:', e)
  }

  // 更新检测：设置面板手动触发 + 启动 10s 后自动静默检查
  ipcMain.handle('check-update', () => checkForUpdate())
  setTimeout(() => void autoCheckUpdate(), 10_000)

  if (!serverReady) serverReady = ensureBackend()
  serverReady
    .then((base) => createWindow(base))
    .catch((err) => {
      console.error('[main] 后端启动失败:', err)
      const modelPath = resolveModelPath()
      const hint = modelPath
        ? ''
        : `\n\n还没有找到模型目录。可以在应用「设置」面板里直接下载模型（约 7.1GB），\n` +
          `或手动下载到 ${join(homedir(), '.downloadmodels', MODEL_DIR_NAME)} 后重新打开本应用。`
      dialog.showErrorBox('后端启动失败', `${err?.message ?? err}${hint}`)
    })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0 && serverReady) {
      serverReady.then(createWindow)
    }
  })
})

function shutdownBackend(): void {
  if (backend && backend.exitCode === null) {
    backend.kill('SIGTERM')
    setTimeout(() => {
      if (backend && backend.exitCode === null) backend.kill('SIGKILL')
    }, 3000)
  }
}

app.on('before-quit', shutdownBackend)
app.on('will-quit', shutdownBackend)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
