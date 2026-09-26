const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('fs')
const path = require('path')

// 用法: electron render.js <variant> <out.png>
const VARIANT = process.argv[2] || 'large'
const OUT = process.argv[3]

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024, height: 1024, show: false,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: false }
  })
  await win.loadFile(path.join(__dirname, 'icon.html'))
  await new Promise((r) => setTimeout(r, 700))
  const dataUrl = await win.webContents.executeJavaScript(
    `window.__renderIcon(${JSON.stringify(VARIANT)})`
  )
  if (!dataUrl || !dataUrl.startsWith('data:image/png;base64,')) {
    console.error('ICON_ERROR 未拿到 PNG 数据')
    app.exit(1)
    return
  }
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64')
  writeFileSync(OUT, buf)
  console.log(`ICON_OK ${VARIANT} ${OUT} ${buf.length} bytes`)
  app.exit(0)
})
