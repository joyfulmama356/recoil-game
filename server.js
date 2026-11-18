'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');

// ---- Tuning ---------------------------------------------------------------
const TICK_MS = 1000 / 30;        // 30 Hz simulation
const SNAPSHOT_EVERY = 2;         // broadcast every 2 ticks (~15 Hz)
const ARENA = { w: 1200, h: 800 };
const FRICTION = 0.90;            // velocity retained per tick
const MAX_SPEED = 12;             // px per tick
const WALL_BOUNCE = 0.8;
const PLAYER_RADIUS = 14;
const DASH_IMPULSE = 13;          // px per tick, toward aim
const DASH_COOLDOWN = 3000;       // ms
const INVULN_MS = 500;
const STARTING_HP = 100;
const UPGRADE_INTERVAL = 60000;   // ms
const BOSS_INTERVAL = 300000;     // ms

const WEAPONS = {
  pistol:  { name: 'Pistol',  rate: 4,   damage: 10, recoil: 6,  pellets: 1, spread: 0,    speed: 14, radius: 4, unlock: 0 },
  smg:     { name: 'SMG',     rate: 10,  damage: 5,  recoil: 2.5,pellets: 1, spread: 0.08, speed: 13, radius: 3, unlock: 120000 },
  shotgun: { name: 'Shotgun', rate: 1.2, damage: 8,  recoil: 14, pellets: 5, spread: 0.35, speed: 11, radius: 4, unlock: 240000 },
  sniper:  { name: 'Sniper',  rate: 0.6, damage: 40, recoil: 20, pellets: 1, spread: 0,    speed: 22, radius: 5, unlock: 360000 },
};

const ENEMY_TYPES = {
  crawler: { hp: 20,  speed: 1.6, radius: 11, damage: 8,  unlock: 0,      weight: 10, color: '#7bdff2' },
  runner:  { hp: 10,  speed: 3.2, radius: 9,  damage: 6,  unlock: 60000,  weight: 7,  color: '#ff9f1c' },
  tank:    { hp: 100, speed: 0.9, radius: 22, damage: 18, unlock: 180000, weight: 3,  color: '#6a4c93' },
  spitter: { hp: 30,  speed: 1.2, radius: 12, damage: 10, unlock: 240000, weight: 5,  color: '#8ac926' },
  boss:    { hp: 800, speed: 1.4, radius: 40, damage: 25, unlock: 300000, weight: 0,  color: '#ff2e63' },
};

const UPGRADES = [
  { id: 'recoil',    name: 'Heavy Recoil', desc: '+25% recoil (more mobility)' },
  { id: 'damage',    name: 'Damage Up',    desc: '+25% damage' },
  { id: 'multishot', name: 'Multishot',    desc: '+1 projectile' },
  { id: 'rapid',     name: 'Rapid Fire',   desc: '+20% fire rate' },
  { id: 'piercing',  name: 'Piercing',     desc: 'Bullets pass through +1 enemy' },
  { id: 'bigger',    name: 'Bigger Bullets', desc: '+30% bullet size' },
  { id: 'lifesteal', name: 'Lifesteal',    desc: '+2 HP per kill per stack' },
  { id: 'maxhp',     name: 'Max HP Up',    desc: '+20 max HP and heal 20' },
  { id: 'dash',      name: 'Faster Dash',  desc: '-20% dash cooldown' },
  { id: 'slow',      name: 'Slow Field',   desc: '-10% enemy speed (global)', global: true },
  { id: 'heal',      name: 'Repair',       desc: 'Restore 50% HP' },
];

const COLORS = ['#ff4d6d', '#4dabf7', '#ffd43b', '#69db7c'];
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json',
};

// ---- State ----------------------------------------------------------------
const rooms = new Map();
const sockets = new Map(); // ws -> { roomCode, playerId }
let nextId = 1;
let nextEntityId = 1;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(SCORES_FILE)) fs.writeFileSync(SCORES_FILE, '[]');

function loadScores() {
  try { return JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8')); } catch { return []; }
}
function saveScores(scores) {
  fs.writeFileSync(SCORES_FILE, JSON.stringify(scores.slice(0, 10), null, 2));
}
function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}
function broadcast(room, obj) {
  const msg = JSON.stringify(obj);
  for (const ws of room.clients) if (ws.readyState === 1) ws.send(msg);
}
function r1(n) { return Math.round(n * 10) / 10; }

// ---- Room lifecycle --------------------------------------------------------
function createRoom() {
  const room = {
    code: makeCode(), clients: new Set(), players: new Map(), hostId: null,
    enemies: [], bullets: [], phase: 'waiting', time: 0, tick: 0,
    spawnTimer: 0, nextUpgradeAt: UPGRADE_INTERVAL, nextBossAt: BOSS_INTERVAL,
    upgrades: new Map(), slowStacks: 0, results: [],
  };
  rooms.set(room.code, room);
  return room;
}

function addPlayer(room, ws, name, weaponKey) {
  const id = 'p' + nextId++;
  const idx = room.players.size;
  const p = {
    id, ws, name: String(name || 'Player').slice(0, 16),
    color: COLORS[idx % COLORS.length],
    x: 200 + (idx % 4) * 90, y: ARENA.h / 2,
    vx: 0, vy: 0, angle: 0,
    hp: STARTING_HP, maxHp: STARTING_HP,
    weapon: WEAPONS[weaponKey] ? weaponKey : 'pistol',
    fireCooldown: 0, dashCooldown: 0, invuln: 0,
    kills: 0, damageDealt: 0, alive: true,
    input: { aim: 0, firing: false, dash: false },
    stacks: {},
    picked: false,
  };
  room.players.set(id, p);
  if (!room.hostId) room.hostId = id;
  sockets.set(ws, { roomCode: room.code, playerId: id });
  room.clients.add(ws);

  send(ws, {
    type: 'init', id, hostId: room.hostId, room: room.code, arena: ARENA,
    weapons: Object.fromEntries(Object.entries(WEAPONS).map(([k, v]) => [k, { name: v.name, unlock: v.unlock }])),
    enemies: Object.fromEntries(Object.entries(ENEMY_TYPES).map(([k, v]) => [k, { color: v.color }])),
    leaderboard: loadScores(),
  });

  if (room.phase === 'waiting') broadcastRoster(room);
  return p;
}

function broadcastRoster(room) {
  broadcast(room, {
    type: 'roster', hostId: room.hostId,
    players: [...room.players.values()].map(p => ({ id: p.id, n: p.name, c: p.color })),
  });
}

function resetPlayer(p) {
  p.x = 200 + ([...p.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 4) * 90;
  p.y = ARENA.h / 2;
  p.vx = p.vy = 0; p.angle = 0;
  p.hp = p.maxHp = STARTING_HP;
  p.fireCooldown = p.dashCooldown = p.invuln = 0;
  p.kills = 0; p.damageDealt = 0; p.alive = true; p.picked = false;
  p.stacks = {};
  p.input = { aim: 0, firing: false, dash: false };
}

function resetRoom(room) {
  room.enemies = []; room.bullets = [];
  room.time = 0; room.tick = 0; room.spawnTimer = 0;
  room.nextUpgradeAt = UPGRADE_INTERVAL; room.nextBossAt = BOSS_INTERVAL;
  room.slowStacks = 0; room.results = [];
  room.upgrades.clear();
  room.phase = 'playing';
  for (const p of room.players.values()) resetPlayer(p);
  broadcast(room, { type: 'start' });
}

function removeSocket(ws) {
  const info = sockets.get(ws);
  sockets.delete(ws);
  if (!info) return;
  const room = rooms.get(info.roomCode);
  if (!room) return;
  room.clients.delete(ws);
  const p = room.players.get(info.playerId);
  if (p) {
    p.alive = false;
    room.players.delete(info.playerId);
  }
  if (room.hostId === info.playerId) room.hostId = room.players.keys().next().value || null;
  if (room.phase === 'waiting') broadcastRoster(room);
  if (room.clients.size === 0) rooms.delete(room.code);
}

// ---- Simulation ------------------------------------------------------------
function nearestPlayer(room, x, y) {
  let best = null, bestD = Infinity;
  for (const p of room.players.values()) {
    if (!p.alive) continue;
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function spawnEnemy(room, type, x, y) {
  const def = ENEMY_TYPES[type];
  const hpScale = 1 + room.time / 180000;
  const e = {
    id: 'e' + nextEntityId++, type, x, y, vx: 0, vy: 0,
    hp: def.hp * hpScale, maxHp: def.hp * hpScale, r: def.radius,
    wobble: Math.random() * Math.PI * 2,
    shotCooldown: 1500 + Math.random() * 1500,
    chargeState: 'idle', chargeTimer: 2500, tx: 0, ty: 0,
  };
  room.enemies.push(e);
  return e;
}

function spawnWave(room) {
  const t = room.time;
  const available = Object.entries(ENEMY_TYPES).filter(([k, v]) => v.weight > 0 && t >= v.unlock);
  const total = available.reduce((s, [, v]) => s + v.weight, 0);
  const count = 1 + Math.floor(t / 60000);
  for (let i = 0; i < Math.min(count, 6); i++) {
    let roll = Math.random() * total, chosen = available[0][0];
    for (const [k, v] of available) { roll -= v.weight; if (roll <= 0) { chosen = k; break; } }
    const edge = Math.floor(Math.random() * 4);
    const x = edge === 0 ? 20 : edge === 1 ? ARENA.w - 20 : Math.random() * ARENA.w;
    const y = edge === 2 ? 20 : edge === 3 ? ARENA.h - 20 : Math.random() * ARENA.h;
    spawnEnemy(room, chosen, x, y);
  }
}

function spawnBoss(room) {
  const p = nearestPlayer(room, ARENA.w / 2, ARENA.h / 2);
  const angle = Math.random() * Math.PI * 2;
  const x = ARENA.w / 2 + Math.cos(angle) * 250;
  const y = ARENA.h / 2 + Math.sin(angle) * 250;
  spawnEnemy(room, 'boss', Math.max(60, Math.min(ARENA.w - 60, x)), Math.max(60, Math.min(ARENA.h - 60, y)));
  broadcast(room, { type: 'notice', text: 'BOSS INCOMING' });
  if (p) { /* boss finds nearest player on its own */ }
}

function playerStats(p) {
  const w = WEAPONS[p.weapon];
  const s = p.stacks;
  return {
    rate: w.rate * (1 + 0.20 * (s.rapid || 0)),
    damage: w.damage * (1 + 0.25 * (s.damage || 0)),
    recoil: w.recoil * (1 + 0.25 * (s.recoil || 0)),
    pellets: w.pellets + (s.multishot || 0),
    spread: w.spread,
    speed: w.speed,
    radius: w.radius * (1 + 0.30 * (s.bigger || 0)),
    pierce: s.piercing || 0,
    dashCooldown: DASH_COOLDOWN * Math.pow(0.8, s.dash || 0),
  };
}

function fire(room, p, stats) {
  const spread = stats.spread;
  for (let i = 0; i < stats.pellets; i++) {
    const offset = stats.pellets === 1 ? 0 : (i - (stats.pellets - 1) / 2) * (spread || 0.18);
    const a = p.angle + offset + (Math.random() - 0.5) * spread * 0.5;
    room.bullets.push({
      id: 'b' + nextEntityId++, x: p.x + Math.cos(a) * (PLAYER_RADIUS + 4), y: p.y + Math.sin(a) * (PLAYER_RADIUS + 4),
      vx: Math.cos(a) * stats.speed, vy: Math.sin(a) * stats.speed,
      r: stats.radius, dmg: stats.damage, pierce: stats.pierce,
      hostile: false, owner: p.id, life: 75,
    });
  }
  p.vx -= Math.cos(p.angle) * stats.recoil;
  p.vy -= Math.sin(p.angle) * stats.recoil;
}

function updatePlayer(room, p, dt) {
  p.angle = p.input.aim;
  if (p.invuln > 0) p.invuln -= dt;
  if (p.fireCooldown > 0) p.fireCooldown -= dt;
  if (p.dashCooldown > 0) p.dashCooldown -= dt;

  if (p.input.dash && p.dashCooldown <= 0) {
    p.vx += Math.cos(p.angle) * DASH_IMPULSE;
    p.vy += Math.sin(p.angle) * DASH_IMPULSE;
    p.dashCooldown = playerStats(p).dashCooldown;
  }
  p.input.dash = false;

  const stats = playerStats(p);
  if (p.input.firing && p.fireCooldown <= 0) {
    fire(room, p, stats);
    p.fireCooldown = 1000 / stats.rate;
  }

  p.x += p.vx; p.y += p.vy;
  p.vx *= FRICTION; p.vy *= FRICTION;
  const sp = Math.hypot(p.vx, p.vy);
  if (sp > MAX_SPEED) { p.vx = p.vx / sp * MAX_SPEED; p.vy = p.vy / sp * MAX_SPEED; }

  if (p.x < PLAYER_RADIUS) { p.x = PLAYER_RADIUS; p.vx = Math.abs(p.vx) * WALL_BOUNCE; }
  if (p.x > ARENA.w - PLAYER_RADIUS) { p.x = ARENA.w - PLAYER_RADIUS; p.vx = -Math.abs(p.vx) * WALL_BOUNCE; }
  if (p.y < PLAYER_RADIUS) { p.y = PLAYER_RADIUS; p.vy = Math.abs(p.vy) * WALL_BOUNCE; }
  if (p.y > ARENA.h - PLAYER_RADIUS) { p.y = ARENA.h - PLAYER_RADIUS; p.vy = -Math.abs(p.vy) * WALL_BOUNCE; }
}

function updateEnemy(room, e, dt, alive) {
  const target = nearestPlayer(room, e.x, e.y);
  if (!target) return;
  const def = ENEMY_TYPES[e.type];
  let speed = def.speed * Math.pow(0.9, room.slowStacks);
  const dx = target.x - e.x, dy = target.y - e.y;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = dx / dist, ny = dy / dist;

  if (e.type === 'spitter') {
    e.shotCooldown -= dt;
    if (dist > 200) { e.x += nx * speed; e.y += ny * speed; }
    else if (dist < 130) { e.x -= nx * speed; e.y -= ny * speed; }
    else { e.wobble += 0.05; e.x += -ny * speed * 0.5 * Math.cos(e.wobble); e.y += nx * speed * 0.5 * Math.cos(e.wobble); }
    if (e.shotCooldown <= 0) {
      e.shotCooldown = 2000;
      const a = Math.atan2(dy, dx);
      room.bullets.push({
        id: 'b' + nextEntityId++, x: e.x + nx * (e.r + 4), y: e.y + ny * (e.r + 4),
        vx: Math.cos(a) * 7, vy: Math.sin(a) * 7, r: 5, dmg: 10,
        pierce: 0, hostile: true, owner: e.id, life: 160,
      });
    }
  } else if (e.type === 'boss') {
    e.chargeTimer -= dt;
    if (e.chargeState === 'idle') {
      e.x += nx * speed * 0.7; e.y += ny * speed * 0.7;
      e.shotCooldown -= dt;
      if (e.shotCooldown <= 0) {
        e.shotCooldown = 3000;
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2 + Math.random() * 0.1;
          room.bullets.push({
            id: 'b' + nextEntityId++, x: e.x, y: e.y,
            vx: Math.cos(a) * 5, vy: Math.sin(a) * 5, r: 6, dmg: 12,
            pierce: 0, hostile: true, owner: e.id, life: 180,
          });
        }
      }
      if (e.chargeTimer <= 0) {
        e.chargeState = 'telegraph'; e.chargeTimer = 800;
        e.tx = target.x; e.ty = target.y;
      }
    } else if (e.chargeState === 'telegraph') {
      if (e.chargeTimer <= 0) {
        e.chargeState = 'charge'; e.chargeTimer = 600;
        const a = Math.atan2(e.ty - e.y, e.tx - e.x);
        e.vx = Math.cos(a) * 9; e.vy = Math.sin(a) * 9;
      }
    } else {
      e.x += e.vx; e.y += e.vy;
      if (e.chargeTimer <= 0) { e.chargeState = 'idle'; e.chargeTimer = 3500; e.vx = e.vy = 0; }
    }
  } else {
    e.wobble += 0.1;
    const wob = e.type === 'runner' ? Math.cos(e.wobble) * 0.5 : 0;
    e.x += (nx - ny * wob) * speed;
    e.y += (ny + nx * wob) * speed;
  }

  e.x = Math.max(e.r, Math.min(ARENA.w - e.r, e.x));
  e.y = Math.max(e.r, Math.min(ARENA.h - e.r, e.y));
}

function damagePlayer(room, p, amount) {
  if (p.invuln > 0 || !p.alive) return;
  p.hp -= amount;
  p.invuln = INVULN_MS;
  if (p.hp <= 0) { p.hp = 0; p.alive = false; }
}

function resolveCollisions(room) {
  const deadEnemies = new Set();
  const deadBullets = new Set();

  for (const b of room.bullets) {
    if (b.hostile) {
      for (const p of room.players.values()) {
        if (!p.alive) continue;
        if (Math.hypot(p.x - b.x, p.y - b.y) < PLAYER_RADIUS + b.r) {
          damagePlayer(room, p, b.dmg);
          deadBullets.add(b.id);
          break;
        }
      }
    } else {
      for (const e of room.enemies) {
        if (deadEnemies.has(e.id)) continue;
        if (Math.hypot(e.x - b.x, e.y - b.y) < e.r + b.r) {
          e.hp -= b.dmg;
          const owner = room.players.get(b.owner);
          if (owner) owner.damageDealt += b.dmg;
          if (e.hp <= 0) {
            deadEnemies.add(e.id);
            if (owner) {
              owner.kills++;
              const heal = (owner.stacks.lifesteal || 0) * 2;
              if (heal) owner.hp = Math.min(owner.maxHp, owner.hp + heal);
            }
          }
          if (b.pierce > 0) b.pierce--;
          else { deadBullets.add(b.id); break; }
        }
      }
    }
  }

  for (const e of room.enemies) {
    if (deadEnemies.has(e.id)) continue;
    for (const p of room.players.values()) {
      if (!p.alive) continue;
      const dx = p.x - e.x, dy = p.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < e.r + PLAYER_RADIUS) {
        damagePlayer(room, p, ENEMY_TYPES[e.type].damage);
        const push = (e.r + PLAYER_RADIUS - d) * 0.5;
        p.x += (dx / d) * push; p.y += (dy / d) * push;
        e.x -= (dx / d) * push; e.y -= (dy / d) * push;
      }
    }
  }

  room.enemies = room.enemies.filter(e => !deadEnemies.has(e.id));
  room.bullets = room.bullets.filter(b => !deadBullets.has(b.id) && --b.life > 0);
}

function startUpgrade(room) {
  room.phase = 'upgrade';
  for (const p of room.players.values()) p.picked = false;
  const pool = UPGRADES.map(u => u.id);
  for (const p of room.players.values()) {
    if (!p.alive) continue;
    const opts = [];
    while (opts.length < 3 && pool.length) {
      const i = Math.floor(Math.random() * pool.length);
      opts.push(pool.splice(i, 1)[0]);
      if (opts.length === 3) break;
    }
    room.upgrades.set(p.id, opts);
    send(p.ws, { type: 'upgrade', options: opts.map(id => UPGRADES.find(u => u.id === id)) });
  }
  broadcast(room, { type: 'phase', phase: 'upgrade' });
}

function applyUpgrade(room, p, id) {
  if (id === 'heal') p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.5);
  else if (id === 'maxhp') { p.maxHp += 20; p.hp = Math.min(p.maxHp, p.hp + 20); }
  else if (id === 'slow') room.slowStacks++;
  else p.stacks[id] = (p.stacks[id] || 0) + 1;
}

function endRound(room) {
  room.phase = 'gameover';
  room.results = [...room.players.values()]
    .map(p => ({ name: p.name, kills: p.kills, damage: Math.round(p.damageDealt) }))
    .sort((a, b) => b.kills - a.kills);
  const scores = loadScores();
  for (const r of room.results) scores.push({ name: r.name, time: Math.round(room.time / 1000), kills: r.kills, date: Date.now() });
  scores.sort((a, b) => b.time - a.time || b.kills - a.kills);
  saveScores(scores);
  broadcast(room, { type: 'gameover', time: Math.round(room.time / 1000), results: room.results, leaderboard: scores.slice(0, 10) });
}

function tickRoom(room) {
  if (room.phase !== 'playing') return;
  const dt = TICK_MS;
  room.tick++;
  room.time += dt;

  const alive = [...room.players.values()].filter(p => p.alive);
  if (!alive.length) { endRound(room); return; }

  room.spawnTimer += dt;
  const interval = Math.max(280, 1300 - room.time * 1.6);
  while (room.spawnTimer >= interval) { room.spawnTimer -= interval; spawnWave(room); }

  if (room.time >= room.nextBossAt) { spawnBoss(room); room.nextBossAt += BOSS_INTERVAL; }

  for (const p of alive) updatePlayer(room, p, dt);
  for (const e of room.enemies) updateEnemy(room, e, dt, alive);

  for (const b of room.bullets) { b.x += b.vx; b.y += b.vy; }
  resolveCollisions(room);

  if (room.time >= room.nextUpgradeAt) {
    startUpgrade(room);
    room.nextUpgradeAt += UPGRADE_INTERVAL;
  }

  if (room.tick % SNAPSHOT_EVERY === 0) {
    broadcast(room, {
      type: 'state',
      phase: room.phase,
      time: Math.round(room.time / 100),
      players: [...room.players.values()].map(p => ({
        id: p.id, n: p.name, c: p.color, x: r1(p.x), y: r1(p.y), a: r1(p.angle),
        hp: Math.round(p.hp), mh: p.maxHp, w: p.weapon, al: p.alive,
        k: p.kills, d: Math.round(p.dashCooldown),
        st: p.stacks,
      })),
      enemies: room.enemies.map(e => ({ id: e.id, t: e.type, x: r1(e.x), y: r1(e.y), h: Math.round(e.hp), m: Math.round(e.maxHp), cs: e.chargeState })),
      bullets: room.bullets.map(b => ({ id: b.id, x: r1(b.x), y: r1(b.y), r: b.r, h: b.hostile ? 1 : 0, c: b.hostile ? '#ff6b6b' : '#ffe066' })),
    });
  }
}

// ---- HTTP + WebSocket ------------------------------------------------------
const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const info = sockets.get(ws);

    if (msg.type === 'create') {
      const room = createRoom();
      addPlayer(room, ws, msg.name, msg.weapon);
      return;
    }
    if (msg.type === 'join') {
      const room = rooms.get(String(msg.room || '').toUpperCase());
      if (!room) { send(ws, { type: 'error', text: 'Room not found' }); return; }
      if (room.players.size >= 4) { send(ws, { type: 'error', text: 'Room full' }); return; }
      if (room.phase !== 'waiting') { send(ws, { type: 'error', text: 'Game already in progress' }); return; }
      addPlayer(room, ws, msg.name, msg.weapon);
      return;
    }
    if (!info) return;
    const room = rooms.get(info.roomCode);
    if (!room) return;
    const p = room.players.get(info.playerId);
    if (!p) return;

    if (msg.type === 'start') {
      if (room.phase === 'waiting' && p.id === room.hostId) resetRoom(room);
    } else if (msg.type === 'input') {
      p.input.aim = Number(msg.aim) || 0;
      p.input.firing = !!msg.firing;
      if (msg.dash) p.input.dash = true;
    } else if (msg.type === 'pick' && room.phase === 'upgrade') {
      if (p.picked || !p.alive) return;
      const options = room.upgrades.get(p.id) || [];
      if (!options.includes(msg.id)) return;
      applyUpgrade(room, p, msg.id);
      p.picked = true;
      const allDone = [...room.players.values()].filter(x => x.alive).every(x => x.picked);
      if (allDone) {
        room.phase = 'playing';
        room.upgrades.clear();
        broadcast(room, { type: 'phase', phase: 'playing' });
      }
    } else if (msg.type === 'replay') {
      if (room.phase === 'gameover') resetRoom(room);
    }
  });

  ws.on('close', () => removeSocket(ws));
});

let last = Date.now(), acc = 0;
setInterval(() => {
  const now = Date.now();
  acc += Math.min(now - last, 250);
  last = now;
  while (acc >= TICK_MS) {
    for (const room of rooms.values()) tickRoom(room);
    acc -= TICK_MS;
  }
}, TICK_MS);

server.listen(PORT, () => console.log(`RECOIL running at http://localhost:${PORT}`));
