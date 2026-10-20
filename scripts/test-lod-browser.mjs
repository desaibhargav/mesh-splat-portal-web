// Real-pointer LOD regression. Run against both Vite dev and production preview.
// Uses processing-package Puppeteer; adds no portal runtime dependency.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.resolve(repository, '../mesh-splat-artifact-service');
const require = createRequire(path.join(backend, 'package.json'));
const { default: puppeteer } = await import(require.resolve('puppeteer'));
const { derivativeFiles, regularFile } = await import(pathToFileURL(path.join(backend, 'dist/artifacts/derivativeFiles.js')));
const assetRoot = process.env.LOD_ASSET_ROOT ?? path.join(backend, 'data/assets');
const output = process.env.LOD_TEST_OUTPUT ?? '/private/tmp/gab-lod-browser';
const base = process.env.VIEWER_BASE ?? 'http://127.0.0.1:5179';
const fixtures = [
  { id: 'skull', slug: process.env.LOD_MESH_SLUG ?? 'scattering-skull', type: 'mesh', entry: 'content.glb' },
  { id: 'sakura', slug: process.env.LOD_SPLAT_SLUG ?? 'sakura-garden', type: 'splat', entry: 'meta.json' }
];
for (const asset of fixtures) {
  asset.content = `derivatives/${asset.slug}/${asset.entry}`;
  asset.files = await derivativeFiles(assetRoot, asset.content);
  for (const filename of asset.files) await regularFile(assetRoot, filename);
}
await mkdir(output, { recursive: true });
let transferred = 0;
const server = createServer(async (request, response) => {
  try {
    const filename = decodeURIComponent(new URL(request.url, 'http://localhost').pathname.slice(1));
    if (!fixtures.some(asset => asset.files.has(filename))) throw Error('Unpublished file');
    await regularFile(assetRoot, filename);
    const bytes = await readFile(path.join(assetRoot, filename)); transferred += bytes.length;
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Content-Type', filename.endsWith('.json') ? 'application/json' :
      filename.endsWith('.glb') ? 'model/gltf-binary' : filename.endsWith('.webp') ? 'image/webp' : 'application/octet-stream');
    if (filename.endsWith('.gz')) response.setHeader('Content-Encoding', 'gzip');
    response.end(bytes);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const fileBase = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(40000);
  await page.setViewport({ width: 1300, height: 1050 });
  page.on('pageerror', error => errors.push(error.stack ?? String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setRequestInterception(true);
  const record = asset => ({ id: asset.id, title: asset.slug, type: asset.type, description: 'LOD integration fixture',
    sizeBytes: 0, thumbnailUrl: null, contentUrl: `${fileBase}/${asset.content}`,
    lodUrl: `${fileBase}/derivatives/${asset.slug}/lod.json` });
  let holdFineMesh = false, delayedMesh;
  page.on('request', request => {
    const url = new URL(request.url());
    if (holdFineMesh && url.pathname === `/derivatives/${fixtures[0].slug}/content.glb`) { delayedMesh = request; return; }
    if (url.pathname === '/favicon.ico') return request.respond({ status: 204 });
    if (url.pathname === '/api/v1/artifacts') return request.respond({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ items: fixtures.map(record), nextCursor: null }) });
    if (url.pathname.startsWith('/api/v1/artifacts/')) return request.respond({ status: 200, contentType: 'application/json',
      body: JSON.stringify(record(fixtures.find(asset => asset.id === url.pathname.split('/').at(-1)))) });
    return request.continue();
  });
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const clickText = async (scope, text) => { await page.locator(`${scope} button ::-p-text(${text})`).click(); await settle(); };
  const handle = () => page.evaluateHandle(() => {
    const node = document.querySelector('.selection-toolbar');
    let fiber = node[Object.keys(node).find(key => key.startsWith('__reactFiber$'))];
    while (fiber && !fiber.memoizedProps?.handle) fiber = fiber.return;
    return fiber.memoizedProps.handle;
  });
  const panel = async (id = 'perspective') => (await page.$(`[data-viewport="${id}"]`)).boundingBox();
  const point = async (u, v, id = 'perspective') => { const box = await panel(id); return { x: box.x + box.width * u, y: box.y + box.height * v }; };
  async function gesture(u1, v1, u2, v2) {
    const start = await point(u1, v1), end = await point(u2, v2);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 12 }); await page.mouse.up();
    await settle();
    await page.waitForFunction(() => !document.querySelector('button[aria-label="Select"]').disabled);
    await settle();
  }
  async function surfacePoint() {
    const canvas = await page.$('.viewer-canvas canvas'), box = await canvas.boundingBox();
    const png = (await canvas.screenshot()).toString('base64');
    return page.evaluate(async (png, box) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
      const image = new OffscreenCanvas(bitmap.width, bitmap.height), context = image.getContext('2d');
      context.drawImage(bitmap, 0, 0); bitmap.close();
      const { data } = context.getImageData(0, 0, image.width, image.height);
      for (let y = image.height * .25 | 0; y < image.height * .7; y += 3) for (let x = image.width * .25 | 0; x < image.width * .65; x += 3) {
        const offset = (y * image.width + x) * 4;
        if (data[offset] > data[offset + 1] * 1.5 && data[offset] > data[offset + 2] * 1.5 &&
          document.elementFromPoint(box.x + x, box.y + y)?.tagName === 'CANVAS') return { x: box.x + x, y: box.y + y };
      }
      throw Error('No visible painted surface found');
    }, png, box);
  }
  // Read state for assertions only. All edits and navigation use actual UI input.
  async function fingerprint(h) {
    return h.evaluate(async h => {
      const digest = async arrays => {
        const bytes = new Uint8Array(arrays.reduce((total, array) => total + array.byteLength, 0)); let cursor = 0;
        for (const array of arrays) { bytes.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), cursor); cursor += array.byteLength; }
        return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].join(',');
      };
      return { mask: await digest(h.selection.state.masks), paint: await digest(h.selection.colors),
        areas: await digest(h.selection.areas.flatMap(area => area.snapshot.masks.map(mask => mask.bits))) };
    });
  }
  async function lods(h) {
    return h.evaluate(h => {
      if (h.selection.levels instanceof Map) return [h.selection.forCamera(h.camera()).index];
      const camera = h.app.renderer.gsplatDirector.camerasMap.get(h.camera().camera);
      return [...camera?.layersMap.values() ?? []].flatMap(layer =>
        [...layer.gsplatManager?.world._octreeInstances.values() ?? []].flatMap(instance => instance.nodeInfos.map(node => node.currentLod).filter(level => level >= 0)));
    });
  }
  async function zoom(h, delta, expected, panelId = 'perspective') {
    const p = await point(.4, .4, panelId); await page.mouse.move(p.x, p.y);
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const levels = await lods(h);
      if (levels.includes(expected)) {
        for (let frame = 0; frame < 8; frame++) await settle();
        if ((await lods(h)).includes(expected)) return;
      }
      const current = (await lods(h))[0];
      await page.mouse.wheel({ deltaY: current === undefined ? Math.sign(delta) * 80 : current < expected ? 80 : -80 });
      for (let frame = 0; frame < 8; frame++) await settle();
    }
    console.error('ZOOM DIAGNOSTIC', await h.evaluate(h => ({ camera: h.camera().entity.getPosition().toArray(),
      splats: h.app.root.findComponents('gsplat').map(s => ({ base: s.lodBaseDistance, multiplier: s.lodMultiplier, min: s.lodRangeMin, max: s.lodRangeMax })) })));
    throw Error(`Zoom did not reach LOD ${expected}: ${JSON.stringify(await lods(h))}`);
  }
  async function metrics(h) {
    return h.evaluate(async h => {
      const samples = []; let last = performance.now();
      for (let frame = 0; frame < 60; frame++) {
        await new Promise(resolve => requestAnimationFrame(resolve)); const now = performance.now(); samples.push(now - last); last = now;
      }
      samples.sort((a, b) => a - b);
      return { medianMs: samples[30], p95Ms: samples[57], gpuBytes: ['tex', 'vb', 'ib', 'ub', 'sb'].reduce((sum, key) => sum + h.app.stats.vram[key], 0) };
    });
  }
  for (const asset of fixtures) {
    transferred = 0; const start = performance.now();
    await page.goto(`${base}/artifacts/${asset.id}`);
    await page.waitForSelector('button[aria-label="Four views"]'); await page.$eval('.viewer-frame', element => element.scrollIntoView());
    const h = await handle();
    // Frame once, then wheel inward from the middle level to the finest level.
    const blank = await point(.1, .1); await page.mouse.click(blank.x, blank.y); await page.keyboard.press('f');
    await zoom(h, -450, 0);
    console.log('READY', asset.id, { ms: performance.now() - start, transferred });
    await page.locator('button[aria-label="Select"]').click();
    await gesture(.2, .2, .65, .7);
    assert.ok(await h.evaluate(h => h.selection.summary.selected > 0), 'Visible selection is empty');
    await page.locator('button[aria-label="Color selection red"]').click();
    await page.locator('[aria-label="Selection name"]').fill('Painted LOD region'); await clickText('.selection-options', 'Save selection');
    let expected = await fingerprint(h);
    await page.locator('button[aria-label="Annotate"]').click(); await clickText('.annotation-actions', 'Annotate a selection');
    let p = await surfacePoint(); await page.mouse.move(p.x, p.y);
    await page.waitForFunction(() => document.querySelector('.annotation-actions [role=status]')?.textContent.startsWith('Click '));
    await page.mouse.click(p.x, p.y);
    await page.waitForFunction(() => document.querySelector('.annotation-actions [role=status]')?.textContent === 'Place the marker by clicking');
    await page.mouse.click(p.x, p.y); await page.waitForSelector('input[name=title]');
    await page.locator('input[name=title]').fill('Painted surface'); await page.locator('textarea[name=description]').fill('Saved binding across LOD');
    await clickText('.annotation-actions', 'Save annotation'); await page.keyboard.press('q');
    const fine = await metrics(h); await page.screenshot({ path: path.join(output, `${asset.id}-fine.png`), fullPage: true });
    await zoom(h, 1800, 2);
    assert.deepEqual(await fingerprint(h), expected, 'Zoom replaced canonical paint or saved masks');
    const coarse = await metrics(h); await page.screenshot({ path: path.join(output, `${asset.id}-coarse.png`), fullPage: true });
    const originalRegion = await h.evaluate(h => h.selection.areas.find(area => area.name === 'Painted LOD region').snapshot.masks.map(mask => [...mask.bits]));
    const redCount = await h.evaluate(h => h.selection.colors.reduce((sum, colors) => sum + colors.filter(color => color === 0xe53935 + 1).length, 0));
    await page.locator('button[aria-label="Select"]').click(); await gesture(.35, .3, .65, .7);
    assert.ok(await h.evaluate(h => h.selection.summary.selected > 0), 'Coarse selection is empty');
    await page.locator('button[aria-label="Color selection blue"]').click();
    await settle(); await page.waitForFunction(() => !document.querySelector('button[aria-label="Select"]').disabled);
    const painted = await fingerprint(h);
    await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta');
    assert.notEqual((await fingerprint(h)).paint, painted.paint, 'Undo did not remove coarse paint');
    await page.keyboard.down('Meta'); await page.keyboard.down('Shift'); await page.keyboard.press('z');
    await page.keyboard.up('Shift'); await page.keyboard.up('Meta');
    assert.deepEqual(await fingerprint(h), painted, 'Redo did not restore coarse paint');
    await page.locator('[aria-label="Selection name"]').fill('Coarse edit'); await clickText('.selection-options', 'Save selection');
    assert.deepEqual(await h.evaluate(h => h.selection.areas.find(area => area.name === 'Painted LOD region').snapshot.masks.map(mask => [...mask.bits])), originalRegion,
      'Coarse editing overwrote the saved fine boundary');
    assert.equal(await h.evaluate(h => h.selection.colors.reduce((sum, colors) => sum + colors.filter(color => color === 0xe53935 + 1).length, 0)), redCount,
      'Overlapping coarse paint overwrote the previous color');
    expected = await fingerprint(h); await page.keyboard.press('q');
    await zoom(h, -450, 1);
    assert.deepEqual(await fingerprint(h), expected, 'Middle level changed saved edits');
    await zoom(h, -450, 0);
    assert.deepEqual(await fingerprint(h), expected, 'Fine boundary was lost after coarse display');
    await page.locator('button[aria-label="Annotate"]').click(); await clickText('[aria-label="Saved annotations"]', 'Painted surface');
    assert.equal(await page.$eval('textarea[name=description]', element => element.value), 'Saved binding across LOD');
    await page.keyboard.press('q');
    const active = await point(.3, .3); await page.mouse.move(active.x, active.y); await page.keyboard.press('Space');
    await page.waitForFunction(() => document.querySelectorAll('.viewport-panel').length === 4);
    const split = await metrics(h); await page.screenshot({ path: path.join(output, `${asset.id}-quad.png`), fullPage: true });
    const perspectivePose = await h.evaluate(h => h.camera().entity.getPosition().toArray());
    await zoom(h, 80, 2, 'front');
    assert.deepEqual(await fingerprint(h), expected, 'Orthographic zoom replaced shared edits');
    // Maximize/restore keeps that panel's camera and LOD, then return to perspective.
    await page.keyboard.press('Space'); await settle();
    assert.equal(await page.$$('.viewport-panel').then(panels => panels.length), 1);
    assert.ok((await lods(h)).includes(2));
    await page.keyboard.press('Space'); await settle();
    const perspective = await point(.4, .4); await page.mouse.move(perspective.x, perspective.y); await settle();
    assert.deepEqual(await h.evaluate(h => h.camera().entity.getPosition().toArray()), perspectivePose, 'Orthographic zoom moved the perspective camera');
    const restoreDeadline = Date.now() + 20000;
    while (!(await lods(h)).includes(0) && Date.now() < restoreDeadline) await settle();
    assert.ok((await lods(h)).includes(0), 'Perspective LOD did not restore after native streaming resumed');
    // Shared view -> section -> measurement workflow runs in four panels.
    await page.locator('button[aria-label="Views"]').click(); await clickText('.view-options', 'Create view');
    await page.locator('[aria-label="View name"]').fill('LOD reference'); await clickText('.view-options', 'Save view');
    await page.locator('button[aria-label="Cross section"]').click(); await page.select('[aria-label="Section reference"]', '1');
    await clickText('.section-options', 'Enable section');
    await page.locator('[aria-label="Section name"]').fill('LOD cut'); await clickText('.section-options', 'Save section');
    await page.keyboard.press('q');
    assert.deepEqual(await fingerprint(h), expected, 'Cross-tool operations replaced the selection document');
    await page.locator('button[aria-label="Measure distance"]').click();
    // The options panel covers much of the lower-right viewport; measure in Right.
    const inspection = await point(.4, .4, 'right'); await page.mouse.move(inspection.x, inspection.y); await settle();
    // Choose rendered retained pixels through the engine picker, then place via UI.
    const retained = await h.evaluate(async h => {
      const c = h.camera(), canvas = h.app.graphicsDevice.canvas.getBoundingClientRect(), rect = c.rect;
      const node = document.querySelector('.measurement-actions');
      let fiber = node[Object.keys(node).find(key => key.startsWith('__reactFiber$'))];
      while (fiber && !fiber.memoizedProps?.measurement) fiber = fiber.return;
      let hook = fiber.memoizedState;
      while (hook && !hook.memoizedState?.current?.picker?.capture) hook = hook.next;
      const pick = hook.memoizedState.current.picker.capture(c);
      const points = [];
      for (let v = .1; v < .9; v += .1) for (let u = .1; u < .9; u += .1) {
        const x = rect.x + u * rect.z, y = 1 - rect.y - rect.w + v * rect.w;
        const px = canvas.x + canvas.width * x, py = canvas.y + canvas.height * y;
        if (document.elementFromPoint(px, py)?.tagName === 'CANVAS' && await pick(x, y)) points.push({ x: px, y: py });
      }
      let pair = [], distance = 0;
      for (const first of points) for (const second of points) {
        const next = (first.x - second.x) ** 2 + (first.y - second.y) ** 2;
        if (next > distance) { pair = [first, second]; distance = next; }
      }
      return pair;
    });
    assert.equal(retained.length, 2, 'No retained surfaces available for measurement');
    await page.mouse.click(retained[0].x, retained[0].y);
    await page.waitForFunction(() => document.querySelector('.measurement-actions [role=status]')?.textContent === 'Click the second surface point');
    await settle();
    await page.mouse.click(retained[1].x, retained[1].y);
    await page.waitForSelector('[aria-label="Measured distance"]');
    await page.locator('[aria-label="Measurement name"]').fill('Retained span'); await clickText('.measurement-actions', 'Save measurement');
    await page.keyboard.press('q'); await page.screenshot({ path: path.join(output, `${asset.id}-composed.png`), fullPage: true });
    assert.deepEqual(await fingerprint(h), expected);
    console.log('PASS', asset.id, { fine, coarse, split, transferred });
    await page.locator('.back-link').click(); await page.waitForSelector('.catalog-page');
    console.log('CLEANUP', asset.id);
    assert.deepEqual(errors, [], 'Browser errors or teardown failure');
  }
  // Reproduce the late-download lifecycle race with an actually pending response.
  holdFineMesh = true;
  await page.goto(`${base}/artifacts/${fixtures[0].id}`);
  await page.waitForSelector('button[aria-label="Four views"]');
  for (let frame = 0; !delayedMesh && frame < 120; frame++) await settle();
  assert.ok(delayedMesh, 'No finer mesh download was intercepted');
  await page.locator('.back-link').click(); await page.waitForSelector('.catalog-page');
  await delayedMesh.continue();
  for (let frame = 0; frame < 60; frame++) await settle();
  assert.deepEqual(errors, [], 'Late mesh response touched a destroyed viewer');
  console.log('PASS cancel finer mesh download on navigation away');
} catch (error) {
  for (const page of await browser.pages()) {
    console.error(await page.$$eval('[role=status]', nodes => nodes.map(node => node.textContent)));
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
  }
  throw error;
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await browser.close(); }
