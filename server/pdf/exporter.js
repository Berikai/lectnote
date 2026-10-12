/**
 * Headless PDF Exporter for LectNote
 * Uses Puppeteer to capture vector-quality PDF with KaTeX, RoughNotation, and proper page breaks.
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

async function exportLectureToPdf(options = {}) {
  const {
    url,
    outputPath,
    theme = 'notebook',
    timeout = 30000
  } = options;

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--font-render-hinting=medium'
      ]
    });

    const page = await browser.newPage();
    
    // Set viewport matching standard desktop rendering
    await page.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 2 });

    // Navigate to printable view
    await page.goto(url, { waitUntil: 'networkidle0', timeout });

    // Wait until window.__LECTNOTE_READY__ is set by the preview scripts
    await page.waitForFunction(
      () => window.__LECTNOTE_READY__ === true,
      { timeout: 15000 }
    ).catch(() => {
      console.warn('Timed out waiting for __LECTNOTE_READY__, proceeding with current DOM state.');
    });

    // Small stabilization pause to ensure Rough Notation paths have completed layout
    await new Promise(r => setTimeout(r, 600));

    // Generate vector PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: '12mm',
        right: '12mm',
        bottom: '15mm',
        left: '12mm'
      }
    });

    if (outputPath) {
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(outputPath, pdfBuffer);
    }

    return pdfBuffer;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = { exportLectureToPdf };

