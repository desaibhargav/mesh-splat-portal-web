// Real pointer/keyboard workflows with published mesh and splat fixtures.
// Read-only document assertions supplement visible screenshots; geometry is never mocked.
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";
const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const output = process.env.SEGMENT_TEST_OUTPUT ?? path.join(tmpdir(), "gab-segments-browser");
await mkdir(output, { recursive: true });
const require = createRequire(root + "/mesh-splat-artifact-service/package.json");
const { default: puppeteer } = await import(require.resolve("puppeteer"));
const assets = root + "/mesh-splat-artifact-service/data/assets/derivatives";
const server = createServer(async (req, res) => {
  try {
    const parts = new URL(req.url, "http://localhost").pathname.split("/").filter(Boolean);
    if (parts.length !== 2 || !["21e231-006699", "sakura-garden"].includes(parts[0]) || parts.some((p) => !/^[-a-zA-Z0-9._]+$/.test(p))) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", parts[1].endsWith(".json") ? "application/json" : parts[1].endsWith(".glb") ? "model/gltf-binary" : "image/webp");
    res.end(await readFile(path.join(assets, ...parts)));
  } catch (e) {
    res.writeHead(404);
    res.end(String(e));
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
try {
  page.setDefaultTimeout(2e4);
  page.setDefaultNavigationTimeout(9e4);
  await page.setViewport({
    width: 1200,
    height: 1e3,
    deviceScaleFactor: 1
  });
  const errors = [];
  page.on("pageerror", (e) => {
    errors.push(String(e));
    console.log("PAGE ERROR", e.stack);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) console.log("HTTP ERROR", r.status(), r.url());
  });
  page.on("console", (m) => {
    if (m.type() === "error") {
      errors.push(m.text());
      console.log("CONSOLE ERROR", m.text());
    }
  });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (new URL(req.url()).pathname === "/favicon.ico") {
      req.respond({ status: 204 });
    } else if (req.url().includes("/api/v1/artifacts?")) {
      req.respond({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: ["sakura-garden", "21e231-006699"].map((slug) => ({
            id: slug,
            title: slug,
            description: "test",
            type: slug === "21e231-006699" ? "mesh" : "splat",
            thumbnailUrl: null,
            contentUrl: `http://127.0.0.1:${server.address().port}/${slug}/${slug === "21e231-006699" ? "content.glb" : "meta.json"}`,
            sizeBytes: 0
          })),
          nextCursor: null
        })
      });
    } else if (req.url().includes("/api/v1/artifacts/")) {
      const slug = req.url().split("/").at(-1);
      req.respond({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: slug,
          title: slug,
          description: "Local selection validation",
          type: slug === "21e231-006699" ? "mesh" : "splat",
          thumbnailUrl: null,
          contentUrl: `http://127.0.0.1:${server.address().port}/${slug}/${slug === "21e231-006699" ? "content.glb" : "meta.json"}`,
          sizeBytes: 0
        })
      });
    } else req.continue();
  });
  const base = process.env.VIEWER_BASE ?? "http://127.0.0.1:5175";
  function check(ok, message) {
    if (!ok) throw new Error(message);
  }
  async function settle() {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }
  async function button(text, scope) {
    await page.locator(scope + " button ::-p-text(" + text + ")").click();
    await settle();
  }
  async function panelBox(id) {
    return (await page.$("[data-viewport=\"" + id + "\"]")).boundingBox();
  }
  async function pointer(id, u = .5, v = .5) {
    const b = await panelBox(id);
    await page.mouse.move(b.x + b.width * u, b.y + b.height * v);
    await settle();
  }
  async function click(p) {
    await page.mouse.click(p.x, p.y);
    await page.waitForFunction(() => ![...document.querySelectorAll("[role=status]")].some((e) => e.textContent === "Picking surface…"));
    await settle();
  }
  async function points(id, painted = false, cut = false) {
    const b = await panelBox(id), canvas = await page.$(".viewer-canvas canvas"), cbox = await canvas.boundingBox(), png = (await canvas.screenshot()).toString("base64");
    return page.evaluate(async (png, b, cbox, painted, cut) => {
      const bm = await createImageBitmap(await (await fetch("data:image/png;base64," + png)).blob()), c = new OffscreenCanvas(bm.width, bm.height), ctx = c.getContext("2d");
      ctx.drawImage(bm, 0, 0);
      bm.close();
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const results = [];
      for (const [u, v] of cut ? [[.56, .3], [.6, .4]] : painted ? [[.6, .22], [.45, .35]] : [[.38, .4], [.48, .5]]) {
        let best = Infinity, p = null;
        for (let y = b.height * .2 | 0; y < b.height * .8; y += 2) for (let x = b.width * .2 | 0; x < b.width * .75; x += 2) {
          const sx = Math.floor(b.x - cbox.x + x), sy = Math.floor(b.y - cbox.y + y), i = (sy * c.width + sx) * 4;
          if (painted && !(d[i] > d[i + 1] * 1.4 && d[i] > d[i + 2] * 1.4)) continue;
          if (document.elementFromPoint(b.x + x, b.y + y)?.tagName !== "CANVAS") continue;
          if (Math.abs(d[i] - 192) + Math.abs(d[i + 1] - 192) + Math.abs(d[i + 2] - 192) < 85) continue;
          const dist = (x / b.width - u) ** 2 + (y / b.height - v) ** 2;
          if (dist < best) {
            best = dist;
            p = {
              x: b.x + x,
              y: b.y + y
            };
          }
        }
        results.push(p);
      }
      return results;
    }, png, b, cbox, painted, cut);
  }
  async function selected() {
    return page.$eval(".selection-toolbar [role=status]", (e) => Number(e.textContent.split(" / ")[0].replaceAll(",", "")));
  }
  const appHandle = () => page.evaluateHandle(() => {
    const node = document.querySelector(".selection-toolbar");
    let f = node[Object.keys(node).find((k) => k.startsWith("__reactFiber$"))];
    while (f && !f.memoizedProps?.handle) f = f.return;
    return f.memoizedProps.handle;
  });
  async function doc() {
    const h = await appHandle();
    return h.evaluate((h) => {
      const n = document.querySelector(".selection-toolbar");
      let f = n[Object.keys(n).find((k) => k.startsWith("__reactFiber$"))];
      while (f && !f.memoizedProps?.workspaces) f = f.return;
      const w = f.memoizedProps.workspaces, d = w.current;
      return {
        id: d.id,
        name: d.name,
        total: h.selection.summary.total,
        selected: h.selection.summary.selected,
        colors: h.selection.colors.reduce((n, c) => n + c.filter(Boolean).length, 0),
        areas: h.selection.areas.filter((a) => a.saved).map((a) => a.name),
        notes: d.annotations.records.map((a) => a.title),
        measures: d.measurement.records.map((m) => m.name),
        sections: d.sections.records.length,
        cut: !!h.app.graphicsDevice.scope.resolve("portalSectionEnabled").getValue(),
        vertices: h.selection.parts?.map((p) => p.source.mesh.vertexBuffer.id),
        scope: h.selection.scope?.map((a) => a.filter(Boolean).length)
      };
    });
  }
  async function exact(text, scope = "") {
    const b = await page.evaluateHandle((text, scope) => [...(scope ? document.querySelector(scope) : document).querySelectorAll("button")].find((b) => b.textContent.trim() === text), text, scope);
    if (!b.asElement()) throw Error("Missing " + text);
    await b.click();
    await b.dispose();
    await settle();
  }
  async function drawBox() {
    const b = await panelBox("perspective");
    await page.mouse.move(b.x + b.width * .25, b.y + b.height * .22);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * .52, b.y + b.height * .77, { steps: 10 });
    await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector(".selection-toolbar [role=status]").textContent.includes("Selecting"));
    await settle();
  }
  for (const slug of ["21e231-006699", "sakura-garden"]) {
    console.log("LOAD", slug, base);
    await page.goto(base + "/artifacts/" + slug);
    await page.waitForSelector("button[aria-label=\"Select\"]:not([disabled])", { timeout: 9e4 });
    await page.$eval(".viewer-frame", (e) => e.scrollIntoView());
    if (slug === "sakura-garden") {
      await page.$eval("[aria-label=\"Look from Front\"]", (e) => e.focus());
      await page.keyboard.press("Enter");
      await settle();
    }
    await page.click("[aria-label=\"Select\"]");
    await exact("X-ray off");
    await drawBox();
    check((await doc()).selected > 0, "Select parent");
    await page.click("[aria-label=\"Color selection red\"]");
    await settle();
    await page.locator("[aria-label=\"Selection name\"]").fill("Parent region");
    await exact("Save selection");
    const parent = await doc();
    const outside = await (await appHandle()).evaluate(async (h) => {
      const result = [];
      for (let v = .25; v < .8; v += .15) for (let u = .58; u < .77; u += .05) {
        const hit = await h.selection.primitiveAt(h.app, h.camera(), u, v);
        if (hit && !h.selection.state.masks[hit.part][hit.index]) result.push({
          u,
          v
        });
      }
      return result;
    });
    await exact("Create segment");
    await page.locator("[aria-label=\"Segment name\"]").fill("Alpha");
    await exact("Save segment");
    console.log("CREATED", slug, await doc());
    let alpha = await doc();
    check(alpha.id > 0 && alpha.total === parent.selected && alpha.colors === 0 && alpha.areas.length === 0, "Independent segment initialization");
    check(JSON.stringify(alpha.vertices) === JSON.stringify(parent.vertices), "Geometry was duplicated");
    const rejected = await (await appHandle()).evaluate(async (h, points) => {
      for (const p of points) if (!await h.selection.primitiveAt(h.app, h.camera(), p.u, p.v)) return p;
      return null;
    }, outside);
    check(rejected, "No excluded parent surface to test");
    await page.click("[aria-label=\"Measure distance\"]");
    {
      const b = await (await page.$(".viewer-canvas canvas")).boundingBox();
      await click({
        x: b.x + b.width * rejected.u,
        y: b.y + b.height * rejected.v
      });
      check((await doc()).measures.length === 0, "Measurement picked outside segment");
    }
    await page.keyboard.press("q");
    // Hold an actual GPU result across a document switch; it must not land in the parent.
    await page.click("[aria-label=\"Select\"]");
    await (await appHandle()).evaluate((h) => {
      const original = h.selection.hitTest.bind(h.selection);
      h.selection.hitTest = async (...args) => {
        const hits = await original(...args);
        return new Promise((resolve) => {
          window.releaseSegmentPick = () => {
            h.selection.hitTest = original;
            resolve(hits);
            delete window.releaseSegmentPick;
          };
        });
      };
    });
    {
      const b = await panelBox("perspective");
      await page.mouse.move(b.x + b.width * .3, b.y + b.height * .3);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width * .5, b.y + b.height * .7, { steps: 8 });
      await page.mouse.up();
      await page.waitForFunction(() => typeof window.releaseSegmentPick === "function");
      await exact("Return to asset");
      await page.evaluate(() => window.releaseSegmentPick());
      await settle();
      check((await doc()).id === 0 && (await doc()).areas.length === 1 && (await doc()).selected === 0, "Stale GPU edit crossed workspaces");
      await page.click("[aria-label=\"Segment\"]");
      await exact("Alpha", ".segment-list");
    }
    await page.click("[aria-label=\"Select\"]");
    await exact("X-ray off");
    {
      const b = await panelBox("perspective");
      await page.mouse.move(b.x + b.width * .04, b.y + b.height * .15);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width * .77, b.y + b.height * .9, { steps: 10 });
      await page.mouse.up();
      await settle();
      check((await doc()).selected <= alpha.total, "X-ray escaped the segment");
    }
    await drawBox();
    await page.click("[aria-label=\"Color selection blue\"]");
    await settle();
    await page.locator("[aria-label=\"Selection name\"]").fill("Local region");
    await exact("Save selection");
    await exact("Remove Color");
    check((await doc()).colors === 0, "Remove Color did not affect the segment");
    await page.keyboard.down("Control");
    await page.keyboard.press("z");
    await page.keyboard.up("Control");
    check((await doc()).colors > 0, "Segment paint undo failed");
    await page.keyboard.down("Control");
    await page.keyboard.down("Shift");
    await page.keyboard.press("z");
    await page.keyboard.up("Shift");
    await page.keyboard.up("Control");
    check((await doc()).colors === 0, "Segment paint redo failed");
    await page.keyboard.down("Control");
    await page.keyboard.press("z");
    await page.keyboard.up("Control");
    await page.keyboard.press("q");
    check((await doc()).colors > 0, "Local paint disappeared");
    await page.click("[aria-label=\"Annotate\"]");
    await exact("Annotate with a point");
    let ps = await points("perspective");
    check(ps[0], "Visible segment surface");
    await click(ps[0]);
    await page.waitForSelector("input[name=\"title\"]");
    await page.type("input[name=\"title\"]", "Alpha note");
    await exact("Save annotation");
    await page.keyboard.press("q");
    await page.click("[aria-label=\"Measure distance\"]");
    ps = await points("perspective");
    await click(ps[0]);
    await click(ps[1]);
    await page.locator("[aria-label=\"Measurement name\"]").fill("Alpha span");
    await exact("Save measurement");
    await page.keyboard.press("q");
    alpha = await doc();
    check(alpha.notes[0] === "Alpha note" && alpha.measures[0] === "Alpha span", "Local tool records missing");
    await page.click("[aria-label=\"Four views\"]");
    await pointer("front");
    await page.click("[aria-label=\"Views\"]");
    await exact("Create view");
    await page.locator("[aria-label=\"View name\"]").fill("Segment reference");
    await exact("Save view");
    await page.click("[aria-label=\"Cross section\"]");
    await page.select("[aria-label=\"Section reference\"]", "1");
    await exact("Enable section");
    await page.locator("[aria-label=\"Section name\"]").fill("Segment cut");
    await exact("Save section");
    await page.keyboard.press("q");
    check((await doc()).cut, "Segment section did not enable");
    await page.click("[aria-label=\"Measure distance\"]");
    let cutPoints = await points("front");
    check(cutPoints.every(Boolean), "Sectioned segment has no surface");
    const candidates = await (await appHandle()).evaluate(async (h) => {
      const c = h.camera(), r = c.rect, b = h.app.graphicsDevice.canvas.getBoundingClientRect(), result = [];
      for (let y = .2; y < .8; y += .12) for (let x = .25; x < .75; x += .1) {
        const u = r.x + x * r.z, v = 1 - r.y - r.w + y * r.w;
        if (await h.selection.primitiveAt(h.app, c, u, v)) result.push({
          x: b.x + u * b.width,
          y: b.y + v * b.height
        });
      }
      return result;
    });
    for (const candidate of candidates) {
      await click(candidate);
      const n = await (await appHandle()).evaluate((h) => {
        const node = document.querySelector(".selection-toolbar");
        let f = node[Object.keys(node).find((k) => k.startsWith("__reactFiber$"))];
        while (f && !f.memoizedProps?.workspaces) f = f.return;
        const m = f.memoizedProps.workspaces.current.measurement;
        return m.records.at(-1)?.saved ? 0 : m.points.length;
      });
      if (n === 2) break;
    }
    await page.locator("[aria-label=\"Measurement name\"]").fill("Cut span");
    await exact("Save measurement");
    await page.keyboard.press("q");
    check((await doc()).measures.includes("Cut span"), "Sectioned segment measurement not saved");
    await page.screenshot({ path: path.join(output, slug + "-segment-quad.png") });
    await page.keyboard.press("Space");
    await page.keyboard.press("Space");
    await page.click("[aria-label=\"Segment\"]");
    await page.waitForFunction(() => document.querySelector("[aria-label=\"Segment name\"]")?.value === "Alpha");
    await exact("Return to asset");
    let root = await doc();
    check(root.id === 0 && !root.cut && root.notes.length === 0 && root.measures.length === 0 && root.colors === parent.colors, "Segment edits leaked into parent");
    check(root.areas[0] === "Parent region", "Parent saved region lost");
    await page.click("[aria-label=\"Segment\"]");
    await exact("Alpha", ".segment-list");
    let again = await doc();
    check(again.notes[0] === "Alpha note" && again.measures[0] === "Alpha span" && again.colors === alpha.colors && again.cut && again.measures.includes("Cut span"), "Segment edits not restored");
    await page.click(".viewer-tree-toggle");
    await page.click("[aria-label=\"Hide Alpha\"]");
    check((await doc()).total === 0, "Hidden segment rendered");
    await page.click("[aria-label=\"Show Alpha\"]");
    check((await doc()).total === alpha.total, "Shown segment lost scope");
    await page.click(".viewer-tree-toggle");
    await exact("Return to asset");
    await page.click("[aria-label=\"Segment\"]");
    await exact("New segment");
    await exact("X-ray off");
    await drawBox();
    await page.locator("[aria-label=\"Segment name\"]").fill("Beta");
    await exact("Save segment");
    check((await doc()).name === "Beta", "Draw new segment failed");
    await exact("Return to asset");
    await page.click("[aria-label=\"Segment\"]");
    await exact("From existing selection");
    let regionPoints = await points("front", true);
    check(regionPoints[0], "No parent colored point");
    await page.mouse.move(regionPoints[0].x, regionPoints[0].y);
    await page.waitForFunction(() => document.querySelector(".segment-options [role=status]")?.textContent.includes("Click Parent region"));
    await click(regionPoints[0]);
    await page.locator("[aria-label=\"Segment name\"]").fill("Gamma");
    await exact("Save segment");
    check((await doc()).total === parent.selected, "Selection conversion changed region");
    await page.click(".viewer-tree-toggle");
    await page.click("[aria-label=\"Rename Gamma\"]");
    await page.locator("[aria-label=\"Rename Gamma\"]").fill("Renamed segment");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector("[aria-label=\"Segment name\"]")?.value === "Renamed segment");
    await page.click(".viewer-tree-toggle");
    await exact("Return to asset");
    await page.click("[aria-label=\"Segment\"]");
    // Tree names open the same editors as saved boxes; eye/pencil stay independent.
    await page.click(".viewer-tree-toggle");
    await exact("Alpha", ".viewer-tree");
    check((await doc()).name === "Alpha", "Tree did not enter the segment");
    check(await page.$(".segment-options"), "Tree did not open Segment");
    if (await page.$('.viewer-tree[data-open="false"]')) await page.click(".viewer-tree-toggle");
    const banner = await (await page.$(".workspace-banner")).boundingBox();
    const canvasBox = await (await page.$(".viewer-canvas canvas")).boundingBox();
    check(banner.x + banner.width / 2 > canvasBox.x + canvasBox.width / 2, "Return action is not on the right");
    await exact("Local region", ".viewer-tree");
    await page.waitForFunction(() => document.querySelector('[aria-label="Selection name"]')?.value === "Local region");
    check((await doc()).selected > 0, "Tree did not activate the saved selection");
    await exact("Isolate", ".selection-options");
    await exact("Show all", ".selection-options");
    await exact("Brush", ".selection-shapes");
    await page.focus('[aria-label="Brush size"]'); await page.keyboard.press("End");
    await pointer("front", .2, .3);
    check(await page.$eval('[aria-label="Brush size"]', e => e.value === "50"), "Brush does not reach 50 percent");
    check(await page.$eval('.selection-brush-cursor', e => parseFloat(e.style.width) > 0), "Brush cursor not projected");
    await exact("Alpha span", ".viewer-tree");
    await page.waitForFunction(() => document.querySelector('[aria-label="Measurement name"]')?.value === "Alpha span");
    check(await page.$('.measurement-actions .tool-action-save'), "Tree did not open measurement editor");
    const rows = await page.$$eval('.measurement-actions .tool-slider', rows => rows.every(row => {
      const label = row.querySelector('label').getBoundingClientRect(), input = row.querySelector('input').getBoundingClientRect();
      return Math.abs(label.y + label.height / 2 - input.y - input.height / 2) < 2;
    }));
    check(rows, "Slider labels are not inline");
    await page.focus('[aria-label="Font size"]'); await page.keyboard.press("End");
    await page.focus('[aria-label="Line width"]'); await page.keyboard.press("End");
    await page.click('[aria-label="Reset font size"]');
    check(await page.$eval('[aria-label="Line width"]', e => e.value === "8"), "Font reset changed line width");
    await page.click('[aria-label="Reset line width"]');
    await page.screenshot({ path: path.join(output, slug + "-tree-measurement.png") });
    await page.click('[aria-label="Hide Alpha note"]');
    await exact("Alpha note", ".viewer-tree");
    await page.waitForFunction(() => document.querySelector('input[name="title"]')?.value === "Alpha note");
    await exact("Save annotation", ".annotation-actions");
    check(await page.$('[aria-label="Hide Alpha note"]'), "Saving tree-opened annotation hid it again");
    await page.keyboard.press("q");
    await page.click('[aria-label="Annotate"]');
    check(await page.$('.annotation-kinds'), "Old tree request reopened after leaving the tool");
    await exact("Segment reference", ".viewer-tree");
    await page.waitForFunction(() => document.querySelector('[aria-label="View name"]')?.value === "Segment reference");
    // Leaving a recalled view cancels its draft before the next tool frames.
    await exact("Alpha span", ".viewer-tree");
    await page.waitForFunction(() => document.querySelector('[aria-label="Measurement name"]')?.value === "Alpha span");
    const centered = await (await appHandle()).evaluate(h => {
      const node = document.querySelector(".selection-toolbar");
      let f = node[Object.keys(node).find(k => k.startsWith("__reactFiber$"))];
      while (f && !f.memoizedProps?.workspaces) f = f.return;
      const m = f.memoizedProps.workspaces.current.measurement;
      const record = m.records.find(item => item.name === "Alpha span");
      const bounds = h.space.worldBounds(m.bounds(record.id));
      return h.camera().entity.script.get("cameraControls").focusPoint.distance(bounds.center) < 1e-6;
    });
    check(centered, "View cancellation overwrote measurement framing");
    await exact("Segment cut", ".viewer-tree");
    await page.waitForFunction(() => document.querySelector('[aria-label="Section name"]')?.value === "Segment cut");
    await page.screenshot({ path: path.join(output, slug + "-tree-section.png") });
    await exact("Segment reference", ".viewer-tree");
    await exact("Alpha", ".viewer-tree");
    check(await (await appHandle()).evaluate(h => h.camera().entity.script.get("cameraControls").focusPoint.distance(h.selection.bounds(null).center) < 1e-6),
      "View cancellation overwrote segment framing");
    await page.setViewport({ width: 600, height: 1000, deviceScaleFactor: 1 }); await settle();
    const separated = await page.evaluate(() => {
      const a = document.querySelector('.workspace-banner').getBoundingClientRect(), b = document.querySelector('.annotation-panels').getBoundingClientRect();
      return a.right <= innerWidth && a.left >= 0 && (a.bottom <= b.top || b.bottom <= a.top || a.right <= b.left || b.right <= a.left);
    });
    check(separated, "Return card overlaps the tool options on a narrow screen");
    await page.screenshot({ path: path.join(output, slug + "-return-narrow.png") });
    await page.setViewport({ width: 1200, height: 1000, deviceScaleFactor: 1 }); await settle();

    await exact("Return to asset");
    await page.click('[aria-label="Segment"]');
    await page.click("[aria-label=\"Delete Renamed segment\"]");
    await page.click("[aria-label=\"Delete Beta\"]");
    await page.click("[aria-label=\"Delete Alpha\"]");
    check((await doc()).id === 0, "Delete changed parent");
    await page.locator(".back-link").click();
    await page.waitForSelector(".catalog-page");
    console.log("PASS segment create/select/paint/annotation/measurement/quad/return/reopen/visibility/delete/cleanup", slug);
  }
  if (errors.length) throw Error(errors.join("\n"));
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await browser.close();
  server.close();
}
