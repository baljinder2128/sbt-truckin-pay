// Desktop mode ("node server/index.js --desktop"): everything the Windows start file needs, done in Node itself,
// so no PowerShell script is involved (Windows Smart App Control blocks unsigned scripts, but allows signed node.exe).
const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const enabled = process.argv.includes('--desktop');

// Must run before ./db is loaded, so the data folder is set first.
function setup() {
  if (!enabled) return;
  const home = path.join(os.homedir(), 'SB Truckin Pay');
  process.env.SBT_DESKTOP = '1';
  process.env.DATA_DIR = process.env.DATA_DIR || path.join(home, 'data');
  process.env.BACKUP_DIR = process.env.BACKUP_DIR || path.join(home, 'backups');
  process.env.TZ = process.env.TZ || 'Australia/Melbourne';
  process.env.PORT = process.env.PORT || '3000';
  delete process.env.DATABASE_URL;
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') spawn('cmd.exe', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  } catch { /* the address is printed in the window anyway */ }
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) {
    if (a.family === 'IPv4' && !a.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) out.push(a.address);
  }
  return out;
}

function banner(port, dataDir, backupDir) {
  const line = '='.repeat(62);
  console.log(`\n${line}\n   SB TRUCKIN PAY is running on this computer\n${line}\n`);
  console.log(`   Open it here:         http://localhost:${port}`);
  for (const ip of lanAddresses()) console.log(`   Phone on same Wi-Fi:  http://${ip}:${port}`);
  console.log(`\n   Your data:            ${dataDir}\n   Daily backups:        ${backupDir}\n`);
  console.log('   KEEP THIS WINDOW OPEN (you can minimise it). Closing it stops the app.\n');
}

function healthy(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 1500 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false)).on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// "--desktop --background": start the app hidden (no window to close), open the browser, and exit.
// If it is already running, just open the browser. "--no-browser" is used when Windows starts it at sign-in.
async function launchInBackground() {
  const port = Number(process.env.PORT);
  const url = `http://localhost:${port}`;
  const wantBrowser = !process.argv.includes('--no-browser');
  if (!(await healthy(port))) {
    fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
    const log = fs.openSync(path.join(process.env.DATA_DIR, '..', 'app-log.txt'), 'a');
    const args = process.execArgv.concat([process.argv[1], '--desktop']);
    spawn(process.execPath, args, { cwd: process.cwd(), detached: true, windowsHide: true, stdio: ['ignore', log, log] }).unref();
    for (let i = 0; i < 60 && !(await healthy(port)); i++) await new Promise((r) => setTimeout(r, 500));
  }
  if (wantBrowser) openBrowser(url);
  setTimeout(() => process.exit(0), 1500);
}

function desktopFolder() {
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders', '/v', 'Desktop'], { encoding: 'utf8', windowsHide: true });
    const m = out.match(/REG_(?:EXPAND_)?SZ\s+(.+)/);
    if (m) {
      const p = m[1].trim().replace(/%([^%]+)%/g, (_, k) => process.env[k] || process.env[k.toUpperCase()] || '');
      if (fs.existsSync(p)) return p;
    }
  } catch { /* fall back below */ }
  return path.join(os.homedir(), 'Desktop');
}

// Windows only: start hidden at every sign-in, and put an "SB Truckin Pay" icon on the desktop that opens it.
function installShortcuts(port) {
  if (!enabled || process.platform !== 'win32') return;
  const appDir = path.resolve(__dirname, '..');
  const script = path.join(appDir, 'server', 'index.js');
  try {
    const startup = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    fs.mkdirSync(startup, { recursive: true });
    fs.writeFileSync(path.join(startup, 'SB Truckin Pay.cmd'),
      `@echo off\r\ncd /d "${appDir}"\r\nstart "" /b "${process.execPath}" --disable-warning=ExperimentalWarning "${script}" --desktop --background --no-browser\r\n`);
  } catch (e) { console.error('Could not set up start at sign-in:', e.message); }
  try {
    const icon = path.join(appDir, 'public', 'icons', 'favicon.ico');
    fs.writeFileSync(path.join(desktopFolder(), 'SB Truckin Pay.url'),
      `[InternetShortcut]\r\nURL=http://localhost:${port}/\r\nIconFile=${icon}\r\nIconIndex=0\r\n`);
  } catch (e) { console.error('Could not make the desktop icon:', e.message); }
}

module.exports = { enabled, setup, openBrowser, banner, launchInBackground, installShortcuts };
