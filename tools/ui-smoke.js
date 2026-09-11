'use strict';

const fs = require('fs');
const endpoint = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9223';
const site = process.env.SITE_URL || 'http://127.0.0.1:3000';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await pause(100);
  }
  throw new Error('Timed out waiting for page state');
}

async function main() {
  const target = await fetch(`${endpoint}/json/new?${encodeURIComponent(site + '/')}`, { method: 'PUT' }).then((res) => res.json());
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Evaluation failed');
    return result.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await waitFor(() => evaluate("Boolean(document.querySelector('#home-list'))"));

  const homeBefore = await evaluate("({ y: scrollY, height: document.documentElement.scrollHeight, viewport: innerHeight })");
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 720, y: 450, deltaX: 0, deltaY: 760 });
  await pause(900);
  const homeAfter = await evaluate("({ y: scrollY, loader: document.querySelector('#loader').className })");

  await evaluate("document.querySelector('a[href=\"/about\"]').click(); true");
  await waitFor(() => evaluate("location.pathname === '/about'"));
  await pause(350);
  await evaluate("document.querySelector('a[href=\"/\"]').click(); true");
  await waitFor(() => evaluate("location.pathname === '/' && Boolean(document.querySelector('#home-list'))"));
  await pause(450);
  const returnedHome = await evaluate("({ y: scrollY, loader: document.querySelector('#loader').className })");

  await send('Page.navigate', { url: `${site}/post/mc-mod-guide` });
  await waitFor(() => evaluate("Boolean(document.querySelector('#md'))"));
  await pause(350);
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 720, y: 450, deltaX: 0, deltaY: 980 });
  await pause(900);
  const articleAfterWheel = await evaluate("scrollY");
  await pause(900);
  const articleAfterWait = await evaluate("scrollY");

  const result = {
    homeScrollable: homeBefore.height > homeBefore.viewport && homeAfter.y > 100,
    homeScrollY: homeAfter.y,
    loaderDismissed: /leaving|hide/.test(homeAfter.loader),
    introDoesNotReplay: /hide/.test(returnedHome.loader),
    articleScrollable: articleAfterWheel > 100,
    articleScrollStable: articleAfterWait > 100,
    articleScrollY: articleAfterWait,
  };
  if (process.env.LEAF_SCREENSHOT_PATH) {
    await send('Page.navigate', { url: `${site}/` });
    await waitFor(() => evaluate("Boolean(document.querySelector('#home-list'))"));
    await pause(900);
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(process.env.LEAF_SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'));
  }
  console.log(JSON.stringify(result, null, 2));
  socket.close();
  if (Object.values(result).some((value) => value === false)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
