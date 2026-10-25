// Real engine AR/VR sessions with Meta IWER; emulator is test-only and never bundled.
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const derivatives = path.join(root, "mesh-splat-artifact-service/data/assets/derivatives");
const output = await mkdtemp(path.join(tmpdir(), "gab-xr-"));
const require = createRequire(path.join(root, "mesh-splat-artifact-service/package.json"));
const { default: puppeteer } = await import(require.resolve("puppeteer"));
const { Document, NodeIO } = await import(require.resolve("@gltf-transform/core"));
const fixture = new Document(), buffer = fixture.createBuffer();
const positions = fixture.createAccessor().setType("VEC3").setArray(new Float32Array([-1,-1,0,1,-1,0,1,1,0,-1,1,0])).setBuffer(buffer);
const normals = fixture.createAccessor().setType("VEC3").setArray(new Float32Array([0,0,1,0,0,1,0,0,1,0,0,1])).setBuffer(buffer);
const indices = fixture.createAccessor().setType("SCALAR").setArray(new Uint16Array([0,1,2,0,2,3])).setBuffer(buffer);
const material = fixture.createMaterial().setBaseColorFactor([.15,.3,.5,1]).setDoubleSided(true);
const primitive = fixture.createPrimitive().setAttribute("POSITION", positions).setAttribute("NORMAL", normals).setIndices(indices).setMaterial(material);
fixture.createScene().addChild(fixture.createNode().setMesh(fixture.createMesh().addPrimitive(primitive)).setTranslation([2,1,-.5]));
const fixtureBody = Buffer.from(await new NodeIO().writeBinary(fixture));
const assets = {
  "surface-fixture": { type: "mesh", file: "content.glb", body: fixtureBody },
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
        const body = assets[parts[0]].body ?? await readFile(path.join(derivatives, parts[0], parts[1]));
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
      let timer;
      try {
        await Promise.race([(async()=> {
          for (let i=0;i<3;i++) await new Promise(resolve => h.app.once("postrender", resolve));
        })(), new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("Viewer stopped rendering during interaction")),12000);})]);
      } finally {clearTimeout(timer);}
    });
  }
  const targetPose = h => h.evaluate(h => {
    const root=h.app.root.findByName("Immersive artifact");
    return {position:root.getPosition().toArray(),rotation:root.getRotation().toArray(),scale:root.getLocalScale().x};
  });
  async function clickToolbar(h, x) {
    await page.evaluate(() => {
      window.xrDevice.controllers.right.position.set(0,0,0);
      window.xrDevice.controllers.right.quaternion.set(0,0,0,1);
    }); await settle(h);
    const position = await h.evaluate((h,x) => {
      const element = h.app.root.findByName("XR tool bar").element, c = element.worldCorners, u = x / element.width;
      const origin = h.app.xr.input.inputSources.find(source=>source.handedness === "right").getOrigin();
      return [c[0].x+(c[1].x-c[0].x)*u-origin.x, (c[0].y+c[3].y)/2-origin.y, c[0].z+.2-origin.z];
    }, x);
    await page.evaluate(position=>window.xrDevice.controllers.right.position.set(...position), position); await settle(h);
    await page.evaluate(()=>window.xrDevice.controllers.right.updateButtonValue("trigger",1)); await settle(h);
    await page.evaluate(()=>window.xrDevice.controllers.right.updateButtonValue("trigger",0)); await settle(h);
  }
  async function surfaceRegression(h) {
    const points = [[1.7,.8,-.5],[2.3,1.2,-.5]];
    const records = () => page.evaluate(() => {
      const node = document.querySelector(".selection-toolbar");
      let fiber = node[Object.keys(node).find(key=>key.startsWith("__reactFiber$"))];
      while (fiber && !fiber.memoizedProps?.workspaces) fiber = fiber.return;
      return fiber.memoizedProps.workspaces.current.measurement.records.map(r=>r.points.map(p=>p.toArray()));
    });
    const distance = (a,b) => Math.hypot(...a.map((v,i)=>v-b[i]));
    await page.click('[aria-label="Measure distance"]');
    const box = await (await page.$('.viewer-canvas canvas')).boundingBox();
    for (const [index, point] of points.entries()) {
      const screen = await h.evaluate((h,p)=> {
        const Vec3 = h.app.root.getPosition().constructor;
        return h.camera().worldToScreen(h.space.toWorld(new Vec3(...p))).toArray();
      }, point);
      await page.mouse.move(box.x+screen[0], box.y+screen[1]);
      await page.waitForFunction(h=>h.app.root.findByName("Surface point preview")?.enabled, {timeout:15000}, h);
      await settle(h);
      const preview = await h.evaluate(h=>h.space.toLocal(h.app.root.findByName("Surface point preview").getPosition()).toArray());
      check(distance(preview,point)<.002, `Desktop preview missed the known plane: ${preview}`);
      await page.screenshot({path:path.join(output, `fixture-desktop-preview-${index}.png`)});
      await page.mouse.click(box.x+screen[0], box.y+screen[1]);
      await page.waitForFunction((h,n)=>h.app.root.findByName("Measurements")?.findByName("Measurement segment")?.children.filter(e=>e.name==="Measurement endpoint").length===n,
        {timeout:10000},h,index+1);
      check(distance((await records())[0][index],point)<.002, "Desktop click did not commit its surface preview");
    }
    await page.click('.measurement-actions .tool-action-reset'); await page.keyboard.press("q");
    await page.click('[aria-label="View in VR"]');
    await page.waitForFunction(()=>document.querySelector('.viewer-frame')?.dataset.immersive==="true"); await settle(h);
    const initialUi = await h.evaluate(h=>Array.from(h.app.root.findByName("XR workspace UI").getWorldTransform().data));
    await page.evaluate(()=>window.xrDevice.quaternion.set(Math.sin(.3),0,0,Math.cos(.3)));
    for (let i=0;i<8;i++) await settle(h);
    check(await h.evaluate((h,before)=>Array.from(h.app.root.findByName("XR workspace UI").getWorldTransform().data).every((v,i)=>Math.abs(v-before[i])<1e-5),initialUi),
      "Looking up moved the workspace UI");
    await page.evaluate(()=>window.xrDevice.quaternion.set(0,Math.sin(.45),0,Math.cos(.45)));
    for (let i=0;i<40;i++) await settle(h);
    check(await h.evaluate(h=> {
      const anchor=h.app.root.findByName("XR workspace UI"), head=h.viewports.perspectivePanel.camera.entity;
      return anchor.forward.dot(head.forward)>.98 && Math.abs(anchor.up.y-1)<1e-5;
    }), "Larger horizontal turn did not gently recenter a level toolbar");
    await page.evaluate(()=>window.xrDevice.quaternion.set(0,0,0,1));
    for (let i=0;i<40;i++) await settle(h);
    await clickToolbar(h,81);
    // Known source-plane coordinates plus nontrivial presentation scale/rotation/pan.
    await h.evaluate(h=> {
      const root=h.app.root.findByName("Immersive artifact"), Vec3=root.getPosition().constructor;
      const center=h.space.toWorld(new Vec3(2,1,-.5));
      root.setLocalScale(.7,.7,.7); root.setEulerAngles(20,-25,10);
      const moved=h.space.toWorld(new Vec3(2,1,-.5));
      root.setPosition(root.getPosition().clone().add(center).sub(moved).add(new Vec3(.08,.04,0)));
    }); await settle(h);
    let wrongCameraFrames=0;
    await h.evaluate(h=> {
      h.app.__surfaceCameraLeaks=0;
      h.app.on("postrender", ()=> {
        if(h.app.systems.camera.cameras.some(c=>c.enabled && c.entity!==h.app.xr.camera)) h.app.__surfaceCameraLeaks++;
      });
    });
    for (const [index, point] of points.entries()) {
      const ray = await h.evaluate((h,p)=> {
        const Vec3=h.app.root.getPosition().constructor, Quat=h.app.root.getRotation().constructor;
        const world=h.space.toWorld(new Vec3(...p)), normal=h.space.root.getWorldTransform().transformVector(new Vec3(0,0,1)).normalize();
        return {origin:world.clone().add(normal.clone().mulScalar(.35)).toArray(),
          rotation:new Quat().setFromDirections(new Vec3(0,0,-1),normal.mulScalar(-1)).toArray(),world:world.toArray()};
      },point);
      await page.evaluate(q=> {const c=window.xrDevice.controllers.right; c.position.set(0,0,0);c.quaternion.set(...q);},ray.rotation); await settle(h);
      const offset=await h.evaluate(h=>h.app.xr.input.inputSources.find(s=>s.handedness==="right").getOrigin().toArray());
      await page.evaluate(p=>window.xrDevice.controllers.right.position.set(...p),ray.origin.map((v,i)=>v-offset[i]));
      await page.waitForFunction((h,expected)=> {
        const marker=h.app.root.findByName("Surface point preview");
        return marker?.enabled && marker.getPosition().distance({x:expected[0],y:expected[1],z:expected[2]})<.002;
      },{timeout:15000},h,ray.world);
      await settle(h); await page.screenshot({path:path.join(output,`fixture-xr-preview-${index}.png`)});
      await page.evaluate(()=>window.xrDevice.controllers.right.updateButtonValue("trigger",1)); await settle(h);
      await page.evaluate(()=>window.xrDevice.controllers.right.updateButtonValue("trigger",0)); await settle(h);
      check(distance((await records())[0][index],point)<.002, `XR point ${index} missed the transformed surface`);
    }
    const verifyAnchors = async () => {
      await settle(h);
      return h.evaluate((h,points)=> {
        const Vec3=h.app.root.getPosition().constructor;
        const expected=points.map(p=>h.space.toWorld(new Vec3(...p)));
        const visual=h.app.root.findByName("Measurements").findByName("Measurement segment");
        const markers=visual.children.filter(e=>e.name==="Measurement endpoint");
        const line=visual.findByName("XR measurement line");
        return {errors:markers.map((m,i)=>m.getPosition().distance(expected[i])),
          markerState:markers.map(m=>({enabled:m.enabled,scale:m.getLocalScale().toArray(),sphereScale:m.findByName("Measurement marker").getLocalScale().toArray()})),
          layers:h.viewports.perspectivePanel.camera.layers,
          lineError:line.getPosition().distance(expected[0].clone().lerp(expected[0],expected[1],.5)),
          lengthError:Math.abs(line.getLocalScale().y-expected[0].distance(expected[1]))};
      },points);
    };
    let anchors=await verifyAnchors();
    console.log("SURFACE VISUALS",JSON.stringify(anchors));
    check(anchors.errors.every(v=>v<.002)&&anchors.lineError<.002&&anchors.lengthError<.002, "Measurement visuals missed their transformed surface anchors: "+JSON.stringify(anchors));
    await page.evaluate(()=>{window.xrDevice.controllers.left.connected=false;window.xrDevice.controllers.right.connected=false;}); await settle(h);
    const fixtureCanvas=await h.evaluateHandle(h=>h.app.graphicsDevice.canvas);
    const withEndpoints=await fixtureCanvas.asElement().screenshot();
    await h.evaluate(h=>h.app.root.findByName("Measurements").findComponents("render").filter(r=>r.entity.name==="Measurement marker").forEach(r=>{r.enabled=false;}));
    await settle(h);
    check(!withEndpoints.equals(await fixtureCanvas.asElement().screenshot()), "Endpoint spheres had valid transforms but produced no visible pixels");
    await h.evaluate(h=>h.app.root.findByName("Measurements").findComponents("render").filter(r=>r.entity.name==="Measurement marker").forEach(r=>{r.enabled=true;}));
    await settle(h); await page.screenshot({path:path.join(output,"fixture-xr-surface-measurement.png")});
    await h.evaluate(h=>{const r=h.app.root.findByName("Immersive artifact");r.setLocalScale(.4,.4,.4);r.setEulerAngles(-15,30,25);r.setPosition(-.1,1.4,-1.8);});
    anchors=await verifyAnchors();
    check(anchors.errors.every(v=>v<.002)&&anchors.lineError<.002&&anchors.lengthError<.002, "Saved anchors drifted after additional asset manipulation");
    wrongCameraFrames=await h.evaluate(h=>h.app.__surfaceCameraLeaks);
    check(wrongCameraFrames===0, `A picking camera rendered ${wrongCameraFrames} visible frames`);
    await page.screenshot({path:path.join(output,"fixture-xr-transformed-measurement.png")});
    await h.evaluate(async h=>{await new Promise(resolve=>h.app.xr.end(resolve));});
    await page.waitForFunction(()=>document.querySelector('.viewer-frame')?.dataset.immersive==="false");
    console.log("PASS known surface: desktop/XR preview and clicks, transformed endpoints/line, no extra scene camera, level toolbar dead zone/follow");
  }
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
  for (const id of Object.keys(assets).filter(id=>!process.env.XR_ASSET || id===process.env.XR_ASSET)) {
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
    if (id === "surface-fixture") { await surfaceRegression(h); continue; }
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
    for (const split of process.env.XR_UI_ONLY ? [] : [false, true]) {
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
        const entryPose = await targetPose(h);
        check(await h.evaluate(h => h.app.root.findByName("XR tool bar")?.parent.enabled),
          "XR toolbar did not appear when entering from Navigate");
        if (type === "immersive-ar") {
          await clickToolbar(h, 81);
          check(await h.evaluate(h=>h.app.root.findByName("XR measurement options").parent.enabled), "AR measurement icon did not open options");
          if (!split) await page.screenshot({path:path.join(output, `${id}-ar-measurement-options.png`)});
          await clickToolbar(h, 32);
          check(await h.evaluate(h=>!h.app.root.findByName("XR measurement options").parent.enabled), "AR Navigate did not close options");
        }
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
          await page.evaluate(() => window.xrDevice.controllers.left.updateButtonValue("x-button", 1));
          await settle(h);
          const framed = await h.evaluate((h, localCenter) => {
            const Vec3 = h.app.root.getPosition().constructor;
            const center = h.app.root.findByName("Immersive artifact").getWorldTransform().transformPoint(new Vec3(...localCenter));
            const camera = h.viewports.perspectivePanel.camera.entity;
            return center.clone().sub(camera.getPosition()).dot(camera.forward);
          }, initialBounds.center);
          check(Math.abs(framed - 1.5) < .02, `Left X did not frame the artifact in front of the headset: ${framed}`);
          await page.evaluate(() => window.xrDevice.controllers.left.updateButtonValue("x-button", 0));
          await settle(h);
        }
        if (!split) {
          await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("b-button", 1));
          await settle(h);
          check(await page.$eval('.viewer-frame', node => node.dataset.immersive === "true"), "First B exited instead of resetting");
          const reset = await targetPose(h);
          check(reset.position.every((value, i) => Math.abs(value - entryPose.position[i]) < 1e-4) &&
            reset.rotation.every((value, i) => Math.abs(value - entryPose.rotation[i]) < 1e-4) &&
            Math.abs(reset.scale - entryPose.scale) < 1e-5, "First B did not restore the placed/framed pose");
          await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("b-button", 0));
          await settle(h);
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
    // XR entry keeps Navigate, even if Measurement was active on desktop.
    await page.click('[aria-label="Measure distance"]');
    check(await page.$eval('.measurement-panels', node => getComputedStyle(node).display !== "none"), "Desktop options missing");
    const hoverCanvas = await (await page.$(".viewer-canvas canvas")).boundingBox();
    let desktopPreview = false;
    const hoverCandidates=await h.evaluate(h=>h.viewports.visible.flatMap(panel=> {
      const r=panel.camera.rect;
      return [[.5,.5],[.4,.5],[.6,.5],[.5,.4],[.5,.6]].map(([u,v])=>[r.x+r.z*u,1-r.y-r.w+r.w*v]);
    }));
    for (const [u,v] of hoverCandidates) {
      await page.mouse.move(hoverCanvas.x+hoverCanvas.width*u, hoverCanvas.y+hoverCanvas.height*v);
      await page.waitForFunction(h=>h.app.root.findByName("Surface point preview")?.enabled, {timeout:1500}, h).catch(()=>{});
      desktopPreview = await h.evaluate(h=>!!h.app.root.findByName("Surface point preview")?.enabled);
      if (desktopPreview) break;
    }
    check(desktopPreview, "Desktop did not render a live surface-point sphere");
    await page.screenshot({path:path.join(output, `${id}-desktop-surface-preview.png`)});
    await page.click('[aria-label="View in VR"]');
    await page.waitForFunction(() => document.querySelector('.viewer-frame')?.dataset.immersive === "true");
    await settle(h);
    check(await h.evaluate(h => h.app.root.findByName("XR tool bar")?.parent.enabled &&
      !h.app.root.findByName("XR measurement options")?.parent.enabled), "XR auto-opened Measurement instead of showing only its toolbar");
    await page.screenshot({ path:path.join(output, `${id}-xr-toolbar.png`) });
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
    const panelTarget = (name, x, y) => h.evaluate((h, name, x, y) => {
      const panel = h.app.root.findByName(name), c = panel.element.worldCorners;
      const u = x / panel.element.width, v = 1 - y / panel.element.height;
      return [c[0].x + (c[1].x-c[0].x)*u + (c[3].x-c[0].x)*v,
        c[0].y + (c[1].y-c[0].y)*u + (c[3].y-c[0].y)*v,
        c[0].z + (c[1].z-c[0].z)*u + (c[3].z-c[0].z)*v + .2];
    }, name, x, y);
    const tap = async () => {
      await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("trigger", 1)); await settle(h);
      await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("trigger", 0)); await settle(h);
    };
    const panelClick = async (name, x, y) => {
      await positionRightRay(await panelTarget(name, x, y));
      check(await h.evaluate((h,name) => h.app.xr.input.inputSources.find(s=>s.handedness === "right").elementEntity?.entity.name === name, name),
        `Native PlayCanvas controller input did not target ${name}: ` + JSON.stringify(await h.evaluate(h => ({
          input: !!h.app.elementInput, enabled: h.app.elementInput?.enabled, attached: h.app.elementInput?._selectEventsAttached,
          elements: h.app.elementInput?._elements.map(e=>e.entity.name),
          source: h.app.xr.input.inputSources.map(s=>({hand:s.handedness,input:s.elementInput,target:s.elementEntity?.name,origin:s.getOrigin().toArray(),direction:s.getDirection().toArray()})),
          corners: h.app.root.findByName("XR tool bar").element.worldCorners.map(c=>c.toArray())
        }))));
      await tap();
    };
    await panelClick("XR tool bar", 81, 25);
    check(await h.evaluate(h => h.app.root.findByName("XR measurement options").parent.enabled), "Measurement icon did not open options: "+JSON.stringify(await h.evaluate(h=> {
      const element=h.app.root.findByName("XR tool bar").element;
      const panel=element._callbacks.get("click")[0].scope;
      const source=h.app.xr.input.inputSources.find(s=>s.handedness==="right");
      return {coordinates:panel.coordinates({inputSource:source}),controls:panel.controls.map(c=>({label:c.label,x:c.x,y:c.y})),
        tools:h.app.xr.input._callbacks.get("selectstart").map(h=>h.scope?.currentTool).filter(Boolean),selecting:source.selecting};
    })));
    await page.screenshot({ path:path.join(output, `${id}-measurement-options.png`) });
    const measurementRecords = () => page.evaluate(() => {
      const node = document.querySelector(".selection-toolbar");
      let fiber = node[Object.keys(node).find(key => key.startsWith("__reactFiber$"))];
      while (fiber && !fiber.memoizedProps?.workspaces) fiber = fiber.return;
      return fiber.memoizedProps.workspaces.current.measurement.records.map(record => ({
        id: record.id, name:record.name, saved: record.saved, points: record.points.map(point => point.toArray())
      }));
    });
    const measurementStyle = () => page.evaluate(() => {
      const node = document.querySelector(".selection-toolbar");
      let fiber = node[Object.keys(node).find(key => key.startsWith("__reactFiber$"))];
      while (fiber && !fiber.memoizedProps?.workspaces) fiber = fiber.return;
      return fiber.memoizedProps.workspaces.current.measurement.style;
    });
    // A direct surface tap, without the old additional Place points command.
    let sawPreview = false;
    const aim = async (dx, dy, click = true) => {
      const target = await h.evaluate((h, offset) => {
        const bounds = h.selection.bounds(null), center = bounds.center, radius = bounds.halfExtents.length();
        return [center.x + offset[0], center.y + offset[1], center.z + radius * 2 + .5];
      }, [dx, dy]);
      await positionRightRay(target);
      await page.waitForFunction(h => h.app.root.findByName("Surface point preview")?.enabled,
        { timeout: 600, polling: 50 }, h).catch(() => {});
      sawPreview ||= await h.evaluate(h => !!h.app.root.findByName("Surface point preview")?.enabled);
      if (click) await tap();
    };
    const candidates = [[0,0],[-.12,0],[.12,0],[0,.12],[0,-.12],[-.12,.12],[.12,-.12],[-.25,0],[.25,0],[0,.25],[0,-.25]];
    for (const [dx, dy] of candidates) {
      await aim(dx,dy);
      if ((await measurementRecords()).at(-1)?.points.length === 1) break;
    }
    check((await measurementRecords()).at(-1)?.points.length === 1, "XR missed the first surface point");
    for (const [dx, dy] of candidates.slice(1)) {
      await aim(dx,dy);
      if ((await measurementRecords()).at(-1)?.points.length === 2) break;
    }
    check((await measurementRecords()).at(-1)?.points.length === 2, "XR missed the second surface point");
    check(sawPreview, "XR surface marker never appeared");
    await page.screenshot({ path:path.join(output, `${id}-measurement-line.png`) });
    // Name field uses the same save form, with a headset keyboard as the input adapter.
    await panelClick("XR measurement options", 110, 101);
    check(await h.evaluate(h => h.app.root.findByName("XR text keyboard").parent.enabled), "Name field did not open XR keyboard");
    await panelClick("XR text keyboard", 23, 73);
    await panelClick("XR text keyboard", 288, 175);
    check(await h.evaluate(h => !h.app.root.findByName("XR text keyboard").parent.enabled), "Done did not close XR keyboard");
    await panelClick("XR measurement options", 120, 138);
    check((await measurementRecords()).at(-1)?.saved && (await measurementRecords()).at(-1)?.name.endsWith("1"), "XR name/save did not update the shared record");
    await page.screenshot({ path:path.join(output, `${id}-measurement-saved.png`) });
    const formImage = await h.evaluate(h => h.app.root.findByName("XR measurement options").element.texture.getSource().toDataURL());
    await writeFile(path.join(output, `${id}-measurement-form.png`), Buffer.from(formImage.split(",")[1], "base64"));
    const collapse = async () => {
      const height = await h.evaluate(h => h.app.root.findByName("XR measurement options").element.height);
      await panelClick("XR measurement options", 225, height - 9);
    };
    await collapse();
    check(await h.evaluate(h => h.app.root.findByName("XR measurement options").element.height === 18), "Collapse did not reduce XR options to its bar");
    await page.screenshot({ path:path.join(output, `${id}-measurement-collapsed.png`) });
    await collapse();
    check(await h.evaluate(h => h.app.root.findByName("XR measurement options").element.height > 18), "Expand did not restore XR options");
    // Saved box opens the record, and the native-style slider/reset remains editable.
    await panelClick("XR measurement options", 110, 44);
    await panelClick("XR measurement options", 170, 243);
    check((await measurementStyle()).lineWidth !== 3, "XR line-width slider did not update the shared style");
    await panelClick("XR measurement options", 250, 243);
    check((await measurementStyle()).lineWidth === 3, "XR line-width reset did not restore the default");
    await panelClick("XR measurement options", 170, 272);
    check((await measurementStyle()).fontSize !== 16, "XR font-size slider did not update the shared style");
    await panelClick("XR measurement options", 250, 272);
    check((await measurementStyle()).fontSize === 16, "XR font-size reset did not restore the default");
    await page.screenshot({ path:path.join(output, `${id}-measurement-edit.png`) });
    await collapse();
    const previousEndpoint = (await measurementRecords()).at(-1).points[1];
    for (const delta of [.04, -.04, .08, -.08]) {
      const target = await h.evaluate((h, position) => {
        const Vec3 = h.app.root.getPosition().constructor;
        const point = h.space.toWorld(new Vec3(...position));
        return [point.x, point.y, point.z + .3];
      }, (await measurementRecords()).at(-1).points[1]);
      await positionRightRay(target);
      await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("trigger", 1)); await settle(h);
      await page.evaluate(delta => { window.xrDevice.controllers.right.position.x += delta; }, delta); await settle(h);
      await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("trigger", 0)); await settle(h);
      if ((await measurementRecords()).at(-1).points[1].some((value,index)=>Math.abs(value-previousEndpoint[index])>1e-6)) break;
    }
    check((await measurementRecords()).at(-1).points[1].some((value,index)=>Math.abs(value-previousEndpoint[index])>1e-6),
      "Saved endpoint did not follow controller surface drag");
    const beforeCancelledDrag = (await measurementRecords()).at(-1).points[1];
    const cancelTarget = await h.evaluate((h, position) => {
      const Vec3 = h.app.root.getPosition().constructor, point = h.space.toWorld(new Vec3(...position));
      return [point.x, point.y, point.z+.3];
    }, beforeCancelledDrag);
    await positionRightRay(cancelTarget);
    await page.evaluate(()=>window.xrDevice.controllers.right.updateButtonValue("trigger",1)); await settle(h);
    await positionRightRay(await panelTarget("XR tool bar", 81, 25));
    await page.evaluate(()=>window.xrDevice.controllers.right.updateButtonValue("trigger",0)); await settle(h);
    check(JSON.stringify((await measurementRecords()).at(-1).points[1]) === JSON.stringify(beforeCancelledDrag),
      "An endpoint released over UI committed an unintended surface edit");
    await collapse();
    // Menu remains attached to the headset; body movement does not strand it.
    const relativeUi = () => h.evaluate(h => h.app.root.findByName("XR tool bar").parent.getLocalPosition().toArray());
    const beforeUi = await relativeUi();
    await page.evaluate(() => { window.xrDevice.position.x += .1; }); await settle(h);
    check(JSON.stringify(await relativeUi()) === JSON.stringify(beforeUi), "Toolbar moved relative to the headset");
    // Independent controller navigation while a record is open.
    await page.evaluate(() => { window.xrDevice.controllers.right.position.set(-.5,1.6,-.6); }); await settle(h);
    const beforeOrbit = await targetPose(h);
    await page.evaluate(() => window.xrDevice.controllers.left.updateButtonValue("trigger",1)); await settle(h);
    await page.evaluate(() => { window.xrDevice.controllers.left.position.x += .08; }); await settle(h);
    check((await targetPose(h)).rotation.some((v,i)=>Math.abs(v-beforeOrbit.rotation[i])>.01), "Orbit stopped with Measurement open");
    await page.evaluate(() => window.xrDevice.controllers.left.updateButtonValue("trigger",0)); await settle(h);
    const beforePan = await targetPose(h);
    await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("trigger",1)); await settle(h);
    await page.evaluate(() => { window.xrDevice.controllers.right.position.x += .08; }); await settle(h);
    check(Math.abs((await targetPose(h)).position[0]-beforePan.position[0])>.02, "Pan stopped with Measurement open");
    await page.evaluate(() => window.xrDevice.controllers.right.updateButtonValue("trigger",0)); await settle(h);
    await panelClick("XR tool bar", 32, 25);
    check(await h.evaluate(h => !h.app.root.findByName("XR measurement options").parent.enabled), "Navigate left Measurement options open");
    check((await measurementRecords()).at(-1)?.saved, "Navigate removed the saved measurement");
    await panelClick("XR tool bar", 81, 25);
    for (const [dx, dy] of candidates) {
      await aim(dx,dy);
      if ((await measurementRecords()).some(record=>!record.saved)) break;
    }
    check((await measurementRecords()).some(record=>!record.saved), "Could not create a draft for Navigate cancellation");
    await panelClick("XR tool bar", 32, 25);
    check((await measurementRecords()).every(record=>record.saved), "Navigate retained an unsaved XR draft");
    await h.evaluate(async h => { await new Promise(resolve => h.app.xr.end(resolve)); });
    await page.waitForFunction(() => document.querySelector('.viewer-frame')?.dataset.immersive === "false");
    await page.click('[aria-label="Measure distance"]');
    check(await page.$eval('[aria-label="Saved measurements"]', node => node.textContent.includes("Measurement")), "Saved XR record missing on desktop");
    await page.keyboard.press("q");
    await page.click('[aria-label="View in VR"]');
    await page.waitForFunction(() => document.querySelector('.viewer-frame')?.dataset.immersive === "true");
    await settle(h);
    check(await h.evaluate(h=>!h.app.root.findByName("XR measurement options").parent.enabled), "Repeated entry reopened Measurement");
    await panelClick("XR tool bar", 81, 25);
    await panelClick("XR measurement options", 246, 44);
    check((await measurementRecords()).length === 0, "XR saved-list delete did not remove the shared measurement");
    await h.evaluate(async h => { await new Promise(resolve=>h.app.xr.end(resolve)); });
    await page.waitForFunction(() => document.querySelector('.viewer-frame')?.dataset.immersive === "false");
    console.log("PASS", id, "XR icon toolbar, explicit activation, matching measurement form, naming, save, collapse, navigation, desktop record");
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
