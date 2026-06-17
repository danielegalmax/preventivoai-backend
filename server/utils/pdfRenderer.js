const puppeteer = require('puppeteer')

async function generaPdfBufferDaHtml(html) {
  let browser
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    })
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })
    await page.waitForFunction('window.__preventivoPaginationReady === true', { timeout: 8000 }).catch(() => {})
    return await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true
    })
  } finally {
    if (browser) await browser.close()
  }
}

module.exports = { generaPdfBufferDaHtml }
