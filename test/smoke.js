'use strict';

// Automated end-to-end checks for RECOIL. Run with: npm test
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const assert = require('assert');
const WebSocket = require('ws');

const PORT = 3199;
const ROOT = path.join(__dirname, '..');
const TMP = path.join(__dirname, 'tmp');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    UPGRADE_INTERVAL: '1500',
    BOSS_INTERVAL: '2500',
    PVP_KILL_LIMIT: '2',
    PVP_TIME_LIMIT: '15000',
    SCORES_FILE: path.join(TMP, 'scores.json'),
    PVP_SCORES_FILE: path.join(TMP, 'pvp-scores.json'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLog = '';
server.stdout.on('data', d => { serverLog += d.toString(); });
server.stderr.on('data', d => { serverLog += d.toString(); });

class Client {
  constructor() {
    this.ws = new WebSocket(`ws://localhost:${PORT}`);
    this.msgs = [];
    this.handlers = new Set();
    this.ws.on('message', raw => {
      const m = JSON.parse(raw);
      this.msgs.push(m);
      for (const h of [...this.handlers]) h(m);
    });
  }
  ready() { return new Promise(res => this.ws.on('open', res)); }
  send(o) { this.ws.send(JSON.stringify(o)); }
  on(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
  async waitFor(pred, timeout = 6000, label = 'message') {
    const hit = this.msgs.find(pred);
    if (hit) return hit;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.handlers.delete(fn); reject(new Error(`timeout waiting for ${label}`)); }, timeout);
      const fn = m => {
        if (pred(m)) { clearTimeout(timer); this.handlers.delete(fn); resolve(m); }
      };
      this.handlers.add(fn);
    });
  }
  latest(pred = () => true) {
    for (let i = this.msgs.length - 1; i >= 0; i--) if (pred(this.msgs[i])) return this.msgs[i];
    return null;
  }
  close() { this.ws.close(); }
}

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => resolve({ code: res.statusCode, type: res.headers['content-type'], body }));
    }).on('error', reject);
  });
}

async function main() {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 5000);
    server.stdout.on('data', d => {
      if (d.toString().includes('running')) { clearTimeout(timer); resolve(); }
    });
  });

  const results = [];
  const check = (name, fn) => fn().then(() => { results.push([name, true]); console.log(`PASS  ${name}`); })
                                .catch(e => { results.push([name, false]); console.log(`FAIL  ${name}: ${e.message}`); });

  // ---- Static assets ------------------------------------------------------
  await check('assets served as SVG', async () => {
    const files = ['player', 'enemy-crawler', 'enemy-runner', 'enemy-tank',
                   'enemy-spitter', 'enemy-boss', 'bullet', 'bullet-hostile', 'bg-tile'];
    for (const f of files) {
      const r = await get(`http://localhost:${PORT}/assets/${f}.svg`);
      assert.strictEqual(r.code, 200, `${f}.svg status`);
      assert.ok(r.type.includes('image/svg+xml'), `${f}.svg content-type`);
      assert.ok(r.body.includes('<svg'), `${f}.svg body`);
    }
  });

  await check('join errors: unknown room, full room, in-progress', async () => {
    const x = new Client(); await x.ready();
    x.send({ type: 'join', room: 'ZZZZ', name: 'X', weapon: 'pistol' });
    const bad = await x.waitFor(m => m.type === 'error', 2000, 'unknown room error');
    assert.match(bad.text, /not found/i);
    x.send({ type: 'create', name: 'X', weapon: 'pistol', mode: 'pve' });
    const init = await x.waitFor(m => m.type === 'init', 2000, 'init');
    const extras = [];
    for (const n of ['A', 'B', 'C']) {
      const e = new Client(); await e.ready();
      e.send({ type: 'join', room: init.room, name: n, weapon: 'pistol' });
      await e.waitFor(m => m.type === 'init', 2000, 'join init');
      extras.push(e);
    }
    const fifth = new Client(); await fifth.ready();
    fifth.send({ type: 'join', room: init.room, name: 'F', weapon: 'pistol' });
    const full = await fifth.waitFor(m => m.type === 'error', 2000, 'full error');
    assert.match(full.text, /full/i);
    x.send({ type: 'start' });
    await x.waitFor(m => m.type === 'start', 2000, 'start');
    const late = new Client(); await late.ready();
    late.send({ type: 'join', room: init.room, name: 'L', weapon: 'pistol' });
    const running = await late.waitFor(m => m.type === 'error', 2000, 'in-progress error');
    assert.match(running.text, /in progress/i);
    x.close(); extras.forEach(e => e.close()); fifth.close(); late.close();
  });

  // ---- PvE ----------------------------------------------------------------
  const a = new Client(), b = new Client();
  await Promise.all([a.ready(), b.ready()]);

  await check('PvE room create/join/start', async () => {
    a.send({ type: 'create', name: 'Alpha', weapon: 'pistol', mode: 'pve' });
    const init = await a.waitFor(m => m.type === 'init', 3000, 'init');
    assert.strictEqual(init.mode, 'pve');
    assert.match(init.room, /^[A-Z]{4}$/);
    b.send({ type: 'join', room: init.room, name: 'Bravo', weapon: 'pistol' });
    const initB = await b.waitFor(m => m.type === 'init', 3000, 'friend init');
    assert.strictEqual(initB.room, init.room);
    const roster = await a.waitFor(m => m.type === 'roster' && m.players.length === 2, 3000, 'roster');
    assert.strictEqual(roster.players.length, 2);
    a.send({ type: 'start' });
    await a.waitFor(m => m.type === 'start', 3000, 'start');
    await b.waitFor(m => m.type === 'start', 3000, 'friend start');
  });

  await check('recoil moves player without WASD', async () => {
    await a.waitFor(m => m.type === 'state', 3000, 'state');
    const before = a.latest(m => m.type === 'state').players.find(p => p.n === 'Alpha').x;
    const timer = setInterval(() => a.send({ type: 'input', aim: 0, firing: true, dash: false }), 33);
    await sleep(900);
    clearInterval(timer);
    const after = a.latest(m => m.type === 'state').players.find(p => p.n === 'Alpha').x;
    assert.ok(after < before - 20, `expected recoil left, got ${before} -> ${after}`);
    const bullets = a.latest(m => m.type === 'state').bullets;
    assert.ok(bullets.length > 0, 'firing should spawn bullets');
  });

  await check('state time is in seconds and dash has cooldown', async () => {
    const st = a.latest(m => m.type === 'state');
    assert.ok(st.time > 0.3 && st.time < 5, `time should be seconds, got ${st.time}`);
    a.send({ type: 'input', aim: 0, firing: false, dash: true });
    await sleep(150);
    const after = a.latest(m => m.type === 'state');
    const me = after.players.find(p => p.n === 'Alpha');
    assert.ok(me.d > 0, `dash should set cooldown, got ${me.d}`);
  });

  await check('both players get 3 unique upgrades and resume', async () => {
    const upA = await a.waitFor(m => m.type === 'upgrade', 5000, 'upgrade A');
    const upB = await b.waitFor(m => m.type === 'upgrade', 5000, 'upgrade B');
    assert.strictEqual(upA.options.length, 3);
    assert.strictEqual(upB.options.length, 3);
    assert.strictEqual(new Set(upA.options.map(o => o.id)).size, 3);
    assert.strictEqual(new Set(upB.options.map(o => o.id)).size, 3);
    a.send({ type: 'pick', id: upA.options[0].id });
    b.send({ type: 'pick', id: upB.options[0].id });
    const resumed = await a.waitFor(m => m.type === 'phase' && m.phase === 'playing', 3000, 'resume');
    assert.ok(resumed);
  });

  await check('boss spawns and enemy count stays capped', async () => {
    await a.waitFor(m => m.type === 'notice' && m.text === 'BOSS INCOMING', 6000, 'boss notice');
    const boss = await a.waitFor(m => m.type === 'state' && m.enemies.some(e => e.t === 'boss'), 4000, 'boss state');
    assert.ok(boss.enemies.some(e => e.t === 'boss'));
    let max = 0;
    const off = a.on(m => { if (m.type === 'state') max = Math.max(max, m.enemies.length); });
    await sleep(2500);
    off();
    assert.ok(max <= 24, `enemy cap exceeded: ${max}`);
  });

  a.close(); b.close();

  await check('PvE gameover records scores', async () => {
    const e = new Client(), f = new Client();
    await Promise.all([e.ready(), f.ready()]);
    e.send({ type: 'create', name: 'Idle1', weapon: 'pistol', mode: 'pve' });
    const init = await e.waitFor(m => m.type === 'init', 3000, 'init');
    f.send({ type: 'join', room: init.room, name: 'Idle2', weapon: 'pistol' });
    await f.waitFor(m => m.type === 'init', 3000, 'friend init');
    const offE = e.on(m => { if (m.type === 'upgrade') e.send({ type: 'pick', id: m.options[0].id }); });
    const offF = f.on(m => { if (m.type === 'upgrade') f.send({ type: 'pick', id: m.options[0].id }); });
    e.send({ type: 'start' });
    const over = await e.waitFor(m => m.type === 'gameover', 30000, 'PvE gameover');
    assert.strictEqual(over.results.length, 2);
    assert.ok(over.leaderboard.length >= 2);
    assert.ok(typeof over.time === 'number' && over.time >= 0);
    offE(); offF(); e.close(); f.close();
  });

  // ---- PvP ----------------------------------------------------------------
  const c = new Client(), d = new Client();
  await Promise.all([c.ready(), d.ready()]);

  await check('PvP room starts with no AI enemies', async () => {
    c.send({ type: 'create', name: 'Red', weapon: 'pistol', mode: 'pvp' });
    const init = await c.waitFor(m => m.type === 'init', 3000, 'pvp init');
    assert.strictEqual(init.mode, 'pvp');
    d.send({ type: 'join', room: init.room, name: 'Blue', weapon: 'pistol' });
    await d.waitFor(m => m.type === 'init', 3000, 'pvp friend init');
    c.send({ type: 'start' });
    await c.waitFor(m => m.type === 'start', 3000, 'pvp start');
    await sleep(400);
    const st = c.latest(m => m.type === 'state');
    assert.ok(st, 'expected state');
    assert.strictEqual(st.enemies.length, 0, 'PvP must have no enemies');
    assert.strictEqual(st.players.length, 2);
    assert.strictEqual(st.players.find(p => p.n === 'Red').w, 'pistol');
  });

  await check('PvP bullets damage, kill, credit and respawn', async () => {
    const timer = setInterval(() => c.send({ type: 'input', aim: 0, firing: true, dash: false }), 33);
    const dead = await c.waitFor(m => m.type === 'state' &&
      (m.players.find(p => p.n === 'Blue') || {}).dth >= 1, 12000, 'PvP death');
    const blueDead = dead.players.find(p => p.n === 'Blue');
    const red = dead.players.find(p => p.n === 'Red');
    assert.strictEqual(blueDead.al, false);
    assert.ok(red.k >= 1, 'attacker should get kill credit');
    const aliveAgain = await c.waitFor(m => m.type === 'state' &&
      (m.players.find(p => p.n === 'Blue') || {}).al === true &&
      m.players.find(p => p.n === 'Blue').dth >= 1, 5000, 'PvP respawn');
    assert.ok(aliveAgain);
    clearInterval(timer);
  });

  await check('PvP gameover and replay', async () => {
    const over = await c.waitFor(m => m.type === 'gameover', 12000, 'PvP gameover');
    assert.strictEqual(over.mode, 'pvp');
    assert.ok(over.results.length === 2);
    assert.ok(over.leaderboard.length >= 2);
    assert.ok(over.winner, 'winner should be reported');
    c.send({ type: 'replay' });
    const restarted = await c.waitFor(m => m.type === 'start', 3000, 'replay');
    assert.ok(restarted, 'replay should restart round');
  });

  c.close(); d.close();

  await check('no server-side errors', async () => {
    assert.ok(!/Error:|Unhandled|TypeError|ReferenceError/.test(serverLog), serverLog.slice(-1000));
  });

  server.kill('SIGTERM');
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch(e => { console.error(e); server.kill('SIGTERM'); process.exit(1); });
