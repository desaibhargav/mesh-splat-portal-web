// Real engine AR/VR sessions with Meta IWER; emulator is test-only and never bundled.
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
const emulatorPath = process.env.XR_EMULATOR_PATH;
if (!emulatorPath) throw new Error("Set XR_EMULATOR_PATH to Meta IWER's build/iwer.js (see docs/xr.md).");
const emulator = await readFile(emulatorPath, "utf8");
const semPath = process.env.XR_SEM_PATH;
if (!semPath) throw new Error("Set XR_SEM_PATH to Meta SEM's build/iwer-sem.js for AR placement tests (see docs/xr.md).");
const sem = await readFile(semPath, "utf8");
const room = JSON.parse(await readFile(path.resolve(path.dirname(semPath), "../captures/office_small.json"), "utf8"));
room.spatialEntities = room.spatialEntities.filter(entity => entity.semanticLabel_META === "FLOOR");
const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage(), errors = [];
  await page.setViewport({ width: 1200, height: 1000, deviceScaleFactor: 1 });
  page.setDefaultTimeout(30000);
  page.on("pageerror", error => errors.push(String(error)));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.evaluateOnNewDocument(emulator + sem + `
    window.xrDevice = new IWER.XRDevice(IWER.metaQuest3, { stereoEnabled: true });
    window.xrDevice.installSEM(IWER_SEM.SyntheticEnvironmentModule);
    window.xrDevice.installRuntime({ forceInstall: true });
  `);
  await page.setRequestInterception(true);
  page.on("request", async request => {
    const url = new URL(request.url());
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.pathname === "/favicon.ico") request.respond({ status: 204 });
    else if (url.pathname === "/api/v1/artifacts") request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], nextCursor: null }) });
    else if (url.pathname.startsWith("/api/v1/artifacts/")) {
      const id = url.pathname.split("/").at(-1), asset = assets[id];
      request.respond({ status: 200, contentType: "application/json", body: JSON.stringify({
        id, title: id, description: "XR regression", type: asset.type, thumbnailUrl: null,
        contentUrl: `${url.origin}/${id}/${asset.file}`, sizeBytes: 0
      }) });
    } else if (assets[parts[0]] && parts.length === 2 && /^[-a-zA-Z0-9._]+$/.test(parts[1])) {
      try {
        const body = await readFile(path.join(derivatives, parts[0], parts[1]));
        request.respond({ status: 200, contentType: parts[1].endsWith(".glb") ? "model/gltf-binary" : parts[1].endsWith(".json") ? "application/json" : "application/octet-stream", body });
      } catch { request.respond({ status: 404 }); }
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
  async function settle(h) {
    await h.evaluate(async h => {
      for (let i=0;i<3;i++) await new Promise(resolve => h.app.once("postrender", resolve));
    });
  }
  const targetPose = h => h.evaluate(h => {
    const root=h.app.root.findByName("Immersive artifact");
    return {position:root.getPosition().toArray(),rotation:root.getRotation().toArray(),scale:root.getLocalScale().x};
  });
  async function manipulate(h, id, type) {
    await page.waitForFunction(h => h.app.root.findByName("XR controller left")?.findComponents("render").length &&
      h.app.root.findByName("XR controller right")?.findComponents("render").length, {timeout:45000}, h);
    await page.evaluate(() => {
      const d=window.xrDevice;
      d.controllers.left.position.set(-.18,1.6,-.8); d.controllers.right.position.set(.18,1.6,-.8);
      d.controllers.left.quaternion.set(0,0,0,1); d.controllers.right.quaternion.set(0,0,0,1);
      d.controllers.left.updateButtonValue("squeeze",0); d.controllers.right.updateButtonValue("squeeze",0);
    });
    await settle(h);
    const before=await targetPose(h);
    const canvas=await h.evaluateHandle(h => h.app.graphicsDevice.canvas);
    const imageBefore=await canvas.asElement().screenshot();
    await page.screenshot({path:path.join(output,`${id}-${type}-controllers-ready.png`)});
    await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("squeeze",1)); await settle(h);
    await page.evaluate(() => { window.xrDevice.controllers.right.position.x+=.2; }); await settle(h);
    const moved=await targetPose(h);
    check(Math.abs(moved.position[0]-before.position[0]-.2)<1e-4,"One-controller drag did not follow its tracked grip");
    await page.evaluate(() => window.xrDevice.controllers.right.quaternion.set(Math.sin(Math.PI/12),0,0,Math.cos(Math.PI/12))); await settle(h);
    const tilted=await targetPose(h);
    check(tilted.rotation.some((value,i)=>Math.abs(value-moved.rotation[i])>.01),"One-controller tilt did not rotate artifact");
    await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("squeeze",0)); await settle(h);
    const released=await targetPose(h); await settle(h);
    check(JSON.stringify(released)===JSON.stringify(await targetPose(h)),"Released artifact kept moving");
    const imageAfter=await canvas.asElement().screenshot();
    check(!imageBefore.equals(imageAfter),"Grip movement did not change rendered artifact");
    await page.evaluate(() => {
      window.xrDevice.controllers.left.updateButtonValue("squeeze",1);
      window.xrDevice.controllers.right.updateButtonValue("squeeze",1);
    }); await settle(h);
    const twoStart=await targetPose(h);
    await page.evaluate(() => {
      window.xrDevice.controllers.left.position.x-=.2;
      window.xrDevice.controllers.right.position.x+=.2;
    }); await settle(h);
    const larger=await targetPose(h);
    check(Math.abs(larger.scale-twoStart.scale)<1e-5,"Two-grip movement unexpectedly changed joystick-controlled zoom");
    await page.evaluate(() => {
      window.xrDevice.controllers.left.position.z+=.2;
      window.xrDevice.controllers.right.position.z-=.2;
    }); await settle(h);
    const turned=await targetPose(h);
    check(turned.rotation.some((value,i)=>Math.abs(value-larger.rotation[i])>.01),"Native two-controller turn did not rotate artifact");
    await page.evaluate(() => {
      window.xrDevice.controllers.left.position.y+=.15;
      window.xrDevice.controllers.right.position.y+=.15;
    }); await settle(h);
    const shifted=await targetPose(h);
    check(Math.abs(shifted.position[1]-turned.position[1]-.15)<1e-4,"Native two-controller translation did not follow hands");
    await page.evaluate(() => window.xrDevice.controllers.left.updateButtonValue("squeeze",0)); await settle(h);
    const oneAgain=await targetPose(h);
    check(oneAgain.position.every((value,i)=>Math.abs(value-shifted.position[i])<1e-4),"Two-to-one transition jumped");
    await page.evaluate(() => { window.xrDevice.controllers.right.position.x+=.1; }); await settle(h);
    const resumed=await targetPose(h);
    check(Math.abs(resumed.position[0]-oneAgain.position[0]-.1)<1e-4,"One-controller grab did not resume after two-hand resize");
    await page.evaluate(() => { window.xrDevice.controllers.right.connected=false; }); await settle(h);
    const disconnected=await targetPose(h); await settle(h);
    check(JSON.stringify(disconnected)===JSON.stringify(await targetPose(h)),"Tracking-source removal left grab active");
    await page.screenshot({path:path.join(output,`${id}-${type}-controllers-manipulated.png`)});
    await page.evaluate(() => {
      window.xrDevice.controllers.right.updateButtonValue("squeeze",0);
      window.xrDevice.controllers.left.updateButtonValue("squeeze",0);
      window.xrDevice.controllers.right.connected=true;
    }); await settle(h);
    const orbitBefore=await targetPose(h);
    const orbitImageBefore=await canvas.asElement().screenshot();
    await page.evaluate(() => window.xrDevice.controllers.left.updateButtonValue("trigger",1)); await settle(h);
    await page.evaluate(() => { window.xrDevice.controllers.left.position.x+=.12; }); await settle(h);
    const orbited=await targetPose(h);
    check(orbited.rotation.some((value,i)=>Math.abs(value-orbitBefore.rotation[i])>.01),"Left trigger gesture did not orbit");
    check(!orbitImageBefore.equals(await canvas.asElement().screenshot()), "Orbit did not visibly turn the artifact");
    await settle(h);
    const heldOrbit=await targetPose(h);
    check(heldOrbit.position.every((value,i)=>Math.abs(value-orbited.position[i])<1e-4), "Orbit pivot oscillated while the controller was held still");
    await page.evaluate(() => window.xrDevice.controllers.left.updateButtonValue("trigger",0)); await settle(h);
    const panBefore=await targetPose(h);
    await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("trigger",1)); await settle(h);
    await page.evaluate(() => { window.xrDevice.controllers.right.position.x+=.12; }); await settle(h);
    const panned=await targetPose(h);
    check(Math.abs(panned.position[0]-panBefore.position[0])>.05,"Right trigger gesture did not pan");
    await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("trigger",0)); await settle(h);
    const zoomBefore=await targetPose(h);
    await page.evaluate(() => window.xrDevice.controllers.left.updateAxes("thumbstick",0,-1)); await settle(h);
    const zoomed=await targetPose(h);
    check(zoomed.scale>zoomBefore.scale,"Left thumbstick forward did not zoom in");
    await page.evaluate(() => window.xrDevice.controllers.left.updateAxes("thumbstick",0,1)); await settle(h);
    const zoomedOut=await targetPose(h);
    check(zoomedOut.scale<zoomed.scale,"Left thumbstick backward did not zoom out");
    await page.evaluate(() => window.xrDevice.controllers.left.updateAxes("thumbstick",0,0)); await settle(h);
    console.log("PASS",id,type,"controller models, grip movement, orbit, pan, zoom, release, transition, disconnect");
  }
  for (const id of Object.keys(assets)) {
    await page.goto(`${base}/artifacts/${id}`);
    await page.evaluate(environment => window.xrDevice.sem.loadEnvironment(environment), room);
    await page.waitForSelector('[aria-label="Select"]:not([disabled])', { timeout: 90000 });
    await page.waitForSelector('[aria-label="View in VR"]');
    check(await page.evaluate(() => {
      const footer = document.querySelector(".viewer-footer"), vr = footer?.querySelector('[aria-label="View in VR"]');
      const ar = footer?.querySelector('[aria-label="View in your room"]');
      const bounds = footer?.getBoundingClientRect(), vrBounds = vr?.getBoundingClientRect();
      return !!(vr && ar && bounds && vrBounds && vrBounds.width <= 35 && vrBounds.bottom <= bounds.bottom &&
        !document.querySelector(".viewer-help") && !document.querySelector('[aria-label="Four views"]'));
    }), "Compact bottom VR/AR controls did not replace the instructions and four-view button");
    await page.$eval(".viewer-frame", element => element.scrollIntoView());
    const h = await handle();
    const desktopCamera = () => h.evaluate(h => ({
      position: h.camera().entity.getPosition().toArray(),
      rotation: h.camera().entity.getRotation().toArray(),
      focus: h.camera().entity.script.get("cameraControls").focusPoint.toArray()
    }));
    const canvasBounds = await (await page.$(".viewer-canvas canvas")).boundingBox();
    const x = canvasBounds.x + canvasBounds.width * .5, y = canvasBounds.y + canvasBounds.height * .5;
    const desktopBefore = await desktopCamera();
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 90, y - 35, { steps: 8 }); await page.mouse.up(); await settle(h);
    const desktopOrbit = await desktopCamera();
    check(desktopOrbit.rotation.some((value, index) => Math.abs(value - desktopBefore.rotation[index]) > .001), "Desktop orbit stopped working");
    await page.keyboard.down("Shift"); await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 70, y + 30, { steps: 8 }); await page.mouse.up(); await page.keyboard.up("Shift"); await settle(h);
    const desktopPan = await desktopCamera();
    check(desktopPan.focus.some((value, index) => Math.abs(value - desktopOrbit.focus[index]) > .001), "Desktop pan stopped working");
    await page.mouse.wheel({ deltaY: -250 }); await settle(h);
    const desktopZoom = await desktopCamera();
    check(desktopZoom.position.some((value, index) => Math.abs(value - desktopPan.position[index]) > .001), "Desktop zoom stopped working");
    console.log("PASS", id, "desktop orbit, pan, zoom before XR entry");
    // Denied permission must leave the desktop viewer ready to retry.
    await page.evaluate(() => {
      const request = navigator.xr.requestSession.bind(navigator.xr);
      navigator.xr.requestSession = () => { navigator.xr.requestSession = request; return Promise.reject(new Error("XR permission denied for regression")); };
    });
    await page.click('[aria-label="View in VR"]');
    await page.waitForFunction(() => document.querySelector('.immersive-controls [role=alert]')?.textContent.includes("permission denied"));
    check(await h.evaluate(h => !h.app.xr.active && h.viewports.perspectivePanel.camera.entity.parent === h.app.root), "Failed entry did not restore desktop");
    for (const split of [false, true]) {
      if (split) {
        await page.hover(".viewer-canvas canvas"); await page.focus(".viewer-frame"); await page.keyboard.press("Space");
        await page.click('[aria-label="Look from Top"]');
      }
      const initialBounds = await h.evaluate(h => { const b = h.selection.bounds(null); return { center: b.center.toArray(), halfExtents: b.halfExtents.toArray() }; });
      const before = await h.evaluate(h => ({
        split: h.viewports.split, active: h.viewports.active.id,
        root: Array.from(h.space.root.getWorldTransform().data),
        cameras: h.viewports.panels.map(p => ({ id:p.id, enabled:p.camera.enabled, rect:p.camera.rect.toArray(),
          position:p.camera.entity.getPosition().toArray(), rotation:p.camera.entity.getRotation().toArray(),
          near:p.camera.nearClip, far:p.camera.farClip, projection:p.camera.projection,
          background:p.camera.clearColor.toArray(), controls:p.camera.entity.script.get("cameraControls").enabled }))
      }));
      for (const [label, type] of [["View in VR", "immersive-vr"], ["View in your room", "immersive-ar"]]) {
        await page.click(`[aria-label="${label}"]`);
        await page.waitForFunction(() => document.querySelector('.viewer-frame')?.dataset.immersive === "true");
        await h.evaluate(async h => {
          while (h.app.xr.views.list.length !== 2) await new Promise(requestAnimationFrame);
          await new Promise(resolve => h.app.once("postrender", resolve));
        });
        if (type === "immersive-ar") {
          check(await h.evaluate(h => !h.app.root.findByName("Immersive artifact").enabled), "AR artifact appeared before surface placement");
          await page.evaluate(() => {
            const c=window.xrDevice.controllers.right;
            c.position.set(.3,1.3,-.5);
            c.quaternion.set(-Math.sin(7*Math.PI/36),0,0,Math.cos(7*Math.PI/36));
          });
          await page.waitForFunction(h => h.app.root.findByName("AR placement target")?.enabled, {timeout:15000}, h);
          await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("trigger",1));
          await page.waitForFunction(h => h.app.root.findByName("Immersive artifact")?.enabled, {timeout:15000}, h);
          await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("trigger",0));
          const bottom = await h.evaluate((h, bounds) => {
            const root = h.app.root.findByName("Immersive artifact");
            const point = { x: bounds.center[0], y: bounds.center[1] - bounds.halfExtents[1], z: bounds.center[2] };
            return root.getWorldTransform().transformPoint(point).toArray();
          }, initialBounds);
          check(Math.abs(bottom[1] - .048785) < .01, "AR artifact did not rest on the detected floor: " + JSON.stringify(bottom));
          if (!split) await page.screenshot({path:path.join(output, `${id}-ar-placed.png`)});
        }
        const state = await h.evaluate(h => {
          const c=h.camera(), bounds=h.selection.bounds(null), parent=c.entity.parent;
          const relative = parent.getWorldTransform().clone().invert().transformPoint(bounds.center);
          return { type:h.app.xr.type, split:h.viewports.split, active:h.viewports.active.id, views:h.app.xr.views.list.length,
            controls:c.entity.script.get("cameraControls").enabled, alpha:c.clearColor.a,
            relative:relative.toArray(), eye:c.entity.getLocalPosition().toArray(),
            root:Array.from(h.space.root.getLocalTransform().data),
            drawCalls:h.app.stats.drawCalls.total };
        });
        check(state.type===type && state.views===2 && !state.split && state.active==="perspective" && !state.controls, "XR camera lifecycle: "+JSON.stringify(state));
        check(state.drawCalls>0, "XR rendered no draw calls");
        check(type!=="immersive-ar" || state.alpha===0, "Passthrough background is opaque");
        check(JSON.stringify(state.root)===JSON.stringify(before.root), "XR changed asset geometry space");
        check(type === "immersive-ar" || Math.abs(state.relative[0]-state.eye[0])<1e-4 && Math.abs(state.relative[1]-state.eye[1])<1e-4 && Math.abs(state.relative[2]-state.eye[2]+1.5)<1e-4,
          "Artifact was not placed in front of the first tracked pose: "+JSON.stringify(state));
        if (!split && type === "immersive-vr") {
          await page.evaluate(() => { window.xrDevice.position.z -= .9; });
          await h.evaluate(async h => { for (let i=0;i<3;i++) await new Promise(resolve => h.app.once("postrender",resolve)); });
          await page.screenshot({path:path.join(output,`${id}-close-view.png`)});
          await page.evaluate(() => { window.xrDevice.position.z += .9; });
          await h.evaluate(async h => { for (let i=0;i<3;i++) await new Promise(resolve => h.app.once("postrender",resolve)); });
          await page.evaluate(() => { window.xrDevice.position.z -= 3; window.xrDevice.quaternion.set(0, 1, 0, 0); });
          await h.evaluate(async h => { for (let i=0;i<3;i++) await new Promise(resolve => h.app.once("postrender",resolve)); });
          await page.screenshot({path:path.join(output,`${id}-rear-before.png`)});
          await page.evaluate(() => { window.xrDevice.position.z += 3; window.xrDevice.quaternion.set(0, 0, 0, 1); });
          await h.evaluate(async h => { for (let i=0;i<3;i++) await new Promise(resolve => h.app.once("postrender",resolve)); });
        }
        if (!split) await manipulate(h, id, type);
        const canvas = await h.evaluateHandle(h => h.app.graphicsDevice.canvas);
        const first = await canvas.asElement().screenshot();
        await page.screenshot({ path:path.join(output, `${id}-${type}-${split?"split":"single"}.png`) });
        await page.evaluate(() => { window.xrDevice.position.x += .2; });
        await h.evaluate(async h => { await new Promise(resolve => h.app.once("postrender", resolve)); await new Promise(resolve => h.app.once("postrender", resolve)); });
        const moved = await canvas.asElement().screenshot();
        check(!first.equals(moved), "Tracked head movement did not change rendered image");
        if (!split) {
          await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("b-button", 1));
        } else {
          await h.evaluate(async h => { await new Promise(resolve => h.app.xr.end(resolve)); });
        }
        await page.waitForFunction(() => document.querySelector('.viewer-frame')?.dataset.immersive === "false");
        if (!split) {
          await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("b-button", 0));
        }
        check(await h.evaluate(h => !h.app.root.findByName("Immersive artifact") && !h.app.root.findByName("XR controller left") && !h.app.root.findByName("XR controller right")), "XR resources leaked after exit");
        const after = await h.evaluate(h => ({
          split:h.viewports.split, active:h.viewports.active.id,
          root:Array.from(h.space.root.getWorldTransform().data),
          cameras:h.viewports.panels.map(p => ({id:p.id, enabled:p.camera.enabled, rect:p.camera.rect.toArray(),
            position:p.camera.entity.getPosition().toArray(), rotation:p.camera.entity.getRotation().toArray(),
            near:p.camera.nearClip, far:p.camera.farClip, projection:p.camera.projection,
            background:p.camera.clearColor.toArray(), controls:p.camera.entity.script.get("cameraControls").enabled}))
        }));
        const near = (a, b) => a.every((value, index) => Math.abs(value - b[index]) < 1e-5);
        check(after.split === before.split && after.active === before.active && near(after.root, before.root) &&
          after.cameras.every((camera, index) => {
            const previous = before.cameras[index];
            return camera.id === previous.id && camera.enabled === previous.enabled && camera.near === previous.near &&
              camera.far === previous.far && camera.projection === previous.projection && camera.controls === previous.controls &&
              near(camera.rect, previous.rect) && near(camera.position, previous.position) &&
              near(camera.rotation, previous.rotation) && near(camera.background, previous.background);
          }), "XR exit did not restore desktop: "+JSON.stringify({before,after}));
        console.log("PASS",id,type,split?"four views restored":"single view restored", "stereo draw calls",state.drawCalls);
      }
    }
    // The same document must receive stereo XR picks and remain editable on desktop.
    await page.click('[aria-label="Measure distance"]');
    check(await page.$eval('.measurement-panels', node => !!node && getComputedStyle(node).display !== "none"),
      "Desktop Measurement options did not open on tool entry");
    await page.click('[aria-label="View in VR"]');
    await page.waitForFunction(() => document.querySelector('.viewer-frame')?.dataset.immersive === "true");
    const menuReady = await h.evaluate(h => {
      const menu = h.viewports.perspectivePanel.camera.entity.script?.get("xrMenu");
      return !!menu?._menuVisible && menu.menuItems[3].label === "Place points";
    });
    check(menuReady, "Measurement menu did not open automatically on XR entry");
    await page.waitForFunction(h => h.viewports.perspectivePanel.camera.entity.script.get("xrMenu")._currentOpacity > .99,
      { timeout: 10000 }, h);
    await page.screenshot({ path:path.join(output, `${id}-measurement-menu.png`) });
    const positionRightRay = async point => {
      await page.evaluate(() => {
        const c = window.xrDevice.controllers.right;
        c.position.set(0, 0, 0); c.quaternion.set(0, 0, 0, 1);
      });
      await settle(h);
      const origin = await h.evaluate(h => h.app.xr.input.inputSources.find(source => source.handedness === "right").getOrigin().toArray());
      await page.evaluate(position => window.xrDevice.controllers.right.position.set(...position),
        point.map((value, index) => value - origin[index]));
      await settle(h);
    };
    const menuTarget = index => h.evaluate((h, index) => {
      const menu = h.viewports.perspectivePanel.camera.entity.script.get("xrMenu");
      const corners = menu._buttons[index].element.worldCorners;
      return [(corners[0].x + corners[2].x) / 2, (corners[0].y + corners[2].y) / 2, (corners[0].z + corners[2].z) / 2 + .25];
    }, index);
    await positionRightRay(await menuTarget(3));
    check(await h.evaluate(h => h.viewports.perspectivePanel.camera.entity.script.get("xrMenu")._hoveredButton?.menuData?.index === 3),
      "Controller ray did not hover Place points");
    await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("trigger", 1)); await settle(h);
    await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("trigger", 0)); await settle(h);
    check(await h.evaluate(h => !h.viewports.perspectivePanel.camera.entity.script?.get("xrMenu")?._menuVisible),
      "Controller ray did not activate Place points and close the menu");
    const whileMeasuring = await targetPose(h);
    await page.evaluate(() => window.xrDevice.controllers.left.updateAxes("thumbstick", 0, -1)); await settle(h);
    check((await targetPose(h)).scale > whileMeasuring.scale, "Thumbstick zoom stopped in Measure mode");
    await page.evaluate(() => window.xrDevice.controllers.left.updateAxes("thumbstick", 0, 0)); await settle(h);
    await page.evaluate(() => window.xrDevice.controllers.left.updateButtonValue("trigger", 1)); await settle(h);
    await page.evaluate(() => { window.xrDevice.controllers.left.position.x += .08; }); await settle(h);
    check((await targetPose(h)).rotation.some((v,i) => Math.abs(v - whileMeasuring.rotation[i]) > .01),
      "Orbit stopped in Measure mode");
    await page.evaluate(() => { window.xrDevice.controllers.left.position.x -= .08; }); await settle(h);
    await page.evaluate(() => window.xrDevice.controllers.left.updateButtonValue("trigger", 0)); await settle(h);
    await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("trigger", 1)); await settle(h);
    await page.evaluate(() => { window.xrDevice.controllers.right.position.x += .08; }); await settle(h);
    check(Math.abs((await targetPose(h)).position[0] - whileMeasuring.position[0]) > .02,
      "Pan stopped in Measure mode");
    await page.evaluate(() => { window.xrDevice.controllers.right.position.x -= .08; }); await settle(h);
    await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("trigger", 0)); await settle(h);
    await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("squeeze", 1)); await settle(h);
    await page.evaluate(() => { window.xrDevice.controllers.right.position.x += .08; }); await settle(h);
    check(Math.abs((await targetPose(h)).position[0] - whileMeasuring.position[0]) > .02,
      "Grip movement stopped in Measure mode");
    await page.evaluate(() => { window.xrDevice.controllers.right.position.x -= .08; }); await settle(h);
    await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("squeeze", 0)); await settle(h);
    const measurementRecords = () => page.evaluate(() => {
      const node = document.querySelector(".selection-toolbar");
      let fiber = node[Object.keys(node).find(key => key.startsWith("__reactFiber$"))];
      while (fiber && !fiber.memoizedProps?.workspaces) fiber = fiber.return;
      return fiber.memoizedProps.workspaces.current.measurement.records.map(record => ({
        id: record.id, saved: record.saved, points: record.points.map(point => point.toArray())
      }));
    });
    const aim = async (dx, dy) => {
      const target = await h.evaluate((h, offset) => {
        const bounds = h.selection.bounds(null);
        const center = bounds.center;
        const radius = bounds.halfExtents.length();
        return [center.x + offset[0], center.y + offset[1], center.z + radius * 2 + .5];
      }, [dx, dy]);
      await positionRightRay(target);
      await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("trigger", 1)); await settle(h);
      await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("trigger", 0)); await settle(h);
    };
    const candidates = [[0,0],[-.12,0],[.12,0],[0,.12],[0,-.12],[-.12,.12],[.12,-.12],
      [-.25,0],[.25,0],[0,.25],[0,-.25],[-.25,.2],[.25,.2],[-.25,-.2],[.25,-.2]];
    for (const [dx, dy] of candidates) {
      await aim(dx,dy);
      if ((await measurementRecords()).at(-1)?.points.length === 1) break;
    }
    check((await measurementRecords()).at(-1)?.points.length === 1,
      "XR controller ray missed the first surface point: " + JSON.stringify(await h.evaluate(h => ({
        status: h.viewports.perspectivePanel.camera.entity.script.get("xrMenu").menuItems[2].label,
        bounds: h.selection.bounds(null)?.center.toArray(),
        scale: h.app.root.findByName("Immersive artifact")?.getLocalScale().toArray()
      }))));
    for (const [dx, dy] of candidates.slice(1)) {
      await aim(dx,dy);
      if ((await measurementRecords()).at(-1)?.points.length === 2) break;
    }
    check((await measurementRecords()).at(-1)?.points.length === 2, "XR controller ray missed the second surface point");
    check(await h.evaluate(h => !!h.app.root.findByName("Measurement segment")), "XR points did not produce a scene measurement");
    await page.evaluate(() => { window.xrDevice.controllers.left.connected=false; window.xrDevice.controllers.right.connected=false; });
    await settle(h);
    await page.screenshot({ path:path.join(output, `${id}-measurement-line.png`) });
    await page.evaluate(() => { window.xrDevice.controllers.left.connected=true; window.xrDevice.controllers.right.connected=true; });
    await settle(h);
    await page.waitForFunction(h => h.viewports.perspectivePanel.camera.entity.script.get("xrMenu")._currentOpacity > .99,
      { timeout: 10000 }, h);
    await positionRightRay(await menuTarget(4));
    check(await h.evaluate(h => h.viewports.perspectivePanel.camera.entity.script.get("xrMenu")._hoveredButton?.menuData?.index === 4),
      "Controller ray did not hover Save measurement");
    await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("trigger", 1)); await settle(h);
    await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("trigger", 0)); await settle(h);
    check((await measurementRecords()).at(-1)?.saved, "XR Save did not update the shared measurement document");
    const priorB = (await measurementRecords()).at(-1).points[1];
    await positionRightRay(await menuTarget(8));
    await new Promise(resolve => setTimeout(resolve, 350));
    await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("trigger", 1)); await settle(h);
    await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("trigger", 0)); await settle(h);
    check(await h.evaluate(h => !h.viewports.perspectivePanel.camera.entity.script.get("xrMenu")._menuVisible),
      "Move point B did not arm surface picking");
    for (const [dx, dy] of [[-.12,0],[0,.12],[0,-.12],[.12,.12],[-.12,-.12],[0,0]]) {
      await aim(dx, dy);
      const now = (await measurementRecords()).at(-1).points[1];
      if (now.some((value, index) => Math.abs(value - priorB[index]) > 1e-6)) break;
    }
    check((await measurementRecords()).at(-1).points[1].some((value, index) => Math.abs(value - priorB[index]) > 1e-6),
      "XR Move point B did not edit the shared saved measurement");
    await page.waitForFunction(h => h.viewports.perspectivePanel.camera.entity.script.get("xrMenu")._currentOpacity > .99,
      { timeout: 10000 }, h);
    await positionRightRay(await menuTarget(0));
    check(await h.evaluate(h => h.viewports.perspectivePanel.camera.entity.script.get("xrMenu")._hoveredButton?.menuData?.index === 0),
      "Controller ray did not hover Navigate");
    await new Promise(resolve => setTimeout(resolve, 350));
    await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("trigger", 1)); await settle(h);
    await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("trigger", 0)); await settle(h);
    check(await h.evaluate(h => !h.viewports.perspectivePanel.camera.entity.script.get("xrMenu")._menuVisible),
      "Navigate did not close the XR tool menu");
    await page.evaluate(() => window.xrDevice.controllers.left.updateButtonValue("y-button", 1)); await settle(h);
    await page.evaluate(() => window.xrDevice.controllers.left.updateButtonValue("y-button", 0)); await settle(h);
    check(await h.evaluate(h => h.viewports.perspectivePanel.camera.entity.script.get("xrMenu")._menuVisible),
      "Left Y did not reopen the XR tool menu from Navigate");
    await positionRightRay(await menuTarget(1));
    await new Promise(resolve => setTimeout(resolve, 350));
    await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("trigger", 1)); await settle(h);
    await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("trigger", 0)); await settle(h);
    check(await page.$eval('[aria-label="Measure distance"]', node => node.getAttribute("aria-pressed") === "true"),
      "XR Measure command did not switch the shared desktop tool");
    await h.evaluate(async h => { await new Promise(resolve => h.app.xr.end(resolve)); });
    await page.waitForFunction(() => document.querySelector('.viewer-frame')?.dataset.immersive === "false");
    check(await page.$eval('[aria-label="Saved measurements"]', node => node.textContent.includes("Measurement")),
      "Saved XR measurement was absent from the desktop tool");
    await page.keyboard.press("q");
    console.log("PASS", id, "XR measurement menu, stereo scene line, controller points, save, desktop record");
    // Existing cuts follow the artifact presentation and restore their source plane on exit.
    await page.click('[aria-label="Cross section"]');
    await page.locator('.section-buttons button ::-p-text(Enable section)').click();
    await page.locator('[aria-label="Section name"]').fill("XR cut");
    await page.locator('.section-options button ::-p-text(Save section)').click();
    const cut = await h.evaluate(h => Array.from(h.app.graphicsDevice.scope.resolve("portalSectionPlane").getValue()));
    await page.keyboard.press("q");
    await page.click('[aria-label="View in your room"]');
    await page.waitForFunction(() => document.querySelector('.viewer-frame')?.dataset.immersive === "true");
    await h.evaluate(async h => { await new Promise(resolve => h.app.once("postrender", resolve)); });
    check(await h.evaluate((h, expected) => {
      const root=h.app.root.findByName("Immersive artifact"), matrix=root.getWorldTransform().clone().transpose();
      const actual=h.app.graphicsDevice.scope.resolve("portalSectionPlane").getValue();
      // M^T * presented plane recovers the source equation without assuming a
      // source format, object size, or XR presentation transform.
      const equation=h.camera().rect.clone().set(...actual);
      const recovered=matrix.transformVec4(equation).toArray();
      return h.app.graphicsDevice.scope.resolve("portalSectionEnabled").getValue()===1 && recovered.every((value,i)=>Math.abs(value-expected[i])<1e-4);
    }, cut), "XR changed the retained section half-space");
    await h.evaluate(async h => { await new Promise(resolve => h.app.xr.end(resolve)); });
    await page.waitForFunction(() => document.querySelector('.viewer-frame')?.dataset.immersive === "false");
    check(await h.evaluate(h => h.app.graphicsDevice.scope.resolve("portalSectionEnabled").getValue() === 1), "XR exit lost the existing section");
    console.log("PASS", id, "section composition");
    // Enter directly from a naming field: text-entry rendering must yield to XR
    // and must not leave the desktop render loop paused after the session ends.
    await page.click('[aria-label="Capture view"]');
    await page.click('[aria-label="Capture name"]');
    check(await h.evaluate(h => !h.app.autoRender), "Typing did not pause desktop rendering");
    await page.click('[aria-label="View in VR"]');
    await page.waitForFunction(() => document.querySelector('.viewer-frame')?.dataset.immersive === "true");
    check(await h.evaluate(h => h.app.autoRender), "Typing policy blocked immersive rendering");
    await h.evaluate(async h => { await new Promise(resolve => h.app.xr.end(resolve)); });
    await page.waitForFunction(() => document.querySelector('.viewer-frame')?.dataset.immersive === "false");
    check(await h.evaluate(h => h.app.autoRender), "Desktop stayed paused after entering XR from a text field");
    console.log("PASS", id, "text entry to XR to desktop rendering");
    // Leave the route while presenting to exercise scene teardown and session end.
    await page.click('[aria-label="View in VR"]');
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
} finally { await browser.close(); }
