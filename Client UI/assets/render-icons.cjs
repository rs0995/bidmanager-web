// Rasterises an SVG to PNGs and a Windows .ico using the Electron the app
// already depends on — no image library, nothing added to package.json.
// Chromium renders the SVG once at full size in an offscreen transparent
// window; the smaller frames are high-quality downscales of that capture.
//
//   electron.exe render-icons.cjs <input.svg> <outDir> <basename> [sizes] [--ico]
//
// To regenerate this app's icon set after editing assets/icon.svg, from
// "Client UI" (and note ELECTRON_RUN_AS_NODE must NOT be set, or require
// ('electron') returns a path string instead of the API):
//
//   node_modules\electron\dist\electron.exe assets\render-icons.cjs ^
//     assets\icon.svg assets icon 16,24,32,48,64,128,256 --ico
//   copy assets\icon-256.png electron\icon.png
//
// Then mirror any edit into public/favicon.svg.
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const [input, outDir, baseName, sizeList, ...flags] = process.argv.slice(2);
const sizes = (sizeList || '256').split(',').map(Number).filter(Boolean).sort((a, b) => a - b);
const wantIco = flags.includes('--ico');
// Logical window size. Must stay well inside the desktop work area: Windows
// clamps an oversized window, which silently yields a non-square capture. The
// display's scale factor then multiplies this (e.g. 512 @ 125% = 640 physical),
// which is what the frames are downscaled from.
const MASTER = 512;

// ICO container: 6-byte header, 16 bytes per directory entry, then the PNG
// payloads. Windows accepts PNG-compressed frames (Vista and later).
function buildIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);                 // type 1 = icon
  header.writeUInt16LE(frames.length, 4);
  const entries = [];
  let offset = 6 + frames.length * 16;
  for (const frame of frames) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(frame.size >= 256 ? 0 : frame.size, 0);  // 0 encodes 256
    entry.writeUInt8(frame.size >= 256 ? 0 : frame.size, 1);
    entry.writeUInt8(0, 2);                   // palette entries
    entry.writeUInt8(0, 3);                   // reserved
    entry.writeUInt16LE(1, 4);                // colour planes
    entry.writeUInt16LE(32, 6);               // bits per pixel
    entry.writeUInt32LE(frame.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += frame.data.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...frames.map((f) => f.data)]);
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const svg = fs.readFileSync(input, 'utf8');
  fs.mkdirSync(outDir, { recursive: true });

  // Stage in the OS temp dir: a data: URL overflows Chromium's length limit
  // once the SVG carries comments, and staging inside a OneDrive-synced
  // folder intermittently fails to load.
  const stage = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bm-icon-')), 'icon.html');
  fs.writeFileSync(stage, `<!doctype html><meta charset="utf-8">
    <style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}
    svg{display:block;width:${MASTER}px;height:${MASTER}px}</style>${svg}`, 'utf8');

  const win = new BrowserWindow({
    width: MASTER, height: MASTER, show: false, frame: false,
    transparent: true, backgroundColor: '#00000000', useContentSize: true,
  });
  await win.loadFile(stage);
  await new Promise((r) => setTimeout(r, 250));
  const master = await win.webContents.capturePage();
  win.destroy();
  const { width, height } = master.getSize();
  console.log(`RENDER master ${width}x${height}`);
  if (width !== height) {
    console.error(`RENDER ABORT: capture is not square (${width}x${height}) — the window was clamped. Lower MASTER.`);
    app.exit(1);
    return;
  }
  if (width < Math.max(...sizes)) {
    console.error(`RENDER ABORT: capture ${width}px is smaller than the largest requested frame.`);
    app.exit(1);
    return;
  }

  const frames = [];
  for (const size of sizes) {
    const png = (size === width ? master : master.resize({ width: size, height: size, quality: 'best' })).toPNG();
    fs.writeFileSync(path.join(outDir, `${baseName}-${size}.png`), png);
    frames.push({ size, data: png });
    console.log(`RENDER ${baseName}-${size}.png  ${png.length} bytes`);
  }

  if (wantIco) {
    const icoPath = path.join(outDir, `${baseName}.ico`);
    fs.writeFileSync(icoPath, buildIco(frames));
    console.log(`RENDER ${baseName}.ico  ${fs.statSync(icoPath).size} bytes  (${frames.length} frames)`);
  }
  fs.rmSync(path.dirname(stage), { recursive: true, force: true });
  console.log('RENDER DONE');
  app.exit(0);
});
