// Downloads real PNG captures from the shared mesh/splat viewer canvas.
import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const derivatives = path.join(root, "mesh-splat-artifact-service/data/assets/derivatives");
const output = await mkdtemp(path.join(tmpdir(), "gab-capture-"));
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

const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage(), errors = [];
  page.setDefaultTimeout(30000);
  await page.setViewport({ width: 1200, height: 1000, deviceScaleFactor: 1 });
  page.on("pageerror", error => errors.push(String(error)));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const client = await page.createCDPSession();
  await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: output });
  await page.setRequestInterception(true);
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname === "/favicon.ico") request.respond({ status: 204 });
    else if (url.pathname === "/api/v1/artifacts") request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], nextCursor: null }) });
    else if (url.pathname.startsWith("/api/v1/artifacts/")) {
      const id = url.pathname.split("/").at(-1), asset = assets[id];
      request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({
        id, title: id, description: "Capture test", type: asset.type, thumbnailUrl: null,
        contentUrl: `http://127.0.0.1:${server.address().port}/${id}/${asset.file}`, sizeBytes: 0
      }) });
    } else request.continue();
  });
  const base = process.env.VIEWER_BASE ?? "http://127.0.0.1:5175";
  const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  async function waitForFile(filename) {
    const file = path.join(output, filename);
    for (let attempt = 0; attempt < 200; attempt++) {
      try { const data = await readFile(file); if (data.length > 1000) return data; } catch {}
      await pause(50);
    }
    throw new Error(`Capture was not downloaded: ${filename}`);
  }
  async function imageStats(data) {
    return page.evaluate(async base64 => {
      const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
      const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext("2d");
      context.drawImage(image, 0, 0); image.close();
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data, quadrants = [];
      for (const [x0, y0] of [[0, 0], [.5, 0], [0, .5], [.5, .5]]) {
        const colors = new Set();
        for (let y = y0 + .1; y < y0 + .4; y += .03) for (let x = x0 + .1; x < x0 + .4; x += .03) {
          const offset = (Math.floor(y * canvas.height) * canvas.width + Math.floor(x * canvas.width)) * 4;
          colors.add(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]}`);
        }
        quadrants.push(colors.size);
      }
      return { width: canvas.width, height: canvas.height, quadrants };
    }, data.toString("base64"));
  }
  const appHandle = () => page.evaluateHandle(() => {
    const node = document.querySelector(".selection-toolbar");
    let fiber = node[Object.keys(node).find(key => key.startsWith("__reactFiber$"))];
    while (fiber && !fiber.memoizedProps?.handle) fiber = fiber.return;
    return fiber.memoizedProps.handle;
  });
  async function typeText(selector, value) {
    await page.click(selector);
    await page.$eval(selector, element => element.select());
    await page.keyboard.type(value);
    if (!await page.$eval(selector, (element, expected) => element.value === expected, value)) throw new Error(`Typing did not update ${selector}`);
    const paused = await (await appHandle()).evaluate(async handle => {
      let frames = 0;
      const rendered = () => frames++;
      handle.app.on("postrender", rendered);
      await new Promise(resolve => setTimeout(resolve, 120));
      handle.app.off("postrender", rendered);
      return { autoRender: handle.app.autoRender, frames };
    });
    if (paused.autoRender || paused.frames) throw new Error(`Viewer rendered while typing in ${selector}: ${JSON.stringify(paused)}`);
    await page.$eval(".viewer-frame", element => element.focus());
    await new Promise(resolve => setTimeout(resolve, 50));
    if (!await (await appHandle()).evaluate(handle => handle.app.autoRender)) throw new Error(`Viewer did not resume after typing in ${selector}`);
  }
  async function capture(name, screenshot = false, annotated = false) {
    await page.click('[aria-label="Capture view"]');
    await typeText('[aria-label="Capture name"]', name);
    if (screenshot) await page.screenshot({ path: path.join(output, "capture-tool-ui.png") });
    await page.locator(`.capture-actions button ::-p-text(${annotated ? "Download with annotations" : "Download"})`).click();
    const data = await waitForFile(`${name}.png`);
    if (!data.subarray(1, 4).equals(Buffer.from("PNG"))) throw new Error("Downloaded file is not a PNG");
    return { data, stats: await imageStats(data) };
  }
  for (const id of Object.keys(assets)) {
    await page.goto(`${base}/artifacts/${id}`);
    await page.waitForSelector('[aria-label="Capture view"]:not([disabled])', { timeout: 90000 });
    await page.$eval(".viewer-frame", node => node.scrollIntoView());
    const canvas = await page.$eval(".viewer-canvas canvas", node => ({ width: node.width, height: node.height }));
    const singleCapture = await capture(`${id} single`, id === Object.keys(assets)[0]), single = singleCapture.stats;
    if (single.width !== canvas.width || single.height !== canvas.height) throw new Error(`Capture resolution changed: ${JSON.stringify({ canvas, single })}`);
    const surface = await page.evaluate(async () => {
      const node = document.querySelector(".selection-toolbar");
      let fiber = node[Object.keys(node).find(key => key.startsWith("__reactFiber$"))];
      while (fiber && !fiber.memoizedProps?.handle) fiber = fiber.return;
      const handle = fiber.memoizedProps.handle, bounds = handle.app.graphicsDevice.canvas.getBoundingClientRect();
      for (let v = .25; v <= .75; v += .05) for (let u = .25; u <= .75; u += .05) {
        if (await handle.selection.primitiveAt(handle.app, handle.camera(), u, v)) return { x: bounds.x + u * bounds.width, y: bounds.y + v * bounds.height };
      }
      return null;
    });
    if (!surface) throw new Error("No visible surface for annotation capture");
    await page.click('[aria-label="Annotate"]');
    await page.locator('button ::-p-text(Annotate with a point)').click();
    await page.mouse.click(surface.x, surface.y);
    await page.waitForSelector('input[name="title"]');
    await typeText('input[name="title"]', "Captured note");
    await typeText('textarea[name="description"]', "Visible annotation description");
    await page.locator('button ::-p-text(Save annotation)').click();
    const annotated = await capture(`${id} annotated`, false, true);
    if (annotated.data.equals(singleCapture.data)) throw new Error("Annotated capture did not change the PNG");
    await page.click('[aria-label="Four views"]');
    await page.waitForSelector(".viewport-layout.is-split");
    const split = (await capture(`${id} four views`)).stats;
    if (split.quadrants.some(colors => colors < 3)) throw new Error(`Four-view capture has an empty panel: ${JSON.stringify(split)}`);
    console.log("CAPTURED", id, { single, split });
  }
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("PASS mesh/splat single and four-view PNG downloads", output);
} finally { await browser.close(); server.close(); }
