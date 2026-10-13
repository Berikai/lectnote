const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer');

/**
 * Creates a valid Windows .ico file containing multiple PNG images.
 * @param {Array<{ width: number, height: number, buffer: Buffer }>} pngEntries
 * @returns {Buffer}
 */
function createIco(pngEntries) {
  const count = pngEntries.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  let offset = headerSize + dirEntrySize * count;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // Reserved (0)
  header.writeUInt16LE(1, 2); // 1 = ICO resource
  header.writeUInt16LE(count, 4); // Number of images

  const dirEntries = [];
  for (const item of pngEntries) {
    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(item.width >= 256 ? 0 : item.width, 0);
    entry.writeUInt8(item.height >= 256 ? 0 : item.height, 1);
    entry.writeUInt8(0, 2); // Color palette count (0 for 32-bit RGBA)
    entry.writeUInt8(0, 3); // Reserved (0)
    entry.writeUInt16LE(1, 4); // Color planes
    entry.writeUInt16LE(32, 6); // Bits per pixel
    entry.writeUInt32LE(item.buffer.length, 8); // Size of image data in bytes
    entry.writeUInt32LE(offset, 12); // Offset of image data from beginning of file
    dirEntries.push(entry);
    offset += item.buffer.length;
  }

  return Buffer.concat([header, ...dirEntries, ...pngEntries.map(e => e.buffer)]);
}

async function generateIcons() {
  const rootDir = path.resolve(__dirname, '..');
  const buildDir = path.join(rootDir, 'build');
  const webDir = path.join(rootDir, 'web');
  const iconsetDir = path.join(buildDir, 'icon.iconset');

  fs.mkdirSync(buildDir, { recursive: true });
  fs.mkdirSync(iconsetDir, { recursive: true });
  fs.mkdirSync(webDir, { recursive: true });

  // 1. Master 1024x1024 app icon SVG
  // Uses the LectNote brand badge (top-left of UI): vibrant blue squircle with white fountain pen nib.
  const masterSvg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Vibrant LectNote Blue Gradient -->
    <linearGradient id="brandBlueGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#1e7dfa"/>
      <stop offset="50%" stop-color="#166ee1"/>
      <stop offset="100%" stop-color="#105ec7"/>
    </linearGradient>

    <!-- macOS Dock Drop Shadow -->
    <filter id="macAppShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="28" stdDeviation="30" flood-color="#000000" flood-opacity="0.32"/>
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000000" flood-opacity="0.18"/>
    </filter>
  </defs>

  <!-- macOS App Squircle Background -->
  <rect x="96" y="96" width="832" height="832" rx="192" fill="url(#brandBlueGrad)" filter="url(#macAppShadow)"/>

  <!-- Subtle Inner Highlight Rim -->
  <rect x="96" y="96" width="832" height="832" rx="192" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="4"/>

  <!-- Brand Fountain Pen Nib Icon -->
  <g transform="translate(272, 272) scale(20)"
     fill="none"
     stroke="#ffffff"
     stroke-width="2.2"
     stroke-linecap="round"
     stroke-linejoin="round">
    <path d="M12 19l7-7 3 3-7 7-3-3z"/>
    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
    <path d="M2 2l7.586 7.586"/>
    <circle cx="11" cy="11" r="2"/>
  </g>
</svg>`;

  // 2. Favicon SVG for web browser tabs
  const faviconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#166ee1"/>
  <g transform="translate(6.75, 6.75) scale(0.77)"
     fill="none"
     stroke="#ffffff"
     stroke-width="2.2"
     stroke-linecap="round"
     stroke-linejoin="round">
    <path d="M12 19l7-7 3 3-7 7-3-3z"/>
    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
    <path d="M2 2l7.586 7.586"/>
    <circle cx="11" cy="11" r="2"/>
  </g>
</svg>`;

  fs.writeFileSync(path.join(webDir, 'favicon.svg'), faviconSvg.trim(), 'utf8');
  console.log('Saved web/favicon.svg');

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:transparent;overflow:hidden;">
  ${masterSvg}
</body>
</html>`;

  console.log('Rendering 1024x1024 master icon via headless Chromium...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 1024, deviceScaleFactor: 1 });
  await page.setContent(html);

  const icon1024Path = path.join(buildDir, 'icon.png');
  await page.screenshot({ path: icon1024Path, omitBackground: true });
  await browser.close();
  console.log('Generated master icon at:', icon1024Path);

  // Generate iconset sizes using macOS sips
  const macSizes = [
    { name: 'icon_16x16.png', size: 16 },
    { name: 'icon_16x16@2x.png', size: 32 },
    { name: 'icon_32x32.png', size: 32 },
    { name: 'icon_32x32@2x.png', size: 64 },
    { name: 'icon_128x128.png', size: 128 },
    { name: 'icon_128x128@2x.png', size: 256 },
    { name: 'icon_256x256.png', size: 256 },
    { name: 'icon_256x256@2x.png', size: 512 },
    { name: 'icon_512x512.png', size: 512 },
    { name: 'icon_512x512@2x.png', size: 1024 }
  ];

  for (const item of macSizes) {
    const dest = path.join(iconsetDir, item.name);
    execSync(`sips -z ${item.size} ${item.size} "${icon1024Path}" --out "${dest}"`, { stdio: 'ignore' });
  }

  // Generate macOS .icns file
  const icnsPath = path.join(buildDir, 'icon.icns');
  try {
    execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`);
    console.log('Generated macOS icon at:', icnsPath);
  } catch (err) {
    console.warn('iconutil warning:', err.message);
  }

  // Generate Windows .ico with multiple resolutions
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoEntries = [];
  const tmpDir = path.join(buildDir, '_ico_tmp');
  fs.mkdirSync(tmpDir, { recursive: true });

  for (const s of icoSizes) {
    const tmpPng = path.join(tmpDir, `ico_${s}.png`);
    execSync(`sips -z ${s} ${s} "${icon1024Path}" --out "${tmpPng}"`, { stdio: 'ignore' });
    icoEntries.push({ width: s, height: s, buffer: fs.readFileSync(tmpPng) });
  }

  const icoPath = path.join(buildDir, 'icon.ico');
  fs.writeFileSync(icoPath, createIco(icoEntries));
  console.log('Generated Windows icon at:', icoPath);
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // Generate Web favicons and Apple touch icon
  const favicon16 = path.join(webDir, 'favicon-16x16.png');
  const favicon32 = path.join(webDir, 'favicon-32x32.png');
  const faviconPng = path.join(webDir, 'favicon.png');
  const appleTouch = path.join(webDir, 'apple-touch-icon.png');

  execSync(`sips -z 16 16 "${icon1024Path}" --out "${favicon16}"`, { stdio: 'ignore' });
  execSync(`sips -z 32 32 "${icon1024Path}" --out "${favicon32}"`, { stdio: 'ignore' });
  execSync(`sips -z 32 32 "${icon1024Path}" --out "${faviconPng}"`, { stdio: 'ignore' });
  execSync(`sips -z 180 180 "${icon1024Path}" --out "${appleTouch}"`, { stdio: 'ignore' });

  const webIcoEntries = [
    { width: 16, height: 16, buffer: fs.readFileSync(favicon16) },
    { width: 32, height: 32, buffer: fs.readFileSync(favicon32) }
  ];
  fs.writeFileSync(path.join(webDir, 'favicon.ico'), createIco(webIcoEntries));
  console.log('Generated web favicons in web/');

  // Cleanup temporary iconset directory
  fs.rmSync(iconsetDir, { recursive: true, force: true });
  console.log('Icon generation completed successfully!');
}

generateIcons().catch(err => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
