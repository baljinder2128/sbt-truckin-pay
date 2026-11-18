// Desktop mode ("node server/index.js --desktop"): everything the Windows start file needs, done in Node itself,
// so no PowerShell script is involved (Windows Smart App Control blocks unsigned scripts, but allows signed node.exe).
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

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

module.exports = { enabled, setup, openBrowser, banner };
