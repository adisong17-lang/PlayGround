import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const startedAt = Date.now()
const step = (label, since) => console.log(`${label}: ${Date.now() - since}ms`)
const fail = (message) => {
  const error = message instanceof Error ? message : new Error(String(message))
  console.error(error.stack || error.message)
  process.exitCode = error.transient ? 75 : 1
}
const transient = (error) => {
  if (error && typeof error === 'object') error.transient = true
  throw error
}

const url = process.env.CAPTURE_URL
const output = process.env.CAPTURE_DIR
if (!url || !output) {
  fail('Set CAPTURE_URL and CAPTURE_DIR.')
  process.exit(process.exitCode)
}
try {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('CAPTURE_URL must use http or https.')
} catch (error) {
  fail(error)
  process.exit(process.exitCode)
}

const runtime = process.env.PLAYWRIGHT_RUNTIME || join(process.env.HOME, '.local/share/omgithub-playwright')
const require = createRequire(join(runtime, 'package.json'))
let chromium
try {
  ;({ chromium } = require('playwright'))
} catch (error) {
  fail(`Playwright is unavailable: ${error.message}`)
  process.exit(process.exitCode)
}

let config = {}
try {
  const configPath = join(runtime, process.platform === 'darwin' ? 'metal.json' : 'linux.json')
  config = JSON.parse(readFileSync(configPath, 'utf8'))
  if (process.platform === 'linux') {
    const displayFile = join(runtime, 'display')
    if (!process.env.DISPLAY && existsSync(displayFile)) process.env.DISPLAY = ':' + readFileSync(displayFile, 'utf8').trim()
  }
} catch (error) {
  fail(`Could not read the browser configuration: ${error.message}`)
  process.exit(process.exitCode)
}

try {
  mkdirSync(output, { recursive: true })
} catch (error) {
  fail(`Could not create CAPTURE_DIR: ${error.message}`)
  process.exit(process.exitCode)
}

const launchOptions = { ...(config.browser?.launchOptions || {}), timeout: 30000 }
const readySelector = process.env.CAPTURE_READY_SELECTOR || 'main h1'
const viewports = [
  ['desktop', 1440, 900],
  ['mobile', 390, 844],
]
const pageErrors = []
let browser
try {
  const launchStarted = Date.now()
  browser = await chromium.launch(launchOptions).catch(transient)
  step('Browser launch', launchStarted)

  for (const [name, width, height] of viewports) {
    const captureStarted = Date.now()
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      isMobile: name === 'mobile',
      hasTouch: name === 'mobile',
    }).catch(transient)
    const page = await context.newPage().catch(transient)
    page.setDefaultTimeout(30000)
    page.on('pageerror', (error) => {
      pageErrors.push(error.message)
      console.error(`pageerror (${name}): ${error.message}`)
    })

    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(transient)
      if (!response) transient(new Error(`No HTTP response from ${url}`))
      const status = response.status()
      if (status < 200 || status >= 300) {
        const message = `HTTP ${status} loading ${url}`
        if ([408, 429, 500, 502, 503, 504].includes(status)) transient(new Error(message))
        throw new Error(message)
      }

      await page.waitForLoadState('load', { timeout: 45000 }).catch(transient)
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
      await page.locator(readySelector).first().waitFor({ state: 'visible', timeout: 20000 }).catch((error) => {
        throw new Error(`Rendered content ${JSON.stringify(readySelector)} was not visible: ${error.message}`)
      })
      await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 15000 }).catch((error) => {
        throw new Error(`Fonts did not finish loading: ${error.message}`)
      })
      const text = (await page.locator('body').innerText()).trim()
      if (text.length < 40) throw new Error('Page rendered too little visible text to capture.')
      if (pageErrors.length) throw new Error(`Page emitted ${pageErrors.length} JavaScript error(s).`)

      await page.screenshot({
        path: join(output, `final-${name}.png`),
        timeout: 30000,
        animations: 'disabled',
      }).catch((error) => {
        if (error.name === 'TimeoutError' || !browser.isConnected()) transient(error)
        throw error
      })
      console.log(`Captured ${name} ${width}x${height}: ${join(output, `final-${name}.png`)}`)
      step(`${name} capture`, captureStarted)
    } finally {
      await context.close().catch((error) => {
        console.error(`Could not close ${name} context: ${error.message}`)
        if (!process.exitCode) process.exitCode = 75
      })
    }
  }
} catch (error) {
  fail(error)
} finally {
  if (browser) {
    await browser.close().catch((error) => {
      console.error(`Could not close browser: ${error.message}`)
      if (!process.exitCode) process.exitCode = 75
    })
  }
  step('Total', startedAt)
}
