#!/usr/bin/env node
'use strict';
/*
 * Terwo v1.13.0
 * Simple web panel for Termux: File Manager + Terminal + System Info.
 *
 * Keamanan bawaan:
 *  - Login password (hash PBKDF2), session cookie HttpOnly
 *  - File manager dikurung di dalam PANEL_ROOT (default $HOME)
 *  - Default hanya listen di 127.0.0.1 (localhost)
 */

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn, exec } = require('child_process');

let WebSocket;
try {
  WebSocket = require('ws');
} catch (e) {
  console.error('ERROR: module "ws" is not installed.\nRun first: npm install');
  process.exit(1);
}

// ================= Konfigurasi =================
const HOME = os.homedir();
const ROOT = path.resolve(process.env.PANEL_ROOT || HOME);
const DATA_DIR = path.join(HOME, '.termux-panel');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const PORT = parseInt(process.env.PANEL_PORT || '8080', 10);
const HOST = process.env.PANEL_HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_UPLOAD = 50 * 1024 * 1024; // 50 MB
const sessions = new Map(); // token -> { created }

function hashPassword(pw, salt) {
  return crypto.pbkdf2Sync(pw, salt, 120000, 32, 'sha256').toString('hex');
}

function randAlnum(n) {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  const b = crypto.randomBytes(n);
  for (let i = 0; i < n; i++) s += chars[b[i] % chars.length];
  return s;
}
function timingSafeEq(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
function loadConfig() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(CONFIG_FILE)) {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (!cfg.username) {
      cfg.username = 'admin';
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
      console.log('INFO: default username "admin" added (change it in the Settings menu).');
    }
    return cfg;
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const username = randAlnum(8);
  const password = crypto.randomBytes(12).toString('base64url');
  const cfg = { username, salt, hash: hashPassword(password, salt) };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  const line = '='.repeat(46);
  console.log('');
  console.log('  ' + line);
  console.log('  Terwo — initial access');
  console.log('  ' + line);
  console.log('  URL      : http://' + HOST + ':' + PORT);
  console.log('  Username : ' + username);
  console.log('  Password : ' + password);
  console.log('  ' + line);
  console.log('  Save these well, change them in the Settings menu after login.');
  console.log('');
  return cfg;
}
let config = loadConfig();


function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

// ================= Helper =================
function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (!h) return out;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isAuthed(req) {
  const c = parseCookies(req);
  return !!c.tpsid && sessions.has(c.tpsid);
}

// Pastikan path hasil selalu di dalam ROOT (cegah path traversal)
function safePath(rel) {
  const p = path.resolve(ROOT, rel || '.');
  if (p !== ROOT && !p.startsWith(ROOT + path.sep)) {
    throw new Error('Access outside working directory denied');
  }
  return p;
}

// Single file/folder name: reject path separators
function safeName(name) {
  if (!name || typeof name !== 'string') throw new Error('Invalid name');
  const n = name.trim();
  if (!n || n === '.' || n === '..' || n.includes('/') || n.includes('\\') || n.includes('\0')) {
    throw new Error('Invalid name');
  }
  return n;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { req.destroy(); reject(new Error('Body too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, code, obj, headers) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, headers));
  res.end(body);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

async function servePublic(res, filename) {
  try {
    const data = await fsp.readFile(path.join(PUBLIC_DIR, filename));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filename)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

function relOf(abs) {
  const r = path.relative(ROOT, abs);
  return r === '' ? '' : r;
}

// ================= API: file manager =================
async function apiFiles(url, res) {
  const dir = safePath(url.searchParams.get('path') || '');
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.termux-panel') {
      // show dotfiles too, no problem
    }
    const full = path.join(dir, e.name);
    let size = 0, mtime = 0;
    try {
      const st = await fsp.stat(full);
      size = st.size; mtime = st.mtimeMs;
    } catch { /* ignore */ }
    out.push({ name: e.name, type: e.isDirectory() ? 'dir' : 'file', size, mtime });
  }
  out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  sendJson(res, 200, { path: relOf(dir), entries: out });
}

async function apiMkdir(req, res) {
  const { path: rel, name } = JSON.parse((await readBody(req, 1e6)).toString('utf8'));
  await fsp.mkdir(path.join(safePath(rel || ''), safeName(name)), { recursive: true });
  sendJson(res, 200, { ok: true });
}

async function apiTouch(req, res) {
  const { path: rel, name } = JSON.parse((await readBody(req, 1e6)).toString('utf8'));
  const full = path.join(safePath(rel || ''), safeName(name));
  const fh = await fsp.open(full, 'wx').catch(() => null);
  if (fh) await fh.close();
  sendJson(res, 200, { ok: true });
}

async function apiRename(req, res) {
  const { path: rel, from, to } = JSON.parse((await readBody(req, 1e6)).toString('utf8'));
  const dir = safePath(rel || '');
  await fsp.rename(path.join(dir, safeName(from)), path.join(dir, safeName(to)));
  sendJson(res, 200, { ok: true });
}

async function apiDelete(req, res) {
  const { path: rel, name } = JSON.parse((await readBody(req, 1e6)).toString('utf8'));
  await fsp.rm(path.join(safePath(rel || ''), safeName(name)), { recursive: true, force: true });
  sendJson(res, 200, { ok: true });
}

async function apiRead(req, res) {
  const { path: rel, name } = JSON.parse((await readBody(req, 1e6)).toString('utf8'));
  const full = path.join(safePath(rel || ''), safeName(name));
  const st = await fsp.stat(full);
  if (st.size > 1024 * 1024) throw new Error('File too large to edit (max 1 MB)');
  const content = await fsp.readFile(full, 'utf8');
  sendJson(res, 200, { ok: true, content });
}

async function apiWrite(req, res) {
  const { path: rel, name, content } = JSON.parse((await readBody(req, 10 * 1024 * 1024)).toString('utf8'));
  if (typeof content !== 'string') throw new Error('Invalid content');
  await fsp.writeFile(path.join(safePath(rel || ''), safeName(name)), content, 'utf8');
  sendJson(res, 200, { ok: true });
}

async function apiUpload(req, res) {
  const { path: rel, name, data } = JSON.parse((await readBody(req, MAX_UPLOAD + 1024 * 1024)).toString('utf8'));
  const buf = Buffer.from(data, 'base64');
  if (buf.length > MAX_UPLOAD) throw new Error('File too large (max 50 MB)');
  await fsp.writeFile(path.join(safePath(rel || ''), safeName(name)), buf);
  sendJson(res, 200, { ok: true, size: buf.length });
}

async function apiDownload(url, res) {
  const rel = url.searchParams.get('path') || '';
  const name = safeName(url.searchParams.get('name') || '');
  const full = path.join(safePath(rel), name);
  const st = await fsp.stat(full);
  if (!st.isFile()) throw new Error('Not a file');
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': st.size,
    'Content-Disposition': 'attachment; filename="' + name.replace(/"/g, '') + '"',
  });
  fs.createReadStream(full).pipe(res);
}

async function apiChpasswd(req, res) {
  const { old, new: nw } = JSON.parse((await readBody(req, 1e6)).toString('utf8'));
  if (!old || hashPassword(old, config.salt) !== config.hash) {
    return sendJson(res, 401, { error: 'Password lama salah' });
  }
  if (!nw || nw.length < 6) return sendJson(res, 400, { error: 'Password baru minimal 6 karakter' });
  config.salt = crypto.randomBytes(16).toString('hex');
  config.hash = hashPassword(nw, config.salt);
  saveConfig();
  sessions.clear(); // paksa login ulang di semua sesi
  sendJson(res, 200, { ok: true });
}

function apiSysinfo(res) {
  sendJson(res, 200, {
    hostname: os.hostname(),
    platform: os.platform() + ' ' + os.arch(),
    uptime: Math.floor(os.uptime()),
    freemem: os.freemem(),
    totalmem: os.totalmem(),
    loadavg: os.loadavg().map((n) => +n.toFixed(2)),
    root: ROOT,
  });
}

// ================= Website hosting (Node.js & PHP) =================
const SITES_FILE = path.join(DATA_DIR, 'sites.json');
let sites = [];
function loadSites() {
  try { sites = JSON.parse(fs.readFileSync(SITES_FILE, 'utf8')); }
  catch { sites = []; }
}
function saveSites() {
  fs.writeFileSync(SITES_FILE, JSON.stringify(sites, null, 2), { mode: 0o600 });
}
loadSites();
const running = new Map(); // id -> { child, logs[], type, started }
const deadLogs = new Map(); // id -> string log terakhir setelah proses berhenti

function siteById(id) {
  return sites.find((s) => s.id === id);
}

function pushLog(id, line) {
  const r = running.get(id);
  if (!r) return;
  r.logs.push(line);
  if (r.logs.length > 300) r.logs.splice(0, r.logs.length - 300);
}

async function apiSitesList(res) {
  sendJson(res, 200, {
    sites: sites.map((s) => Object.assign({}, s, { running: running.has(s.id) })),
  });
}

async function apiSiteCreate(req, res) {
  const body = JSON.parse((await readBody(req, 1e6)).toString('utf8'));
  const name = (body.name || '').trim();
  const type = body.type;
  if (!name) throw new Error('Name is required');
  if (type !== 'node' && type !== 'php' && type !== 'static' && type !== 'go') throw new Error('Type must be nodejs, php, static, or go');
  const portNum = parseInt(body.port, 10);
  if (!portNum || portNum < 1024 || portNum > 65535) throw new Error('Port must be 1024–65535');
  if (sites.some((s) => s.port === portNum)) throw new Error('Port is already used by another website');
  const full = safePath(body.path || '.');
  const st = await fsp.stat(full).catch(() => null);
  if (!st) throw new Error('Path not found');
  if (type === 'node' && !st.isFile()) throw new Error('For Node.js, path must be a file (e.g. server.js)');
  if (type === 'php' && !st.isDirectory()) throw new Error('For PHP, path must be a document root folder');
  if (type === 'static' && !st.isDirectory()) throw new Error('For Static, path must be a folder');
  if (type === 'go' && !st.isDirectory()) throw new Error('For Go, path must be a project folder');
  const site = {
    id: crypto.randomBytes(8).toString('hex'),
    name, type, path: relOf(full), port: portNum, created: Date.now(),
  };
  sites.push(site);
  saveSites();
  sendJson(res, 200, { ok: true, site });
}

async function apiSiteStart(req, res, id) {
  const site = siteById(id);
  if (!site) throw new Error('Website not found');
  if (running.has(id)) throw new Error('Already running');
  const full = safePath(site.path);
  if (site.type === 'static') {
    const hasPy = await execCheck('command -v python3 >/dev/null 2>&1');
    if (!hasPy) throw new Error('Install python first via the Store menu');
  }
  if (site.type === 'go') {
    const hasGo = await execCheck('command -v go >/dev/null 2>&1');
    if (!hasGo) throw new Error('Install Go first via the Store menu');
  }
  let child;
  if (site.type === 'node') {
    child = spawn('node', [full], {
      cwd: path.dirname(full),
      env: Object.assign({}, process.env, { PORT: String(site.port) }),
    });
  } else if (site.type === 'php') {
    child = spawn('php', ['-S', '127.0.0.1:' + site.port, '-t', full], { cwd: full });
  } else if (site.type === 'static') {
    child = spawn('python3', ['-m', 'http.server', String(site.port), '--directory', full], {
      cwd: full,
      env: Object.assign({}, process.env, { PORT: String(site.port) }),
    });
  } else {
    child = spawn('go', ['run', '.'], {
      cwd: full,
      env: Object.assign({}, process.env, { PORT: String(site.port) }),
    });
  }
  running.set(id, { child, logs: [], type: site.type, started: Date.now() });
  deadLogs.delete(id);
  pushLog(id, '--- start (' + site.type + ') port ' + site.port + ' ---\n');
  child.stdout.on('data', (d) => pushLog(id, d.toString('utf8')));
  child.stderr.on('data', (d) => pushLog(id, d.toString('utf8')));
  const finish = () => {
    const r = running.get(id);
    if (r) deadLogs.set(id, r.logs.join(''));
    running.delete(id);
  };
  child.on('exit', (code) => { pushLog(id, '--- berhenti (exit ' + code + ') ---\n'); finish(); });
  child.on('error', (e) => { pushLog(id, '--- failed to start: ' + e.message + ' ---\n'); finish(); });
  sendJson(res, 200, { ok: true });
}

async function apiSiteStop(req, res, id) {
  const rec = running.get(id);
  if (!rec) throw new Error('Not running');
  try { rec.child.kill(); } catch { /* ignore */ }
  running.delete(id);
  sendJson(res, 200, { ok: true });
}

async function apiSiteRestart(req, res, id) {
  const rec = running.get(id);
  if (rec) {
    try { rec.child.kill(); } catch { /* ignore */ }
    running.delete(id);
    await new Promise((r) => setTimeout(r, 500));
  }
  return apiSiteStart(req, res, id);
}

async function apiSiteDelete(req, res, id) {
  const rec = running.get(id);
  if (rec) {
    try { rec.child.kill(); } catch { /* ignore */ }
    running.delete(id);
  }
  sites = sites.filter((s) => s.id !== id);
  deadLogs.delete(id);
  saveSites();
  sendJson(res, 200, { ok: true });
}

function apiSiteLogs(res, id) {
  const rec = running.get(id);
  sendJson(res, 200, {
    logs: rec ? rec.logs.join('') : (deadLogs.get(id) || ''),
    running: !!rec,
  });
}

// ================= Install Center =================
// Install Termux packages via pkg/npm, logs stream live to the frontend.
const INSTALL_ITEMS = [
  { id: 'nginx', name: 'Nginx', desc: 'Web server & reverse proxy', bin: 'nginx', cmd: 'pkg install -y nginx' },
  { id: 'nodejs', name: 'Node.js', desc: 'Runtime JavaScript', bin: 'node', cmd: 'pkg install -y nodejs', forcedInstalled: true },
  { id: 'nvm', name: 'NVM', desc: 'Node Version Manager', check: '[ -f "$HOME/.nvm/nvm.sh" ]', cmd: 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash' },
  { id: 'pm2', name: 'PM2', desc: 'Process manager Node.js', bin: 'pm2', cmd: 'npm install -g pm2' },
  { id: 'mysql', name: 'MySQL (MariaDB)', desc: 'Database server MySQL', bin: 'mysqld', cmd: 'pkg install -y mariadb' },
  { id: 'postgres', name: 'PostgreSQL', desc: 'Database server PostgreSQL', bin: 'postgres', cmd: 'pkg install -y postgresql' },
  { id: 'php', name: 'PHP', desc: 'Interpreter PHP', bin: 'php', cmd: 'pkg install -y php' },
  { id: 'bun', name: 'Bun', desc: 'Fast JS runtime', check: 'command -v bun >/dev/null 2>&1 || [ -f "$HOME/.bun/bin/bun" ]', cmd: 'curl -fsSL https:/' + '/bun.sh/install | bash' },
  { id: 'redis', name: 'Redis', desc: 'In-memory database & cache', bin: 'redis-server', cmd: 'pkg install -y redis' },
  { id: 'python', name: 'Python', desc: 'Interpreter Python', bin: 'python', cmd: 'pkg install -y python' },
  { id: 'golang', name: 'Go', desc: 'Go programming language', bin: 'go', cmd: 'pkg install -y golang' },
  { id: 'cronie', name: 'Cronie', desc: 'Cron daemon (scheduled jobs)', bin: 'crond', cmd: 'pkg install -y cronie' },
  { id: '9router', name: '9Router', desc: 'AI model gateway (OpenAI-compatible)', bin: '9router', cmd: 'npm install -g 9router' },
  { id: 'hermes', name: 'Hermes Agent', desc: 'AI coding agent CLI', bin: 'hermes', cmd: 'curl -fsSL https://hermes-agent.' + 'nousresearch.com/install.sh | bash' },
  { id: 'cloudflared', name: 'Cloudflared', desc: 'Cloudflare Tunnel', bin: 'cloudflared', cmd: 'pkg install -y cloudflared' },
  { id: 'zip', name: 'Zip', desc: 'ZIP archives (used by file manager & backup)', bin: 'zip', cmd: 'pkg install -y zip' },
  { id: 'unzip', name: 'Unzip', desc: 'Extract ZIP (used by file manager & backup)', bin: 'unzip', cmd: 'pkg install -y unzip' },
  { id: 'openssh', name: 'OpenSSH', desc: 'SSH server & client (sshd port 8022)', bin: 'sshd', cmd: 'pkg install -y openssh' },
  { id: 'termux-api', name: 'Termux:API', desc: 'Phone sensors & features (battery, notifications)', bin: 'termux-battery-status', cmd: 'pkg install -y termux-api' },
  { id: 'git', name: 'Git', desc: 'Version control system', bin: 'git', cmd: 'pkg install -y git' },
  { id: 'tmux', name: 'Tmux', desc: 'Terminal multiplexer', bin: 'tmux', cmd: 'pkg install -y tmux' },
  { id: 'composer', name: 'Composer', desc: 'Package manager PHP', bin: 'composer', cmd: 'pkg install -y composer' },
  { id: 'sqlite', name: 'SQLite', desc: 'Lightweight serverless database', bin: 'sqlite3', cmd: 'pkg install -y sqlite' },
  { id: 'ffmpeg', name: 'FFmpeg', desc: 'Video & audio processing', bin: 'ffmpeg', cmd: 'pkg install -y ffmpeg' },
  { id: 'yt-dlp', name: 'yt-dlp', desc: 'Video & audio downloader', bin: 'yt-dlp', cmd: 'pkg install -y yt-dlp' },
  { id: 'rsync', name: 'Rsync', desc: 'File sync & backup', bin: 'rsync', cmd: 'pkg install -y rsync' },
];
const installRuns = new Map(); // id -> { child, logs[], running, exitCode }
function execCheck(cmd) {
  return new Promise((resolve) => {
    exec('bash -c ' + JSON.stringify(cmd), { timeout: 8000 }, (err) => resolve(!err));
  });
}

async function apiInstallList(res) {
  const items = [];
  for (const it of INSTALL_ITEMS) {
    const installed = it.forcedInstalled ? true : await execCheck(it.check || ('command -v ' + it.bin + ' >/dev/null 2>&1'));
    const rec = installRuns.get(it.id);
    items.push({ id: it.id, name: it.name, desc: it.desc, installed,
      installing: !!(rec && rec.running) });
  }
  sendJson(res, 200, { items });
}

async function apiInstallStart(req, res, id) {
  const item = INSTALL_ITEMS.find((x) => x.id === id);
  if (!item) throw new Error('Unknown package');
  const rec = installRuns.get(id);
  if (rec && rec.running) throw new Error('Installation already running');
  const child = spawn('bash', ['-c', item.cmd], { cwd: HOME });
  const nr = { child, logs: [], running: true, exitCode: null };
  installRuns.set(id, nr);
  const push = (s) => { nr.logs.push(s); if (nr.logs.length > 500) nr.logs.splice(0, nr.logs.length - 500); };
  push('$ ' + item.cmd + '\n');
  child.stdout.on('data', (d) => push(d.toString('utf8')));
  child.stderr.on('data', (d) => push(d.toString('utf8')));
  child.on('exit', (code) => { nr.running = false; nr.exitCode = code; push('\n--- selesai (exit ' + code + ') ---\n'); sendTelegram((code === 0 ? '✅' : '❌') + ' Install ' + item.name + ' finished (exit ' + code + ')'); });
  child.on('error', (e) => { nr.running = false; nr.exitCode = -1; push('\n--- failed: ' + e.message + ' ---\n'); });
  sendJson(res, 200, { ok: true });
}

function apiInstallLog(res, id) {
  const rec = installRuns.get(id);
  sendJson(res, 200, rec
    ? { logs: rec.logs.join(''), running: rec.running, exitCode: rec.exitCode }
    : { logs: '', running: false, exitCode: null });
}

// ================= Database manager (MySQL & PostgreSQL) =================
const DB_FILE = path.join(DATA_DIR, 'db.json');
const dbConns = {}; // type -> { kind, conn }

function dbValidType(t) {
  if (t !== 'mysql' && t !== 'postgres') throw new Error('Invalid database type');
}

function dbLib(t) {
  try {
    return t === 'mysql' ? require('mysql2/promise') : require('pg');
  } catch {
    throw new Error('Database module not installed. Run: npm install');
  }
}
function loadDbConfigs() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return {}; }
}
function saveDbConfigs(cfgs) {
  fs.writeFileSync(DB_FILE, JSON.stringify(cfgs, null, 2), { mode: 0o600 });
}
function pgIdent(s) {
  return '"' + String(s).replace(/"/g, '""') + '"';
}
function safeRow(row) {
  const out = {};
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (Buffer.isBuffer(v)) out[k] = v.toString('utf8');
    else if (v instanceof Date) out[k] = v.toISOString();
    else out[k] = v;
  }
  return out;
}
function dbDefaultCfg(t) {
  return t === 'mysql'
    ? { host: '127.0.0.1', port: 3306, user: 'root', password: '', database: '' }
    : { host: '127.0.0.1', port: 5432, user: 'postgres', password: '', database: '' };
}
function normCfg(t, body) {
  const d = dbDefaultCfg(t);
  return {
    host: String(body.host || d.host),
    port: parseInt(body.port, 10) || d.port,
    user: String(body.user || d.user),
    password: body.password != null ? String(body.password) : '',
    database: body.database ? String(body.database) : '',
  };
}
function dbDisconnect(t) {
  const rec = dbConns[t];
  if (!rec) return;
  delete dbConns[t];
  (async () => { try { await rec.conn.end(); } catch { /* ignore */ } })();
}
async function dbQuery(t, sql, params) {
  const rec = dbConns[t];
  if (!rec) throw new Error('Not connected');
  if (rec.kind === 'mysql') {
    const [rows, fields] = await rec.conn.query(sql, params || []);
    return {
      rows: Array.isArray(rows) ? rows.map(safeRow) : [],
      fields: (fields || []).map((f) => f.name),
      affected: rows.affectedRows != null ? rows.affectedRows : null,
    };
  }
  const r = await rec.conn.query(sql, params || []);
  return {
    rows: r.rows.map(safeRow),
    fields: r.fields.map((f) => f.name),
    affected: r.rowCount != null ? r.rowCount : null,
  };
}
async function withPgDb(t, cfg, db, fn) {
  const pg = dbLib(t);
  const client = new pg.Client({
    host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password,
    database: db, connectionTimeoutMillis: 5000,
  });
  await client.connect();
  try { return await fn(client); }
  finally { try { await client.end(); } catch { /* ignore */ } }
}
async function dbListDatabases(t) {
  if (!dbConns[t]) throw new Error('Not connected');
  if (t === 'mysql') {
    const r = await dbQuery(t, 'SHOW DATABASES');
    return r.rows.map((x) => x.Database);
  }
  const r = await dbQuery(t, 'SELECT datname FROM pg_database WHERE datistemplate=false ORDER BY datname');
  return r.rows.map((x) => x.datname);
}
async function apiDbConfigGet(res, t) {
  dbValidType(t);
  const cfgs = loadDbConfigs();
  sendJson(res, 200, { config: Object.assign(dbDefaultCfg(t), cfgs[t] || {}), connected: !!dbConns[t] });
}
async function apiDbConfigSave(req, res, t) {
  dbValidType(t);
  const body = JSON.parse((await readBody(req, 1e6)).toString('utf8'));
  const cfgs = loadDbConfigs();
  cfgs[t] = normCfg(t, body);
  saveDbConfigs(cfgs);
  sendJson(res, 200, { ok: true });
}
async function apiDbTest(req, res, t) {
  dbValidType(t);
  const body = JSON.parse((await readBody(req, 1e6)).toString('utf8'));
  const cfg = normCfg(t, body);
  try {
    if (t === 'mysql') {
      const conn = await dbLib(t).createConnection({
        host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password,
        database: cfg.database || undefined, connectTimeout: 5000 });
      await conn.end();
    } else {
      const client = new (dbLib(t).Client)({
        host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password,
        database: cfg.database || 'postgres', connectionTimeoutMillis: 5000 });
      await client.connect();
      await client.end();
    }
    sendJson(res, 200, { ok: true });
  } catch (e) {
    sendJson(res, 200, { ok: false, error: e.message || 'Connection failed' });
  }
}
async function apiDbConnect(req, res, t) {
  dbValidType(t);
  const body = JSON.parse((await readBody(req, 1e6)).toString('utf8'));
  const cfg = normCfg(t, body);
  const cfgs = loadDbConfigs();
  cfgs[t] = cfg;
  saveDbConfigs(cfgs);
  dbDisconnect(t);
  try {
    if (t === 'mysql') {
      const conn = await dbLib(t).createConnection({
        host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password,
        database: cfg.database || undefined, connectTimeout: 8000 });
      dbConns[t] = { kind: 'mysql', conn };
    } else {
      const client = new (dbLib(t).Client)({
        host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password,
        database: cfg.database || 'postgres', connectionTimeoutMillis: 8000 });
      await client.connect();
      dbConns[t] = { kind: 'postgres', conn: client };
    }
  } catch (e) {
    dbDisconnect(t);
    return sendJson(res, 400, { error: 'Connection failed: ' + (e.message || 'unknown') });
  }
  sendJson(res, 200, { ok: true, databases: await dbListDatabases(t) });
}
function apiDbDisconnect(res, t) {
  dbValidType(t);
  dbDisconnect(t);
  sendJson(res, 200, { ok: true });
}
async function apiDbDatabases(res, t) {
  dbValidType(t);
  sendJson(res, 200, { databases: await dbListDatabases(t) });
}
async function apiDbTables(url, res, t) {
  dbValidType(t);
  const db = url.searchParams.get('db');
  if (!db) throw new Error('Database must be selected');
  if (t === 'mysql') {
    const r = await dbQuery(t, 'SELECT table_name AS t FROM information_schema.tables WHERE table_schema=? ORDER BY table_name', [db]);
    sendJson(res, 200, { tables: r.rows.map((x) => x.t) });
    return;
  }
  const cfgs = loadDbConfigs();
  const tables = await withPgDb(t, normCfg(t, cfgs[t] || {}), db, async (client) => {
    const r = await client.query("SELECT tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY tablename");
    return r.rows.map((x) => x.tablename);
  });
  sendJson(res, 200, { tables });
}
async function apiDbRows(url, res, t) {
  dbValidType(t);
  const db = url.searchParams.get('db');
  const table = url.searchParams.get('table');
  if (!db || !table) throw new Error('Database and table are required');
  if (db.length > 128 || table.length > 128) throw new Error('Name too long');
  if (t === 'mysql') {
    const r = await dbQuery(t, 'SELECT * FROM ??.?? LIMIT 50', [db, table]);
    sendJson(res, 200, { fields: r.fields, rows: r.rows });
    return;
  }
  const cfgs = loadDbConfigs();
  const r = await withPgDb(t, normCfg(t, cfgs[t] || {}), db, async (client) => {
    const q = await client.query('SELECT * FROM ' + pgIdent(table) + ' LIMIT 50');
    return { fields: q.fields.map((f) => f.name), rows: q.rows.map(safeRow) };
  });
  sendJson(res, 200, { fields: r.fields, rows: r.rows });
}
async function apiDbQuery(req, res, t) {
  dbValidType(t);
  const body = JSON.parse((await readBody(req, 1e6)).toString('utf8'));
  const sql = (body.sql || '').trim();
  if (!sql) throw new Error('SQL is empty');
  if (sql.length > 20000) throw new Error('SQL too long');
  const r = await dbQuery(t, sql);
  sendJson(res, 200, { fields: r.fields, rows: r.rows, affected: r.affected });
}
// ================= Settings & Telegram =================
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); }
  catch { return { telegram: { botToken: '', chatId: '', enabled: false, commandsEnabled: true } }; }
}
function saveSettings(s) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
}
function telegramSend(botToken, chatId, text) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const host = ['api', 'telegram', 'org'].join('.');
    const data = JSON.stringify({ chat_id: chatId, text: String(text).slice(0, 4000) });
    const req = https.request({
      hostname: host, path: '/bot' + botToken + '/sendMessage', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 10000,
    }, (r) => {
      let b = '';
      r.on('data', (c) => { b += c; });
      r.on('end', () => {
        try { const j = JSON.parse(b); j.ok ? resolve() : reject(new Error(j.description || 'Failed to send')); }
        catch { reject(new Error('Invalid Telegram response')); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    const hard = setTimeout(() => { req.destroy(); reject(new Error('Timeout')); }, 10000);
    req.on('close', () => clearTimeout(hard));
    req.write(data);
    req.end();
  });
}
function sendTelegram(text) {
  try {
    const tg = loadSettings().telegram || {};
    if (!tg.enabled || !tg.botToken || !tg.chatId) return;
    telegramSend(tg.botToken, tg.chatId, text).catch((e) => console.log('Telegram failed:', e.message));
  } catch (e) { console.log('Telegram failed:', e.message); }
}
async function apiSettingsGet(res) {
  const s = loadSettings();
  sendJson(res, 200, { username: config.username, telegram: s.telegram || {}, version: '1.13.0' });
}
async function apiSettingsPost(req, res) {
  const body = JSON.parse((await readBody(req, 1e6)).toString('utf8'));
  const s = loadSettings();
  const tg = body.telegram || {};
  s.telegram = { botToken: String(tg.botToken || ''), chatId: String(tg.chatId || ''),
    enabled: !!tg.enabled, commandsEnabled: tg.commandsEnabled === undefined ? true : !!tg.commandsEnabled };
  saveSettings(s);
  try { startTelegramPoll(); } catch { /* ignore */ }
  sendJson(res, 200, { ok: true });
}
async function apiTelegramTest(res) {
  const tg = loadSettings().telegram || {};
  if (!tg.enabled || !tg.botToken || !tg.chatId) {
    return sendJson(res, 400, { ok: false, error: 'Fill in bot token & chat ID and enable it first' });
  }
  try {
    await telegramSend(tg.botToken, tg.chatId, 'Terwo notification test successful!');
    sendJson(res, 200, { ok: true });
  } catch (e) { sendJson(res, 400, { ok: false, error: e.message }); }
}
// ================= Telegram bot commands (polling) =================
let tgPollTimer = null, tgPollOffset = 0;
function tgApiGet(botToken, apiPath) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const host = ['api', 'telegram', 'org'].join('.');
    const req = https.request({ hostname: host, path: '/bot' + botToken + apiPath,
      method: 'GET', timeout: 10000 }, (r) => {
      let b = '';
      r.on('data', (c) => { b += c; });
      r.on('end', () => {
        try { const j = JSON.parse(b); j.ok ? resolve(j) : reject(new Error(j.description || 'API failed')); }
        catch { reject(new Error('Invalid response')); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    const hard = setTimeout(() => { req.destroy(); reject(new Error('Timeout')); }, 10000);
    req.on('close', () => clearTimeout(hard));
    req.end();
  });
}
function fmtUptime(sec) {
  sec = Math.floor(sec);
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
  const p = [];
  if (d) p.push(d + 'h'); if (h) p.push(h + 'j'); if (m || !p.length) p.push(m + 'm');
  return p.join(' ');
}
function mb(b) { return Math.round(b / 1048576); }
async function tgReply(tg, cmd) {
  const s = await getStatsData();
  const run = s.sites.filter((x) => x.running).length;
  switch (cmd) {
    case '/help':
      return 'Bot commands:\n/status summary\n/ram RAM details\n/cpu CPU details\n/battery battery info\n/sites list websites';
    case '/status': {
      const bat = s.battery ? s.battery.percentage + '%' : 'n/a';
      return '🖥 ' + s.hostname + ' | ⏱ ' + fmtUptime(s.uptime) + '\n' +
        '⚙️ CPU load ' + s.cpu.load1 + ' (' + s.cpu.cores + ' core)\n' +
        '🧠 RAM ' + mb(s.mem.used) + '/' + mb(s.mem.total) + ' MB (' + s.mem.percent + '%)\n' +
        '💾 Disk ' + (s.disk ? s.disk.percent + '%' : 'n/a') + ' | 🔋 ' + bat + '\n' +
        '🌐 Website ' + run + '/' + s.sites.length + ' running';
    }
    case '/ram':
      return '🧠 RAM — Total ' + mb(s.mem.total) + ' MB, used ' + mb(s.mem.used) + ' MB (' + s.mem.percent + '%), free ' + mb(s.mem.free) + ' MB';
    case '/cpu':
      return '⚙️ CPU (' + s.cpu.cores + ' core) — load ' + s.cpu.load1 + '/' + s.cpu.load5 + '/' + s.cpu.load15 + ', uptime ' + fmtUptime(s.uptime);
    case '/battery': case '/bat':
      return s.battery ? '🔋 Battery ' + s.battery.percentage + '% (' + s.battery.status + ')' : '🔋 Battery unavailable (needs Termux:API)';
    case '/sites':
      return s.sites.length ? '🌐 Website:\n' + s.sites.map((x) => (x.running ? '🟢' : '🔴') + ' ' + x.name + ' (' + x.type + ') :' + x.port).join('\n') : 'No websites yet';
    default: return 'Unknown command. Type /help.';
  }
}
async function tgPollOnce() {
  const tg = loadSettings().telegram || {};
  if (!(tg.enabled && tg.botToken && tg.chatId && tg.commandsEnabled !== false)) return;
  let j;
  try { j = await tgApiGet(tg.botToken, '/getUpdates?offset=' + tgPollOffset + '&timeout=5'); }
  catch (e) { console.log('Telegram poll:', e.message); return; }
  for (const u of (j.result || [])) {
    tgPollOffset = Math.max(tgPollOffset, (u.update_id || 0) + 1);
    const m = u.message;
    if (!m || typeof m.text !== 'string') continue;
    if (String(m.chat && m.chat.id) !== String(tg.chatId)) { console.log('Telegram: message from unknown chat ignored'); continue; }
    const cmd = m.text.trim().split(' ')[0].split('@')[0].toLowerCase();
    try {
      const reply = await tgReply(tg, cmd);
      await telegramSend(tg.botToken, tg.chatId, reply);
    } catch (e) { console.log('Telegram reply failed:', e.message); }
  }
}
function stopTelegramPoll() {
  if (tgPollTimer) { clearInterval(tgPollTimer); tgPollTimer = null; }
}
function startTelegramPoll() {
  stopTelegramPoll();
  const tg = loadSettings().telegram || {};
  if (!(tg.enabled && tg.botToken && tg.chatId && tg.commandsEnabled !== false)) return;
  tgApiGet(tg.botToken, '/getUpdates?timeout=0').then((j) => {
    const r = j.result || [];
    if (r.length) tgPollOffset = Math.max.apply(null, r.map((u) => u.update_id)) + 1;
  }).catch((e) => console.log('Telegram poll:', e.message));
  tgPollTimer = setInterval(() => { tgPollOnce().catch((e) => console.log('Telegram poll:', e.message)); }, 10000);
}
// ================= Auth lanjutan =================
function validUsername(u) {
  return typeof u === 'string' && /^[a-zA-Z0-9_-]{3,32}$/.test(u);
}
async function apiChangeUsername(req, res) {
  const body = JSON.parse((await readBody(req, 1e6)).toString('utf8'));
  if (!validUsername(body.username)) throw new Error('Username 3-32 karakter (huruf/angka/_/-)');
  config.username = body.username;
  saveConfig();
  sendJson(res, 200, { ok: true, username: config.username });
}
async function apiChangePassword2(req, res) {
  const b = JSON.parse((await readBody(req, 1e6)).toString('utf8'));
  if (!b.currentPassword || hashPassword(b.currentPassword, config.salt) !== config.hash) {
    return sendJson(res, 400, { error: 'Password lama salah' });
  }
  if (!b.newPassword || b.newPassword.length < 6) {
    return sendJson(res, 400, { error: 'Password baru minimal 6 karakter' });
  }
  if (b.newPassword !== b.confirmPassword) {
    return sendJson(res, 400, { error: 'Password confirmation does not match' });
  }
  config.salt = crypto.randomBytes(16).toString('hex');
  config.hash = hashPassword(b.newPassword, config.salt);
  saveConfig();
  sessions.clear();
  sendJson(res, 200, { ok: true });
}
function apiLogoutAll(res) {
  sessions.clear();
  sendJson(res, 200, { ok: true });
}
// ================= Helper exec umum =================
function sq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
function execOk(cmd, timeout) {
  return new Promise((resolve) => {
    exec('bash -c ' + JSON.stringify(cmd), { timeout: timeout || 10000 }, (err, stdout) => {
      resolve({ ok: !err, out: String(stdout || '') + (err ? err.message : '') });
    });
  });
}
function execTimeout(cmd, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    exec('bash -c ' + JSON.stringify(cmd), {
      timeout: opts.timeout || 30000, cwd: opts.cwd || HOME, maxBuffer: 50 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message || 'Failed').slice(-800)));
      else resolve(String(stdout || ''));
    });
  });
}
async function mustBin(bin, msg) {
  const r = await execOk('command -v ' + bin + ' >/dev/null 2>&1', 8000);
  if (!r.ok) throw new Error(msg);
}
// ================= Dashboard: /api/stats =================
async function getStatsData() {
  const load = os.loadavg();
  const total = os.totalmem(), free = os.freemem();
  let disk = null;
  try {
    const out = await execTimeout('df -k ' + sq(ROOT), { timeout: 5000 });
    const cols = out.trim().split('\n').pop().split(/\s+/);
    if (cols.length >= 6) {
      const tot = parseInt(cols[1], 10) * 1024, used = parseInt(cols[2], 10) * 1024, av = parseInt(cols[3], 10) * 1024;
      disk = { total: tot, used, free: av, percent: tot ? Math.round((used / tot) * 100) : 0 };
    }
  } catch { /* ignore */ }
  let battery = null;
  try {
    const b = JSON.parse(await execTimeout('termux-battery-status', { timeout: 3000 }));
    battery = { percentage: b.percentage, status: b.status };
  } catch { /* ignore */ }
  return {
    hostname: os.hostname(), uptime: Math.floor(os.uptime()), time: Date.now(),
    cpu: { load1: +load[0].toFixed(2), load5: +load[1].toFixed(2), load15: +load[2].toFixed(2), cores: os.cpus().length },
    mem: { total, free, used: total - free, percent: total ? Math.round(((total - free) / total) * 100) : 0 },
    disk, battery,
    sites: sites.map((s) => ({ name: s.name, type: s.type, port: s.port, running: running.has(s.id) })),
  };
}
async function apiStats(res) {
  sendJson(res, 200, await getStatsData());
}
// ================= Nginx reverse proxy =================
const NGINX_FILE = path.join(DATA_DIR, 'nginx.json');
const NGINX_SITES_DIR = path.join(DATA_DIR, 'nginx', 'sites');
let nginxProxies = [];
function loadNginx() {
  try { nginxProxies = JSON.parse(fs.readFileSync(NGINX_FILE, 'utf8')).proxies || []; }
  catch { nginxProxies = []; }
}
function saveNginx() {
  fs.writeFileSync(NGINX_FILE, JSON.stringify({ proxies: nginxProxies }, null, 2), { mode: 0o600 });
}
loadNginx();
function termuxPrefix() { return process.env.PREFIX || '/data/data/com.termux/files/usr'; }
function nginxConfBlock(p) {
  return 'server {\n' +
    '    listen ' + p.listenPort + ';\n' +
    '    server_name ' + (p.domain || '_') + ';\n' +
    '    location / {\n' +
    '        proxy_pass http://127.0.0.1:' + p.targetPort + ';\n' +
    '        proxy_set_header Host $host;\n' +
    '        proxy_set_header X-Real-IP $remote_addr;\n' +
    '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n' +
    '    }\n}\n';
}
function ensureNginxInclude() {
  const confPath = path.join(termuxPrefix(), 'etc', 'nginx', 'nginx.conf');
  if (!fs.existsSync(confPath)) throw new Error('nginx.conf not found. Install nginx first via the Store menu.');
  let txt = fs.readFileSync(confPath, 'utf8');
  if (txt.includes(NGINX_SITES_DIR)) return;
  const hi = txt.indexOf('http {');
  if (hi === -1) throw new Error('http block not found in nginx.conf');
  let depth = 0, i = txt.indexOf('{', hi);
  for (; i < txt.length; i++) {
    if (txt[i] === '{') depth++;
    else if (txt[i] === '}') { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) throw new Error('nginx.conf rusak (kurung tak seimbang)');
  const line = '    include ' + NGINX_SITES_DIR + '/*.conf;\n';
  fs.writeFileSync(confPath, txt.slice(0, i) + line + txt.slice(i), 'utf8');
}
async function nginxWriteAll() {
  fs.mkdirSync(NGINX_SITES_DIR, { recursive: true });
  for (const f of fs.readdirSync(NGINX_SITES_DIR)) {
    if (f.startsWith('panel-') && f.endsWith('.conf')) fs.unlinkSync(path.join(NGINX_SITES_DIR, f));
  }
  for (const p of nginxProxies) {
    fs.writeFileSync(path.join(NGINX_SITES_DIR, 'panel-' + p.id + '.conf'), nginxConfBlock(p));
  }
  ensureNginxInclude();
  const t = await execOk('nginx -t', 15000);
  if (!t.ok) throw new Error('nginx -t failed: ' + t.out.slice(-500));
}
async function nginxTryReload() {
  const r = await execOk('nginx -s reload', 10000);
  return r.ok;
}
async function apiNginxStatus(res) {
  const r = await execOk('pgrep -x nginx >/dev/null 2>&1', 5000);
  sendJson(res, 200, { running: r.ok });
}
async function apiNginxService(req, res) {
  const body = JSON.parse((await readBody(req, 1e6)).toString('utf8'));
  const act = body.action;
  if (act === 'start') {
    await mustBin('nginx', 'nginx is not installed. Install it first via the Store menu.');
    const r = await execOk('nginx', 10000);
    if (!r.ok) throw new Error('Failed to start nginx: ' + r.out.slice(-500));
  } else if (act === 'stop') {
    const r = await execOk('nginx -s stop', 10000);
    if (!r.ok) throw new Error('Failed to stop nginx: ' + r.out.slice(-500));
  } else if (act === 'reload') {
    await mustBin('nginx', 'nginx is not installed. Install it first via the Store menu.');
    const t = await execOk('nginx -t', 15000);
    if (!t.ok) throw new Error('nginx -t failed: ' + t.out.slice(-500));
    await execOk('nginx -s reload', 10000);
  } else throw new Error('Unknown action');
  sendJson(res, 200, { ok: true });
}
function apiNginxList(res) {
  sendJson(res, 200, { proxies: nginxProxies });
}
async function apiNginxCreate(req, res) {
  const b = JSON.parse((await readBody(req, 1e6)).toString('utf8'));
  const name = (b.name || '').trim();
  if (!name) throw new Error('Name is required');
  const listenPort = parseInt(b.listenPort, 10);
  if (!listenPort || listenPort < 1024 || listenPort > 65535) {
    throw new Error('Listen port must be 1024-65535 (Termux cannot bind <1024 without root)');
  }
  const targetPort = parseInt(b.targetPort, 10);
  if (!targetPort || targetPort < 1 || targetPort > 65535) throw new Error('Invalid target port');
  const domain = (b.domain || '').trim();
  if (domain && !/^[a-zA-Z0-9.*_-]+$/.test(domain)) throw new Error('Invalid domain');
  if (nginxProxies.some((p) => p.listenPort === listenPort)) throw new Error('Listen port is already used by another proxy');
  const p = { id: crypto.randomBytes(4).toString('hex'), name, listenPort, domain, targetPort, created: Date.now() };
  nginxProxies.push(p);
  saveNginx();
  try { await nginxWriteAll(); } catch (e) { nginxProxies = nginxProxies.filter((x) => x.id !== p.id); saveNginx(); throw e; }
  await nginxTryReload();
  sendJson(res, 200, { ok: true, proxy: p });
}
async function apiNginxDelete(res, id) {
  nginxProxies = nginxProxies.filter((p) => p.id !== id);
  saveNginx();
  try { await nginxWriteAll(); } catch { /* ignore, conf already deleted */ }
  await nginxTryReload();
  sendJson(res, 200, { ok: true });
}
// ================= Cron scheduler =================
function cronSpawnWrite(lines) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', 'crontab -']);
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString('utf8'); });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error('crontab failed: ' + err.slice(-300))));
    child.stdin.write(lines.join('\n') + '\n');
    child.stdin.end();
  });
}
async function cronLines() {
  const r = await execOk('crontab -l', 8000);
  if (!r.ok) return [];
  return r.out.split('\n');
}
function cronParseLine(line) {
  let enabled = true, s = line;
  if (s.trimStart().startsWith('#')) {
    enabled = false;
    s = s.replace(/^(\s*)#/, '$1');
  }
  const m = s.match(/#\s*panel:([0-9a-f]+):(.*)$/);
  if (!m) return null;
  const head = s.slice(0, m.index).trim().split(/\s+/);
  if (head.length < 6) return null;
  return { id: m[1], name: (m[2] || '').trim(), schedule: head.slice(0, 5).join(' '), command: head.slice(5).join(' '), enabled };
}
function cronJobLine(j) {
  return j.schedule + ' ' + j.command + ' # panel:' + j.id + ':' + j.name.replace(/[\r\n#]/g, ' ');
}
async function apiCronStatus(res) {
  const r = await execOk('pgrep -x crond >/dev/null 2>&1', 5000);
  sendJson(res, 200, { running: r.ok });
}
async function apiCronService(req, res) {
  const body = JSON.parse((await readBody(req, 1e6)).toString('utf8'));
  if (body.action === 'start') {
    await mustBin('crond', 'crond is not installed. Install Cronie via the Store menu.');
    const child = spawn('crond', [], { detached: true, stdio: 'ignore' });
    child.unref();
    sendJson(res, 200, { ok: true });
  } else if (body.action === 'stop') {
    await execOk('pkill -x crond', 5000);
    sendJson(res, 200, { ok: true });
  } else throw new Error('Unknown action');
}
async function apiCronJobs(res) {
  const jobs = [];
  for (const l of await cronLines()) {
    const j = cronParseLine(l);
    if (j) jobs.push(j);
  }
  sendJson(res, 200, { jobs });
}
async function apiCronAdd(req, res) {
  const b = JSON.parse((await readBody(req, 1e6)).toString('utf8'));
  const name = (b.name || '').trim() || 'job';
  const schedule = (b.schedule || '').trim();
  const command = (b.command || '').trim();
  if (!/^(\S+\s+){4}\S+$/.test(schedule)) throw new Error('Jadwal harus 5 field cron');
  if (!command) throw new Error('Command wajib diisi');
  await mustBin('crontab', 'crontab is not available on this system');
  const lines = await cronLines();
  const job = { id: crypto.randomBytes(4).toString('hex'), name, schedule, command };
  lines.push(cronJobLine(job));
  await cronSpawnWrite(lines);
  sendJson(res, 200, { ok: true, job });
}
async function apiCronDelete(res, id) {
  const lines = await cronLines();
  const kept = lines.filter((l) => { const j = cronParseLine(l); return !j || j.id !== id; });
  await cronSpawnWrite(kept);
  sendJson(res, 200, { ok: true });
}
async function apiCronToggle(res, id) {
  const lines = await cronLines();
  const out = lines.map((l) => {
    const j = cronParseLine(l);
    if (!j || j.id !== id) return l;
    if (j.enabled) return '#' + l;
    return l.replace(/^(\s*)#/, '$1');
  });
  await cronSpawnWrite(out);
  sendJson(res, 200, { ok: true });
}
// ================= Backup & restore =================
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
function backupStamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
function backupMeta(name) {
  try { return JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, name + '.json'), 'utf8')); }
  catch { return null; }
}
async function apiBackupList(res) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const out = [];
  for (const f of fs.readdirSync(BACKUP_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, f), 'utf8'));
      const st = fs.statSync(path.join(BACKUP_DIR, meta.file));
      out.push({ name: meta.name, file: meta.file, type: meta.type, source: meta.source, size: st.size, mtime: st.mtimeMs, created: meta.created });
    } catch { /* ignore */ }
  }
  out.sort((a, b) => b.created - a.created);
  sendJson(res, 200, { backups: out });
}
async function apiBackupCreate(req, res) {
  const b = JSON.parse((await readBody(req, 1e6)).toString('utf8'));
  const type = b.type;
  if (type !== 'folder' && type !== 'mysql' && type !== 'postgres') throw new Error('Invalid type');
  let name = (b.name || '').trim() || ('backup-' + backupStamp());
  name = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!name) throw new Error('Invalid name');
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (backupMeta(name)) throw new Error('Backup name already taken');
  let file, source;
  if (type === 'folder') {
    const src = safePath(b.source || '.');
    const st = await fsp.stat(src).catch(() => null);
    if (!st) throw new Error('Source not found');
    await mustBin('zip', 'Package "zip" is not installed — install it first via the Store menu');
    file = name + '.zip';
    source = relOf(src);
    await execTimeout('zip -rq ' + sq(path.join(BACKUP_DIR, file)) + ' .', { cwd: src, timeout: 120000 });
  } else {
    const dbName = (b.source || '').trim();
    if (!dbName) throw new Error('Nama database wajib diisi');
    const cfg = normCfg(type, (loadDbConfigs()[type]) || {});
    source = dbName;
    file = name + '.sql';
    const dest = path.join(BACKUP_DIR, file);
    if (type === 'mysql') {
      await mustBin('mysqldump', 'mysqldump not found. Install mysql via the Store menu.');
      const pw = cfg.password ? ' --password=' + sq(cfg.password) : '';
      await execTimeout('mysqldump -h ' + sq(cfg.host) + ' -P ' + cfg.port + ' -u ' + sq(cfg.user) + pw + ' ' + sq(dbName) + ' > ' + sq(dest), { timeout: 120000 });
    } else {
      await mustBin('pg_dump', 'pg_dump not found. Install postgres via the Store menu.');
      await execTimeout('PGPASSWORD=' + sq(cfg.password) + ' pg_dump -h ' + sq(cfg.host) + ' -p ' + cfg.port + ' -U ' + sq(cfg.user) + ' -d ' + sq(dbName) + ' > ' + sq(dest), { timeout: 120000 });
    }
  }
  fs.writeFileSync(path.join(BACKUP_DIR, name + '.json'), JSON.stringify({ name, file, type, source, created: Date.now() }, null, 2), { mode: 0o600 });
  sendJson(res, 200, { ok: true, name });
}
function apiBackupDownload(res, name) {
  const meta = backupMeta(name);
  if (!meta || /[^a-zA-Z0-9._-]/.test(name)) throw new Error('Backup not found');
  const full = path.join(BACKUP_DIR, meta.file);
  const st = fs.statSync(full);
  if (!st.isFile()) throw new Error('File backup hilang');
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': st.size,
    'Content-Disposition': 'attachment; filename="' + meta.file.replace(/"/g, '') + '"',
  });
  fs.createReadStream(full).pipe(res);
}
function apiBackupDelete(res, name) {
  const meta = backupMeta(name);
  if (!meta || /[^a-zA-Z0-9._-]/.test(name)) throw new Error('Backup not found');
  try { fs.unlinkSync(path.join(BACKUP_DIR, meta.file)); } catch { /* ignore */ }
  try { fs.unlinkSync(path.join(BACKUP_DIR, name + '.json')); } catch { /* ignore */ }
  sendJson(res, 200, { ok: true });
}
async function apiBackupRestore(req, res, name) {
  const meta = backupMeta(name);
  if (!meta || /[^a-zA-Z0-9._-]/.test(name)) throw new Error('Backup not found');
  const b = JSON.parse((await readBody(req, 1e6)).toString('utf8'));
  const full = path.join(BACKUP_DIR, meta.file);
  if (meta.type === 'folder') {
    const target = safePath(b.targetPath || meta.source || '.');
    await mustBin('unzip', 'Package "unzip" is not installed — install it first via the Store menu');
    fs.mkdirSync(target, { recursive: true });
    await execTimeout('unzip -o ' + sq(full) + ' -d ' + sq(target), { timeout: 120000 });
  } else {
    const cfg = normCfg(meta.type, (loadDbConfigs()[meta.type]) || {});
    if (meta.type === 'mysql') {
      await mustBin('mysql', 'mysql not found. Install mysql via the Store menu.');
      const pw = cfg.password ? ' --password=' + sq(cfg.password) : '';
      await execTimeout('mysql -h ' + sq(cfg.host) + ' -P ' + cfg.port + ' -u ' + sq(cfg.user) + pw + ' ' + sq(meta.source) + ' < ' + sq(full), { timeout: 120000 });
    } else {
      await mustBin('psql', 'psql not found. Install postgres via the Store menu.');
      await execTimeout('PGPASSWORD=' + sq(cfg.password) + ' psql -h ' + sq(cfg.host) + ' -p ' + cfg.port + ' -U ' + sq(cfg.user) + ' -d ' + sq(meta.source) + ' < ' + sq(full), { timeout: 120000 });
    }
  }
  sendJson(res, 200, { ok: true });
}
// ================= File manager tambahan =================
async function apiFileZip(req, res) {
  const b = JSON.parse((await readBody(req, 1e6)).toString('utf8'));
  const full = safePath(b.path || '');
  if (full === ROOT) throw new Error('Cannot zip root');
  await mustBin('zip', 'Package "zip" is not installed — install it first via the Store menu');
  await execTimeout('zip -rq ' + sq(full + '.zip') + ' ' + sq(path.basename(full)), { cwd: path.dirname(full), timeout: 60000 });
  sendJson(res, 200, { ok: true, zipPath: relOf(full + '.zip') });
}
async function apiFileUnzip(req, res) {
  const b = JSON.parse((await readBody(req, 1e6)).toString('utf8'));
  const full = safePath(b.path || '');
  if (!/\.zip$/i.test(full)) throw new Error('Bukan file zip');
  await mustBin('unzip', 'Package "unzip" is not installed — install it first via the Store menu');
  await execTimeout('unzip -o ' + sq(full) + ' -d ' + sq(path.dirname(full)), { timeout: 60000 });
  sendJson(res, 200, { ok: true });
}
const PREVIEW_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
async function apiFilePreview(url, res) {
  const full = safePath(url.searchParams.get('path') || '');
  const mime = PREVIEW_MIME[path.extname(full).toLowerCase()];
  if (!mime) throw new Error('Preview hanya untuk gambar');
  const st = await fsp.stat(full);
  if (!st.isFile() || st.size > 20 * 1024 * 1024) throw new Error('Invalid file');
  res.writeHead(200, { 'Content-Type': mime, 'Content-Length': st.size });
  fs.createReadStream(full).pipe(res);
}
// ================= Health check website + notif =================
const siteHealth = new Map();
function healthCheckOnce() {
  for (const s of sites) {
    if (!running.has(s.id)) { siteHealth.delete(s.id); continue; }
    const req = http.get({ host: '127.0.0.1', port: s.port, path: '/', timeout: 5000 }, (r) => {
      r.resume();
      if (siteHealth.get(s.id)) sendTelegram('Website "' + s.name + '" recovered (port ' + s.port + ')');
      siteHealth.set(s.id, false);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => {
      if (!siteHealth.get(s.id)) sendTelegram('Website "' + s.name + '" DOWN (port ' + s.port + ')');
      siteHealth.set(s.id, true);
    });
  }
}
setInterval(() => { try { healthCheckOnce(); } catch (e) { console.log('Health check failed:', e.message); } }, 60000);

// ================= HTTP server =================
const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((e) => {
    if (!res.headersSent) sendJson(res, 400, { error: (e && e.message) || 'Failed' });
    else { try { res.end(); } catch { /* ignore */ } }
  });
});

// App pages served by clean slugs (no .html). Each slug renders the same
// shell; the client activates the matching tab from the URL path.
const APP_PAGES = new Set(['dashboard', 'website', 'database', 'files', 'cron', 'backup', 'settings', 'terminal', 'store']);

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;

    if (p === '/') {
      res.writeHead(302, { Location: isAuthed(req) ? '/dashboard' : '/login' });
      return res.end();
    }
    if (p === '/login') return servePublic(res, 'login.html');
    if (p === '/login.html') { res.writeHead(302, { Location: '/login' }); return res.end(); }
    // aset publik untuk halaman login (tanpa auth)
    if (p === '/tailwind.css') return servePublic(res, 'tailwind.css');
    if (p === '/favicon.svg') return servePublic(res, 'favicon.svg');
    if (p === '/vendor/lucide.min.js') return servePublic(res, 'vendor/lucide.min.js');

        if (p === '/api/login' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req, 1e6)).toString('utf8'));
      const userOk = timingSafeEq(body.username || '', config.username || '');
      const passOk = body.password && hashPassword(body.password, config.salt) === config.hash;
      if (userOk && passOk) {
        const token = crypto.randomBytes(32).toString('hex');
        sessions.set(token, { created: Date.now() });
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': 'tpsid=' + token + '; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400',
        });
        return res.end(JSON.stringify({ ok: true }));
      }
      return sendJson(res, 401, { error: 'Username atau password salah' });
    }

    // ---- semua di bawah ini wajib login ----
    if (!isAuthed(req)) {
      if (p.startsWith('/api/') || p === '/term') return sendJson(res, 401, { error: 'Not logged in' });
      res.writeHead(302, { Location: '/login' });
      return res.end();
    }

    if (p === '/app.html') { res.writeHead(302, { Location: '/dashboard' }); return res.end(); }
    if (APP_PAGES.has(p.slice(1))) return servePublic(res, 'app.html');
    if (p === '/app.js') return servePublic(res, 'app.js');
    if (p === '/style.css') return servePublic(res, 'style.css');
    if (p === '/vendor/xterm.js') return servePublic(res, 'vendor/xterm.js');
    if (p === '/vendor/xterm.css') return servePublic(res, 'vendor/xterm.css');
    if (p === '/vendor/xterm-addon-fit.js') return servePublic(res, 'vendor/xterm-addon-fit.js');

    if (p === '/api/logout' && req.method === 'POST') {
      const c = parseCookies(req);
      if (c.tpsid) sessions.delete(c.tpsid);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': 'tpsid=; HttpOnly; Path=/; Max-Age=0',
      });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (p === '/api/files') return apiFiles(url, res);
    if (p === '/api/sysinfo') return apiSysinfo(res);
    if (p === '/api/download') return apiDownload(url, res);
    if (req.method === 'POST' && p === '/api/mkdir') return apiMkdir(req, res);
    if (req.method === 'POST' && p === '/api/touch') return apiTouch(req, res);
    if (req.method === 'POST' && p === '/api/rename') return apiRename(req, res);
    if (req.method === 'POST' && p === '/api/delete') return apiDelete(req, res);
    if (req.method === 'POST' && p === '/api/read') return apiRead(req, res);
    if (req.method === 'POST' && p === '/api/write') return apiWrite(req, res);
    if (req.method === 'POST' && p === '/api/upload') return apiUpload(req, res);
    if (req.method === 'POST' && p === '/api/chpasswd') return apiChpasswd(req, res);

    // website hosting
    if (p === '/api/sites' && req.method === 'GET') return apiSitesList(res);
    if (p === '/api/sites' && req.method === 'POST') return apiSiteCreate(req, res);
    const sm = p.match(/^\/api\/sites\/([0-9a-f]{16})\/(start|stop|restart|delete|logs)$/);
    if (sm) {
      const sid = sm[1], act = sm[2];
      if (act === 'start' && req.method === 'POST') return apiSiteStart(req, res, sid);
      if (act === 'stop' && req.method === 'POST') return apiSiteStop(req, res, sid);
      if (act === 'restart' && req.method === 'POST') return apiSiteRestart(req, res, sid);
      if (act === 'delete' && req.method === 'POST') return apiSiteDelete(req, res, sid);
      if (act === 'logs' && req.method === 'GET') return apiSiteLogs(res, sid);
    }

    // install center
    if (p === '/api/install' && req.method === 'GET') return apiInstallList(res);
    const im = p.match(/^\/api\/install\/([a-z0-9-]+)\/(start|log)$/);
    if (im) {
      if (im[2] === 'start' && req.method === 'POST') return apiInstallStart(req, res, im[1]);
      if (im[2] === 'log' && req.method === 'GET') return apiInstallLog(res, im[1]);
    }

    // database manager
    const dm = p.match(/^\/api\/db\/(mysql|postgres)\/(config|test|connect|disconnect|databases|tables|rows|query)$/);
    if (dm) {
      const dt = dm[1], da = dm[2];
      if (da === 'config' && req.method === 'GET') return apiDbConfigGet(res, dt);
      if (da === 'config' && req.method === 'POST') return apiDbConfigSave(req, res, dt);
      if (da === 'test' && req.method === 'POST') return apiDbTest(req, res, dt);
      if (da === 'connect' && req.method === 'POST') return apiDbConnect(req, res, dt);
      if (da === 'disconnect' && req.method === 'POST') return apiDbDisconnect(res, dt);
      if (da === 'databases' && req.method === 'GET') return apiDbDatabases(res, dt);
      if (da === 'tables' && req.method === 'GET') return apiDbTables(url, res, dt);
      if (da === 'rows' && req.method === 'GET') return apiDbRows(url, res, dt);
      if (da === 'query' && req.method === 'POST') return apiDbQuery(req, res, dt);
    }
        // auth & settings
    if (req.method === 'POST' && p === '/api/auth/change-username') return apiChangeUsername(req, res);
    if (req.method === 'POST' && p === '/api/auth/change-password') return apiChangePassword2(req, res);
    if (req.method === 'POST' && p === '/api/auth/logout-all') return apiLogoutAll(res);
    if (req.method === 'GET' && p === '/api/settings') return apiSettingsGet(res);
    if (req.method === 'POST' && p === '/api/settings') return apiSettingsPost(req, res);
    if (req.method === 'POST' && p === '/api/settings/test-telegram') return apiTelegramTest(res);
    // dashboard
    if (req.method === 'GET' && p === '/api/stats') return apiStats(res);
    // nginx reverse proxy
    if (req.method === 'GET' && p === '/api/nginx/status') return apiNginxStatus(res);
    if (req.method === 'POST' && p === '/api/nginx/service') return apiNginxService(req, res);
    if (req.method === 'GET' && p === '/api/nginx/proxies') return apiNginxList(res);
    if (req.method === 'POST' && p === '/api/nginx/proxies') return apiNginxCreate(req, res);
    const nxm = p.match(/^\/api\/nginx\/proxies\/([0-9a-f]+)$/);
    if (nxm && req.method === 'DELETE') return apiNginxDelete(res, nxm[1]);
    // cron
    if (req.method === 'GET' && p === '/api/cron/status') return apiCronStatus(res);
    if (req.method === 'POST' && p === '/api/cron/service') return apiCronService(req, res);
    if (req.method === 'GET' && p === '/api/cron/jobs') return apiCronJobs(res);
    if (req.method === 'POST' && p === '/api/cron/jobs') return apiCronAdd(req, res);
    const crm = p.match(/^\/api\/cron\/jobs\/([0-9a-f]+)(\/toggle)?$/);
    if (crm) {
      if (crm[2] && req.method === 'POST') return apiCronToggle(res, crm[1]);
      if (!crm[2] && req.method === 'DELETE') return apiCronDelete(res, crm[1]);
    }
    // backup
    if (req.method === 'GET' && p === '/api/backups') return apiBackupList(res);
    if (req.method === 'POST' && p === '/api/backups') return apiBackupCreate(req, res);
    const bkm = p.match(/^\/api\/backups\/([A-Za-z0-9._-]+)(\/(download|restore))?$/);
    if (bkm) {
      if (bkm[3] === 'download' && req.method === 'GET') return apiBackupDownload(res, bkm[1]);
      if (bkm[3] === 'restore' && req.method === 'POST') return apiBackupRestore(req, res, bkm[1]);
      if (!bkm[3] && req.method === 'DELETE') return apiBackupDelete(res, bkm[1]);
    }
    // file manager tambahan
    if (req.method === 'POST' && p === '/api/files/zip') return apiFileZip(req, res);
    if (req.method === 'POST' && p === '/api/files/unzip') return apiFileUnzip(req, res);
    if (req.method === 'GET' && p === '/api/files/preview') return apiFilePreview(url, res);
sendJson(res, 404, { error: 'Not found' });
  } catch (e) {
    sendJson(res, 400, { error: e.message || 'Failed' });
  }
}

// ================= Terminal via WebSocket (xterm.js + node-pty opsional) =================
let ptyMod = null;
try { ptyMod = require('node-pty'); } catch { /* opsional, fallback ke pipe */ }
const wss = new WebSocket.Server({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  let ok = false;
  try {
    const url = new URL(req.url, 'http://x');
    ok = url.pathname === '/term' && isAuthed(req);
  } catch { /* ignore */ }
  if (!ok) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const shell = process.env.SHELL || 'bash';
    const send = (d) => { if (ws.readyState === 1) ws.send(d.toString('utf8')); };
    let writeFn, resizeFn, killFn;
    if (ptyMod) {
      const p = ptyMod.spawn(shell, [], { name: 'xterm-256color', cols: 80, rows: 24,
        cwd: ROOT, env: Object.assign({}, process.env, { TERM: 'xterm-256color' }) });
      p.onData(send);
      writeFn = (d) => { try { p.write(d); } catch {} };
      resizeFn = (c, r) => { try { p.resize(c, r); } catch {} };
      killFn = () => { try { p.kill(); } catch {} };
      p.on('exit', () => { try { ws.close(); } catch {} });
    } else {
      const child = spawn(shell, [], { cwd: ROOT,
        env: Object.assign({}, process.env, { TERM: 'xterm-256color' }) });
      child.stdout.on('data', send);
      child.stderr.on('data', send);
      writeFn = (d) => { try { child.stdin.write(d); } catch {} };
      resizeFn = () => {};
      killFn = () => { try { child.kill(); } catch {} };
      child.on('exit', () => { try { ws.close(); } catch {} });
    }
    ws.on('message', (m) => {
      const s = m.toString();
      let msg = null;
      try { msg = JSON.parse(s); } catch { /* mentah seperti dulu */ }
      if (msg && typeof msg === 'object' && msg.t === 'in') writeFn(msg.d || '');
      else if (msg && typeof msg === 'object' && msg.t === 'rs') resizeFn(msg.c | 0 || 80, msg.r | 0 || 24);
      else writeFn(s);
    });
    ws.on('close', killFn);
    ws.on('error', killFn);
    ws.send('\r\n=== Terminal siap (' + shell + (ptyMod ? ', pty' : ', pipe') + ') ===\r\n');
  });
});

server.listen(PORT, HOST, () => {
  try { startTelegramPoll(); } catch { /* ignore */ }
  console.log('Terwo running at http://' + HOST + ':' + PORT);
  console.log('Working directory: ' + ROOT);
  if (HOST === '0.0.0.0') {
    console.log('WARNING: panel is open on all network interfaces. Make sure it is protected!');
  }
});
