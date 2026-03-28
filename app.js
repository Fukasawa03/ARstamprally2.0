/**
 * WebAR Stamp Rally - app.js
 * モジュール設計: DB → Config → State → UI → AR → Admin
 */

'use strict';

// ============================================================
// 1. DATABASE MODULE (IndexedDB + LocalStorage fallback)
// ============================================================
const DB = (() => {
  const DB_NAME = 'StampRallyDB';
  const DB_VER  = 1;
  let _db = null;

  async function open() {
    if (_db) return _db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('kv')) {
          db.createObjectStore('kv');
        }
      };
      req.onsuccess = e => { _db = e.target.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  async function get(key) {
    try {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readonly');
        const req = tx.objectStore('kv').get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror   = () => reject(req.error);
      });
    } catch {
      // Fallback to localStorage
      const val = localStorage.getItem(key);
      return val ? JSON.parse(val) : null;
    }
  }

  async function set(key, value) {
    try {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
      });
    } catch {
      localStorage.setItem(key, JSON.stringify(value));
    }
  }

  async function del(key) {
    try {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
      });
    } catch {
      localStorage.removeItem(key);
    }
  }

  return { get, set, del };
})();

// ============================================================
// 2. DEFAULT CONFIG (全文言・スタンプ設定)
// ============================================================
const DEFAULT_CONFIG = {
  versionId: '2026_Ver1',
  sheetsUrl: '',
  leaderboardUrl: '',

  // イベント情報
  eventYear:     '2026',
  eventTitle:    '文化祭\nスタンプラリー',
  eventSubtitle: '全スタンプを集めて特典をゲットしよう！',

  // UI文言
  ui: {
    btnStart:       'スタート！',
    btnHowto:       '遊び方',
    howtoTitle:     '遊び方',
    mapTitle:       'スタンプマップ',
    progressLabel:  '進捗',
    btnScan:        'ARスキャン開始',
    arTitle:        'マーカーを照らして！',
    arHint:         'マーカーを枠内に合わせてください',
    stampAcquiredLabel: 'スタンプ獲得！',
    btnToMap:       'マップに戻る',
    btnShare:       'シェア',
    completeTitle:  'コンプリート！',
    completeSubtitle: '全スタンプ制覇おめでとう！',
    completeTimeLabel: 'クリアタイム',
    manualTitle:    '合言葉入力',
    manualDesc:     'スタンプ地点に掲示された数字を入力してください',
    manualError:    '合言葉が違います',
    manualSubmit:   '確認',
  },

  // クーポン
  coupon: {
    title: '🎁 特典クーポン',
    body:  '文化祭グッズ引換券！本部で見せてください',
    code:  'FES-2026-COMP',
  },

  // 遊び方ステップ
  howtoSteps: [
    { title: 'アプリを開く',        desc: 'このページをホーム画面に追加しておくと便利です。' },
    { title: 'スタンプ場所へ行く',   desc: 'マップから行きたい場所を確認して出発しましょう！' },
    { title: 'マーカーをスキャン',   desc: '「ARスキャン開始」を押してカメラを起動し、マーカーに向けてください。' },
    { title: 'スタンプをゲット',     desc: 'スキャン成功！スタンプが記録されます。全部集めよう！' },
    { title: 'コンプリートで特典',   desc: '全スタンプを集めると特典クーポンが表示されます！' },
  ],

  // スタンプデータ
  stamps: [
    { id: 'stamp_01', name: '科学部の秘密実験',  location: '3階 理科室', message: 'サイエンスの世界へようこそ！', emoji: '🔬', code: '1234', barcodeId: 0,  modelUrl: '', mindFile: '' },
    { id: 'stamp_02', name: '美術部ギャラリー',   location: '2階 美術室', message: '芸術に触れてみよう！',         emoji: '🎨', code: '2345', barcodeId: 1,  modelUrl: '', mindFile: '' },
    { id: 'stamp_03', name: '音楽部ライブステージ', location: '体育館',   message: '音楽の力を感じてください！', emoji: '🎵', code: '3456', barcodeId: 2,  modelUrl: '', mindFile: '' },
    { id: 'stamp_04', name: '茶道部おもてなし',   location: '和室',      message: 'お茶をどうぞ！',             emoji: '🍵', code: '4567', barcodeId: 3,  modelUrl: '', mindFile: '' },
    { id: 'stamp_05', name: 'フードコート',        location: '中庭',      message: '美味しいものいっぱい！',       emoji: '🍔', code: '5678', barcodeId: 4,  modelUrl: '', mindFile: '' },
  ],

  // .mindファイル一覧（Base64）
  mindFiles: [], // [{name, data, linkedStampId}]
};

// ============================================================
// 3. CONFIG MODULE
// ============================================================
const Config = (() => {
  let _cfg = null;
  let _fetchPromise = null;

  async function load() {
    if (_cfg) return _cfg;

    // Step 1: Load from IndexedDB cache
    const cached = await DB.get('config');
    if (cached) {
      _cfg = deepMerge(DEFAULT_CONFIG, cached);
    } else {
      _cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }

    // Step 2: Version check → reset progress if mismatch
    const savedVer = await DB.get('versionId');
    if (savedVer && savedVer !== _cfg.versionId) {
      await DB.del('progress');
      await DB.del('timerStart');
      await DB.del('timerElapsed');
      console.log('[Config] Version changed, progress reset.');
    }
    await DB.set('versionId', _cfg.versionId);

    // Step 3: Fetch from Google Sheets (once, if URL set)
    if (_cfg.sheetsUrl && !cached) {
      try {
        await fetchFromSheets(_cfg.sheetsUrl);
      } catch(e) {
        console.warn('[Config] Sheets fetch failed, using cache:', e);
      }
    }

    return _cfg;
  }

  async function fetchFromSheets(url) {
    if (_fetchPromise) return _fetchPromise;
    _fetchPromise = fetch(url)
      .then(r => r.json())
      .then(async data => {
        if (data && typeof data === 'object') {
          _cfg = deepMerge(_cfg, data);
          await DB.set('config', _cfg);
          console.log('[Config] Loaded from Sheets');
        }
      })
      .finally(() => { _fetchPromise = null; });
    return _fetchPromise;
  }

  async function save() {
    await DB.set('config', _cfg);
  }

  function get() { return _cfg; }

  function deepMerge(target, source) {
    const out = { ...target };
    for (const k of Object.keys(source)) {
      if (source[k] && typeof source[k] === 'object' && !Array.isArray(source[k])) {
        out[k] = deepMerge(target[k] || {}, source[k]);
      } else {
        out[k] = source[k];
      }
    }
    return out;
  }

  return { load, get, save, fetchFromSheets };
})();

// ============================================================
// 4. STATE MODULE (progress + timer)
// ============================================================
const State = (() => {
  let acquired = new Set();
  let timerStart = null;
  let timerElapsed = 0;
  let timerInterval = null;

  async function load() {
    const p = await DB.get('progress');
    if (p) acquired = new Set(p);
    timerElapsed = (await DB.get('timerElapsed')) || 0;
    const ts = await DB.get('timerStart');
    if (ts) {
      timerStart = ts;
      // Resume timer
    }
  }

  async function acquireStamp(id) {
    if (acquired.has(id)) return false;
    acquired.add(id);
    await DB.set('progress', [...acquired]);
    return true;
  }

  function isAcquired(id) { return acquired.has(id); }
  function getAcquired() { return [...acquired]; }
  function getCount() { return acquired.size; }

  // Timer
  function startTimer() {
    if (timerStart) return; // already running
    timerStart = Date.now() - timerElapsed;
    DB.set('timerStart', timerStart);
    timerInterval = setInterval(() => {
      timerElapsed = Date.now() - timerStart;
      DB.set('timerElapsed', timerElapsed);
      UI.updateTimer(timerElapsed);
    }, 500);
  }

  function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  function getElapsed() {
    if (timerStart) return Date.now() - timerStart;
    return timerElapsed;
  }

  async function reset() {
    acquired = new Set();
    timerStart = null;
    timerElapsed = 0;
    stopTimer();
    await DB.del('progress');
    await DB.del('timerStart');
    await DB.del('timerElapsed');
  }

  return { load, acquireStamp, isAcquired, getAcquired, getCount, startTimer, stopTimer, getElapsed, reset };
})();

// ============================================================
// 5. UI MODULE
// ============================================================
const UI = (() => {
  // ---- Utility ----
  function $(id) { return document.getElementById(id); }
  function show(id) { const el = $(id); if (el) { el.classList.remove('hidden'); el.classList.add('active'); } }
  function hide(id) { const el = $(id); if (el) { el.classList.remove('active'); el.classList.add('hidden'); } }

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => {
      s.classList.remove('active');
      s.classList.add('hidden');
    });
    const el = $(id);
    if (el) { el.classList.remove('hidden'); el.classList.add('active'); }
  }

  function showModal(id) { const el = $(id); if(el) el.classList.remove('hidden'); }
  function hideModal(id) { const el = $(id); if(el) el.classList.add('hidden'); }

  function toast(msg, duration = 2500) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hidden'), duration);
  }

  function formatTime(ms) {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  function updateTimer(ms) {
    const el = $('timer-display');
    if (el) el.textContent = formatTime(ms);
  }

  // ---- Apply Config to DOM ----
  function applyConfig(cfg) {
    const set = (id, val) => { const el = $(id); if (el && val !== undefined) el.textContent = val; };
    set('ui-event-year',    cfg.eventYear);
    set('ui-event-title',   cfg.eventTitle);
    set('ui-event-subtitle',cfg.eventSubtitle);
    set('ui-btn-start',     cfg.ui.btnStart);
    set('ui-btn-howto',     cfg.ui.btnHowto);
    set('ui-howto-title',   cfg.ui.howtoTitle);
    set('ui-map-title',     cfg.ui.mapTitle);
    set('ui-progress-label',cfg.ui.progressLabel);
    set('ui-btn-scan',      cfg.ui.btnScan);
    set('ui-ar-title',      cfg.ui.arTitle);
    set('ui-ar-hint',       cfg.ui.arHint);
    set('ui-stamp-acquired-label', cfg.ui.stampAcquiredLabel);
    set('ui-btn-to-map',    cfg.ui.btnToMap);
    set('ui-btn-share',     cfg.ui.btnShare);
    set('ui-complete-title',cfg.ui.completeTitle);
    set('ui-complete-subtitle', cfg.ui.completeSubtitle);
    set('ui-complete-time-label', cfg.ui.completeTimeLabel);
    set('ui-manual-title',  cfg.ui.manualTitle);
    set('ui-manual-desc',   cfg.ui.manualDesc);
    set('ui-coupon-title',  cfg.coupon.title);
    set('ui-coupon-body',   cfg.coupon.body);
    set('ui-coupon-code',   cfg.coupon.code);
    document.title = cfg.eventTitle.replace('\n', '') + ' ' + cfg.eventYear;
  }

  // ---- Render Howto Steps ----
  function renderHowtoSteps(steps) {
    const container = $('howto-steps-container');
    if (!container) return;
    container.innerHTML = steps.map((s, i) => `
      <div class="howto-step">
        <div class="howto-step-num">${i + 1}</div>
        <div class="howto-step-content">
          <h3>${escHtml(s.title)}</h3>
          <p>${escHtml(s.desc)}</p>
        </div>
      </div>
    `).join('');
  }

  // ---- Render Stamp List (Map Screen) ----
  function renderStampList(stamps) {
    const list = $('stamp-list');
    if (!list) return;
    list.innerHTML = stamps.map(s => `
      <div class="stamp-item ${State.isAcquired(s.id) ? 'acquired' : ''}" data-id="${s.id}">
        <div class="stamp-item-emoji">${s.emoji || '⭐'}</div>
        <div class="stamp-item-info">
          <div class="stamp-item-name">${escHtml(s.name)}</div>
          <div class="stamp-item-location">📍 ${escHtml(s.location)}</div>
        </div>
        <div class="stamp-item-check">${State.isAcquired(s.id) ? '✓' : ''}</div>
      </div>
    `).join('');
  }

  // ---- Update Progress ----
  function updateProgress(stamps) {
    const total = stamps.length;
    const count = State.getCount();
    const pct   = total ? (count / total * 100) : 0;
    const bar   = $('progress-bar');
    const label = $('progress-count');
    if (bar) bar.style.width = pct + '%';
    if (label) label.textContent = `${count} / ${total}`;
    renderStampList(stamps);
  }

  // ---- Show Stamp Acquired ----
  function showStampAcquired(stamp) {
    $('sa-emoji').textContent    = stamp.emoji || '⭐';
    $('sa-name').textContent     = stamp.name;
    $('sa-location').textContent = stamp.location;
    $('sa-message').textContent  = stamp.message;
    showScreen('screen-stamp');
    // Sparkle effect
    const bg = document.querySelector('.stamp-acquired-bg');
    if (bg) {
      bg.innerHTML = '';
      for (let i = 0; i < 20; i++) {
        const d = document.createElement('div');
        d.className = 'sparkle';
        d.style.cssText = `
          left: ${Math.random()*100}%; top: ${60 + Math.random()*30}%;
          width: ${4 + Math.random()*8}px; height: ${4 + Math.random()*8}px;
          background: ${['#c840ff','#00f0ff','#ffce00','#00e87a'][Math.floor(Math.random()*4)]};
          animation-delay: ${Math.random()*0.5}s;
          animation-duration: ${1 + Math.random()}s;
        `;
        bg.appendChild(d);
      }
    }
  }

  // ---- Show Complete ----
  function showComplete(cfg, elapsedMs) {
    $('complete-time-value').textContent = formatTime(elapsedMs);
    showScreen('screen-complete');
    startConfetti();
    submitLeaderboard(cfg, elapsedMs);
  }

  // ---- Stars on title ----
  function renderStars() {
    const c = $('stars');
    if (!c) return;
    for (let i = 0; i < 60; i++) {
      const d = document.createElement('div');
      d.className = 'star-dot';
      const size = 1 + Math.random() * 2.5;
      d.style.cssText = `
        left: ${Math.random()*100}%; top: ${Math.random()*100}%;
        width: ${size}px; height: ${size}px; opacity: ${0.1 + Math.random()*0.6};
        --dur: ${2 + Math.random()*4}s; --delay: ${Math.random()*4}s;
      `;
      c.appendChild(d);
    }
  }

  function escHtml(str) {
    return String(str || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  return { $, show, hide, showScreen, showModal, hideModal, toast, formatTime, updateTimer, applyConfig, renderHowtoSteps, renderStampList, updateProgress, showStampAcquired, showComplete, renderStars, escHtml };
})();

// ============================================================
// 6. CONFETTI
// ============================================================
function startConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  canvas.width  = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
  const ctx = canvas.getContext('2d');
  const particles = [];
  const colors = ['#c840ff','#00f0ff','#ffce00','#00e87a','#ff4458','#fff'];
  for (let i = 0; i < 120; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * 200,
      r: 4 + Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      speed: 2 + Math.random() * 3,
      angle: Math.random() * 2 * Math.PI,
      spin: (Math.random() - 0.5) * 0.15,
      drift: (Math.random() - 0.5) * 1.5,
    });
  }
  let frame;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of particles) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.r/2, -p.r/2, p.r, p.r * 1.6);
      ctx.restore();
      p.y += p.speed;
      p.x += p.drift;
      p.angle += p.spin;
      if (p.y > canvas.height) {
        p.y = -20;
        p.x = Math.random() * canvas.width;
      }
    }
    frame = requestAnimationFrame(draw);
  }
  draw();
  // Stop after 8s
  setTimeout(() => { cancelAnimationFrame(frame); ctx.clearRect(0, 0, canvas.width, canvas.height); }, 8000);
}

// ============================================================
// 7. WEB SHARE API
// ============================================================
async function shareStamp(stamp, cfg) {
  const text = `📍 ${stamp.name} のスタンプをゲット！\n${stamp.message}\n\n${cfg.eventTitle} ${cfg.eventYear}`;
  if (navigator.share) {
    try { await navigator.share({ title: cfg.eventTitle, text }); } catch(e) { /* user cancelled */ }
  } else {
    try { await navigator.clipboard.writeText(text); UI.toast('クリップボードにコピーしました！'); } catch { UI.toast('シェアできませんでした'); }
  }
}

async function shareComplete(cfg, elapsed) {
  const text = `🏆 全スタンプをコンプリート！\nクリアタイム: ${UI.formatTime(elapsed)}\n\n${cfg.eventTitle} ${cfg.eventYear}`;
  if (navigator.share) {
    try { await navigator.share({ title: cfg.eventTitle, text }); } catch { /* cancelled */ }
  } else {
    try { await navigator.clipboard.writeText(text); UI.toast('クリップボードにコピーしました！'); } catch { UI.toast('シェアできませんでした'); }
  }
}

// ============================================================
// 8. LEADERBOARD (GAS submit)
// ============================================================
async function submitLeaderboard(cfg, elapsed) {
  if (!cfg.leaderboardUrl) return;
  const name = localStorage.getItem('playerName') || 'ゲスト';
  try {
    await fetch(cfg.leaderboardUrl, {
      method: 'POST',
      body: JSON.stringify({ name, time: elapsed, version: cfg.versionId }),
      headers: { 'Content-Type': 'application/json' },
    });
  } catch { /* ignore */ }
}

async function loadLeaderboard(cfg) {
  if (!cfg.leaderboardUrl) { UI.toast('ランキングURLが設定されていません'); return; }
  const el = document.getElementById('lb-list');
  if (!el) return;
  el.innerHTML = '<div class="lb-loading">読み込み中...</div>';
  UI.showModal('modal-leaderboard');
  try {
    const r = await fetch(cfg.leaderboardUrl + '?version=' + encodeURIComponent(cfg.versionId));
    const data = await r.json();
    const medals = ['gold','silver','bronze'];
    el.innerHTML = (data.entries || []).map((e, i) => `
      <div class="lb-item">
        <div class="lb-rank ${medals[i] || ''}">${i + 1}</div>
        <div class="lb-name">${UI.escHtml(e.name)}</div>
        <div class="lb-time">${UI.formatTime(e.time)}</div>
      </div>
    `).join('') || '<div class="lb-loading">まだ記録がありません</div>';
  } catch {
    el.innerHTML = '<div class="lb-loading">読み込みに失敗しました</div>';
  }
}

// ============================================================
// 9. AR MODULE
// ============================================================
const AR = (() => {
  let _stamps = [];
  let _detected = new Set();
  let _bannerTimer = null;
  let _onDetect = null;

  function init(stamps, onDetect) {
    _stamps = stamps;
    _onDetect = onDetect;
    buildMarkers();
  }

  function buildMarkers() {
    const container = document.getElementById('ar-markers-container');
    const assets    = document.getElementById('ar-assets');
    if (!container || !assets) return;
    container.innerHTML = '';
    assets.innerHTML = '';

    _stamps.forEach(stamp => {
      if (stamp.mindFile) {
        // .mind file marker
        const assetId = `mind-${stamp.id}`;
        const img = document.createElement('img');
        img.id  = assetId;
        img.src = stamp.mindFile; // Data URL
        assets.appendChild(img);
        const marker = document.createElement('a-nft');
        marker.setAttribute('type', 'nft');
        marker.setAttribute('url', stamp.mindFile);
        marker.setAttribute('smooth', 'true');
        marker.setAttribute('smoothCount', '10');
        marker.setAttribute('smoothTolerance', '0.01');
        if (stamp.modelUrl) {
          const model = document.createElement('a-gltf-model');
          model.setAttribute('src', stamp.modelUrl);
          model.setAttribute('scale', '0.1 0.1 0.1');
          marker.appendChild(model);
        } else {
          const text = document.createElement('a-text');
          text.setAttribute('value', stamp.emoji + '\n' + stamp.name);
          text.setAttribute('align', 'center');
          text.setAttribute('color', '#ffffff');
          marker.appendChild(text);
        }
        marker.addEventListener('markerFound', () => handleDetect(stamp));
        container.appendChild(marker);
      } else {
        // Barcode marker
        const marker = document.createElement('a-marker');
        marker.setAttribute('type', 'barcode');
        marker.setAttribute('value', String(stamp.barcodeId));
        marker.setAttribute('smooth', 'true');
        marker.setAttribute('smoothCount', '10');
        if (stamp.modelUrl) {
          const model = document.createElement('a-gltf-model');
          model.setAttribute('src', stamp.modelUrl);
          model.setAttribute('scale', '0.1 0.1 0.1');
          marker.appendChild(model);
        } else {
          const box = document.createElement('a-box');
          box.setAttribute('color', '#c840ff');
          box.setAttribute('scale', '0.5 0.5 0.5');
          const text = document.createElement('a-text');
          text.setAttribute('value', stamp.emoji);
          text.setAttribute('align', 'center');
          text.setAttribute('position', '0 0.6 0');
          text.setAttribute('color', '#ffffff');
          marker.appendChild(box);
          marker.appendChild(text);
        }
        marker.addEventListener('markerFound', () => handleDetect(stamp));
        container.appendChild(marker);
      }
    });
  }

  function handleDetect(stamp) {
    if (_detected.has(stamp.id)) return;
    _detected.add(stamp.id);
    showBanner(stamp);
    if (_onDetect) _onDetect(stamp);
    setTimeout(() => _detected.delete(stamp.id), 5000);
  }

  function showBanner(stamp) {
    const banner = document.getElementById('ar-banner');
    const emoji  = document.getElementById('ar-banner-emoji');
    const text   = document.getElementById('ar-banner-text');
    if (!banner) return;
    if (emoji) emoji.textContent = stamp.emoji;
    if (text)  text.textContent  = stamp.name + ' をスキャン！';
    banner.classList.remove('hidden');
    clearTimeout(_bannerTimer);
    _bannerTimer = setTimeout(() => banner.classList.add('hidden'), 3000);
  }

  function reset() {
    _detected.clear();
  }

  return { init, buildMarkers, reset };
})();

// ============================================================
// 10. ADMIN MODULE
// ============================================================
const Admin = (() => {
  let _cfg = null;
  let _editingStampId = null;
  let _dragSrcIdx = null;

  function init(cfg) {
    _cfg = cfg;
    renderAll();
    bindEvents();
  }

  function renderAll() {
    renderStampAdminList();
    renderMindFileList();
    renderTextEditors();
    renderHowtoEditor();
    document.getElementById('admin-current-version').textContent = 'v: ' + _cfg.versionId;
    document.getElementById('admin-version-id').value = _cfg.versionId;
    document.getElementById('admin-sheets-url').value = _cfg.sheetsUrl || '';
    document.getElementById('admin-leaderboard-url').value = _cfg.leaderboardUrl || '';
  }

  // ---- Stamp Admin List (drag-and-drop) ----
  function renderStampAdminList() {
    const list = document.getElementById('stamp-admin-list');
    if (!list) return;
    list.innerHTML = _cfg.stamps.map((s, i) => `
      <div class="stamp-admin-item" draggable="true" data-idx="${i}">
        <span class="stamp-admin-drag">⠿</span>
        <span class="stamp-admin-emoji">${s.emoji || '⭐'}</span>
        <div class="stamp-admin-info">
          <div class="stamp-admin-name">${UI.escHtml(s.name)}</div>
          <div class="stamp-admin-sub">${s.mindFile ? '.mindファイル使用' : 'バーコード #' + s.barcodeId} | 合言葉: ${s.code}</div>
        </div>
        <button class="stamp-admin-edit" data-id="${s.id}">編集</button>
      </div>
    `).join('');

    // Drag-and-drop
    list.querySelectorAll('.stamp-admin-item').forEach(item => {
      item.addEventListener('dragstart', e => {
        _dragSrcIdx = parseInt(item.dataset.idx);
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => item.classList.add('dragging'), 0);
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        list.querySelectorAll('.stamp-admin-item').forEach(i => i.classList.remove('drag-over'));
      });
      item.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        list.querySelectorAll('.stamp-admin-item').forEach(i => i.classList.remove('drag-over'));
        item.classList.add('drag-over');
      });
      item.addEventListener('drop', e => {
        e.preventDefault();
        const destIdx = parseInt(item.dataset.idx);
        if (_dragSrcIdx === null || _dragSrcIdx === destIdx) return;
        const arr = [..._cfg.stamps];
        const [moved] = arr.splice(_dragSrcIdx, 1);
        arr.splice(destIdx, 0, moved);
        _cfg.stamps = arr;
        renderStampAdminList();
        Config.save();
        UI.toast('並び順を更新しました');
      });
      item.querySelector('.stamp-admin-edit').addEventListener('click', () => {
        openStampEdit(item.querySelector('.stamp-admin-edit').dataset.id);
      });
    });
  }

  // ---- Mind File List ----
  function renderMindFileList() {
    const list = document.getElementById('mind-file-list');
    if (!list) return;
    list.innerHTML = (_cfg.mindFiles || []).map((f, i) => {
      const linked = _cfg.stamps.find(s => s.mindFile === f.name);
      return `
        <div class="mind-file-item">
          <span style="font-size:20px">📁</span>
          <div class="mind-file-name">${UI.escHtml(f.name)}</div>
          <div class="mind-file-linked">${linked ? '→ ' + linked.name : '未リンク'}</div>
          <button class="mind-file-delete" data-idx="${i}">🗑</button>
        </div>
      `;
    }).join('') || '<div style="font-size:13px;color:var(--text-muted)">登録なし</div>';

    list.querySelectorAll('.mind-file-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        const fileName = _cfg.mindFiles[idx].name;
        _cfg.mindFiles.splice(idx, 1);
        // Unlink stamps
        _cfg.stamps.forEach(s => { if (s.mindFile === fileName) s.mindFile = ''; });
        Config.save();
        renderMindFileList();
        renderStampAdminList();
        UI.toast('削除しました');
      });
    });
  }

  // ---- Text Editors ----
  function renderTextEditors() {
    renderEditorGroup('text-editors-event', [
      { key: 'eventYear',     label: '年度',          val: _cfg.eventYear },
      { key: 'eventTitle',    label: 'タイトル',       val: _cfg.eventTitle },
      { key: 'eventSubtitle', label: 'サブタイトル',   val: _cfg.eventSubtitle },
    ]);
    renderEditorGroup('text-editors-ui', Object.entries(_cfg.ui).map(([k,v]) => ({
      key: 'ui.' + k, label: k, val: v,
    })));
    renderEditorGroup('text-editors-coupon', [
      { key: 'coupon.title', label: 'クーポンタイトル', val: _cfg.coupon.title },
      { key: 'coupon.body',  label: 'クーポン本文',    val: _cfg.coupon.body },
      { key: 'coupon.code',  label: 'クーポンコード',  val: _cfg.coupon.code },
    ]);
  }

  function renderEditorGroup(containerId, items) {
    const c = document.getElementById(containerId);
    if (!c) return;
    c.innerHTML = items.map(item => `
      <div class="text-editor-item field-group">
        <label>${UI.escHtml(item.label)}</label>
        <input type="text" data-key="${UI.escHtml(item.key)}" value="${UI.escHtml(item.val)}" class="admin-input">
      </div>
    `).join('');
  }

  function collectTextEditors() {
    document.querySelectorAll('.text-editor-item input').forEach(input => {
      const keys = input.dataset.key.split('.');
      let obj = _cfg;
      for (let i = 0; i < keys.length - 1; i++) { obj = obj[keys[i]]; }
      obj[keys[keys.length - 1]] = input.value;
    });
  }

  // ---- Howto Editor ----
  function renderHowtoEditor() {
    const c = document.getElementById('howto-editor');
    if (!c) return;
    c.innerHTML = (_cfg.howtoSteps || []).map((s, i) => `
      <div class="howto-editor-item" data-idx="${i}">
        <div class="howto-editor-num">${i+1}</div>
        <div class="howto-editor-fields">
          <input type="text" placeholder="ステップタイトル" value="${UI.escHtml(s.title)}" data-field="title" data-idx="${i}" class="admin-input">
          <input type="text" placeholder="説明文" value="${UI.escHtml(s.desc)}" data-field="desc" data-idx="${i}" class="admin-input">
        </div>
        <button data-idx="${i}" class="howto-del-btn">✕</button>
      </div>
    `).join('');

    c.querySelectorAll('input').forEach(input => {
      input.addEventListener('change', () => {
        const idx = parseInt(input.dataset.idx);
        const field = input.dataset.field;
        _cfg.howtoSteps[idx][field] = input.value;
      });
    });
    c.querySelectorAll('.howto-del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _cfg.howtoSteps.splice(parseInt(btn.dataset.idx), 1);
        renderHowtoEditor();
      });
    });
  }

  // ---- Stamp Edit Modal ----
  function openStampEdit(id) {
    _editingStampId = id;
    const stamp = _cfg.stamps.find(s => s.id === id) || {};
    const isNew = !stamp.id;

    document.getElementById('stamp-edit-title').textContent   = isNew ? 'スタンプ追加' : 'スタンプ編集';
    document.getElementById('stamp-edit-id').value            = stamp.id || '';
    document.getElementById('stamp-edit-name').value          = stamp.name || '';
    document.getElementById('stamp-edit-location').value      = stamp.location || '';
    document.getElementById('stamp-edit-message').value       = stamp.message || '';
    document.getElementById('stamp-edit-emoji').value         = stamp.emoji || '⭐';
    document.getElementById('stamp-edit-code').value          = stamp.code || '';
    document.getElementById('stamp-edit-model').value         = stamp.modelUrl || '';
    document.getElementById('stamp-edit-barcode').value       = stamp.barcodeId ?? '';

    // Populate mind file select
    const sel = document.getElementById('stamp-edit-mind');
    sel.innerHTML = '<option value="">バーコードを使用（.mindファイルなし）</option>' +
      (_cfg.mindFiles || []).map(f => `<option value="${UI.escHtml(f.name)}" ${stamp.mindFile === f.name ? 'selected' : ''}>${UI.escHtml(f.name)}</option>`).join('');

    document.getElementById('stamp-edit-delete').style.display = isNew ? 'none' : '';
    UI.showModal('modal-stamp-edit');
  }

  function saveStampEdit() {
    const id = document.getElementById('stamp-edit-id').value;
    const data = {
      id:       id || ('stamp_' + Date.now()),
      name:     document.getElementById('stamp-edit-name').value,
      location: document.getElementById('stamp-edit-location').value,
      message:  document.getElementById('stamp-edit-message').value,
      emoji:    document.getElementById('stamp-edit-emoji').value,
      code:     document.getElementById('stamp-edit-code').value,
      modelUrl: document.getElementById('stamp-edit-model').value,
      barcodeId:parseInt(document.getElementById('stamp-edit-barcode').value) || 0,
      mindFile: document.getElementById('stamp-edit-mind').value,
    };
    const idx = _cfg.stamps.findIndex(s => s.id === id);
    if (idx >= 0) {
      _cfg.stamps[idx] = data;
    } else {
      _cfg.stamps.push(data);
    }
    Config.save();
    renderAll();
    UI.hideModal('modal-stamp-edit');
    UI.toast('スタンプを保存しました');
    // Re-init AR markers
    AR.init(_cfg.stamps, App.onStampDetect);
    UI.updateProgress(_cfg.stamps);
  }

  function deleteStamp(id) {
    if (!confirm('このスタンプを削除しますか？')) return;
    _cfg.stamps = _cfg.stamps.filter(s => s.id !== id);
    Config.save();
    renderAll();
    UI.hideModal('modal-stamp-edit');
    UI.toast('スタンプを削除しました');
    AR.init(_cfg.stamps, App.onStampDetect);
    UI.updateProgress(_cfg.stamps);
  }

  function bindEvents() {
    // Tab switching
    document.querySelectorAll('.admin-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.admin-tab-content').forEach(c => { c.classList.remove('active'); c.style.display = 'none'; });
        tab.classList.add('active');
        const content = document.getElementById('tab-' + tab.dataset.tab);
        if (content) { content.classList.add('active'); content.style.display = 'block'; }
      });
    });

    // Add stamp
    document.getElementById('btn-add-stamp')?.addEventListener('click', () => openStampEdit(null));

    // Stamp edit modal
    document.getElementById('stamp-edit-close')?.addEventListener('click',  () => UI.hideModal('modal-stamp-edit'));
    document.getElementById('stamp-edit-backdrop')?.addEventListener('click',() => UI.hideModal('modal-stamp-edit'));
    document.getElementById('stamp-edit-save')?.addEventListener('click',   saveStampEdit);
    document.getElementById('stamp-edit-delete')?.addEventListener('click', () => deleteStamp(document.getElementById('stamp-edit-id').value));

    // Mind file upload
    const mindInput = document.getElementById('mind-file-input');
    document.getElementById('btn-mind-browse')?.addEventListener('click', () => mindInput?.click());
    mindInput?.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        if (!_cfg.mindFiles) _cfg.mindFiles = [];
        _cfg.mindFiles.push({ name: file.name, data: ev.target.result, linkedStampId: '' });
        Config.save();
        renderMindFileList();
        UI.toast('.mindファイルを追加しました');
      };
      reader.readAsDataURL(file);
    });
    // Drop zone
    const dropArea = document.getElementById('mind-upload-area');
    if (dropArea) {
      dropArea.addEventListener('dragover', e => { e.preventDefault(); dropArea.classList.add('drag-active'); });
      dropArea.addEventListener('dragleave',() => dropArea.classList.remove('drag-active'));
      dropArea.addEventListener('drop', e => {
        e.preventDefault();
        dropArea.classList.remove('drag-active');
        const file = e.dataTransfer.files[0];
        if (file && file.name.endsWith('.mind')) {
          const reader = new FileReader();
          reader.onload = ev => {
            if (!_cfg.mindFiles) _cfg.mindFiles = [];
            _cfg.mindFiles.push({ name: file.name, data: ev.target.result, linkedStampId: '' });
            Config.save();
            renderMindFileList();
            UI.toast('.mindファイルを追加しました');
          };
          reader.readAsDataURL(file);
        } else {
          UI.toast('.mindファイルのみ対応しています');
        }
      });
    }

    // Save texts
    document.getElementById('btn-save-texts')?.addEventListener('click', () => {
      collectTextEditors();
      collectHowtoEditor();
      Config.save();
      UI.applyConfig(_cfg);
      UI.renderHowtoSteps(_cfg.howtoSteps);
      UI.toast('文言を保存しました');
    });

    // Add howto step
    document.getElementById('btn-add-howto-step')?.addEventListener('click', () => {
      _cfg.howtoSteps.push({ title: '新しいステップ', desc: '説明を入力してください' });
      renderHowtoEditor();
    });

    // Version update
    document.getElementById('btn-update-version')?.addEventListener('click', async () => {
      const newVer = document.getElementById('admin-version-id').value.trim();
      if (!newVer) { UI.toast('バージョンIDを入力してください'); return; }
      if (!confirm(`バージョンを「${newVer}」に更新すると参加者の進捗がリセットされます。よろしいですか？`)) return;
      _cfg.versionId = newVer;
      await Config.save();
      await DB.set('versionId', newVer);
      await State.reset();
      UI.updateProgress(_cfg.stamps);
      document.getElementById('admin-current-version').textContent = 'v: ' + newVer;
      UI.toast('バージョンを更新しました。進捗をリセットしました。');
    });

    // Sheets fetch
    document.getElementById('btn-fetch-sheets')?.addEventListener('click', async () => {
      const url = document.getElementById('admin-sheets-url').value.trim();
      if (!url) { UI.toast('URLを入力してください'); return; }
      _cfg.sheetsUrl = url;
      const status = document.getElementById('sheets-status');
      if (status) status.textContent = '取得中...';
      try {
        await Config.fetchFromSheets(url);
        await Config.save();
        renderAll();
        UI.applyConfig(_cfg);
        UI.renderStampList(_cfg.stamps);
        UI.updateProgress(_cfg.stamps);
        if (status) status.textContent = '✓ 取得成功';
        UI.toast('スプレッドシートから設定を読み込みました');
      } catch(e) {
        if (status) status.textContent = '✗ 取得失敗: ' + e.message;
        UI.toast('取得に失敗しました');
      }
    });

    // Leaderboard
    document.getElementById('btn-view-leaderboard')?.addEventListener('click', async () => {
      _cfg.leaderboardUrl = document.getElementById('admin-leaderboard-url').value.trim();
      await Config.save();
      loadLeaderboard(_cfg);
    });
    document.getElementById('lb-close')?.addEventListener('click',    () => UI.hideModal('modal-leaderboard'));
    document.getElementById('lb-backdrop')?.addEventListener('click', () => UI.hideModal('modal-leaderboard'));

    // Export JSON
    document.getElementById('btn-export-json')?.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(_cfg, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `stamp-rally-config-${_cfg.versionId}.json`;
      a.click();
    });

    // Import JSON
    document.getElementById('import-json-input')?.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      try {
        const data = JSON.parse(text);
        Object.assign(_cfg, data);
        await Config.save();
        renderAll();
        UI.applyConfig(_cfg);
        UI.updateProgress(_cfg.stamps);
        AR.init(_cfg.stamps, App.onStampDetect);
        UI.toast('設定をインポートしました');
      } catch {
        UI.toast('JSONの形式が正しくありません');
      }
    });

    // Reset all
    document.getElementById('btn-reset-all')?.addEventListener('click', async () => {
      if (!confirm('この端末のすべてのデータをリセットしますか？')) return;
      await State.reset();
      UI.updateProgress(_cfg.stamps);
      UI.toast('リセットしました');
    });
  }

  function collectHowtoEditor() {
    document.querySelectorAll('#howto-editor .howto-editor-item').forEach(item => {
      const idx = parseInt(item.dataset.idx);
      const inputs = item.querySelectorAll('input');
      if (_cfg.howtoSteps[idx]) {
        _cfg.howtoSteps[idx].title = inputs[0]?.value || '';
        _cfg.howtoSteps[idx].desc  = inputs[1]?.value || '';
      }
    });
  }

  return { init };
})();

// ============================================================
// 11. APP (Main Controller)
// ============================================================
const App = {
  _cfg: null,

  async onStampDetect(stamp) {
    const isNew = await State.acquireStamp(stamp.id);
    if (!isNew) return;
    const cfg = App._cfg;
    UI.showStampAcquired(stamp);
    UI.updateProgress(cfg.stamps);

    // Check complete
    if (State.getCount() >= cfg.stamps.length) {
      State.stopTimer();
      setTimeout(() => UI.showComplete(cfg, State.getElapsed()), 1500);
    }
  },

  async init() {
    // Load config + state
    const cfg = await Config.load();
    App._cfg = cfg;
    await State.load();

    // Apply UI
    UI.applyConfig(cfg);
    UI.renderStars();
    UI.renderHowtoSteps(cfg.howtoSteps);
    UI.updateProgress(cfg.stamps);

    // Init AR
    AR.init(cfg.stamps, App.onStampDetect);

    // Init Admin
    Admin.init(cfg);

    // Bind screen navigation
    App.bindNav();
    App.bindModals();

    // Show title
    UI.showScreen('screen-title');
  },

  bindNav() {
    const cfg = App._cfg;

    document.getElementById('btn-start')?.addEventListener('click', () => {
      UI.showScreen('screen-map');
      State.startTimer();
    });

    document.getElementById('btn-howto')?.addEventListener('click', () => {
      UI.showModal('modal-howto');
    });

    document.getElementById('btn-back-to-title')?.addEventListener('click', () => {
      UI.showScreen('screen-title');
    });

    document.getElementById('btn-go-scan')?.addEventListener('click', () => {
      AR.reset();
      UI.showScreen('screen-ar');
    });

    document.getElementById('btn-ar-back')?.addEventListener('click', () => {
      UI.showScreen('screen-map');
    });

    document.getElementById('btn-ar-manual')?.addEventListener('click', () => {
      document.getElementById('manual-input').value = '';
      document.getElementById('manual-error').classList.add('hidden');
      UI.showModal('modal-manual');
    });

    document.getElementById('btn-to-map')?.addEventListener('click', () => {
      UI.showScreen('screen-map');
    });

    document.getElementById('btn-share')?.addEventListener('click', () => {
      const id = document.getElementById('sa-name').textContent;
      const stamp = cfg.stamps.find(s => s.name === id) || {};
      shareStamp(stamp, cfg);
    });

    document.getElementById('btn-complete-share')?.addEventListener('click', () => {
      shareComplete(cfg, State.getElapsed());
    });

    document.getElementById('btn-complete-restart')?.addEventListener('click', () => {
      UI.showScreen('screen-map');
    });

    document.getElementById('btn-admin-entry')?.addEventListener('click', () => {
      const pw = prompt('管理者パスワードを入力してください（初期: admin）');
      if (pw === (cfg.adminPassword || 'admin')) {
        UI.showScreen('screen-admin');
      } else if (pw !== null) {
        UI.toast('パスワードが違います');
      }
    });

    document.getElementById('btn-admin-back')?.addEventListener('click', () => {
      UI.showScreen('screen-title');
    });
  },

  bindModals() {
    const cfg = App._cfg;

    // Howto modal
    document.getElementById('howto-backdrop')?.addEventListener('click', () => UI.hideModal('modal-howto'));
    document.getElementById('howto-close')?.addEventListener('click',    () => UI.hideModal('modal-howto'));
    document.getElementById('howto-ok')?.addEventListener('click',       () => UI.hideModal('modal-howto'));

    // Manual input
    document.getElementById('manual-backdrop')?.addEventListener('click', () => UI.hideModal('modal-manual'));
    document.getElementById('manual-close')?.addEventListener('click',    () => UI.hideModal('modal-manual'));
    document.getElementById('manual-submit')?.addEventListener('click',   () => {
      const val = document.getElementById('manual-input').value.trim();
      const match = cfg.stamps.find(s => s.code === val);
      if (match) {
        UI.hideModal('modal-manual');
        App.onStampDetect(match);
      } else {
        document.getElementById('manual-error').classList.remove('hidden');
      }
    });
    document.getElementById('manual-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('manual-submit')?.click();
    });

    // Stamp list item click → detail
    document.getElementById('stamp-list')?.addEventListener('click', e => {
      const item = e.target.closest('.stamp-item');
      if (!item) return;
      const id = item.dataset.id;
      if (State.isAcquired(id)) {
        const stamp = cfg.stamps.find(s => s.id === id);
        if (stamp) UI.showStampAcquired(stamp);
      }
    });
  },
};

// ============================================================
// 12. PWA / SERVICE WORKER REGISTRATION
// ============================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('[SW] Registered:', reg.scope))
      .catch(err => console.warn('[SW] Registration failed:', err));
  });
}

// ============================================================
// BOOT
// ============================================================
document.addEventListener('DOMContentLoaded', () => App.init());
