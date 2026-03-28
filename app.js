/**
 * WebAR Stamp Rally — app.js (完全修正版)
 *
 * 修正点:
 *  1. type="module" 廃止 → 通常スクリプト (A-Frame競合回避)
 *  2. タイマーのバグ修正 (startTimer が2重呼び出しを正しくガード)
 *  3. ドラッグ&ドロップをタッチ対応で完全再実装
 *  4. 画面切替を display: flex/none で統一 (クラス競合排除)
 *  5. AR: A-Frameシーンを動的生成/破棄してカメラ再起動を確実に
 *  6. モーダルを display で管理
 */

'use strict';

/* ============================================================
   1. IndexedDB (KVストア、localStorage fallback)
   ============================================================ */
var DB = (function () {
  var DB_NAME = 'StampRallyDB';
  var DB_VER  = 1;
  var _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise(function (res, rej) {
      var req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = function (e) { _db = e.target.result; res(_db); };
      req.onerror   = function () { rej(req.error); };
    });
  }

  function get(key) {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var tx  = db.transaction('kv', 'readonly');
        var req = tx.objectStore('kv').get(key);
        req.onsuccess = function () { res(req.result !== undefined ? req.result : null); };
        req.onerror   = function () { rej(req.error); };
      });
    }).catch(function () {
      var v = localStorage.getItem('sr_' + key);
      return v ? JSON.parse(v) : null;
    });
  }

  function set(key, value) {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(value, key);
        tx.oncomplete = function () { res(); };
        tx.onerror    = function () { rej(tx.error); };
      });
    }).catch(function () {
      localStorage.setItem('sr_' + key, JSON.stringify(value));
    });
  }

  function del(key) {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').delete(key);
        tx.oncomplete = function () { res(); };
        tx.onerror    = function () { rej(tx.error); };
      });
    }).catch(function () {
      localStorage.removeItem('sr_' + key);
    });
  }

  return { get: get, set: set, del: del };
}());

/* ============================================================
   2. デフォルト設定
   ============================================================ */
var DEFAULT_CONFIG = {
  versionId:     '2026_Ver1',
  adminPassword: 'admin',
  sheetsUrl:     '',
  leaderboardUrl:'',
  eventYear:     '2026',
  eventTitle:    '文化祭\nスタンプラリー',
  eventSubtitle: '全スタンプを集めて特典をゲットしよう！',
  ui: {
    btnStart:          'スタート！',
    btnHowto:          '遊び方',
    howtoTitle:        '遊び方',
    mapTitle:          'スタンプマップ',
    progressLabel:     '進捗',
    btnScan:           'ARスキャン開始',
    arTitle:           'マーカーを照らして！',
    arHint:            'マーカーを枠内に合わせてください',
    stampAcquiredLabel:'スタンプ獲得！',
    btnToMap:          'マップに戻る',
    btnShare:          'シェア',
    completeTitle:     'コンプリート！',
    completeSubtitle:  '全スタンプ制覇おめでとう！',
    completeTimeLabel: 'クリアタイム',
    manualTitle:       '合言葉入力',
    manualDesc:        'スタンプ地点に掲示された数字を入力してください',
  },
  coupon: {
    title: '🎁 特典クーポン',
    body:  '文化祭グッズ引換券！本部で見せてください',
    code:  'FES-2026-COMP',
  },
  howtoSteps: [
    { title: 'アプリを開く',         desc: 'このページをホーム画面に追加しておくと便利です。' },
    { title: 'スタンプ場所へ行く',    desc: 'マップから場所を確認して出発しましょう！' },
    { title: 'マーカーをスキャン',    desc: '「ARスキャン開始」を押してカメラをマーカーに向けてください。' },
    { title: 'スタンプをゲット',      desc: 'スキャン成功！スタンプが記録されます。' },
    { title: 'コンプリートで特典',    desc: '全スタンプを集めると特典クーポンが表示されます！' },
  ],
  stamps: [
    { id:'s01', name:'科学部の秘密実験',   location:'3階 理科室', message:'サイエンスの世界へようこそ！',  emoji:'🔬', code:'1234', barcodeId:0, modelUrl:'', mindFile:'' },
    { id:'s02', name:'美術部ギャラリー',    location:'2階 美術室', message:'芸術に触れてみよう！',          emoji:'🎨', code:'2345', barcodeId:1, modelUrl:'', mindFile:'' },
    { id:'s03', name:'音楽部ライブ',        location:'体育館',     message:'音楽の力を感じてください！',    emoji:'🎵', code:'3456', barcodeId:2, modelUrl:'', mindFile:'' },
    { id:'s04', name:'茶道部おもてなし',    location:'和室',       message:'お茶をどうぞ！',                emoji:'🍵', code:'4567', barcodeId:3, modelUrl:'', mindFile:'' },
    { id:'s05', name:'フードコート',         location:'中庭',       message:'美味しいものいっぱい！',         emoji:'🍔', code:'5678', barcodeId:4, modelUrl:'', mindFile:'' },
  ],
  mindFiles: [],
};

/* ============================================================
   3. Config
   ============================================================ */
var Config = (function () {
  var _cfg = null;

  function deepMerge(target, source) {
    var out = Object.assign({}, target);
    Object.keys(source).forEach(function (k) {
      if (source[k] && typeof source[k] === 'object' && !Array.isArray(source[k])) {
        out[k] = deepMerge(target[k] || {}, source[k]);
      } else {
        out[k] = source[k];
      }
    });
    return out;
  }

  function load() {
    return DB.get('config').then(function (cached) {
      if (cached) {
        _cfg = deepMerge(DEFAULT_CONFIG, cached);
      } else {
        _cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      }
      // バージョンチェック → 不一致なら進捗リセット
      return DB.get('versionId').then(function (savedVer) {
        if (savedVer && savedVer !== _cfg.versionId) {
          return Promise.all([DB.del('progress'), DB.del('timerStart'), DB.del('timerElapsed')])
            .then(function () { console.log('[Config] Version changed, progress reset.'); });
        }
      });
    }).then(function () {
      return DB.set('versionId', _cfg.versionId);
    }).then(function () {
      // Sheetsから1回だけ取得
      if (_cfg.sheetsUrl) {
        return fetchFromSheets(_cfg.sheetsUrl).catch(function (e) {
          console.warn('[Config] Sheets fetch failed:', e.message);
        });
      }
    }).then(function () { return _cfg; });
  }

  function fetchFromSheets(url) {
    return fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && typeof data === 'object') {
          _cfg = deepMerge(_cfg, data);
          return DB.set('config', _cfg);
        }
      });
  }

  function save() { return DB.set('config', _cfg); }
  function get()  { return _cfg; }

  return { load: load, get: get, save: save, fetchFromSheets: fetchFromSheets };
}());

/* ============================================================
   4. State (進捗 + タイマー)
   ============================================================ */
var State = (function () {
  var acquired   = {};   // id → true
  var _start     = null; // Date.now() when timer started
  var _elapsed   = 0;    // accumulated ms
  var _interval  = null;
  var _timerRunning = false;

  function load() {
    return Promise.all([
      DB.get('progress'),
      DB.get('timerElapsed'),
      DB.get('timerStart'),
    ]).then(function (vals) {
      var prog    = vals[0];
      var elapsed = vals[1];
      var start   = vals[2];

      if (prog) {
        prog.forEach(function (id) { acquired[id] = true; });
      }
      _elapsed = elapsed || 0;

      // タイマーが進行中だった場合: 経過時間に追加して再開
      if (start) {
        _elapsed += (Date.now() - start);
        DB.del('timerStart');
      }
    });
  }

  function startTimer() {
    if (_timerRunning) return;
    _timerRunning = true;
    _start = Date.now();
    DB.set('timerStart', _start);

    _interval = setInterval(function () {
      var current = _elapsed + (Date.now() - _start);
      UI.updateTimer(current);
    }, 500);
  }

  function stopTimer() {
    if (!_timerRunning) return;
    _elapsed += (Date.now() - _start);
    _timerRunning = false;
    clearInterval(_interval);
    _interval = null;
    _start = null;
    DB.del('timerStart');
    DB.set('timerElapsed', _elapsed);
  }

  function getElapsed() {
    if (_timerRunning && _start) {
      return _elapsed + (Date.now() - _start);
    }
    return _elapsed;
  }

  function acquireStamp(id) {
    if (acquired[id]) return Promise.resolve(false);
    acquired[id] = true;
    return DB.set('progress', Object.keys(acquired)).then(function () {
      return true;
    });
  }

  function isAcquired(id) { return !!acquired[id]; }
  function getCount() { return Object.keys(acquired).length; }

  function reset() {
    acquired = {};
    _elapsed = 0;
    _start   = null;
    _timerRunning = false;
    clearInterval(_interval);
    _interval = null;
    return Promise.all([DB.del('progress'), DB.del('timerStart'), DB.del('timerElapsed')]);
  }

  return {
    load: load, startTimer: startTimer, stopTimer: stopTimer,
    getElapsed: getElapsed, acquireStamp: acquireStamp,
    isAcquired: isAcquired, getCount: getCount, reset: reset,
  };
}());

/* ============================================================
   5. UI ユーティリティ
   ============================================================ */
var UI = (function () {
  var _currentScreen = null;
  var _toastTimer    = null;

  // ── Screen 切り替え ───────────────────────────────────────
  function showScreen(id) {
    if (_currentScreen) {
      _currentScreen.style.display = 'none';
      _currentScreen.classList.remove('active');
    }
    var el = document.getElementById(id);
    if (!el) return;
    el.style.display = 'flex';
    el.classList.add('active');
    _currentScreen = el;
  }

  // ── Modal ────────────────────────────────────────────────
  function showModal(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'flex';
  }
  function hideModal(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  // ── Toast ────────────────────────────────────────────────
  function toast(msg, dur) {
    dur = dur || 2500;
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () {
      el.style.display = 'none';
    }, dur);
  }

  // ── Timer display ────────────────────────────────────────
  function formatTime(ms) {
    var total = Math.floor(ms / 1000);
    var m = Math.floor(total / 60);
    var s = total % 60;
    return pad(m) + ':' + pad(s);
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function updateTimer(ms) {
    var el = document.getElementById('timer-display');
    if (el) el.textContent = formatTime(ms);
  }

  // ── escapeHTML ────────────────────────────────────────────
  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  // ── Apply config to DOM ────────────────────────────────────
  function applyConfig(cfg) {
    function setText(id, val) {
      var el = document.getElementById(id);
      if (el && val !== undefined) el.textContent = val;
    }
    setText('ui-event-year',         cfg.eventYear);
    setText('ui-event-title',        cfg.eventTitle);
    setText('ui-event-subtitle',     cfg.eventSubtitle);
    setText('ui-btn-start',          cfg.ui.btnStart);
    setText('ui-btn-howto',          cfg.ui.btnHowto);
    setText('ui-howto-title',        cfg.ui.howtoTitle);
    setText('ui-map-title',          cfg.ui.mapTitle);
    setText('ui-progress-label',     cfg.ui.progressLabel);
    setText('ui-btn-scan',           cfg.ui.btnScan);
    setText('ui-ar-title',           cfg.ui.arTitle);
    setText('ui-ar-hint',            cfg.ui.arHint);
    setText('ui-stamp-acquired-label', cfg.ui.stampAcquiredLabel);
    setText('ui-btn-to-map',         cfg.ui.btnToMap);
    setText('ui-btn-share',          cfg.ui.btnShare);
    setText('ui-complete-title',     cfg.ui.completeTitle);
    setText('ui-complete-subtitle',  cfg.ui.completeSubtitle);
    setText('ui-complete-time-label',cfg.ui.completeTimeLabel);
    setText('ui-manual-title',       cfg.ui.manualTitle);
    setText('ui-manual-desc',        cfg.ui.manualDesc);
    setText('ui-coupon-title',       cfg.coupon.title);
    setText('ui-coupon-body',        cfg.coupon.body);
    setText('ui-coupon-code',        cfg.coupon.code);
    document.title = cfg.eventTitle.replace('\n', '') + ' ' + cfg.eventYear;
  }

  // ── Howto steps ────────────────────────────────────────────
  function renderHowtoSteps(steps) {
    var c = document.getElementById('howto-steps-container');
    if (!c) return;
    c.innerHTML = steps.map(function (s, i) {
      return '<div class="howto-step">' +
        '<div class="howto-step-num">' + (i + 1) + '</div>' +
        '<div class="howto-step-body">' +
          '<h3>' + esc(s.title) + '</h3>' +
          '<p>' + esc(s.desc) + '</p>' +
        '</div></div>';
    }).join('');
  }

  // ── Stamp list (map) ───────────────────────────────────────
  function renderStampList(stamps) {
    var list = document.getElementById('stamp-list');
    if (!list) return;
    list.innerHTML = stamps.map(function (s) {
      var acq = State.isAcquired(s.id);
      return '<div class="stamp-item ' + (acq ? 'acquired' : '') + '" data-id="' + s.id + '">' +
        '<div class="stamp-item-emoji">' + (s.emoji || '⭐') + '</div>' +
        '<div class="stamp-item-info">' +
          '<div class="stamp-item-name">' + esc(s.name) + '</div>' +
          '<div class="stamp-item-loc">📍 ' + esc(s.location) + '</div>' +
        '</div>' +
        '<div class="stamp-check">' + (acq ? '✓' : '') + '</div>' +
      '</div>';
    }).join('');
  }

  function updateProgress(stamps) {
    var total = stamps.length;
    var count = State.getCount();
    var pct   = total ? Math.round(count / total * 100) : 0;
    var bar   = document.getElementById('progress-bar');
    var label = document.getElementById('progress-count');
    if (bar)   bar.style.width = pct + '%';
    if (label) label.textContent = count + ' / ' + total;
    renderStampList(stamps);
  }

  // ── Stamp acquired ─────────────────────────────────────────
  function showStampAcquired(stamp) {
    document.getElementById('sa-emoji').textContent    = stamp.emoji || '⭐';
    document.getElementById('sa-name').textContent     = stamp.name;
    document.getElementById('sa-location').textContent = stamp.location;
    document.getElementById('sa-message').textContent  = stamp.message;
    showScreen('screen-stamp');
    spawnSparkles();
  }

  function spawnSparkles() {
    var c = document.getElementById('stamp-sparkles');
    if (!c) return;
    c.innerHTML = '';
    var colors = ['#c840ff','#00f0ff','#ffce00','#00e87a'];
    for (var i = 0; i < 22; i++) {
      var d = document.createElement('div');
      d.className = 'sparkle';
      var size = 5 + Math.random() * 8;
      var tx   = (Math.random() - 0.5) * 200;
      var ty   = -(40 + Math.random() * 120);
      d.style.cssText = 'left:' + Math.random() * 100 + '%;' +
        'top:' + (50 + Math.random() * 40) + '%;' +
        'width:' + size + 'px;height:' + size + 'px;' +
        'background:' + colors[Math.floor(Math.random() * colors.length)] + ';' +
        '--tx:' + tx + 'px;--ty:' + ty + 'px;' +
        '--d:' + (1 + Math.random()) + 's;' +
        '--dl:' + (Math.random() * 0.4) + 's;';
      c.appendChild(d);
    }
  }

  // ── Complete ───────────────────────────────────────────────
  function showComplete(cfg, elapsed) {
    document.getElementById('complete-time-value').textContent = formatTime(elapsed);
    showScreen('screen-complete');
    startConfetti();
  }

  // ── Stars ──────────────────────────────────────────────────
  function renderStars() {
    var c = document.getElementById('stars');
    if (!c) return;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < 60; i++) {
      var el   = document.createElement('div');
      el.className = 'star';
      var sz   = 1 + Math.random() * 2.5;
      el.style.cssText = 'left:' + Math.random() * 100 + '%;' +
        'top:' + Math.random() * 100 + '%;' +
        'width:' + sz + 'px;height:' + sz + 'px;' +
        '--d:' + (2 + Math.random() * 4) + 's;' +
        '--dl:' + (Math.random() * 4) + 's;';
      frag.appendChild(el);
    }
    c.appendChild(frag);
  }

  return {
    showScreen: showScreen, showModal: showModal, hideModal: hideModal,
    toast: toast, formatTime: formatTime, updateTimer: updateTimer,
    applyConfig: applyConfig, renderHowtoSteps: renderHowtoSteps,
    renderStampList: renderStampList, updateProgress: updateProgress,
    showStampAcquired: showStampAcquired, showComplete: showComplete,
    renderStars: renderStars, esc: esc,
  };
}());

/* ============================================================
   6. Confetti
   ============================================================ */
function startConfetti() {
  var canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  canvas.width  = canvas.offsetWidth  || window.innerWidth;
  canvas.height = canvas.offsetHeight || window.innerHeight;
  var ctx = canvas.getContext('2d');
  var colors = ['#c840ff','#00f0ff','#ffce00','#00e87a','#ff4458','#fff'];
  var particles = [];
  for (var i = 0; i < 120; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * 200,
      r: 4 + Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      speed: 2 + Math.random() * 3,
      drift: (Math.random() - 0.5) * 1.5,
      angle: Math.random() * Math.PI * 2,
      spin:  (Math.random() - 0.5) * 0.15,
    });
  }
  var frame;
  (function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(function (p) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 1.7);
      ctx.restore();
      p.y += p.speed;
      p.x += p.drift;
      p.angle += p.spin;
      if (p.y > canvas.height) { p.y = -20; p.x = Math.random() * canvas.width; }
    });
    frame = requestAnimationFrame(draw);
  }());
  setTimeout(function () {
    cancelAnimationFrame(frame);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, 8000);
}

/* ============================================================
   7. Web Share
   ============================================================ */
function shareStamp(stamp, cfg) {
  var text = '📍 ' + stamp.name + ' のスタンプをゲット！\n' +
    stamp.message + '\n\n' + cfg.eventTitle.replace('\n', '') + ' ' + cfg.eventYear;
  if (navigator.share) {
    navigator.share({ title: cfg.eventTitle.replace('\n', ''), text: text }).catch(function () {});
  } else {
    navigator.clipboard && navigator.clipboard.writeText(text)
      .then(function () { UI.toast('クリップボードにコピーしました！'); })
      .catch(function () { UI.toast('シェアできませんでした'); });
  }
}

function shareComplete(cfg, elapsed) {
  var text = '🏆 全スタンプをコンプリート！\nクリアタイム: ' + UI.formatTime(elapsed) +
    '\n\n' + cfg.eventTitle.replace('\n', '') + ' ' + cfg.eventYear;
  if (navigator.share) {
    navigator.share({ title: cfg.eventTitle.replace('\n', ''), text: text }).catch(function () {});
  } else {
    navigator.clipboard && navigator.clipboard.writeText(text)
      .then(function () { UI.toast('クリップボードにコピーしました！'); });
  }
}

/* ============================================================
   8. AR Module — A-Frameを動的生成してカメラを確実に起動
   ============================================================ */
var AR = (function () {
  var _stamps    = [];
  var _onDetect  = null;
  var _cooldown  = {};  // id → timestamp (重複防止)
  var _scene     = null;

  function init(stamps, onDetect) {
    _stamps   = stamps;
    _onDetect = onDetect;
  }

  /* AR画面を表示するときにシーンを生成 */
  function startScene() {
    var wrapper = document.getElementById('ar-scene-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = '';

    // ── A-Frame scene (文字列で構築して innerHTML で挿入)
    var markersHtml = _stamps.map(function (s) {
      var obj = s.modelUrl
        ? '<a-gltf-model src="' + s.modelUrl + '" scale="0.12 0.12 0.12" position="0 0 0"></a-gltf-model>'
        : '<a-box color="#c840ff" scale="0.5 0.5 0.5"></a-box>' +
          '<a-text value="' + (s.emoji || '★') + '" align="center" position="0 0.7 0" scale="3 3 3"></a-text>';
      if (s.mindFile) {
        return '<a-nft id="marker-' + s.id + '" type="nft" url="' + s.mindFile + '" smooth="true" smoothCount="10">' +
          obj + '</a-nft>';
      } else {
        return '<a-marker id="marker-' + s.id + '" type="barcode" value="' + s.barcodeId + '" smooth="true" smoothCount="10">' +
          obj + '</a-marker>';
      }
    }).join('');

    var sceneHtml =
      '<a-scene embedded ' +
        'arjs="sourceType:webcam; debugUIEnabled:false; detectionMode:mono_and_matrix; matrixCodeType:3x3_hamming63;" ' +
        'vr-mode-ui="enabled:false" ' +
        'renderer="logarithmicDepthBuffer:true; antialias:true;" ' +
        'style="position:absolute;top:0;left:0;width:100%;height:100%;">' +
        markersHtml +
        '<a-entity camera></a-entity>' +
      '</a-scene>';

    wrapper.innerHTML = sceneHtml;
    _scene = wrapper.querySelector('a-scene');

    // イベント登録はシーン初期化後に実施
    function attachMarkerEvents() {
      _stamps.forEach(function (s) {
        var marker = document.getElementById('marker-' + s.id);
        if (!marker) return;
        marker.addEventListener('markerFound', function () {
          handleDetect(s);
        });
      });
    }

    if (_scene && _scene.hasLoaded) {
      attachMarkerEvents();
    } else if (_scene) {
      _scene.addEventListener('loaded', attachMarkerEvents);
    }

    // カメラ起動状態を表示
    var status = document.getElementById('ar-status');
    if (status) {
      status.textContent = 'カメラ起動中...';
      // AR.jsがvideoを作成したら消す
      var observer = new MutationObserver(function () {
        var video = document.querySelector('#ar-scene-wrapper video');
        if (video) {
          status.textContent = '';
          observer.disconnect();
        }
      });
      observer.observe(wrapper, { childList: true, subtree: true });
      // タイムアウト
      setTimeout(function () {
        if (status.textContent === 'カメラ起動中...') {
          status.textContent = 'カメラが使えない場合は ⌨️ で合言葉入力';
        }
      }, 6000);
    }
  }

  /* AR画面を離れるときにシーンを破棄 (カメラ解放) */
  function destroyScene() {
    var wrapper = document.getElementById('ar-scene-wrapper');
    if (wrapper) wrapper.innerHTML = '';
    _scene = null;
    _cooldown = {};
  }

  function handleDetect(stamp) {
    var now = Date.now();
    if (_cooldown[stamp.id] && now - _cooldown[stamp.id] < 4000) return;
    _cooldown[stamp.id] = now;

    // banner
    var banner = document.getElementById('ar-banner');
    var bEmoji = document.getElementById('ar-banner-emoji');
    var bText  = document.getElementById('ar-banner-text');
    if (banner) {
      if (bEmoji) bEmoji.textContent = stamp.emoji || '🎉';
      if (bText)  bText.textContent  = stamp.name + ' をスキャン！';
      banner.style.display = 'flex';
      setTimeout(function () { banner.style.display = 'none'; }, 3000);
    }

    if (_onDetect) _onDetect(stamp);
  }

  return { init: init, startScene: startScene, destroyScene: destroyScene };
}());

/* ============================================================
   9. Touch-friendly Drag & Drop (stamp admin list)
   ============================================================ */
function makeDraggable(listEl, onReorder) {
  var dragSrc   = null;
  var dragIdx   = null;
  var touchItem = null;
  var ghost     = null;
  var startY    = 0;

  function getItems() {
    return Array.from(listEl.querySelectorAll('.stamp-admin-item'));
  }

  function getIndexOf(el) {
    return getItems().indexOf(el);
  }

  function itemAtY(y) {
    var items = getItems();
    for (var i = 0; i < items.length; i++) {
      var r = items[i].getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) return items[i];
    }
    return null;
  }

  // ── Mouse drag ──────────────────────────────────────────────
  function onDragStart(e) {
    dragSrc = this.closest('.stamp-admin-item');
    dragIdx = getIndexOf(dragSrc);
    dragSrc.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragIdx));
  }
  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    var item = e.currentTarget;
    getItems().forEach(function (i) { i.classList.remove('drag-over'); });
    item.classList.add('drag-over');
  }
  function onDrop(e) {
    e.preventDefault();
    var destItem = e.currentTarget;
    var destIdx  = getIndexOf(destItem);
    if (dragSrc && dragIdx !== null && dragIdx !== destIdx) {
      onReorder(dragIdx, destIdx);
    }
    cleanup();
  }
  function onDragEnd() { cleanup(); }
  function cleanup() {
    getItems().forEach(function (i) {
      i.classList.remove('dragging');
      i.classList.remove('drag-over');
    });
    dragSrc = null; dragIdx = null;
  }

  // ── Touch drag ──────────────────────────────────────────────
  function onTouchStart(e) {
    var handle = e.currentTarget;
    var item   = handle.closest('.stamp-admin-item');
    if (!item) return;
    touchItem = item;
    startY    = e.touches[0].clientY;

    // ghost
    ghost = item.cloneNode(true);
    ghost.style.cssText =
      'position:fixed;z-index:9999;left:' + item.getBoundingClientRect().left + 'px;' +
      'width:' + item.offsetWidth + 'px;opacity:0.85;pointer-events:none;' +
      'background:var(--surf2);border:1.5px solid var(--accent);border-radius:14px;' +
      'box-shadow:0 8px 32px rgba(0,0,0,.5);';
    ghost.style.top = item.getBoundingClientRect().top + 'px';
    document.body.appendChild(ghost);
    item.classList.add('dragging');
    e.preventDefault();
  }

  function onTouchMove(e) {
    if (!touchItem || !ghost) return;
    var t = e.touches[0];
    ghost.style.top = (t.clientY - 30) + 'px';

    var over = itemAtY(t.clientY);
    getItems().forEach(function (i) { i.classList.remove('drag-over'); });
    if (over && over !== touchItem) over.classList.add('drag-over');
    e.preventDefault();
  }

  function onTouchEnd(e) {
    if (!touchItem || !ghost) return;
    var t      = e.changedTouches[0];
    var over   = itemAtY(t.clientY);
    var srcIdx = getIndexOf(touchItem);
    var dstIdx = over ? getIndexOf(over) : -1;

    if (over && srcIdx !== dstIdx && dstIdx >= 0) {
      onReorder(srcIdx, dstIdx);
    }
    ghost.remove();
    ghost = null;
    getItems().forEach(function (i) {
      i.classList.remove('dragging');
      i.classList.remove('drag-over');
    });
    touchItem = null;
  }

  function rebind() {
    // Mouse
    getItems().forEach(function (item) {
      item.setAttribute('draggable', 'true');
      var handle = item.querySelector('.drag-handle-icon');

      // clean old listeners by replacing node is costly; use flag instead
      item.removeEventListener('dragstart', onDragStart);
      item.removeEventListener('dragover',  onDragOver);
      item.removeEventListener('drop',      onDrop);
      item.removeEventListener('dragend',   onDragEnd);
      item.addEventListener('dragstart', onDragStart);
      item.addEventListener('dragover',  onDragOver);
      item.addEventListener('drop',      onDrop);
      item.addEventListener('dragend',   onDragEnd);

      // Touch
      if (handle) {
        handle.removeEventListener('touchstart', onTouchStart);
        handle.addEventListener('touchstart', onTouchStart, { passive: false });
      }
    });
    document.removeEventListener('touchmove', onTouchMove);
    document.removeEventListener('touchend',  onTouchEnd);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend',  onTouchEnd);
  }

  return { rebind: rebind };
}

/* ============================================================
   10. Admin Module
   ============================================================ */
var Admin = (function () {
  var _cfg       = null;
  var _dragCtrl  = null;

  function init(cfg) {
    _cfg = cfg;
    renderAll();
    bindStaticEvents();
  }

  function renderAll() {
    renderStampAdminList();
    renderMindFileList();
    renderTextEditors();
    renderHowtoEditor();
    var verEl = document.getElementById('admin-current-version');
    if (verEl) verEl.textContent = 'v: ' + _cfg.versionId;
    var vid = document.getElementById('admin-version-id');
    if (vid) vid.value = _cfg.versionId;
    var su = document.getElementById('admin-sheets-url');
    if (su) su.value = _cfg.sheetsUrl || '';
    var lu = document.getElementById('admin-leaderboard-url');
    if (lu) lu.value = _cfg.leaderboardUrl || '';
  }

  // ── Stamp Admin List ────────────────────────────────────────
  function renderStampAdminList() {
    var list = document.getElementById('stamp-admin-list');
    if (!list) return;
    list.innerHTML = _cfg.stamps.map(function (s, i) {
      return '<div class="stamp-admin-item" data-idx="' + i + '">' +
        '<span class="drag-handle-icon" title="ドラッグで並び替え">☰</span>' +
        '<span class="stamp-admin-emoji">' + (s.emoji || '⭐') + '</span>' +
        '<div class="stamp-admin-info">' +
          '<div class="stamp-admin-name">' + UI.esc(s.name) + '</div>' +
          '<div class="stamp-admin-sub">' +
            (s.mindFile ? '.mind: ' + s.mindFile : 'バーコード #' + s.barcodeId) +
            ' | 合言葉: ' + s.code +
          '</div>' +
        '</div>' +
        '<button class="stamp-admin-edit" data-id="' + s.id + '">編集</button>' +
      '</div>';
    }).join('');

    // Edit buttons
    list.querySelectorAll('.stamp-admin-edit').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        openStampEdit(btn.dataset.id);
      });
    });

    // Init drag & drop
    if (!_dragCtrl) {
      _dragCtrl = makeDraggable(list, function (srcIdx, dstIdx) {
        var arr    = _cfg.stamps.slice();
        var moved  = arr.splice(srcIdx, 1)[0];
        arr.splice(dstIdx, 0, moved);
        _cfg.stamps = arr;
        Config.save();
        renderStampAdminList();
        UI.updateProgress(_cfg.stamps);
        UI.toast('並び順を更新しました ✓');
      });
    }
    _dragCtrl.rebind();
  }

  // ── Mind Files ───────────────────────────────────────────────
  function renderMindFileList() {
    var list = document.getElementById('mind-file-list');
    if (!list) return;
    var files = _cfg.mindFiles || [];
    if (!files.length) { list.innerHTML = '<div style="font-size:13px;color:var(--muted);padding:8px 0;">登録ファイルなし</div>'; return; }
    list.innerHTML = files.map(function (f, i) {
      var linked = _cfg.stamps.find(function (s) { return s.mindFile === f.name; });
      return '<div class="mind-file-item">' +
        '<span style="font-size:20px">📄</span>' +
        '<div class="mind-file-name">' + UI.esc(f.name) + '</div>' +
        '<div class="mind-file-linked">' + (linked ? '→ ' + UI.esc(linked.name) : '未リンク') + '</div>' +
        '<button class="mind-file-del" data-idx="' + i + '">🗑</button>' +
      '</div>';
    }).join('');
    list.querySelectorAll('.mind-file-del').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx  = parseInt(btn.dataset.idx);
        var name = _cfg.mindFiles[idx].name;
        _cfg.mindFiles.splice(idx, 1);
        _cfg.stamps.forEach(function (s) { if (s.mindFile === name) s.mindFile = ''; });
        Config.save();
        renderMindFileList();
        renderStampAdminList();
        UI.toast('ファイルを削除しました');
      });
    });
  }

  // ── Text Editors ─────────────────────────────────────────────
  function renderTextEditors() {
    renderEditorGroup('text-editors-event', [
      { key:'eventYear',     label:'年度' },
      { key:'eventTitle',    label:'タイトル（改行は\\n）' },
      { key:'eventSubtitle', label:'サブタイトル' },
    ], _cfg);

    var uiRows = Object.keys(_cfg.ui).map(function (k) {
      return { key:'ui.' + k, label: k };
    });
    renderEditorGroup('text-editors-ui', uiRows, _cfg);

    renderEditorGroup('text-editors-coupon', [
      { key:'coupon.title', label:'クーポンタイトル' },
      { key:'coupon.body',  label:'クーポン本文' },
      { key:'coupon.code',  label:'クーポンコード' },
    ], _cfg);
  }

  function renderEditorGroup(containerId, rows, obj) {
    var c = document.getElementById(containerId);
    if (!c) return;
    c.innerHTML = rows.map(function (r) {
      var val = getNestedVal(obj, r.key);
      return '<div class="text-edit-row">' +
        '<label>' + UI.esc(r.label) + '</label>' +
        '<input type="text" class="admin-input text-edit-input" data-key="' + r.key + '" value="' + UI.esc(val) + '">' +
      '</div>';
    }).join('');
  }

  function getNestedVal(obj, keyPath) {
    var keys = keyPath.split('.');
    var cur  = obj;
    keys.forEach(function (k) { cur = cur && cur[k]; });
    return cur !== undefined ? cur : '';
  }

  function collectTextEditors() {
    document.querySelectorAll('.text-edit-input').forEach(function (input) {
      var keys = input.dataset.key.split('.');
      var obj  = _cfg;
      for (var i = 0; i < keys.length - 1; i++) { obj = obj[keys[i]]; }
      obj[keys[keys.length - 1]] = input.value;
    });
  }

  // ── Howto Editor ─────────────────────────────────────────────
  function renderHowtoEditor() {
    var c = document.getElementById('howto-editor');
    if (!c) return;
    c.innerHTML = (_cfg.howtoSteps || []).map(function (s, i) {
      return '<div class="howto-edit-item" data-idx="' + i + '">' +
        '<div class="howto-edit-num">' + (i + 1) + '</div>' +
        '<div class="howto-edit-fields">' +
          '<input type="text" class="admin-input" placeholder="タイトル" value="' + UI.esc(s.title) + '" data-field="title" data-idx="' + i + '">' +
          '<input type="text" class="admin-input" placeholder="説明" value="' + UI.esc(s.desc) + '" data-field="desc" data-idx="' + i + '">' +
        '</div>' +
        '<button class="howto-del" data-idx="' + i + '">✕</button>' +
      '</div>';
    }).join('');

    c.querySelectorAll('input').forEach(function (input) {
      input.addEventListener('input', function () {
        var idx   = parseInt(input.dataset.idx);
        var field = input.dataset.field;
        if (_cfg.howtoSteps[idx]) _cfg.howtoSteps[idx][field] = input.value;
      });
    });
    c.querySelectorAll('.howto-del').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _cfg.howtoSteps.splice(parseInt(btn.dataset.idx), 1);
        renderHowtoEditor();
      });
    });
  }

  // ── Stamp Edit Modal ─────────────────────────────────────────
  function openStampEdit(id) {
    var stamp = id ? (_cfg.stamps.find(function (s) { return s.id === id; }) || {}) : {};
    var isNew = !stamp.id;

    document.getElementById('stamp-edit-title').textContent = isNew ? 'スタンプ追加' : 'スタンプ編集';
    document.getElementById('stamp-edit-id').value          = stamp.id || '';
    document.getElementById('stamp-edit-name').value        = stamp.name || '';
    document.getElementById('stamp-edit-location').value    = stamp.location || '';
    document.getElementById('stamp-edit-message').value     = stamp.message || '';
    document.getElementById('stamp-edit-emoji').value       = stamp.emoji || '⭐';
    document.getElementById('stamp-edit-code').value        = stamp.code || '';
    document.getElementById('stamp-edit-model').value       = stamp.modelUrl || '';
    document.getElementById('stamp-edit-barcode').value     = stamp.barcodeId !== undefined ? stamp.barcodeId : '';

    var sel = document.getElementById('stamp-edit-mind');
    sel.innerHTML = '<option value="">バーコードを使用（.mindなし）</option>' +
      (_cfg.mindFiles || []).map(function (f) {
        return '<option value="' + UI.esc(f.name) + '" ' + (stamp.mindFile === f.name ? 'selected' : '') + '>' +
          UI.esc(f.name) + '</option>';
      }).join('');

    document.getElementById('stamp-edit-delete').style.display = isNew ? 'none' : '';
    UI.showModal('modal-stamp-edit');
  }

  function saveStampEdit() {
    var id   = document.getElementById('stamp-edit-id').value;
    var name = document.getElementById('stamp-edit-name').value.trim();
    var loc  = document.getElementById('stamp-edit-location').value.trim();
    if (!name) { UI.toast('スタンプ名を入力してください'); return; }
    if (!loc)  { UI.toast('場所を入力してください'); return; }

    var data = {
      id:        id || ('s' + Date.now()),
      name:      name,
      location:  loc,
      message:   document.getElementById('stamp-edit-message').value,
      emoji:     document.getElementById('stamp-edit-emoji').value || '⭐',
      code:      document.getElementById('stamp-edit-code').value,
      modelUrl:  document.getElementById('stamp-edit-model').value,
      barcodeId: parseInt(document.getElementById('stamp-edit-barcode').value) || 0,
      mindFile:  document.getElementById('stamp-edit-mind').value,
    };

    var idx = id ? _cfg.stamps.findIndex(function (s) { return s.id === id; }) : -1;
    if (idx >= 0) { _cfg.stamps[idx] = data; } else { _cfg.stamps.push(data); }

    Config.save();
    renderAll();
    UI.hideModal('modal-stamp-edit');
    UI.toast('スタンプを保存しました ✓');
    AR.init(_cfg.stamps, App.onStampDetect);
    UI.updateProgress(_cfg.stamps);
  }

  function deleteStamp(id) {
    if (!confirm('このスタンプを削除しますか？')) return;
    _cfg.stamps = _cfg.stamps.filter(function (s) { return s.id !== id; });
    Config.save();
    renderAll();
    UI.hideModal('modal-stamp-edit');
    UI.toast('スタンプを削除しました');
    AR.init(_cfg.stamps, App.onStampDetect);
    UI.updateProgress(_cfg.stamps);
  }

  // ── Static event bindings ────────────────────────────────────
  function bindStaticEvents() {
    // Tab switch
    document.querySelectorAll('.admin-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('.admin-tab').forEach(function (t) { t.classList.remove('active'); });
        document.querySelectorAll('.admin-tab-pane').forEach(function (p) { p.classList.remove('active'); p.style.display = 'none'; });
        tab.classList.add('active');
        var pane = document.getElementById('tab-' + tab.dataset.tab);
        if (pane) { pane.classList.add('active'); pane.style.display = 'block'; }
      });
    });

    // Add stamp
    var addBtn = document.getElementById('btn-add-stamp');
    if (addBtn) addBtn.addEventListener('click', function () { openStampEdit(null); });

    // Stamp edit modal
    bind('stamp-edit-close',    function () { UI.hideModal('modal-stamp-edit'); });
    bind('stamp-edit-backdrop', function () { UI.hideModal('modal-stamp-edit'); });
    bind('stamp-edit-save',     saveStampEdit);
    bind('stamp-edit-delete',   function () {
      deleteStamp(document.getElementById('stamp-edit-id').value);
    });

    // Mind file upload
    var mindInput = document.getElementById('mind-file-input');
    bind('btn-mind-browse', function () { mindInput && mindInput.click(); });
    if (mindInput) {
      mindInput.addEventListener('change', function (e) {
        var file = e.target.files[0];
        if (!file) return;
        readMindFile(file);
        e.target.value = '';
      });
    }

    // Drop zone
    var dropZone = document.getElementById('mind-upload-area');
    if (dropZone) {
      dropZone.addEventListener('click', function () { mindInput && mindInput.click(); });
      dropZone.addEventListener('dragover', function (e) {
        e.preventDefault(); dropZone.classList.add('drag-active');
      });
      dropZone.addEventListener('dragleave', function () { dropZone.classList.remove('drag-active'); });
      dropZone.addEventListener('drop', function (e) {
        e.preventDefault(); dropZone.classList.remove('drag-active');
        var file = e.dataTransfer.files[0];
        if (file && file.name.endsWith('.mind')) { readMindFile(file); }
        else { UI.toast('.mindファイルのみ対応しています'); }
      });
    }

    // Howto add step
    bind('btn-add-howto-step', function () {
      _cfg.howtoSteps.push({ title: '新しいステップ', desc: '説明を入力してください' });
      renderHowtoEditor();
    });

    // Save texts
    bind('btn-save-texts', function () {
      collectTextEditors();
      Config.save();
      UI.applyConfig(_cfg);
      UI.renderHowtoSteps(_cfg.howtoSteps);
      UI.toast('文言を保存しました ✓');
    });

    // Version update
    bind('btn-update-version', function () {
      var newVer = document.getElementById('admin-version-id').value.trim();
      if (!newVer) { UI.toast('バージョンIDを入力してください'); return; }
      if (!confirm('バージョンを「' + newVer + '」に更新すると参加者の進捗がリセットされます。よろしいですか？')) return;
      _cfg.versionId = newVer;
      Config.save().then(function () {
        return DB.set('versionId', newVer);
      }).then(function () {
        return State.reset();
      }).then(function () {
        UI.updateProgress(_cfg.stamps);
        UI.updateTimer(0);
        var verEl = document.getElementById('admin-current-version');
        if (verEl) verEl.textContent = 'v: ' + newVer;
        UI.toast('バージョンを更新しました ✓');
      });
    });

    // Sheets
    bind('btn-fetch-sheets', function () {
      var url    = document.getElementById('admin-sheets-url').value.trim();
      var status = document.getElementById('sheets-status');
      if (!url) { UI.toast('URLを入力してください'); return; }
      _cfg.sheetsUrl = url;
      if (status) status.textContent = '取得中...';
      Config.fetchFromSheets(url).then(function () {
        Config.save();
        renderAll();
        UI.applyConfig(_cfg);
        UI.updateProgress(_cfg.stamps);
        if (status) status.textContent = '✓ 取得成功';
        UI.toast('スプレッドシートから読み込みました ✓');
      }).catch(function (e) {
        if (status) status.textContent = '✗ 取得失敗: ' + e.message;
        UI.toast('取得に失敗しました');
      });
    });

    // Leaderboard
    bind('btn-view-leaderboard', function () {
      _cfg.leaderboardUrl = document.getElementById('admin-leaderboard-url').value.trim();
      Config.save();
      loadLeaderboard(_cfg);
    });
    bind('lb-close',    function () { UI.hideModal('modal-leaderboard'); });
    bind('lb-backdrop', function () { UI.hideModal('modal-leaderboard'); });

    // Export
    bind('btn-export-json', function () {
      var blob = new Blob([JSON.stringify(_cfg, null, 2)], { type: 'application/json' });
      var a    = document.createElement('a');
      a.href   = URL.createObjectURL(blob);
      a.download = 'stamp-rally-' + _cfg.versionId + '.json';
      a.click();
    });

    // Import
    var importInput = document.getElementById('import-json-input');
    if (importInput) {
      importInput.addEventListener('change', function (e) {
        var file = e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (ev) {
          try {
            var data = JSON.parse(ev.target.result);
            Object.assign(_cfg, data);
            Config.save();
            renderAll();
            UI.applyConfig(_cfg);
            UI.updateProgress(_cfg.stamps);
            AR.init(_cfg.stamps, App.onStampDetect);
            UI.toast('設定をインポートしました ✓');
          } catch (err) {
            UI.toast('JSONの形式が正しくありません');
          }
        };
        reader.readAsText(file);
        e.target.value = '';
      });
    }

    // Reset
    bind('btn-reset-all', function () {
      if (!confirm('この端末のすべてのデータをリセットしますか？')) return;
      State.reset().then(function () {
        UI.updateProgress(_cfg.stamps);
        UI.updateTimer(0);
        UI.toast('リセットしました');
      });
    });
  }

  function readMindFile(file) {
    var reader = new FileReader();
    reader.onload = function (ev) {
      if (!_cfg.mindFiles) _cfg.mindFiles = [];
      _cfg.mindFiles.push({ name: file.name, data: ev.target.result, linkedStampId: '' });
      Config.save();
      renderMindFileList();
      UI.toast('.mindファイルを追加しました ✓');
    };
    reader.readAsDataURL(file);
  }

  function bind(id, fn) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  }

  return { init: init };
}());

/* ============================================================
   11. Leaderboard
   ============================================================ */
function loadLeaderboard(cfg) {
  if (!cfg.leaderboardUrl) { UI.toast('ランキングURLが設定されていません'); return; }
  var list = document.getElementById('lb-list');
  if (list) list.innerHTML = '<div class="lb-empty">読み込み中...</div>';
  UI.showModal('modal-leaderboard');
  fetch(cfg.leaderboardUrl + '?version=' + encodeURIComponent(cfg.versionId))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var medals = ['r1','r2','r3'];
      list.innerHTML = (data.entries && data.entries.length)
        ? data.entries.map(function (e, i) {
            return '<div class="lb-item">' +
              '<div class="lb-rank ' + (medals[i] || '') + '">' + (i + 1) + '</div>' +
              '<div class="lb-name">' + UI.esc(e.name) + '</div>' +
              '<div class="lb-time">' + UI.formatTime(e.time) + '</div>' +
            '</div>';
          }).join('')
        : '<div class="lb-empty">まだ記録がありません</div>';
    })
    .catch(function () {
      if (list) list.innerHTML = '<div class="lb-empty">読み込みに失敗しました</div>';
    });
}

/* ============================================================
   12. App — メインコントローラー
   ============================================================ */
var App = {
  _cfg: null,
  _currentStamp: null,

  onStampDetect: function (stamp) {
    State.acquireStamp(stamp.id).then(function (isNew) {
      if (!isNew) return;
      var cfg = App._cfg;
      App._currentStamp = stamp;
      UI.showStampAcquired(stamp);
      UI.updateProgress(cfg.stamps);

      if (State.getCount() >= cfg.stamps.length) {
        State.stopTimer();
        setTimeout(function () { UI.showComplete(cfg, State.getElapsed()); }, 1200);
      }
    });
  },

  init: function () {
    Config.load().then(function (cfg) {
      App._cfg = cfg;
      return State.load().then(function () { return cfg; });
    }).then(function (cfg) {
      UI.applyConfig(cfg);
      UI.renderStars();
      UI.renderHowtoSteps(cfg.howtoSteps);
      UI.updateProgress(cfg.stamps);
      UI.updateTimer(State.getElapsed());

      AR.init(cfg.stamps, App.onStampDetect);
      Admin.init(cfg);
      App.bindNav();
      App.bindModals();

      UI.showScreen('screen-title');
    }).catch(function (err) {
      console.error('[App] Init failed:', err);
      UI.showScreen('screen-title');
    });
  },

  bindNav: function () {
    var cfg = App._cfg;

    bind('btn-start', function () {
      UI.showScreen('screen-map');
      State.startTimer();
    });

    bind('btn-howto', function () { UI.showModal('modal-howto'); });

    bind('btn-back-to-title', function () {
      AR.destroyScene();
      UI.showScreen('screen-title');
    });

    bind('btn-go-scan', function () {
      UI.showScreen('screen-ar');
      AR.startScene();
    });

    bind('btn-ar-back', function () {
      AR.destroyScene();
      UI.showScreen('screen-map');
    });

    bind('btn-ar-manual', function () {
      var inp = document.getElementById('manual-input');
      var err = document.getElementById('manual-error');
      if (inp) inp.value = '';
      if (err) err.style.display = 'none';
      UI.showModal('modal-manual');
    });

    bind('btn-to-map', function () {
      UI.showScreen('screen-map');
    });

    bind('btn-share', function () {
      if (App._currentStamp) shareStamp(App._currentStamp, cfg);
    });

    bind('btn-complete-share', function () {
      shareComplete(cfg, State.getElapsed());
    });

    bind('btn-complete-restart', function () {
      UI.showScreen('screen-map');
    });

    bind('btn-admin-entry', function () {
      var pw = prompt('管理者パスワードを入力してください（初期: admin）');
      if (pw === (cfg.adminPassword || 'admin')) {
        UI.showScreen('screen-admin');
      } else if (pw !== null) {
        UI.toast('パスワードが違います');
      }
    });

    bind('btn-admin-back', function () {
      UI.showScreen('screen-title');
    });
  },

  bindModals: function () {
    var cfg = App._cfg;

    // Howto
    bind('howto-backdrop', function () { UI.hideModal('modal-howto'); });
    bind('howto-close',    function () { UI.hideModal('modal-howto'); });
    bind('howto-ok',       function () { UI.hideModal('modal-howto'); });

    // Manual input
    bind('manual-backdrop', function () { UI.hideModal('modal-manual'); });
    bind('manual-close',    function () { UI.hideModal('modal-manual'); });
    bind('manual-submit', function () {
      var val   = (document.getElementById('manual-input').value || '').trim();
      var match = cfg.stamps.find(function (s) { return s.code === val; });
      var err   = document.getElementById('manual-error');
      if (match) {
        UI.hideModal('modal-manual');
        App.onStampDetect(match);
      } else {
        if (err) err.style.display = 'block';
      }
    });
    var mi = document.getElementById('manual-input');
    if (mi) {
      mi.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { var s = document.getElementById('manual-submit'); if (s) s.click(); }
      });
    }

    // Stamp list click
    var stampList = document.getElementById('stamp-list');
    if (stampList) {
      stampList.addEventListener('click', function (e) {
        var item = e.target.closest('.stamp-item');
        if (!item) return;
        var id    = item.dataset.id;
        if (State.isAcquired(id)) {
          var stamp = cfg.stamps.find(function (s) { return s.id === id; });
          if (stamp) { App._currentStamp = stamp; UI.showStampAcquired(stamp); }
        }
      });
    }
  },
};

function bind(id, fn) {
  var el = document.getElementById(id);
  if (el) el.addEventListener('click', fn);
}

/* ============================================================
   13. PWA
   ============================================================ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').catch(function (e) {
      console.warn('[SW]', e);
    });
  });
}

/* ============================================================
   BOOT
   ============================================================ */
document.addEventListener('DOMContentLoaded', function () {
  App.init();
});
