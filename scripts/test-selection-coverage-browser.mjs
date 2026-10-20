// Dense visible triangles + a fully occluded shell. Files remain in the OS temp directory.
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const require = createRequire(root + "/mesh-splat-artifact-service/package.json");
const { Document, NodeIO } = await import(require.resolve("@gltf-transform/core"));
const { default: puppeteer } = await import(require.resolve("puppeteer"));
const directory = await mkdtemp(path.join(tmpdir(), "gab-pick-coverage-"));
const document = new Document(), buffer = document.createBuffer();
function plane(n, z) {
  const positions = new Float32Array((n + 1) ** 2 * 3), normals = new Float32Array(positions.length), indices = new Uint32Array(n * n * 6);
  for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) {
    const i = (y * (n + 1) + x) * 3;
    positions.set([x / n * 2 - 1, y / n * 2 - 1, z], i); normals[i + 2] = 1;
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const a = y * (n + 1) + x;
    indices.set([a, a + 1, a + n + 2, a, a + n + 2, a + n + 1], (y * n + x) * 6);
  }
  const attribute = (array, type) => document.createAccessor().setBuffer(buffer).setArray(array).setType(type);
  const primitive = document.createPrimitive().setAttribute("POSITION", attribute(positions, "VEC3"))
    .setAttribute("NORMAL", attribute(normals, "VEC3")).setIndices(attribute(indices, "SCALAR"))
    .setMaterial(document.createMaterial().setBaseColorFactor([.6, .6, .6, 1]));
  return document.createNode().setMesh(document.createMesh().addPrimitive(primitive));
}
document.createScene().addChild(plane(512, 0)).addChild(plane(1, -.1));
await new NodeIO().write(path.join(directory, "fixture.glb"), document);
const server = createServer(async (request, response) => {
  if (request.url !== "/fixture.glb") { response.writeHead(404).end(); return; }
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Content-Type", "model/gltf-binary");
  response.end(await readFile(path.join(directory, "fixture.glb")));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage(), errors = [];
  await page.setViewport({ width: 1200, height: 1000, deviceScaleFactor: 1 });
  page.on("pageerror", error => errors.push(String(error)));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.setRequestInterception(true);
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/v1/artifacts/")) request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({
      id: "dense-coverage", title: "Dense coverage", description: "Selection regression", type: "mesh", thumbnailUrl: null,
      contentUrl: `http://127.0.0.1:${server.address().port}/fixture.glb`, sizeBytes: 0
    }) });
    else if (url.pathname === "/favicon.ico") request.respond({ status: 204 });
    else request.continue();
  });
  await page.goto((process.env.VIEWER_BASE ?? "http://127.0.0.1:5175") + "/artifacts/dense-coverage");
  await page.waitForSelector('[aria-label="Select"]:not([disabled])', { timeout: 90000 });
  await page.$eval(".viewer-frame", node => node.scrollIntoView());
  await page.click('[aria-label="Look from Front"]');
  await page.click('[aria-label="Select"]');
  const box = await (await page.$(".viewer-canvas canvas")).boundingBox();
  const started = performance.now();
  await page.mouse.move(box.x + 5, box.y + 35); await page.mouse.down();
  await page.mouse.move(box.x + box.width - 5, box.y + box.height - 5, { steps: 5 }); await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector(".selection-toolbar [role=status]").textContent.includes("Selecting"));
  const elapsed = performance.now() - started;
  const counts = await page.evaluate(() => {
    const node = document.querySelector(".selection-toolbar");
    let fiber = node[Object.keys(node).find(key => key.startsWith("__reactFiber$"))];
    while (fiber && !fiber.memoizedProps?.handle) fiber = fiber.return;
    return fiber.memoizedProps.handle.selection.state.masks.map(mask => mask.filter(Boolean).length);
  });
  if (counts[0] !== 524288 || counts[1] !== 0) throw Error("Coverage/occlusion regression: " + JSON.stringify(counts));
  const screenshot = process.env.COVERAGE_SCREENSHOT ?? path.join(tmpdir(), "gab-selection-coverage.png");
  await page.screenshot({ path: screenshot });
  async function clickText(text) {
    const button = await page.evaluateHandle(text => [...document.querySelectorAll('.selection-actions button')].find(node => node.textContent.trim() === text), text);
    await button.click(); await button.dispose();
  }
  await clickText("Clear Selection"); await clickText("Brush");
  await page.focus('[aria-label="Brush size"]'); await page.keyboard.press("End");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2); await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector('.selection-toolbar [role=status]').textContent.includes('Selecting'));
  const brushed = await page.$eval('.selection-toolbar [role=status]', node => Number(node.textContent.split(' / ')[0].replaceAll(',', '')));
  if (!(brushed > 524288 * .1 && brushed < 524288 * .3)) throw Error("Brush footprint did not match 50% of the projected bounds: " + brushed);
  await page.screenshot({ path: screenshot.replace(/\.png$/, '-brush.png') });
  if (errors.length) throw Error(errors.join("\n"));
  console.log("PASS dense coverage + occlusion", { counts, brushed, gestureMilliseconds: Math.round(elapsed), screenshot });
} finally {
  await browser.close(); server.close(); await rm(directory, { recursive: true, force: true });
}
