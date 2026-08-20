/**
 * Screenshot the running app with headless Chrome, for visual checks.
 *
 * Drives an already-installed Chrome over the DevTools protocol, which is
 * plain JSON over a WebSocket - and Node has both `fetch` and `WebSocket`
 * built in, so this needs no packages and no browser download.
 *
 *   npm run dev
 *   node scripts/screenshot.mjs http://localhost:5173 shot.png
 *
 * The optional JS argument is evaluated in the page after load and awaited if
 * it returns a promise, so a particular state can be set up before capturing:
 *
 *   node scripts/screenshot.mjs http://localhost:5173 focused.png "
 *     document.querySelector('#tab-explore').click();
 *     document.querySelector('#wheel').axis = 45;
 *     document.querySelector('#drum').power = -4;
 *     new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
 *   "
 *
 * Set CHROME_PATH if Chrome is somewhere other than the default location.
 */

import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, out, js = '', width = '1440', height = '900'] = process.argv.slice(2);
if (!url || !out) {
  console.error('usage: node shot.mjs <url> <out.png> [js] [width] [height]');
  process.exit(1);
}

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), 'shot-'));

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll the debugger endpoint until Chrome is listening. */
async function targets() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await response.json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // Chrome has not opened the port yet.
    }
    await sleep(250);
  }
  throw new Error('Chrome debugger never came up');
}

const page = await targets();
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});

let nextId = 0;
const pending = new Map();
const events = [];

socket.onmessage = (message) => {
  const data = JSON.parse(message.data);
  if (data.id !== undefined) {
    const entry = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) entry.reject(new Error(JSON.stringify(data.error)));
    else entry.resolve(data.result);
  } else {
    events.push(data.method);
  }
};

function send(method, params = {}) {
  const id = (nextId += 1);
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: Number(width),
  height: Number(height),
  deviceScaleFactor: 1,
  mobile: false,
});

await send('Page.navigate', { url });
for (let i = 0; i < 80 && !events.includes('Page.loadEventFired'); i += 1) await sleep(100);
await sleep(400);

if (js) {
  const result = await send('Runtime.evaluate', {
    expression: js,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    console.error('page JS threw:', JSON.stringify(result.exceptionDetails.exception));
  } else if (result.result?.value !== undefined) {
    console.log('js ->', JSON.stringify(result.result.value));
  }
  await sleep(400);
}

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log(`wrote ${out}`);

socket.close();
chrome.kill();
process.exit(0);
