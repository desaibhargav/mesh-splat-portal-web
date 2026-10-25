// The reported dense-scan brush regression. Uses only a published derivative.
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const require = createRequire(path.join(root, "mesh-splat-artifact-service/package.json"));
const { default: puppeteer } = await import(require.resolve("puppeteer"));
const output = process.env.VISIBILITY_TEST_OUTPUT ?? path.join(tmpdir(), "gab-mesh-visibility");
await mkdir(output, { recursive: true });
const asset = "21d12x-006349";
const server = createServer(async (request, response) => {
  if (request.url !== "/content.glb") { response.writeHead(404).end(); return; }
  try {
    response.setHeader("Access-Control-Allow-Origin", "*"); response.setHeader("Content-Type", "model/gltf-binary");
    response.end(await readFile(path.join(root, "mesh-splat-artifact-service/data/assets/derivatives", asset, "content.glb")));
  } catch (error) { response.writeHead(404).end(String(error)); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage(), errors = [];
  page.setDefaultTimeout(30000);
  await page.setViewport({ width: 1200, height: 1000, deviceScaleFactor: 1 });
  page.on("pageerror", error => errors.push(String(error)));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.setRequestInterception(true);
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname === "/favicon.ico") request.respond({ status: 204 });
    else if (url.pathname === "/api/v1/artifacts") request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], nextCursor: null }) });
    else if (url.pathname.startsWith("/api/v1/artifacts/")) request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({
      id: asset, title: asset, description: "Dense mesh brush regression", type: "mesh", thumbnailUrl: null,
      contentUrl: `http://127.0.0.1:${server.address().port}/content.glb`, sizeBytes: 0
    }) });
    else request.continue();
  });
  const handle = () => page.evaluateHandle(() => {
    const node = document.querySelector(".selection-toolbar");
    let fiber = node[Object.keys(node).find(key => key.startsWith("__reactFiber$"))];
    while (fiber && !fiber.memoizedProps?.handle) fiber = fiber.return;
    return fiber.memoizedProps.handle;
  });
  async function clickText(text) {
    const button = await page.evaluateHandle(text => [...document.querySelectorAll(".selection-actions button")].find(node => node.textContent.trim() === text), text);
    if (!button.asElement()) throw Error("Missing button: " + text);
    await button.asElement().click(); await button.dispose();
  }
  async function settleCamera() {
    await (await handle()).evaluate(async handle => {
      let previous = [], stable = 0;
      while (stable < 4) {
        await new Promise(requestAnimationFrame);
        const next = Array.from(handle.camera().viewMatrix.data);
        stable = next.every((value, i) => value === previous[i]) ? stable + 1 : 0; previous = next;
      }
    });
  }
  await page.goto((process.env.VIEWER_BASE ?? "http://127.0.0.1:5175") + "/artifacts/" + asset);
  await page.waitForSelector('[aria-label="Select"]:not([disabled])', { timeout: 90000 });
  await page.$eval(".viewer-frame", node => node.scrollIntoView());
  await page.click('[aria-label="Look from Front"]');
  await page.mouse.move(600, 500); await page.mouse.wheel({ deltaY: -200 });
  await settleCamera();
  await page.click('[aria-label="Select"]'); await clickText("Brush");
  // Observe the real gesture and read-only camera/mask snapshots. No fake hits.
  await (await handle()).evaluate(handle => {
    const native = handle.selection.hitTest.bind(handle.selection);
    window.visibilityRuns = [];
    handle.selection.hitTest = async (app, camera, region) => {
      window.brushReference = { region, projection: camera.projectionMatrix.clone(), view: camera.viewMatrix.clone() };
      const run = { started: performance.now(), frames: [], done: false }; window.visibilityRuns.push(run);
      let last = run.started;
      const frame = time => { run.frames.push(time - last); last = time; if (!run.done) requestAnimationFrame(frame); };
      requestAnimationFrame(frame);
      try { return await native(app, camera, region); }
      finally { run.milliseconds = performance.now() - run.started; run.done = true; }
    };
  });
  const canvas = await (await page.$(".viewer-canvas canvas")).boundingBox();
  async function stroke() {
    await page.mouse.move(canvas.x + canvas.width * .48, canvas.y + canvas.height * .45); await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width * .5, canvas.y + canvas.height * .65, { steps: 12 }); await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector(".selection-toolbar [role=status]").textContent.includes("Selecting"));
  }
  await stroke();
  // Repeat the same real stroke at the same pose, separating first-use BVH
  // initialization from normal interaction cost.
  await stroke();
  await page.keyboard.press("f"); await settleCamera();
  await page.screenshot({ path: path.join(output, "brush-focused.png") });
  const coverage = await (await handle()).evaluate(async handle => {
    const reference = window.brushReference, region = reference.region;
    const pixels = new Uint8ClampedArray(region.pixels.length).fill(255);
    // A closer native GPU render is the independent visibility reference. Keep
    // the original brush's camera and exclude its antialiased boundary pixels.
    const now = await handle.selection.picker.capture(handle.camera(), { ...region, pixels }, false);
    const Matrix = handle.camera().projectionMatrix.constructor, vp = new Matrix().mul2(reference.projection, reference.view);
    let visible = 0; const missing = [];
    handle.selection.parts.forEach((part, partIndex) => {
      const matrix = new Matrix().mul2(vp, part.source.node.getWorldTransform()).data;
      for (let face = 0; face < part.mask.length; face++) if (now[partIndex][face]) {
        const [x, y, z] = part.centers.subarray(face * 3, face * 3 + 3), w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
        const sx = ((matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w + 1) * region.width / 2;
        const sy = (1 - (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w) * region.height / 2;
        if (sx < 3 || sy < 3 || sx >= region.width - 3 || sy >= region.height - 3) continue;
        if ([-3, 0, 3].some(dx => [-3, 0, 3].some(dy => !region.pixels[(Math.floor(sy + dy) * region.width + Math.floor(sx + dx)) * 4 + 3]))) continue;
        visible++; if (!part.mask[face]) missing.push(face);
      }
    });
    return { visible, missing, selected: handle.selection.summary.selected };
  });
  if (coverage.visible < 9000 || coverage.missing.length) throw Error("Dense brush coverage: " + JSON.stringify(coverage));
  const surfaceRays = await (await handle()).evaluate(async handle => {
    const camera=handle.camera(), rect=handle.app.graphicsDevice.clientRect, times=[];
    let hits=0;
    for (let i=0;i<60;i++) {
      const x=rect.width*(.45+.1*i/59), y=rect.height*.5;
      const origin=camera.screenToWorld(x,y,camera.nearClip), target=camera.screenToWorld(x,y,camera.farClip);
      const start=performance.now();
      if (await handle.selection.pickRay(origin,target.sub(origin).normalize())) hits++;
      times.push(performance.now()-start);
    }
    times.sort((a,b)=>a-b);
    return {hits,medianMs:times[30],p95Ms:times[57],maxMs:times[59]};
  });
  if (!surfaceRays.hits) throw Error("Dense surface-point rays returned no hits");
  await clickText("Isolate");
  await page.screenshot({ path: path.join(output, "brush-isolated.png") });
  await clickText("Show all");
  const timings = await page.evaluate(() => window.visibilityRuns.map(run => ({
    milliseconds: Math.round(run.milliseconds), frames: run.frames.length,
    longestFrame: Math.round(Math.max(...run.frames)),
    p95Frame: Math.round([...run.frames].sort((a, b) => a - b)[Math.floor(run.frames.length * .95)] ?? 0)
  })));
  await page.keyboard.press("q");
  await page.mouse.move(canvas.x + canvas.width * .5, canvas.y + canvas.height * .5); await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width * .6, canvas.y + canvas.height * .55, { steps: 10 }); await page.mouse.up();
  await settleCamera();
  await page.screenshot({ path: path.join(output, "navigation-after.png") });
  const idle = await (await handle()).evaluate(async handle => {
    let frames = 0;
    const rendered = () => frames++;
    handle.app.on("postrender", rendered);
    await new Promise(resolve => setTimeout(resolve, 350));
    handle.app.off("postrender", rendered);
    return { autoRender: handle.app.autoRender, frames, pendingQueries: handle.selection.visibility.pending.size,
      pickLayerInSceneCamera: handle.camera().layers.includes(handle.selection.picker.layer.id) };
  });
  if (idle.pendingQueries || idle.pickLayerInSceneCamera) throw Error("Picking remained active while idle: " + JSON.stringify(idle));
  const worker = page.workers().find(worker => worker.url().includes("visibility.worker"));
  if (!worker) throw Error("Missing visibility worker");
  const closed = new Promise(resolve => page.on("workerdestroyed", destroyed => { if (destroyed === worker) resolve(); }));
  await page.locator('a ::-p-text(Back to collection)').click();
  await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(Error("Visibility worker leaked after navigation")), 10000))]);
  if (errors.length) throw Error(errors.join("\n"));
  console.log("PASS dense scan brush + isolation + navigation + worker cleanup", { ...coverage, surfaceRays, timings, idle, output });
} finally { await browser.close(); server.close(); }
