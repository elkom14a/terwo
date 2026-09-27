'use strict';
/* Frontend Terwo */

// ---------- helper ----------
async function api(path, opts) {
  const r = await fetch(path, opts);
  if (r.status === 401) { location.href = '/login.html'; throw new Error('Sesi habis'); }
  return r;
}
function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}
function fmtDate(ms) {
  return new Date(ms).toLocaleString('id-ID');
}
function fmtUptime(sec) {
  sec = Math.floor(sec || 0);
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d > 0) return d + 'h ' + h + 'j';
  if (h > 0) return h + 'j ' + m + 'm';
  return m + 'm';
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// ---------- ikon lucide ----------
function refreshIcons() { try { if (window.lucide) lucide.createIcons(); } catch (e) {} }
function ic(n, c) { return '<i data-lucide="' + n + '" class="' + (c || 'h-4 w-4') + '"></i>'; }
function dot() { return '<span class="h-1.5 w-1.5 rounded-full bg-current"></span>'; }
// ---------- tema dark/light (tersimpan di localStorage 'terwo-theme') ----------
function getTheme() {
  try { return localStorage.getItem('terwo-theme') === 'light' ? 'light' : 'dark'; }
  catch (e) { return 'dark'; }
}
function updateThemeUI(t) {
  const icon = t === 'light' ? 'moon' : 'sun';
  const label = t === 'light' ? 'Mode Gelap' : 'Mode Terang';
  document.querySelectorAll('.btn-theme').forEach((b) => {
    const hasLabel = b.querySelector('span') !== null;
    b.innerHTML = ic(icon, 'h-4 w-4') + (hasLabel ? '<span>' + label + '</span>' : '');
    b.setAttribute('title', label);
    b.setAttribute('aria-label', label);
  });
  refreshIcons();
}
function applyTheme(t) {
  document.documentElement.classList.toggle('light', t === 'light');
  try { localStorage.setItem('terwo-theme', t); } catch (e) {}
  updateThemeUI(t);
}
function badgeOk(t) { return '<span class="badge badge-ok">' + dot() + esc(t) + '</span>'; }
function badgeOff(t) { return '<span class="badge badge-off">' + dot() + esc(t) + '</span>'; }
function badgeWarn(t) { return '<span class="badge badge-warn">' + dot() + esc(t) + '</span>'; }

// ---------- tabs ----------
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === t.dataset.tab));
    document.querySelectorAll('.tabpane').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById('tab-' + t.dataset.tab).classList.add('active');
    if (t.dataset.tab === 'install') loadInstall();
    if (t.dataset.tab === 'db') loadDbConfig();
    if (t.dataset.tab === 'web') loadNginx();
    if (t.dataset.tab === 'dashboard') startStats(); else stopStats();
    if (t.dataset.tab === 'cron') loadCron();
    if (t.dataset.tab === 'term') termTabOpen();
    if (t.dataset.tab === 'backup') loadBackups();
    if (t.dataset.tab === 'settings') loadSettings();
  });
});

// ---------- sysinfo ----------
(async () => {
  try {
    const j = await (await api('/api/sysinfo')).json();
    const row = (icn, txt) => '<span class="flex items-center gap-2 overflow-hidden text-ellipsis whitespace-nowrap">' + ic(icn, 'h-3.5 w-3.5 text-accent-h') + txt + '</span>';
    document.getElementById('sysinfo').innerHTML =
      row('server', esc(j.hostname)) +
      row('timer', fmtUptime(j.uptime)) +
      row('memory-stick', fmtSize(j.totalmem - j.freemem) + ' / ' + fmtSize(j.totalmem)) +
      row('folder', esc(j.root));
    refreshIcons();
  } catch { /* abaikan */ }
})();

// ---------- logout & ganti password ----------
document.getElementById('btn-logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  location.href = '/login.html';
});
const pwModal = document.getElementById('passwd-modal');
document.getElementById('btn-passwd').addEventListener('click', () => pwModal.classList.remove('hidden'));
document.getElementById('passwd-close').addEventListener('click', () => pwModal.classList.add('hidden'));
document.getElementById('pw-save').addEventListener('click', async () => {
  const err = document.getElementById('pw-err');
  err.textContent = '';
  const r = await api('/api/chpasswd', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      old: document.getElementById('pw-old').value,
      new: document.getElementById('pw-new').value,
    }),
  });
  const j = await r.json();
  if (j.ok) location.href = '/login.html';
  else err.textContent = j.error || 'Gagal';
});

// ---------- file manager ----------
let curDir = '';
const crumbsEl = document.getElementById('crumbs');
const listEl = document.getElementById('file-list');
const fileErr = document.getElementById('file-error');

function entryPath(name) { return curDir ? curDir + '/' + name : name; }

function showFileErr(m) {
  fileErr.textContent = m;
  setTimeout(() => { fileErr.textContent = ''; }, 4000);
}

function renderCrumbs() {
  const parts = curDir ? curDir.split('/') : [];
  let html = '<button class="crumb" data-p="">' + ic('house', 'h-[15px] w-[15px]') + '</button>';
  let acc = '';
  for (const p of parts) {
    acc = acc ? acc + '/' + p : p;
    html += ' <span class="text-muted">/</span> <button class="crumb" data-p="' + esc(acc) + '">' + esc(p) + '</button>';
  }
  crumbsEl.innerHTML = html;
  crumbsEl.querySelectorAll('.crumb').forEach((b) => {
    b.addEventListener('click', () => { curDir = b.dataset.p; loadFiles(); });
  });
  refreshIcons();
}

function fileIcon(e) {
  if (e.type === 'dir') return ic('folder', 'h-4 w-4 text-accent-h');
  if (/\.(png|jpe?g|gif|webp|svg|ico)$/i.test(e.name)) return ic('image', 'h-4 w-4 text-warn');
  if (/\.zip$/i.test(e.name)) return ic('archive', 'h-4 w-4 text-ok');
  return ic('file-text', 'h-4 w-4 text-muted');
}

async function loadFiles() {
  renderCrumbs();
  try {
    const j = await (await api('/api/files?path=' + encodeURIComponent(curDir))).json();
    listEl.innerHTML = '';
    if (curDir) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="4"><button class="crumb" id="up">' + ic('arrow-up', 'h-[15px] w-[15px]') + ' ..</button></td>';
      listEl.appendChild(tr);
      tr.querySelector('#up').addEventListener('click', () => {
        curDir = curDir.split('/').slice(0, -1).join('/');
        loadFiles();
      });
    }
    for (const e of j.entries) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td><span class="fname inline-flex cursor-pointer items-center gap-2 font-medium hover:text-accent-h" data-n="' + esc(e.name) + '" data-t="' + e.type + '">' + fileIcon(e) + ' ' + esc(e.name) + '</span></td>' +
        '<td class="muted">' + (e.type === 'dir' ? '—' : fmtSize(e.size)) + '</td>' +
        '<td class="muted">' + fmtDate(e.mtime) + '</td>' +
        '<td><div class="row-actions"></div></td>';
      const acts = tr.querySelector('.row-actions');
      const mkBtn = (icn, fn, title) => {
        const b = document.createElement('button');
        b.className = 'mini'; b.innerHTML = ic(icn, 'h-[15px] w-[15px]');
        if (title) b.title = title;
        b.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); });
        acts.appendChild(b);
      };
      if (e.type === 'dir') {
        tr.querySelector('.fname').addEventListener('click', () => {
          curDir = entryPath(e.name);
          loadFiles();
        });
      } else {
        mkBtn('download', () => {
          location.href = '/api/download?path=' + encodeURIComponent(curDir) + '&name=' + encodeURIComponent(e.name);
        }, 'Download');
        mkBtn('pencil', () => openEditor(e.name), 'Edit');
        if (/\.(png|jpe?g|gif|webp|svg|ico)$/i.test(e.name)) mkBtn('eye', () => previewImage(e.name), 'Preview');
        if (/\.zip$/i.test(e.name)) mkBtn('package-open', () => unzipEntry(e.name), 'Ekstrak ZIP');
      }
      mkBtn('archive', () => zipEntry(e.name), 'Arsipkan ZIP');
      mkBtn('pencil-line', () => renameEntry(e.name), 'Rename');
      mkBtn('trash-2', () => deleteEntry(e.name), 'Hapus');
      listEl.appendChild(tr);
    }
    if (!j.entries.length) {
      listEl.innerHTML += '<tr><td colspan="4" class="muted">Folder kosong</td></tr>';
    }
    refreshIcons();
  } catch (e) {
    showFileErr(e.message || 'Gagal memuat');
  }
}
// file manager: aksi
document.getElementById('btn-mkdir').addEventListener('click', async () => {
  const n = prompt('Nama folder:');
  if (!n) return;
  const r = await api('/api/mkdir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: curDir, name: n }),
  });
  const j = await r.json();
  if (j.ok) loadFiles(); else showFileErr(j.error || 'Gagal');
});
document.getElementById('btn-touch').addEventListener('click', async () => {
  const n = prompt('Nama file:');
  if (!n) return;
  const r = await api('/api/touch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: curDir, name: n }),
  });
  const j = await r.json();
  if (j.ok) loadFiles(); else showFileErr(j.error || 'Gagal');
});
async function deleteEntry(name) {
  if (!confirm('Hapus "' + name + '"?')) return;
  const r = await api('/api/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: curDir, name }),
  });
  const j = await r.json();
  if (j.ok) loadFiles(); else showFileErr(j.error || 'Gagal');
}
async function renameEntry(name) {
  const n = prompt('Nama baru:', name);
  if (!n || n === name) return;
  const r = await api('/api/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: curDir, from: name, to: n }),
  });
  const j = await r.json();
  if (j.ok) loadFiles(); else showFileErr(j.error || 'Gagal');
}
async function zipEntry(name) {
  const r = await api('/api/files/zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: entryPath(name) }),
  });
  const j = await r.json();
  if (j.ok) loadFiles(); else showFileErr(j.error || 'Gagal');
}
async function unzipEntry(name) {
  const r = await api('/api/files/unzip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: entryPath(name) }),
  });
  const j = await r.json();
  if (j.ok) loadFiles(); else showFileErr(j.error || 'Gagal');
}
// upload (JSON base64)
document.getElementById('btn-upload').addEventListener('click', () => {
  document.getElementById('file-input').click();
});
document.getElementById('file-input').addEventListener('change', (ev) => {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (!f) return;
  const rd = new FileReader();
  rd.onload = async () => {
    const b64 = String(rd.result).split(',')[1] || '';
    try {
      const r = await api('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: curDir, name: f.name, data: b64 }),
      });
      const j = await r.json();
      if (j.ok) loadFiles(); else showFileErr(j.error || 'Upload gagal');
    } catch (e) {
      showFileErr(e.message || 'Upload gagal');
    }
  };
  rd.onerror = () => showFileErr('Gagal membaca file');
  rd.readAsDataURL(f);
});

// ---------- editor file ----------
const edModal = document.getElementById('editor-modal');
const edText = document.getElementById('editor-text');
let edName = null;
async function openEditor(name) {
  edName = name;
  document.getElementById('editor-title').textContent = 'Edit: ' + name;
  edText.value = 'memuat…';
  edModal.classList.remove('hidden');
  try {
    const r = await api('/api/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: curDir, name }),
    });
    const j = await r.json();
    edText.value = j.ok ? j.content : ('Error: ' + (j.error || 'gagal'));
  } catch (e) {
    edText.value = 'Error: ' + (e.message || 'gagal');
  }
}
document.getElementById('editor-close').addEventListener('click', () => edModal.classList.add('hidden'));
document.getElementById('editor-save').addEventListener('click', async () => {
  const r = await api('/api/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: curDir, name: edName, content: edText.value }),
  });
  const j = await r.json();
  if (j.ok) { edModal.classList.add('hidden'); loadFiles(); }
  else showFileErr(j.error || 'Gagal menyimpan');
});
// ---------- preview gambar ----------
const pvModal = document.getElementById('preview-modal');
function previewImage(name) {
  document.getElementById('preview-title').textContent = name;
  document.getElementById('preview-img').src =
    '/api/files/preview?path=' + encodeURIComponent(entryPath(name));
  pvModal.classList.remove('hidden');
}
document.getElementById('preview-close').addEventListener('click', () => pvModal.classList.add('hidden'));

// ---------- terminal (xterm.js) ----------
let termWs = null, term = null, fitAddon = null, termOpened = false;

function termTabOpen() {
  if (!term) initTerm();
  if (termOpened) return;
  termOpened = true;
  term.open(document.getElementById('term-box'));
  fitAddon.fit();
  connectTerm();
  new ResizeObserver(() => { if (term && termOpened) { try { fitAddon.fit(); } catch {} } }).observe(document.getElementById('term-box'));
}
function initTerm() {
  term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Menlo, Consolas, monospace',
    theme: { background: '#0a0e14', foreground: '#e8eef6', cursor: '#818cf8', selectionBackground: '#6366f1' },
  });
  if (window.FitAddon && window.FitAddon.FitAddon) {
    fitAddon = new window.FitAddon.FitAddon();
    term.loadAddon(fitAddon);
  }
  term.attachCustomKeyEventHandler((e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'c' && term.getSelection()) {
      navigator.clipboard.writeText(term.getSelection()).catch(() => {});
      return false;
    }
    return true;
  });
  term.onData((d) => {
    if (termWs && termWs.readyState === 1) termWs.send(JSON.stringify({ t: 'in', d }));
  });
}
function connectTerm() {
  const st = document.getElementById('term-status');
  st.textContent = 'menghubungkan…';
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  termWs = new WebSocket(proto + '//' + location.host + '/term');
  termWs.onopen = () => {
    st.innerHTML = badgeOk('Terhubung');
    if (fitAddon) termWs.send(JSON.stringify({ t: 'rs', c: term.cols, r: term.rows }));
    refreshIcons();
  };
  termWs.onclose = () => { st.innerHTML = badgeOff('Terputus'); refreshIcons(); };
  termWs.onmessage = (ev) => {
    try {
      const m = JSON.parse(ev.data);
      if (m && m.t === 'out' && m.d) { term.write(m.d); return; }
    } catch { /* bukan JSON, tulis mentah */ }
    term.write(ev.data);
  };
}
document.getElementById('btn-term-conn').addEventListener('click', () => {
  if (termWs) { try { termWs.close(); } catch {} }
  termTabOpen();
  connectTerm();
});
document.getElementById('btn-term-clear').addEventListener('click', () => {
  if (term) term.clear();
});
document.getElementById('btn-term-paste').addEventListener('click', async () => {
  try {
    const txt = await navigator.clipboard.readText();
    if (txt && termWs && termWs.readyState === 1) termWs.send(JSON.stringify({ t: 'in', d: txt }));
  } catch (e) {
    alert('Clipboard tidak bisa diakses browser. Gunakan Ctrl+Shift+V / klik kanan.');
  }
});

// ---------- dashboard ----------
let statsTimer = null;
function startStats() {
  stopStats();
  loadStats();
  statsTimer = setInterval(loadStats, 5000);
}
function stopStats() {
  if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
}
async function loadStats() {
  try {
    const j = await (await api('/api/stats')).json();
    const m = j.mem || {}, c = j.cpu || {}, d = j.disk;
    const bar = (p) => '<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-border"><div class="h-full rounded-full bg-accent transition-all" style="width:' + Math.min(100, p || 0) + '%"></div></div>';
    const card = (icn, label, val, sub, pb) =>
      '<div class="card !p-4"><div class="flex items-center gap-2 text-[13px] text-muted">' + ic(icn, 'h-4 w-4 text-accent-h') + esc(label) + '</div>' +
      '<div class="mt-1.5 text-xl font-bold tracking-tight">' + val + '</div>' +
      (sub ? '<div class="mt-0.5 text-xs text-muted">' + sub + '</div>' : '') + (pb || '') + '</div>';
    document.getElementById('stats-grid').innerHTML =
      card('cpu', 'CPU', (c.load1 != null ? c.load1.toFixed(2) : '—'), (c.cores || '—') + ' core', '') +
      card('memory-stick', 'RAM', (m.percent != null ? m.percent + '%' : '—'), fmtSize(m.used || 0) + ' / ' + fmtSize(m.total || 0), bar(m.percent)) +
      card('hard-drive', 'Disk', d ? d.percent + '%' : '—', d ? fmtSize(d.used) + ' / ' + fmtSize(d.total) : '', d ? bar(d.percent) : '') +
      card('battery-medium', 'Baterai', j.battery ? j.battery.percentage + '%' : '—', j.battery ? esc(j.battery.status || '') : '', '') +
      card('timer', 'Uptime', fmtUptime(j.uptime), fmtDate(j.time), '');
    refreshIcons();
  } catch (e) { /* abaikan */ }
}
async function loadDashSites() {
  try {
    const j = await (await api('/api/sites')).json();
    const el = document.getElementById('dash-sites');
    el.innerHTML = '';
    if (!j.sites || !j.sites.length) {
      el.innerHTML = '<tr><td colspan="4" class="muted">Belum ada website</td></tr>';
    } else {
      for (const s of j.sites) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td>' + esc(s.name) + '</td><td class="muted">' + esc(s.type) + '</td><td class="muted">' + s.port + '</td><td>' + (s.running ? badgeOk('Jalan') : badgeOff('Mati')) + '</td>';
        el.appendChild(tr);
      }
    }
    refreshIcons();
  } catch { /* abaikan */ }
}

// ---------- website ----------
let siteType = 'node';
document.querySelectorAll('[data-stype]').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('[data-stype]').forEach((x) => x.classList.toggle('active', x === b));
    siteType = b.dataset.stype;
    document.querySelector('#site-add span').textContent = 'Tambah (' + b.textContent.trim() + ')';
    loadSites();
  });
});
const siteModal = document.getElementById('site-modal');
document.getElementById('site-add').addEventListener('click', () => {
  document.getElementById('site-modal-title').textContent = 'Tambah Website (' + siteType + ')';
  document.getElementById('site-name').value = '';
  document.getElementById('site-path').value = '';
  document.getElementById('site-port').value = '';
  document.getElementById('site-err').textContent = '';
  siteModal.classList.remove('hidden');
});
document.getElementById('site-close').addEventListener('click', () => siteModal.classList.add('hidden'));
document.getElementById('site-save').addEventListener('click', async () => {
  const err = document.getElementById('site-err');
  err.textContent = '';
  const body = {
    name: document.getElementById('site-name').value.trim(),
    path: document.getElementById('site-path').value.trim(),
    port: parseInt(document.getElementById('site-port').value, 10),
    type: siteType,
  };
  if (!body.name || !body.path || !body.port) { err.textContent = 'Isi semua field'; return; }
  const r = await api('/api/sites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (j.ok) { siteModal.classList.add('hidden'); loadSites(); loadDashSites(); }
  else err.textContent = j.error || 'Gagal';
});
async function loadSites() {
  try {
    const j = await (await api('/api/sites')).json();
    const el = document.getElementById('site-list');
    el.innerHTML = '';
    const list = (j.sites || []).filter((s) => s.type === siteType);
    for (const s of list) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + esc(s.name) + '</td>' +
        '<td class="muted font-mono text-[12.5px]">' + esc(s.path) + '</td>' +
        '<td class="muted">' + s.port + '</td>' +
        '<td>' + (s.running ? badgeOk('Jalan') : badgeOff('Mati')) + '</td>' +
        '<td><div class="row-actions"></div></td>';
      const acts = tr.querySelector('.row-actions');
      const mk = (icn, fn, title, danger) => {
        const b = document.createElement('button');
        b.className = 'mini'; b.innerHTML = ic(icn, 'h-[15px] w-[15px]'); b.title = title;
        b.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); });
        if (danger) b.classList.add('text-err', 'border-err/30');
        acts.appendChild(b);
      };
      if (s.running) { mk('square', () => siteAct('stop', s.id), 'Stop'); mk('rotate-cw', () => siteAct('restart', s.id), 'Restart'); }
      else mk('play', () => siteAct('start', s.id), 'Start');
      mk('scroll-text', () => showLogs(s), 'Log');
      mk('trash-2', () => delSite(s), 'Hapus', true);
      el.appendChild(tr);
    }
    if (!list.length) {
      el.innerHTML = '<tr><td colspan="5" class="muted">Belum ada website ' + esc(siteType) + '</td></tr>';
    }
    refreshIcons();
  } catch { /* abaikan */ }
}
async function siteAct(act, id) {
  await api('/api/sites/' + id + '/' + act, { method: 'POST' }).catch(() => {});
  loadSites(); loadDashSites();
}
async function delSite(s) {
  if (!confirm('Hapus website "' + s.name + '"?')) return;
  await api('/api/sites/' + s.id + '/delete', { method: 'POST' }).catch(() => {});
  loadSites(); loadDashSites();
}
// modal log website
const logsModal = document.getElementById('logs-modal');
document.getElementById('logs-close').addEventListener('click', () => logsModal.classList.add('hidden'));
async function showLogs(s) {
  document.getElementById('logs-title').textContent = 'Log: ' + s.name;
  document.getElementById('logs-body').textContent = 'memuat…';
  logsModal.classList.remove('hidden');
  try {
    const j = await (await api('/api/sites/' + s.id + '/logs')).json();
    document.getElementById('logs-body').textContent = (j.logs ? j.logs : 'Log kosong') + '\n';
  } catch (e) {
    document.getElementById('logs-body').textContent = 'Gagal memuat log';
  }
}

// ---------- nginx reverse proxy ----------
async function loadNginx() {
  try {
    const j = await (await api('/api/nginx/status')).json();
    document.getElementById('nginx-status').innerHTML = j.running ? badgeOk('Nginx jalan') : badgeOff('Nginx mati');
  } catch { /* abaikan */ }
  try {
    const j = await (await api('/api/nginx/proxies')).json();
    const el = document.getElementById('px-list');
    el.innerHTML = '';
    for (const p of j.proxies || []) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + esc(p.name) + '</td><td class="muted">' + p.listenPort + '</td><td class="muted">' + esc(p.domain || '—') + '</td><td class="muted">' + p.targetPort + '</td>' +
        '<td><div class="row-actions"><button class="mini text-err border-err/30">' + ic('trash-2', 'h-[15px] w-[15px]') + '</button></div></td>';
      tr.querySelector('button').addEventListener('click', async () => {
        if (!confirm('Hapus proxy "' + p.name + '"?')) return;
        await api('/api/nginx/proxies/' + p.id, { method: 'DELETE' }).catch(() => {});
        loadNginx();
      });
      el.appendChild(tr);
    }
    if (!(j.proxies || []).length) el.innerHTML = '<tr><td colspan="5" class="muted">Belum ada proxy</td></tr>';
    refreshIcons();
  } catch { /* abaikan */ }
}
async function nginxService(action) {
  await api('/api/nginx/service', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  }).catch(() => {});
  loadNginx();
}
document.getElementById('nginx-start').addEventListener('click', () => nginxService('start'));
document.getElementById('nginx-stop').addEventListener('click', () => nginxService('stop'));
document.getElementById('nginx-reload').addEventListener('click', () => nginxService('reload'));
document.getElementById('px-add').addEventListener('click', async () => {
  const err = document.getElementById('px-err');
  err.textContent = '';
  const r = await api('/api/nginx/proxies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: document.getElementById('px-name').value.trim(),
      listenPort: parseInt(document.getElementById('px-port').value, 10),
      domain: document.getElementById('px-domain').value.trim(),
      targetPort: parseInt(document.getElementById('px-target').value, 10),
    }),
  });
  const j = await r.json();
  if (j.ok) loadNginx(); else err.textContent = j.error || 'Gagal';
});

// ---------- store (install) ----------
async function loadInstall() {
  try {
    const j = await (await api('/api/install')).json();
    renderInstall(j.items || []);
  } catch (e) {
    document.getElementById('install-grid').innerHTML = '<p class="err">Gagal memuat</p>';
  }
}
function renderInstall(items) {
  const el = document.getElementById('install-grid');
  el.innerHTML = '';
  for (const it of items) {
    const d = document.createElement('div');
    d.className = 'card';
    const badge = it.installing ? badgeWarn('Berjalan…') : (it.installed ? badgeOk('Terinstall') : badgeOff('Belum install'));
    const desc = it.desc ? '<p class="mt-1 text-[13px] text-muted">' + esc(it.desc) + '</p>' : '';
    const btn = it.installed
      ? '<button class="btn-ghost btn-sm" data-r="1">' + ic('rotate-cw', 'h-4 w-4') + 'Install ulang</button>'
      : '<button class="btn btn-sm" data-i="1">' + ic('download', 'h-4 w-4') + 'Install</button>';
    d.innerHTML =
      '<div class="flex items-start justify-between gap-3">' +
      '<div class="min-w-0"><div class="flex items-center gap-2 text-[15px] font-semibold">' + ic('package', 'h-[18px] w-[18px] text-accent-h') + '<span>' + esc(it.name || it.id) + '</span></div>' + desc + '</div>' + badge + '</div>' +
      '<div class="mt-3 flex gap-2">' + btn + '</div>';
    const b = d.querySelector('button');
    b.addEventListener('click', () => startInstall(it.id, it.name || it.id));
    el.appendChild(d);
  }
  refreshIcons();
}
const instModal = document.getElementById('install-modal');
document.getElementById('install-close').addEventListener('click', () => {
  instModal.classList.add('hidden');
  stopInstallPoll();
});
let instTimer = null;
function stopInstallPoll() {
  if (instTimer) { clearInterval(instTimer); instTimer = null; }
}
async function startInstall(id, label) {
  stopInstallPoll();
  try {
    const r = await api('/api/install/' + id + '/start', { method: 'POST' });
    const j = await r.json();
    if (!j.ok) { alert(j.error || 'Gagal memulai install'); return; }
  } catch (e) { alert(e.message || 'Gagal'); return; }
  document.getElementById('install-title').textContent = 'Install: ' + label;
  document.getElementById('install-body').textContent = 'memulai…\n';
  instModal.classList.remove('hidden');
  const poll = async () => {
    try {
      const j = await (await api('/api/install/' + id + '/log')).json();
      const el = document.getElementById('install-body');
      el.textContent = j.logs || '';
      el.scrollTop = el.scrollHeight;
      if (!j.running) {
        stopInstallPoll();
        el.textContent += '\n--- selesai (exit ' + j.exitCode + ') ---\n';
        loadInstall();
      }
    } catch { /* coba lagi */ }
  };
  await poll();
  instTimer = setInterval(poll, 1000);
}

// ---------- database ----------
let dbType = 'mysql';
let dbConnected = false;
document.querySelectorAll('[data-dtype]').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('[data-dtype]').forEach((x) => x.classList.toggle('active', x === b));
    dbType = b.dataset.dtype;
    loadDbConfig();
  });
});
async function loadDbConfig() {
  try {
    const j = await (await api('/api/db/' + dbType + '/config')).json();
    const c = j.config || {};
    document.getElementById('db-host').value = c.host || '127.0.0.1';
    document.getElementById('db-port').value = c.port || (dbType === 'mysql' ? 3306 : 5432);
    document.getElementById('db-user').value = c.user || 'root';
    document.getElementById('db-pass').value = c.password || '';
    document.getElementById('db-name').value = c.database || '';
    dbConnected = !!j.connected;
    updateDbStatus();
    if (dbConnected) loadDbList();
  } catch { /* abaikan */ }
}
function updateDbStatus() {
  const st = document.getElementById('db-status');
  st.innerHTML = dbConnected ? badgeOk('Terkoneksi (' + dbType + ')') : badgeOff('Belum konek');
  document.getElementById('db-browser').classList.toggle('hidden', !dbConnected);
  refreshIcons();
}
function dbForm() {
  return {
    host: document.getElementById('db-host').value,
    port: parseInt(document.getElementById('db-port').value, 10),
    user: document.getElementById('db-user').value,
    password: document.getElementById('db-pass').value,
    database: document.getElementById('db-name').value,
  };
}
document.getElementById('db-test').addEventListener('click', async () => {
  const err = document.getElementById('db-err');
  err.textContent = '';
  const r = await api('/api/db/' + dbType + '/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dbForm()),
  });
  const j = await r.json();
  err.textContent = j.ok ? 'Koneksi OK' : ('Gagal: ' + (j.error || ''));
});
document.getElementById('db-connect').addEventListener('click', async () => {
  const err = document.getElementById('db-err');
  err.textContent = '';
  const r = await api('/api/db/' + dbType + '/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dbForm()),
  });
  const j = await r.json();
  if (j.ok) {
    dbConnected = true;
    updateDbStatus();
    loadDbList();
  } else {
    err.textContent = j.error || 'Gagal konek';
  }
});
document.getElementById('db-disconnect').addEventListener('click', async () => {
  await api('/api/db/' + dbType + '/disconnect', { method: 'POST' });
  dbConnected = false;
  updateDbStatus();
});
async function loadDbList() {
  try {
    const j = await (await api('/api/db/' + dbType + '/databases')).json();
    const el = document.getElementById('db-list');
    el.innerHTML = '';
    for (const d of j.databases || []) {
      const b = document.createElement('button');
      b.className = 'list-item';
      b.textContent = d;
      b.addEventListener('click', () => loadDbTables(d));
      el.appendChild(b);
    }
  } catch { /* abaikan */ }
}
async function loadDbTables(db) {
  try {
    const j = await (await api('/api/db/' + dbType + '/tables?db=' + encodeURIComponent(db))).json();
    const el = document.getElementById('db-tables');
    el.innerHTML = '';
    el.dataset.db = db;
    for (const t of j.tables || []) {
      const b = document.createElement('button');
      b.className = 'list-item';
      b.textContent = t;
      b.addEventListener('click', () => browseTable(db, t));
      el.appendChild(b);
    }
  } catch { /* abaikan */ }
}
async function browseTable(db, table) {
  const box = document.getElementById('db-result');
  box.innerHTML = '<p class="muted text-sm">memuat…</p>';
  try {
    const j = await (await api('/api/db/' + dbType + '/rows?db=' + encodeURIComponent(db) + '&table=' + encodeURIComponent(table))).json();
    box.innerHTML = renderTable(j.fields || [], j.rows || []);
  } catch (e) {
    box.innerHTML = '<p class="err">' + esc(e.message || 'Gagal') + '</p>';
  }
}
function renderTable(fields, rows) {
  if (!rows.length) return '<p class="muted text-sm">0 baris.</p>';
  let html = '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
    fields.map((c) => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>';
  for (const row of rows) {
    html += '<tr>' + fields.map((c) => '<td class="muted">' + esc(row[c] == null ? 'NULL' : String(row[c])) + '</td>').join('') + '</tr>';
  }
  return html + '</tbody></table></div>';
}
document.getElementById('db-run').addEventListener('click', runQuery);
async function runQuery() {
  const sql = document.getElementById('db-sql').value;
  const box = document.getElementById('db-result');
  box.innerHTML = '<p class="muted text-sm">menjalankan…</p>';
  try {
    const r = await api('/api/db/' + dbType + '/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
    });
    const j = await r.json();
    if (j.error && !j.rows) { box.innerHTML = '<p class="err">' + esc(j.error) + '</p>'; return; }
    box.innerHTML = renderTable(j.fields || [], j.rows || []) +
      (j.affected != null ? '<p class="hint">' + j.affected + ' baris terpengaruh</p>' : '');
  } catch (e) {
    box.innerHTML = '<p class="err">' + esc(e.message || 'Gagal') + '</p>';
  }
}
// ---------- cron ----------
document.getElementById('cj-preset').addEventListener('change', (e) => {
  const inp = document.getElementById('cj-sched');
  if (e.target.value === 'custom') { inp.disabled = false; inp.value = ''; inp.focus(); }
  else { inp.disabled = true; inp.value = e.target.value; }
});
async function loadCron() {
  try {
    const j = await (await api('/api/cron/status')).json();
    document.getElementById('cron-status').innerHTML = j.running ? badgeOk('crond jalan') : badgeOff('crond mati');
    refreshIcons();
  } catch { /* abaikan */ }
  try {
    const j = await (await api('/api/cron/jobs')).json();
    const el = document.getElementById('cj-list');
    el.innerHTML = '';
    for (const c of j.jobs || []) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + esc(c.name) + '</td><td class="muted font-mono text-[12.5px]">' + esc(c.schedule) + '</td><td class="muted font-mono text-[12.5px]">' + esc(c.command) + '</td>' +
        '<td>' + (c.enabled ? badgeOk('Aktif') : badgeOff('Mati')) + '</td>' +
        '<td><div class="row-actions"></div></td>';
      const acts = tr.querySelector('.row-actions');
      const mk = (icn, fn, title) => {
        const b = document.createElement('button');
        b.className = 'mini'; b.innerHTML = ic(icn, 'h-[15px] w-[15px]'); b.title = title;
        b.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); });
        acts.appendChild(b);
      };
      mk(c.enabled ? 'pause' : 'play', async () => {
        await api('/api/cron/jobs/' + c.id + '/toggle', { method: 'POST' }).catch(() => {});
        loadCron();
      }, c.enabled ? 'Nonaktifkan' : 'Aktifkan');
      mk('trash-2', async () => {
        if (!confirm('Hapus job "' + c.name + '"?')) return;
        await api('/api/cron/jobs/' + c.id, { method: 'DELETE' }).catch(() => {});
        loadCron();
      }, 'Hapus');
      el.appendChild(tr);
    }
    if (!(j.jobs || []).length) el.innerHTML = '<tr><td colspan="5" class="muted">Belum ada job</td></tr>';
    refreshIcons();
  } catch { /* abaikan */ }
}
async function cronService(action) {
  await api('/api/cron/service', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  }).catch(() => {});
  loadCron();
}
document.getElementById('cron-start').addEventListener('click', () => cronService('start'));
document.getElementById('cron-stop').addEventListener('click', () => cronService('stop'));
document.getElementById('cj-add').addEventListener('click', async () => {
  const err = document.getElementById('cj-err');
  err.textContent = '';
  const preset = document.getElementById('cj-preset').value;
  const sched = preset === 'custom' ? document.getElementById('cj-sched').value.trim() : preset;
  const r = await api('/api/cron/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: document.getElementById('cj-name').value.trim(),
      schedule: sched,
      command: document.getElementById('cj-cmd').value.trim(),
    }),
  });
  const j = await r.json();
  if (j.ok) { document.getElementById('cj-name').value = ''; document.getElementById('cj-cmd').value = ''; loadCron(); }
  else err.textContent = j.error || 'Gagal';
});

// ---------- backup ----------
async function loadBackups() {
  try {
    const j = await (await api('/api/backups')).json();
    const el = document.getElementById('bk-list');
    el.innerHTML = '';
    for (const b of j.backups || []) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + esc(b.name) + '</td><td class="muted">' + esc(b.type) + '</td><td class="muted font-mono text-[12.5px]">' + esc(b.source || '—') + '</td><td class="muted">' + fmtSize(b.size || 0) + '</td>' +
        '<td><div class="row-actions"></div></td>';
      const acts = tr.querySelector('.row-actions');
      const mk = (icn, fn, title, danger) => {
        const bEl = document.createElement('button');
        bEl.className = 'mini'; bEl.innerHTML = ic(icn, 'h-[15px] w-[15px]'); bEl.title = title;
        bEl.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); });
        if (danger) bEl.classList.add('text-err', 'border-err/30');
        acts.appendChild(bEl);
      };
      mk('download', () => {
        location.href = '/api/backups/' + encodeURIComponent(b.name) + '/download';
      }, 'Download');
      mk('rotate-ccw', async () => {
        if (!confirm('Restore backup "' + b.name + '"? File saat ini bisa tertimpa.')) return;
        await api('/api/backups/' + encodeURIComponent(b.name) + '/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }).catch(() => {});
        loadBackups();
      }, 'Restore');
      mk('trash-2', async () => {
        if (!confirm('Hapus backup "' + b.name + '"?')) return;
        await api('/api/backups/' + encodeURIComponent(b.name), { method: 'DELETE' }).catch(() => {});
        loadBackups();
      }, 'Hapus', true);
      el.appendChild(tr);
    }
    if (!(j.backups || []).length) el.innerHTML = '<tr><td colspan="5" class="muted">Belum ada backup</td></tr>';
    refreshIcons();
  } catch { /* abaikan */ }
}
document.getElementById('bk-create').addEventListener('click', async () => {
  const err = document.getElementById('bk-err');
  err.textContent = '';
  const r = await api('/api/backups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: document.getElementById('bk-name').value.trim(),
      type: document.getElementById('bk-type').value,
      source: document.getElementById('bk-source').value.trim(),
    }),
  });
  const j = await r.json();
  if (j.ok) { document.getElementById('bk-name').value = ''; document.getElementById('bk-source').value = ''; loadBackups(); }
  else err.textContent = j.error || 'Gagal';
});

// ---------- settings ----------
async function loadSettings() {
  try {
    const j = await (await api('/api/settings')).json();
    document.getElementById('set-uname').textContent = j.username || '';
    document.getElementById('set-ver').textContent = j.version || '';
    const tg = j.telegram || {};
    document.getElementById('set-tg-token').value = tg.botToken || '';
    document.getElementById('set-tg-chat').value = tg.chatId || '';
    document.getElementById('set-tg-on').checked = !!tg.enabled;
    document.getElementById('set-tg-cmd').checked = tg.commandsEnabled !== false;
  } catch { /* abaikan */ }
}
document.getElementById('set-user-save').addEventListener('click', async () => {
  const err = document.getElementById('set-user-err');
  err.textContent = '';
  const r = await api('/api/auth/change-username', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: document.getElementById('set-newuser').value.trim() }),
  });
  const j = await r.json();
  if (j.ok) loadSettings(); else err.textContent = j.error || 'Gagal';
});
document.getElementById('set-pw-save').addEventListener('click', async () => {
  const err = document.getElementById('set-pw-err');
  err.textContent = '';
  const nw = document.getElementById('set-pw-new').value;
  if (nw !== document.getElementById('set-pw-conf').value) { err.textContent = 'Konfirmasi password tidak cocok'; return; }
  const r = await api('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      currentPassword: document.getElementById('set-pw-old').value,
      newPassword: nw,
      confirmPassword: document.getElementById('set-pw-conf').value,
    }),
  });
  const j = await r.json();
  if (j.ok) {
    document.getElementById('set-pw-old').value = '';
    document.getElementById('set-pw-new').value = '';
    document.getElementById('set-pw-conf').value = '';
    err.textContent = 'Password diganti — silakan login ulang';
    setTimeout(() => { location.href = '/login.html'; }, 1200);
  } else err.textContent = j.error || 'Gagal';
});
document.getElementById('set-tg-save').addEventListener('click', async () => {
  const err = document.getElementById('set-tg-err');
  err.textContent = '';
  const r = await api('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      telegram: {
        botToken: document.getElementById('set-tg-token').value.trim(),
        chatId: document.getElementById('set-tg-chat').value.trim(),
        enabled: document.getElementById('set-tg-on').checked,
        commandsEnabled: document.getElementById('set-tg-cmd').checked,
      },
    }),
  });
  const j = await r.json();
  if (!j.ok) err.textContent = j.error || 'Gagal';
});
document.getElementById('set-tg-test').addEventListener('click', async () => {
  const err = document.getElementById('set-tg-err');
  err.textContent = 'mengirim…';
  const r = await api('/api/settings/test-telegram', { method: 'POST' });
  const j = await r.json();
  err.textContent = j.ok ? 'Pesan test terkirim' : (j.error || 'Gagal');
});
document.getElementById('set-logout-all').addEventListener('click', async () => {
  if (!confirm('Logout semua sesi?')) return;
  await api('/api/auth/logout-all', { method: 'POST' }).catch(() => {});
  location.href = '/login.html';
});

// ---------- init ----------
document.querySelectorAll('.btn-theme').forEach((b) => {
  b.addEventListener('click', () => applyTheme(getTheme() === 'light' ? 'dark' : 'light'));
});
updateThemeUI(getTheme());
document.getElementById('cj-preset').dispatchEvent(new Event('change'));
loadFiles();
loadSites();
loadDashSites();
startStats();
refreshIcons();
