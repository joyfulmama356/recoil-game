'use strict';

// Browser-level check using headless Chrome + DevTools Protocol.
// Verifies the client boots, art loads, and sprites actually render to canvas.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const WebSocket = require('ws');

const PORT = 3000;
const CDP_PORT = 9223;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'recoil-chrome-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1200,800', `http://localhost:${PORT}/`,
], { stdio: ['ignore', 'ignore', 'pipe'] });

let chromeLog = '';
chrome.stderr.on('data', d => { chromeLog += d.toString(); });

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let b = ''; res.on('data', d => { b += d; }); res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function waitForTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const targets = await getJSON(`http://localhost:${CDP_PORT}/json/list`);
      const page = targets.find(t => t.type === 'page' && t.url.includes(`localhost:${PORT}`));
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome page target not found\n' + chromeLog.slice(-1000));
}

async function main() {
  const target = await waitForTarget();
  const cdp = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { cdp.on('open', res); cdp.on('error', rej); });

  let seq = 0;
  const pending = new Map();
  const errors = [];
  cdp.on('message', raw => {
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.text + ' ' + (msg.params.exceptionDetails.exception?.description || ''));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map(a => a.value || a.description).join(' '));
    }
  });
  const cmd = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    cdp.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expr => {
    const r = await cmd('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
    return r.result.value;
  };
  const until = async (expr, label, timeout = 6000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evaluate(expr)) return;
      await sleep(100);
    }
    throw new Error(`browser timeout: ${label}`);
  };

  await cmd('Runtime.enable');
  await until('document.readyState === "complete"', 'page load');
  await until('typeof ws !== "undefined" && ws && ws.readyState === 1', 'websocket open');

  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push(true); console.log(`PASS  ${name}`); }
    catch (e) { results.push(false); console.log(`FAIL  ${name}: ${e.message}`); }
  };

  await check('menu renders with mode buttons', async () => {
    const r = await evaluate(`({
      menu: !document.getElementById('menu').classList.contains('hidden'),
      pve: !!document.getElementById('mode-pve'),
      pvp: !!document.getElementById('mode-pvp'),
      canvas: !!document.getElementById('game')
    })`);
    assert.deepStrictEqual(r, { menu: true, pve: true, pvp: true, canvas: true });
  });

  await check('all 9 SVG sprites load', async () => {
    await until('Object.keys(images).length === 9', 'images loaded', 4000);
    const r = await evaluate(`Object.keys(ASSETS).every(k => hasArt(k))`);
    assert.strictEqual(r, true, 'every asset should report loaded');
  });

  await check('create room and start round in browser', async () => {
    await evaluate(`document.getElementById('create-btn').click()`);
    await until(`!document.getElementById('waiting').classList.contains('hidden')`, 'waiting overlay');
    await evaluate(`ws.send(JSON.stringify({type:'start'}))`);
    await until(`phase === 'playing'`, 'playing phase');
    await until(`current && current.players.length === 1`, 'state received');
  });

  await check('player sprite renders pink pixels on canvas', async () => {
    await evaluate(`ws.send(JSON.stringify({type:'input', aim:0, firing:false, dash:false}))`);
    await sleep(300);
    const r = await evaluate(`(() => {
      const c = document.getElementById('game');
      const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      let pink = 0, nonBg = 0;
      for (let i=0;i<d.length;i+=4) {
        if (d[i] !== 13 || d[i+1] !== 18 || d[i+2] !== 32) nonBg++;
        if (d[i] > 180 && d[i+1] < 140 && d[i+2] < 170 && d[i+2] > 40) pink++;
      }
      return { pink, nonBg };
    })()`);
    assert.ok(r.nonBg > 1000, `canvas should have drawn content, got ${r.nonBg}`);
    assert.ok(r.pink > 100, `player sprite should draw pink pixels, got ${r.pink}`);
  });

  await check('no browser console errors', async () => {
    assert.deepStrictEqual(errors, [], errors.join('\n'));
  });

  cdp.close();
  chrome.kill('SIGKILL');
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold files */ }
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} browser checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(e => { console.error(e); chrome.kill('SIGTERM'); process.exit(1); });
