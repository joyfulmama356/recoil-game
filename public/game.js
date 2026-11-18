'use strict';

// ---------------------------------------------------------------------------
// ART HOOK — drop files into public/assets/ and they replace the placeholders
// automatically. See public/assets/README.md for the exact asset brief.
// ---------------------------------------------------------------------------
// Each key tries PNG first (so DeepSeek art overrides automatically), then SVG.
const ASSETS = {
  player:          ['assets/player.png', 'assets/player.svg'],
  'enemy-crawler': ['assets/enemy-crawler.png', 'assets/enemy-crawler.svg'],
  'enemy-runner':  ['assets/enemy-runner.png', 'assets/enemy-runner.svg'],
  'enemy-tank':    ['assets/enemy-tank.png', 'assets/enemy-tank.svg'],
  'enemy-spitter': ['assets/enemy-spitter.png', 'assets/enemy-spitter.svg'],
  'enemy-boss':    ['assets/enemy-boss.png', 'assets/enemy-boss.svg'],
  bullet:          ['assets/bullet.png', 'assets/bullet.svg'],
  'bullet-hostile':['assets/bullet-hostile.png', 'assets/bullet-hostile.svg'],
  'bg-tile':       ['assets/bg-tile.png', 'assets/bg-tile.svg'],
};
const images = {};
for (const [key, files] of Object.entries(ASSETS)) {
  const img = new Image();
  let i = 0;
  img.onload = () => { images[key] = img; };
  img.onerror = () => { i++; if (i < files.length) img.src = files[i]; else images[key] = null; };
  img.src = files[0];
}
function hasArt(key) { const i = images[key]; return i && i.complete && i.naturalWidth > 0; }
function sprite(key, x, y, size, angle, fallback) {
  if (hasArt(key)) {
    ctx.save();
    ctx.translate(x, y);
    if (angle) ctx.rotate(angle);
    ctx.drawImage(images[key], -size / 2, -size / 2, size, size);
    ctx.restore();
  } else {
    fallback();
  }
}

// ---- DOM / canvas ----------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = id => document.getElementById(id);
const el = {
  menu: $('menu'), waiting: $('waiting'), upgrade: $('upgrade'), gameover: $('gameover'),
  notice: $('notice'), time: $('hud-time'), kills: $('hud-kills'), room: $('hud-room'),
  players: $('hud-players'), hpFill: $('hp-fill'), weapon: $('hud-weapon'), dash: $('hud-dash'),
  modeVal: $('hud-mode-val'), modePve: $('mode-pve'), modePvp: $('mode-pvp'),
  error: $('menu-error'), waitingCode: $('waiting-code'), cards: $('upgrade-cards'),
  waitingPlayers: $('waiting-players'), startBtn: $('start-btn'), waitingHint: $('waiting-hint'),
  finalTime: $('final-time'), finalStats: $('final-stats'), leaderboard: $('leaderboard'),
};

let ws = null;
let myId = null;
let hostId = null;
let roomCode = null;
let arena = { w: 1200, h: 800 };
let weaponDefs = {};
let enemyDefs = {};
let previous = null, current = null, prevAt = 0, curAt = 0;
let phase = 'menu';
let selectedMode = 'pve';
let mode = 'pve';
let pvpLeaderboard = [];
let upgradeOptions = [];
let mouse = { x: arena.w / 2, y: arena.h / 2, down: false };
let keys = {};
let particles = [];
let shake = 0;

// ---- Persistence -----------------------------------------------------------
function bestTime() { return Number(localStorage.getItem('recoil_best') || 0); }
function refreshWeaponOptions() {
  const best = bestTime();
  for (const opt of $('weapon-select').options) {
    if (!opt.value) continue;
    const unlock = opt.value === 'smg' ? 120 : opt.value === 'shotgun' ? 240 : opt.value === 'sniper' ? 360 : 0;
    opt.disabled = selectedMode !== 'pvp' && best < unlock;
    opt.textContent = `${opt.textContent.split(' — ')[0]} — ${selectedMode === 'pvp' ? 'all unlocked' : unlock ? 'unlock at ' + fmt(unlock) : 'balanced'}`;
  }
}
function fmt(sec) { return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }

// ---- Network ---------------------------------------------------------------
function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);
  ws.onopen = () => { el.error.textContent = ''; };
  ws.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    handle(m);
  };
  ws.onclose = () => {
    if (phase !== 'menu') showError('Disconnected — reload to rejoin.');
  };
}
function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function showError(text) { el.error.textContent = text; }

function handle(m) {
  switch (m.type) {
    case 'init':
      myId = m.id; hostId = m.hostId; roomCode = m.room; arena = m.arena;
      mode = m.mode || 'pve'; pvpLeaderboard = m.pvpLeaderboard || [];
      weaponDefs = m.weapons || {}; enemyDefs = m.enemies || {};
      canvas.width = arena.w; canvas.height = arena.h;
      el.room.textContent = roomCode;
      el.waitingCode.textContent = roomCode;
      el.modeVal.textContent = mode === 'pvp' ? 'PvP · FIRST TO 5' : 'CO-OP';
      el.waitingHint.textContent = mode === 'pvp'
        ? 'PvP: first to 5 kills wins. Waiting for the host to start…'
        : 'Waiting for the host to start…';
      renderLeaderboard(mode === 'pvp' ? pvpLeaderboard : (m.leaderboard || []));
      show(el.waiting);
      phase = 'waiting';
      break;
    case 'roster':
      hostId = m.hostId;
      if (phase === 'waiting') {
        el.waitingPlayers.innerHTML = m.players.map(p =>
          `<div class="lb-row"><span style="color:${p.c}">${p.n}${p.id === hostId ? ' (host)' : ''}</span><span>ready</span></div>`
        ).join('');
        const isHost = myId === hostId;
        el.startBtn.classList.toggle('hidden', !isHost);
        el.waitingHint.classList.toggle('hidden', isHost);
      }
      break;
    case 'start':
      mode = m.mode || mode;
      el.modeVal.textContent = mode === 'pvp' ? 'PvP · FIRST TO 5' : 'CO-OP';
      hide(el.waiting); hide(el.menu); hide(el.gameover); hide(el.upgrade);
      phase = 'playing';
      break;
    case 'state':
      prevAt = curAt || performance.now();
      curAt = performance.now();
      previous = current;
      current = m;
      break;
    case 'phase':
      phase = m.phase;
      if (phase === 'playing') hide(el.upgrade);
      break;
    case 'upgrade':
      upgradeOptions = m.options;
      showUpgrade(m.options);
      phase = 'upgrade';
      break;
    case 'notice':
      el.notice.textContent = m.text;
      el.notice.classList.add('show');
      setTimeout(() => el.notice.classList.remove('show'), 1800);
      shake = 12;
      break;
    case 'gameover': {
      phase = 'gameover';
      const pvp = (m.mode || mode) === 'pvp';
      if (!pvp) {
        if (m.time > bestTime()) localStorage.setItem('recoil_best', String(m.time));
        refreshWeaponOptions();
      }
      document.querySelector('#gameover h2').innerHTML = pvp
        ? `MATCH OVER · WINNER <span id="final-time">${m.winner || '—'}</span>`
        : `SURVIVED <span id="final-time">${fmt(m.time)}</span>`;
      el.finalTime = $('final-time');
      const me = m.results.find(r => r.name === ($('name-input').value || 'Player'));
      el.finalStats.innerHTML = m.results.map(r => pvp
        ? `<div>${r.name}: ${r.kills} K / ${r.deaths} D</div>`
        : `<div>${r.name}: ${r.kills} kills / ${r.damage} dmg</div>`).join('');
      renderLeaderboard(m.leaderboard || [], me, pvp);
      show(el.gameover);
      break;
    }
    case 'error':
      showError(m.text);
      break;
  }
}

function show(node) { node.classList.remove('hidden'); }
function hide(node) { node.classList.add('hidden'); }

function renderLeaderboard(list, me, pvp) {
  el.leaderboard.innerHTML = list.map((r, i) =>
    `<div class="lb-row ${me && r.name === me.name ? 'me' : ''}"><span>${i + 1}. ${r.name}</span><span>${pvp ? `${r.kills} K / ${r.deaths} D` : `${fmt(r.time)} · ${r.kills} kills`}</span></div>`
  ).join('') || '<div class="lb-row">No scores yet</div>';
}

function showUpgrade(options) {
  el.cards.innerHTML = options.map((o, i) =>
    `<div class="card" data-id="${o.id}"><div class="num">[${i + 1}]</div><div class="name">${o.name}</div><div class="desc">${o.desc}</div></div>`
  ).join('');
  el.cards.querySelectorAll('.card').forEach(c => c.onclick = () => pick(c.dataset.id));
  show(el.upgrade);
}
function pick(id) {
  if (phase !== 'upgrade') return;
  send({ type: 'pick', id });
  hide(el.upgrade);
  phase = 'waiting-pick';
}

// ---- Input -----------------------------------------------------------------
canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - r.left) * (canvas.width / r.width);
  mouse.y = (e.clientY - r.top) * (canvas.height / r.height);
});
canvas.addEventListener('mousedown', e => { if (e.button === 0) mouse.down = true; });
window.addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
  if (phase === 'upgrade') {
    const n = { Digit1: 0, Digit2: 1, Digit3: 2 }[e.code];
    if (n !== undefined && upgradeOptions[n]) pick(upgradeOptions[n].id);
  }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

setInterval(() => {
  if (!ws || ws.readyState !== 1 || !myId) return;
  const me = current && current.players && current.players.find(p => p.id === myId);
  const px = me ? me.x : arena.w / 2;
  const py = me ? me.y : arena.h / 2;
  const aim = Math.atan2(mouse.y - py, mouse.x - px);
  send({ type: 'input', aim, firing: mouse.down && phase === 'playing', dash: !!keys.Space });
  keys.Space = false;
}, 1000 / 30);

// ---- Menu buttons ----------------------------------------------------------
function setMode(m) {
  selectedMode = m;
  el.modePve.classList.toggle('active', m === 'pve');
  el.modePvp.classList.toggle('active', m === 'pvp');
  refreshWeaponOptions();
}
el.modePve.onclick = () => setMode('pve');
el.modePvp.onclick = () => setMode('pvp');

$('create-btn').onclick = () => {
  const name = $('name-input').value.trim() || 'Player';
  send({ type: 'create', name, weapon: $('weapon-select').value, mode: selectedMode });
};
$('join-btn').onclick = () => {
  const room = $('room-input').value.trim().toUpperCase();
  if (room.length !== 4) { showError('Enter a 4-letter room code.'); return; }
  send({ type: 'join', room, name: $('name-input').value.trim() || 'Player', weapon: $('weapon-select').value });
};
$('again-btn').onclick = () => { hide(el.gameover); send({ type: 'replay' }); };
el.startBtn.onclick = () => { send({ type: 'start' }); };

// ---- Interpolation helpers -------------------------------------------------
function lerp(a, b, t) { return a + (b - a) * t; }
function alpha() {
  if (!previous || !current || !prevAt || !curAt || curAt <= prevAt) return 1;
  return Math.max(0, Math.min(1, (performance.now() - curAt) / (curAt - prevAt)));
}
function lerpEntity(list, key) {
  const a = previous ? previous[key] : list;
  const out = [];
  const map = new Map((a || []).map(x => [x.id, x]));
  for (const item of list) {
    const old = map.get(item.id);
    if (old) out.push({ ...item, x: lerp(old.x, item.x, alpha()), y: lerp(old.y, item.y, alpha()) });
    else out.push(item);
  }
  return out;
}

// ---- Rendering -------------------------------------------------------------
function drawBackground() {
  ctx.fillStyle = '#0d1220';
  ctx.fillRect(0, 0, arena.w, arena.h);
  const tile = hasArt('bg-tile') ? images['bg-tile'] : null;
  const step = 60;
  if (tile) {
    for (let x = 0; x < arena.w; x += 64) for (let y = 0; y < arena.h; y += 64) ctx.drawImage(tile, x, y, 64, 64);
  } else {
    ctx.strokeStyle = '#ffffff08';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= arena.w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, arena.h); }
    for (let y = 0; y <= arena.h; y += step) { ctx.moveTo(0, y); ctx.lineTo(arena.w, y); }
    ctx.stroke();
  }
  ctx.strokeStyle = '#ff4d6d55';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, arena.w - 4, arena.h - 4);
}

function drawPlayer(p) {
  const size = 34;
  const dead = !p.al;
  ctx.save();
  ctx.globalAlpha = dead ? 0.25 : 1;
  if (!dead) {
    // aim guide
    ctx.strokeStyle = p.c + '40';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + Math.cos(p.a) * 70, p.y + Math.sin(p.a) * 70);
    ctx.stroke();
  }
  sprite('player', p.x, p.y, size, p.a + Math.PI / 2, () => {
    ctx.fillStyle = p.c;
    ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#080b14'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#e8eef7';
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
    ctx.fillRect(6, -3, 18, 6);
    ctx.restore();
  });
  if (p.id === myId) {
    ctx.strokeStyle = '#ffffffaa'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, 20, 0, Math.PI * 2); ctx.stroke();
  }
  // name + hp
  ctx.font = '11px system-ui'; ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffffcc'; ctx.fillText(p.n, p.x, p.y - 24);
  ctx.fillStyle = '#0008'; ctx.fillRect(p.x - 18, p.y + 18, 36, 4);
  ctx.fillStyle = '#69db7c'; ctx.fillRect(p.x - 18, p.y + 18, 36 * (p.hp / p.mh), 4);
  ctx.restore();
}

function drawEnemy(e) {
  const key = 'enemy-' + e.t;
  const def = enemyDefs[e.t] || {};
  const size = e.t === 'boss' ? 88 : e.t === 'tank' ? 48 : e.t === 'runner' ? 24 : 30;
  const color = def.color || '#7bdff2';
  if (e.cs === 'telegraph') {
    ctx.strokeStyle = '#ff2e63aa'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(e.x, e.y, size / 2 + 10, 0, Math.PI * 2); ctx.stroke();
  }
  sprite(key, e.x, e.y, size, 0, () => {
    ctx.fillStyle = e.cs === 'telegraph' ? '#ffffff' : color;
    ctx.beginPath();
    if (e.t === 'runner') {
      ctx.moveTo(e.x, e.y - size / 2); ctx.lineTo(e.x + size / 2, e.y + size / 2); ctx.lineTo(e.x - size / 2, e.y + size / 2);
    } else if (e.t === 'tank') {
      ctx.rect(e.x - size / 2, e.y - size / 2, size, size);
    } else if (e.t === 'spitter') {
      ctx.moveTo(e.x, e.y - size / 2); ctx.lineTo(e.x + size / 2, e.y); ctx.lineTo(e.x, e.y + size / 2); ctx.lineTo(e.x - size / 2, e.y);
    } else {
      ctx.arc(e.x, e.y, size / 2, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.strokeStyle = '#080b14'; ctx.lineWidth = 2; ctx.stroke();
  });
  if (e.h < e.m) {
    const w = e.t === 'boss' ? 80 : 28;
    ctx.fillStyle = '#0008'; ctx.fillRect(e.x - w / 2, e.y - size / 2 - 10, w, 4);
    ctx.fillStyle = '#ff4d6d'; ctx.fillRect(e.x - w / 2, e.y - size / 2 - 10, w * (e.h / e.m), 4);
  }
}

function drawBullet(b) {
  const key = b.h ? 'bullet-hostile' : 'bullet';
  sprite(key, b.x, b.y, b.r * 3, (b.a || 0) + Math.PI / 2, () => {
    ctx.fillStyle = b.c;
    ctx.shadowColor = b.c; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  });
}

function updateHUD() {
  if (!current) return;
  const me = current.players.find(p => p.id === myId);
  el.time.textContent = mode === 'pvp'
    ? fmt(Math.max(0, 180 - (current.time || 0) / 100))
    : fmt(current.time || 0);
  if (me) {
    el.kills.textContent = mode === 'pvp' ? `${me.k}/${me.dth || 0}` : me.k;
    el.hpFill.style.width = `${100 * me.hp / me.mh}%`;
    el.weapon.textContent = (weaponDefs[me.w] || { name: me.w }).name.toUpperCase();
    el.dash.textContent = me.d > 0 ? `DASH ${(me.d / 1000).toFixed(1)}s` : 'DASH READY';
    el.dash.classList.toggle('cooling', me.d > 0);
  }
  el.players.innerHTML = current.players.map(p =>
    `<span class="pchip ${p.al ? '' : 'dead'}" style="color:${p.c}">${p.n} ${mode === 'pvp' ? `${p.k}/${p.dth || 0}` : p.k}</span>`
  ).join('');
  if (phase === 'waiting') {
    el.waitingPlayers.innerHTML = current.players.map(p =>
      `<div class="lb-row"><span>${p.n}${p.id === hostId ? ' (host)' : ''}</span><span>ready</span></div>`
    ).join('');
    const isHost = myId === hostId;
    el.startBtn.classList.toggle('hidden', !isHost);
    el.waitingHint.classList.toggle('hidden', isHost);
  }
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (shake > 0) {
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    shake *= 0.9;
    if (shake < 0.5) shake = 0;
  }
  drawBackground();
  if (current) {
    const enemies = lerpEntity(current.enemies || [], 'enemies');
    const bullets = lerpEntity(current.bullets || [], 'bullets');
    const players = lerpEntity(current.players || [], 'players');
    for (const b of bullets) drawBullet(b);
    for (const e of enemies) drawEnemy(e);
    for (const p of players) drawPlayer(p);
    updateHUD();
  }
  requestAnimationFrame(render);
}

refreshWeaponOptions();
connect();
render();
