/**
 * Captures each example page's canvas, without the GUI, stats or hints, for the READMEs and the website. A screenshot
 * goes beside its page, named after it: rendering/bloom/index.html → rendering/bloom/index.webp,
 * simulations/noodles/worms.html → simulations/noodles/worms.webp. The pages in examples/ share examples/screenshots/.
 *
 *   npm run dev                                       // serves the pages on localhost:5174
 *   npm run screenshots                               // the pages without a screenshot yet
 *   npm run screenshots -- --all                      // every page
 *   npm run screenshots -- --all --filter=bloom,worms --wait=10
 *
 * --filter=a,b and --filter-out=a,b match page paths, --wait=<s> overrides each page's settle time, and
 * --out=<dir> writes them all into one folder instead, an index.html's named after its folder.
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { styleText } from 'node:util'
import puppeteer from 'puppeteer'

const DEV_SERVER = 'http://localhost:5174'
const WIDTH = 1280
const HEIGHT = 720
const QUALITY = 85
// Seconds each page runs after loading, so its simulation settles and its temporal effects converge.
const SETTLE = { noodles: 10, worms: 20 }
const DEFAULT_SETTLE = 3
const LOAD_TIMEOUT_MS = 120_000

const flag = (name) => process.argv.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1)
const list = (name) => flag(name)?.split(',').filter(Boolean) ?? []
const filters = list('--filter')
const filtersOut = list('--filter-out')
const all = process.argv.includes('--all')
const wait = flag('--wait')

const root = resolve(import.meta.dirname, '..')
const outDir = flag('--out') && resolve(root, flag('--out'))

const pages = ['rendering', 'simulations', 'examples']
  .flatMap((dir) => readdirSync(join(root, dir), { recursive: true }).map((file) => join(dir, file)))
  .filter((file) => file.endsWith('.html'))
  .filter((file) => filters.length === 0 || filters.some((f) => file.includes(f)))
  .filter((file) => !filtersOut.some((f) => file.includes(f)))
  .map((file) => {
    const folder = dirname(file)
    const page = basename(file, '.html')
    const index = page === 'index'
    const name = index ? basename(folder) : page
    const out = outDir
      ? join(outDir, `${name}.webp`)
      : join(root, folder === 'examples' ? 'examples/screenshots' : folder, `${page}.webp`)
    return { name, url: `${DEV_SERVER}/${index ? `${folder}/` : file}`, out }
  })
  .filter((page) => all || !existsSync(page.out))
  .sort((a, b) => a.name.localeCompare(b.name))

if (pages.length === 0) {
  console.log(all ? 'No pages match.' : 'Every page has a screenshot. Use --all to regenerate them.')
  process.exit(0)
}

try {
  await fetch(DEV_SERVER)
} catch {
  console.error(styleText('red', `No dev server on ${DEV_SERVER}: start it with npm run dev.`))
  process.exit(1)
}

const launch = () =>
  puppeteer.launch({
    headless: 'shell',
    // The real GPU: SwiftShader can't run the compute-heavy pages.
    args: [
      ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []),
      '--enable-unsafe-webgpu',
      '--ignore-gpu-blocklist',
      '--hide-scrollbars',
    ],
    protocolTimeout: 3 * 60_000,
  })

const close = async (browser) => {
  const closed = await Promise.race([
    browser.close().then(() => true, () => false),
    new Promise((r) => setTimeout(() => r(false), 10_000)),
  ])
  if (!closed) browser.process()?.kill('SIGKILL')
}

console.log(styleText('cyan', `Capturing ${pages.length} page(s)\n`))

let captured = 0

for (const [i, { name, url, out }] of pages.entries()) {
  const settle = Number(wait ?? SETTLE[name] ?? DEFAULT_SETTLE)
  console.log(`${styleText('yellow', `[${i + 1}/${pages.length}]`)} ${styleText('magenta', name)} ${url}`)

  const browser = await launch()
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: WIDTH, height: HEIGHT })

    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60_000 })

    // Loaded once a canvas draws and any loading screen is done.
    const failure = await page.waitForFunction(
      () => {
        const loading = document.getElementById('loading')
        if (loading?.classList.contains('failed')) return loading.querySelector('.loading-stage')?.textContent.trim()
        return document.querySelector('canvas') && (!loading || loading.classList.contains('done')) && 'ok'
      },
      { timeout: LOAD_TIMEOUT_MS, polling: 100 },
    )
    const status = await failure.jsonValue()
    if (status !== 'ok') errors.push(status)

    await new Promise((r) => setTimeout(r, settle * 1000))

    if (errors.length > 0) {
      console.log(styleText('red', `        skipped, ${errors.length} error(s):`))
      for (const error of errors) console.log(styleText('red', `        ${error}`))
      process.exitCode = 1
      continue
    }

    // The largest canvas is the renderer's; everything beside it and its ancestors is hidden.
    const canvas = await page.evaluateHandle(() => {
      const canvas = [...document.querySelectorAll('canvas')].sort(
        (a, b) => b.width * b.height - a.width * a.height,
      )[0]
      const hide = (parent) => {
        for (const child of parent.children) {
          if (child === canvas) continue
          if (child.contains(canvas)) hide(child)
          else child.style.setProperty('opacity', '0', 'important')
        }
      }
      hide(document.body)
      return canvas
    })
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

    mkdirSync(dirname(out), { recursive: true })
    await canvas.screenshot({ path: out, type: 'webp', quality: QUALITY })
    console.log(styleText('green', `        → ${relative(root, out)} (after ${settle} s)`))
    captured++
  } catch (error) {
    console.log(styleText('red', `        skipped: ${error.message}`))
    process.exitCode = 1
  } finally {
    await close(browser)
  }
}

console.log(`\n${styleText(captured === pages.length ? 'green' : 'yellow', `${captured}/${pages.length} captured.`)}`)
