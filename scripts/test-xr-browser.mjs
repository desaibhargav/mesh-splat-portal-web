// Real engine AR/VR sessions with Meta IWER; emulator is test-only and never bundled.
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const derivatives = path.join(root, "mesh-splat-artifact-service/data/assets/derivatives");
const output = await mkdtemp(path.join(tmpdir(), "gab-xr-"));
const require = createRequire(path.join(root, "mesh-splat-artifact-service/package.json"));
const { default: puppeteer } = await import(require.resolve("puppeteer"));
const assets = {
  "21e231-006699": { type: "mesh", file: "content.glb" },
  "sakura-garden": { type: "splat", file: "meta.json" }
};
const server = createServer(async (request, response) => {
  const parts = new URL(request.url, "http://localhost").pathname.split("/").filter(Boolean);
  const asset = assets[parts[0]];
  if (!asset || parts.length !== 2 || !/^[-a-zA-Z0-9._]+$/.test(parts[1])) { response.writeHead(404).end(); return; }
  try {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Content-Type", parts[1].endsWith(".glb") ? "model/gltf-binary" : parts[1].endsWith(".json") ? "application/json" : "application/octet-stream");
    response.end(await readFile(path.join(derivatives, parts[0], parts[1])));
  } catch (error) { response.writeHead(404).end(String(error)); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

const emulatorPath = process.env.XR_EMULATOR_PATH;
if (!emulatorPath) throw new Error("Set XR_EMULATOR_PATH to Meta IWER's build/iwer.js (see docs/xr.md).");
const emulator = await readFile(emulatorPath, "utf8");
const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage(), errors = [];
  await page.setViewport({ width: 1200, height: 1000, deviceScaleFactor: 1 });
  page.setDefaultTimeout(30000);
  page.on("pageerror", error => errors.push(String(error)));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.evaluateOnNewDocument(emulator + `
    window.xrDevice = new IWER.XRDevice(IWER.metaQuest3, { stereoEnabled: true });
    window.xrDevice.installRuntime({ forceInstall: true });
  `);
  await page.setRequestInterception(true);
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname === "/favicon.ico") request.respond({ status: 204 });
    else if (url.pathname === "/api/v1/artifacts") request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], nextCursor: null }) });
    else if (url.pathname.startsWith("/api/v1/artifacts/")) {
      const id = url.pathname.split("/").at(-1), asset = assets[id];
      request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({
        id, title: id, description: "XR regression", type: asset.type, thumbnailUrl: null,
        contentUrl: `http://127.0.0.1:${server.address().port}/${id}/${asset.file}`, sizeBytes: 0
      }) });
    } else request.continue();
  });
  const base = process.env.VIEWER_BASE ?? "http://127.0.0.1:5175";
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const handle = () => page.evaluateHandle(() => {
    const node = document.querySelector(".selection-toolbar");
    let fiber = node[Object.keys(node).find(key => key.startsWith("__reactFiber$"))];
    while (fiber && !fiber.memoizedProps?.handle) fiber = fiber.return;
    return fiber.memoizedProps.handle;
  });
  for (const id of Object.keys(assets)) {
    await page.goto(`${base}/artifacts/${id}`);
    await page.waitForSelector('[aria-label="Select"]:not([disabled])', { timeout: 90000 });
    await page.waitForSelector('button ::-p-text(Enter VR)');
    await page.$eval(".viewer-frame", element => element.scrollIntoView());
    const h = await handle();
    // Denied permission must leave the desktop viewer ready to retry.
    await page.evaluate(() => {
      const request = navigator.xr.requestSession.bind(navigator.xr);
      navigator.xr.requestSession = () => { navigator.xr.requestSession = request; return Promise.reject(new Error("XR permission denied for regression")); };
    });
    await page.locator('button ::-p-text(Enter VR)').click();
    await page.waitForFunction(() => document.querySelector('.immersive-controls [role=alert]')?.textContent.includes("permission denied"));
    check(await h.evaluate(h => !h.app.xr.active && h.viewports.perspectivePanel.camera.entity.parent === h.app.root), "Failed entry did not restore desktop");
    for (const split of [false, true]) {
      if (split) {
        await page.click('[aria-label="Four views"]');
        await page.click('[aria-label="Look from Top"]');
      }
      const before = await h.evaluate(h => ({
        split: h.viewports.split, active: h.viewports.active.id,
        root: Array.from(h.space.root.getWorldTransform().data),
        cameras: h.viewports.panels.map(p => ({ id:p.id, enabled:p.camera.enabled, rect:p.camera.rect.toArray(),
          position:p.camera.entity.getPosition().toArray(), rotation:p.camera.entity.getRotation().toArray(),
          near:p.camera.nearClip, far:p.camera.farClip, projection:p.camera.projection,
          background:p.camera.clearColor.toArray(), controls:p.camera.entity.script.get("cameraControls").enabled }))
      }));
      for (const [label, type] of [["Enter VR", "immersive-vr"], ["View in your room", "immersive-ar"]]) {
        await page.locator(`button ::-p-text(${label})`).click();
        await page.waitForFunction(() => document.querySelector('.viewer-frame')?.dataset.immersive === "true");
        await h.evaluate(async h => {
          while (h.app.xr.views.list.length !== 2) await new Promise(requestAnimationFrame);
          await new Promise(resolve => h.app.once("postrender", resolve));
        });
        const state = await h.evaluate(h => {
          const c=h.camera(), bounds=h.selection.bounds(null), parent=c.entity.parent;
          const relative = parent.getWorldTransform().clone().invert().transformPoint(bounds.center);
          return { type:h.app.xr.type, split:h.viewports.split, active:h.viewports.active.id, views:h.app.xr.views.list.length,
            controls:c.entity.script.get("cameraControls").enabled, alpha:c.clearColor.a,
            relative:relative.toArray(), eye:c.entity.getLocalPosition().toArray(),
            root:Array.from(h.space.root.getWorldTransform().data),
            drawCalls:h.app.stats.drawCalls.total };
        });
        check(state.type===type && state.views===2 && !state.split && state.active==="perspective" && !state.controls, "XR camera lifecycle: "+JSON.stringify(state));
        check(state.drawCalls>0, "XR rendered no draw calls");
        check(type!=="immersive-ar" || state.alpha===0, "Passthrough background is opaque");
        check(JSON.stringify(state.root)===JSON.stringify(before.root), "XR changed asset geometry space");
        check(Math.abs(state.relative[0]-state.eye[0])<1e-4 && Math.abs(state.relative[1]-state.eye[1])<1e-4 && Math.abs(state.relative[2]-state.eye[2]+1.5)<1e-4,
          "Artifact was not placed in front of the first tracked pose: "+JSON.stringify(state));
        const canvas = await h.evaluateHandle(h => h.app.graphicsDevice.canvas);
        const first = await canvas.asElement().screenshot();
        await page.screenshot({ path:path.join(output, `${id}-${type}-${split?"split":"single"}.png`) });
        await page.evaluate(() => { window.xrDevice.position.x += .2; });
        await h.evaluate(async h => { await new Promise(resolve => h.app.once("postrender", resolve)); await new Promise(resolve => h.app.once("postrender", resolve)); });
        const moved = await canvas.asElement().screenshot();
        check(!first.equals(moved), "Tracked head movement did not change rendered image");
        await h.evaluate(async h => { await new Promise(resolve => h.app.xr.end(resolve)); });
        await page.waitForFunction(() => document.querySelector('.viewer-frame')?.dataset.immersive === "false");
        const after = await h.evaluate(h => ({
          split:h.viewports.split, active:h.viewports.active.id,
          root:Array.from(h.space.root.getWorldTransform().data),
          cameras:h.viewports.panels.map(p => ({id:p.id, enabled:p.camera.enabled, rect:p.camera.rect.toArray(),
            position:p.camera.entity.getPosition().toArray(), rotation:p.camera.entity.getRotation().toArray(),
            near:p.camera.nearClip, far:p.camera.farClip, projection:p.camera.projection,
            background:p.camera.clearColor.toArray(), controls:p.camera.entity.script.get("cameraControls").enabled}))
        }));
        check(JSON.stringify(after)===JSON.stringify(before), "XR exit did not restore desktop: "+JSON.stringify({before,after}));
        console.log("PASS",id,type,split?"four views restored":"single view restored", "stereo draw calls",state.drawCalls);
      }
    }
    // An existing cut remains the same world plane throughout immersive viewing.
    await page.click('[aria-label="Cross section"]');
    await page.locator('.section-buttons button ::-p-text(Enable section)').click();
    const cut = await h.evaluate(h => Array.from(h.app.graphicsDevice.scope.resolve("portalSectionPlane").getValue()));
    await page.keyboard.press("q");
    await page.locator('button ::-p-text(View in your room)').click();
    await page.waitForFunction(() => document.querySelector('.viewer-frame')?.dataset.immersive === "true");
    check(await h.evaluate((h, expected) => h.app.graphicsDevice.scope.resolve("portalSectionEnabled").getValue() === 1 &&
      Array.from(h.app.graphicsDevice.scope.resolve("portalSectionPlane").getValue()).every((value, i) => value === expected[i]), cut), "XR moved or disabled the existing section");
    await h.evaluate(async h => { await new Promise(resolve => h.app.xr.end(resolve)); });
    await page.waitForFunction(() => document.querySelector('.viewer-frame')?.dataset.immersive === "false");
    check(await h.evaluate(h => h.app.graphicsDevice.scope.resolve("portalSectionEnabled").getValue() === 1), "XR exit lost the existing section");
    console.log("PASS", id, "section composition");
    // Enter directly from a naming field: text-entry rendering must yield to XR
    // and must not leave the desktop render loop paused after the session ends.
    await page.click('[aria-label="Capture view"]');
    await page.click('[aria-label="Capture name"]');
    check(await h.evaluate(h => !h.app.autoRender), "Typing did not pause desktop rendering");
    await page.locator('button ::-p-text(Enter VR)').click();
    await page.waitForFunction(() => document.querySelector('.viewer-frame')?.dataset.immersive === "true");
    check(await h.evaluate(h => h.app.autoRender), "Typing policy blocked immersive rendering");
    await h.evaluate(async h => { await new Promise(resolve => h.app.xr.end(resolve)); });
    await page.waitForFunction(() => document.querySelector('.viewer-frame')?.dataset.immersive === "false");
    check(await h.evaluate(h => h.app.autoRender), "Desktop stayed paused after entering XR from a text field");
    console.log("PASS", id, "text entry to XR to desktop rendering");
    // Leave the route while presenting to exercise scene teardown and session end.
    await page.locator('button ::-p-text(Enter VR)').click();
    await page.waitForFunction(() => document.querySelector('.viewer-frame')?.dataset.immersive === "true");
    await page.$eval(".back-link", link => link.click());
    await page.waitForSelector(".catalog-page");
    await h.dispose();
  }
  if (errors.length) throw Error(errors.join("\n"));
  console.log("PASS XR denied-entry recovery, placement, head tracking, AR alpha, stereo mesh/splat rendering, four-view restoration, teardown", output);
} catch (error) {
  for (const page of await browser.pages()) console.log("XR FAILURE", page.url(), await page.evaluate(() => document.body.innerText));
  throw error;
} finally { await browser.close(); server.close(); }
