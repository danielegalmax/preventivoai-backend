const puppeteer = require('puppeteer')

async function generaPdfBufferDaHtml(html) {
  let browser
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 800, height: 1123 })
    await page.setContent(html, { waitUntil: 'networkidle0' })
    await page.waitForFunction('window.__preventivoPaginationReady === true', { timeout: 8000 }).catch(() => {})
    return await page.pdf({
      width: '800px',
      height: '1123px',
      printBackground: true,
      margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' }
    })
  } finally {
    if (browser) await browser.close()
  }
}

module.exports = { generaPdfBufferDaHtml }
