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
  "21d12x-006349": { type: "mesh", file: "content.glb" },
  "2022-01-0056-model": { type: "splat", file: "meta.json" },
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
          h.app.renderNextFrame = true;
          for (let i=0;i<3;i++) await new Promise(resolve => h.app.once("frameend", resolve));
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
    await clickToolbar(h,130);
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
  async function editingRegression(h, id) {
    const workspace = () => page.evaluateHandle(() => {
      const node=document.querySelector('.selection-toolbar'); let f=node[Object.keys(node).find(k=>k.startsWith('__reactFiber$'))];
      while(f&&!f.memoizedProps?.workspaces)f=f.return; return f.memoizedProps.workspaces;
    });
    const ws=await workspace();
    const menu=await h.evaluateHandle(h=>h.app.xr.input._callbacks.get('selectstart').find(c=>c.scope?.editing)?.scope);
    const input=await h.evaluateHandle(h=>h.app._callbacks.get('prerender').find(c=>c.scope?.pointers&&c.scope?.hits)?.scope);
    const move = async point => {
      await page.evaluate(()=>{const c=window.xrDevice.controllers.right;c.position.set(0,0,0);c.quaternion.set(0,0,0,1);}); await settle(h);
      const offset=await h.evaluate(h=>h.app.xr.input.inputSources.find(s=>s.handedness==='right').getOrigin().toArray());
      await page.evaluate(p=>window.xrDevice.controllers.right.position.set(...p),point.map((v,i)=>v-offset[i])); await settle(h);
    };
    const tap=async()=>{
      await page.evaluate(()=>window.xrDevice.controllers.right.updateButtonValue('trigger',1)); await settle(h);
      await page.evaluate(()=>window.xrDevice.controllers.right.updateButtonValue('trigger',0)); await settle(h);
    };
    const control = async (name,label,click=true) => {
      const target=await h.evaluate((h,name,label)=> {
        const e=h.app.root.findByName(name), p=e.element._callbacks.get('click')[0].scope;
        const c=p.controls.find(c=>c.label===label); if(!c)throw Error('Missing control '+label+' in '+p.controls.map(c=>c.label));
        const corners=e.element.worldCorners,u=(c.x+c.width/2)/e.element.width,v=1-(c.y+c.height/2)/e.element.height;
        return [corners[0].x+(corners[1].x-corners[0].x)*u+(corners[3].x-corners[0].x)*v,
          corners[0].y+(corners[1].y-corners[0].y)*u+(corners[3].y-corners[0].y)*v,corners[0].z+.2];
      },name,label);
      await move(target);
      const feedback=await h.evaluate((h,name,label)=>{
        const e=h.app.root.findByName(name), p=e.element._callbacks.get('click')[0].scope;
        const input=h.app._callbacks.get('prerender').find(c=>c.scope?.pointers&&c.scope?.hits).scope;
        const source=h.app.xr.input.inputSources.find(s=>s.handedness==='right');
        const tip=Array.from(input.pointers.get(source).positions).slice(3);
        const c=p.controls.find(c=>c.label===label), pixel=p.context.getImageData(Math.round((c.x+1)*2),Math.round((c.y+c.height/2)*2),1,1).data;
        return {hover:p.isHovered(label),pixel:Array.from(pixel),tip,plane:e.element.worldCorners[0].z};
      },name,label);
      check(feedback.hover, 'No hover feedback on '+label);
      check(feedback.pixel[0]>190&&feedback.pixel[1]>150&&feedback.pixel[2]<160,'Hovered control border was not visibly highlighted: '+label+' '+feedback.pixel);
      check(feedback.tip[2] >= feedback.plane && feedback.tip[2]-feedback.plane < .012,
        'Controller ray crossed or stopped short of UI '+label+': '+JSON.stringify(feedback));
      if(click) await tap();
    };
    const options='XR measurement options';
    const movePanel=async name=>{
      await control(name,'Move panel',false);
      const before=await h.evaluate((h,name)=>h.app.root.findByName(name).parent.getPosition().toArray(),name);
      await page.evaluate(()=>window.xrDevice.controllers.right.updateButtonValue('trigger',1)); await settle(h);
      await page.evaluate(()=>{window.xrDevice.controllers.right.position.x+=.12;}); await settle(h);
      const after=await h.evaluate((h,name)=>h.app.root.findByName(name).parent.getPosition().toArray(),name);
      check(after[0]-before[0]>.09,`Dragging ${name} handle did not move its panel`);
      await page.evaluate(()=>window.xrDevice.controllers.right.updateButtonValue('trigger',0)); await settle(h);
      await page.evaluate(()=>{window.xrDevice.controllers.left.updateButtonValue('trigger',1);
        window.xrDevice.controllers.right.updateButtonValue('trigger',1);}); await settle(h);
      check(await menu.evaluate((m,name)=>{
        const panel=name==='XR tool bar'?m.ui.toolbar:m.ui.options;
        return panel.offset.length()<1e-5;
      },name),`Trigger chord did not recenter ${name}`);
      await page.evaluate(()=>{window.xrDevice.controllers.left.updateButtonValue('trigger',0);
        window.xrDevice.controllers.right.updateButtonValue('trigger',0);}); await settle(h);
    };
    await movePanel('XR tool bar');
    const type=async label=>{for(const key of label) await control('XR text keyboard',key); await control('XR text keyboard','Done');};
    await control('XR tool bar','Select');
    check(await menu.evaluate(m=>m.currentTool==='select'),'Selection toolbar did not activate');
    await movePanel(options);
    await control(options,'Brush');
    await control(options,'Box',false);
    await control(options,'Brush',false);
    check(await h.evaluate(h=>{
      const panel=h.app.root.findByName('XR measurement options');
      const popup=panel.parent.findByName('XR hovered control');
      return popup?.enabled && popup.getLocalPosition().z>0;
    }), 'Hovered XR button did not rise in stereo');
    const hoverScene=await h.evaluateHandle(h=>h.app.graphicsDevice.canvas);
    const raised=await hoverScene.asElement().screenshot();
    await h.evaluate(h=>{h.app.root.findByName('XR measurement options').parent.findByName('XR hovered control').enabled=false;h.app.renderNextFrame=true;});
    await settle(h);
    check(!raised.equals(await hoverScene.asElement().screenshot()),'Raised XR button produced no visible pixels');
    await h.evaluate(h=>{h.app.root.findByName('XR measurement options').parent.findByName('XR hovered control').enabled=true;h.app.renderNextFrame=true;});
    await settle(h);
    const toolbarBefore=await h.evaluate(h=>h.app.root.findByName('XR tool bar').element._callbacks.get('click')[0].scope.canvas.toDataURL());
    await control('XR tool bar','Select',false);
    const toolbarHovered=await h.evaluate(h=>h.app.root.findByName('XR tool bar').element._callbacks.get('click')[0].scope.canvas.toDataURL());
    check(toolbarBefore!==toolbarHovered,'Selected toolbar button gave no additional hover feedback');
    await control(options,'Brush',false);
    const bounds=await h.evaluate(h=>{const b=h.selection.bounds(null);return {center:b.center.toArray(),radius:b.halfExtents.length(),front:b.getMax().z};});
    let aim=null;
    for(const x of [0,-.1,.1,-.2,.2]) {
      const point=[bounds.center[0]+x,bounds.center[1],bounds.front+.3]; await move(point);
      await page.waitForFunction(input=>[...input.hits.values()].every(s=>!s.pending),{timeout:20000},input);
      const hit=await input.evaluate(i=>{const s=[...i.hits.keys()].find(s=>s.handedness==='right'); return i.hit(s)?.point.toArray();});
      if(hit){aim=point;break;}
    }
    if (await h.evaluate(h=>!!h.selection.centers)) {
      const point=await h.evaluate(h=>{
        const c=h.selection.centers,t=h.selection.component.entity.getWorldTransform(),b=h.selection.bounds(null),V=b.center.constructor,p=new V();
        let best=-Infinity,chosen=null;
        for(let i=0;i<c.length;i+=300){p.set(c[i],c[i+1],c[i+2]);t.transformPoint(p,p);
          if(p.x<b.center.x-b.halfExtents.x*.35&&Math.abs(p.y-b.center.y)<b.halfExtents.y*.4&&p.z>best){best=p.z;chosen=p.toArray();}}
        return chosen;
      });
      check(point,'No unobstructed splat test target');
      aim=[point[0],point[1],point[2]+.3]; await move(aim);
    }
    check(aim,'No surface found for selection stroke');
    await page.waitForFunction(menu=>!!menu.editing.brush,{timeout:20000},menu);
    check(await menu.evaluate(m=>{
      const editing=m.editing,b=editing.selection.bounds(null),radius=editing.brush.getLocalScale().x/2;
      const expected=Math.max(.005,Math.max(b.halfExtents.x,b.halfExtents.y,b.halfExtents.z)*editing.brushSize/100);
      return Math.abs(radius-expected)<.002;
    }), 'XR brush radius did not match the displayed asset bounds');
    check(await input.evaluate(i=>{
      const source=[...i.hits.keys()].find(s=>s.handedness==='right'),hit=i.hit(source);
      const brush=i.app.root.findByName('XR 3D brush');
      return !!hit?.normal && Math.abs(brush.up.dot(hit.normal))>.98 && brush.getLocalScale().y<brush.getLocalScale().x*.1;
    }), 'XR brush disc did not align with the picked surface normal');
    const renderCanvas=await h.evaluateHandle(h=>h.app.graphicsDevice.canvas);
    const brushImage=await renderCanvas.asElement().screenshot();
    await page.screenshot({path:path.join(output,`${id}-xr-brush-before.png`)});
    await menu.evaluate(m=>{m.editing.brush.render.enabled=false;}); await settle(h);
    check(!brushImage.equals(await renderCanvas.asElement().screenshot()),'Brush has no visible scene pixels');
    await menu.evaluate(m=>{m.editing.brush.render.enabled=true;}); await settle(h);
    await menu.evaluate(m=>m.editing.action('brush',50)); await settle(h);
    const largestBrush=await renderCanvas.asElement().screenshot();
    await menu.evaluate(m=>{m.editing.brush.render.enabled=false;}); await settle(h);
    check(!largestBrush.equals(await renderCanvas.asElement().screenshot()),'Largest XR brush vanished');
    await menu.evaluate(m=>{m.editing.brush.render.enabled=true;m.editing.action('brush',10);}); await settle(h);
    check(await input.evaluate(i=>{
      const source=[...i.hits.keys()].find(s=>s.handedness==='right'),hit=i.hit(source),tip=i.pointers.get(source).positions;
      const world=i.handle.space.toWorld(hit.point);return Math.hypot(tip[3]-world.x,tip[4]-world.y,tip[5]-world.z)<.002;
    }),'Controller ray did not stop at its surface hit');
    check(await input.evaluate(i=>{
      const source=[...i.pointers.keys()].find(s=>s.handedness==='right');
      const pointer=i.pointers.get(source); return pointer.tip.enabled &&
        pointer.tip.getPosition().distance({x:pointer.positions[3],y:pointer.positions[4],z:pointer.positions[5]})<.002;
    }),'Controller ray endpoint has no visible pointer');
    await page.evaluate(()=>window.xrDevice.controllers.right.updateButtonValue('trigger',1)); await settle(h);
    await page.evaluate(()=>window.xrDevice.controllers.right.position.x+=.04); await settle(h);
    await page.evaluate(()=>window.xrDevice.controllers.right.updateButtonValue('trigger',0)); await settle(h);
    await page.waitForFunction(h=>h.selection.summary.selected>0,{timeout:30000},h);
    await page.waitForFunction(menu=>!menu.editing.busy,{},menu);
    console.log('XR selected',id,await h.evaluate(h=>h.selection.summary.selected));
    if(process.env.XR_EDITING_SECTION && id==='sakura-garden') {
      check(await h.evaluate(h=>{
        const selection=h.selection, plane=h.app.graphicsDevice.scope.resolve('portalSectionPlane').getValue();
        const V=h.app.root.getPosition().constructor, point=new V(),transform=selection.component.entity.getWorldTransform();
        return selection.state.masks[0].every((chosen,i)=>{
          if(!chosen)return true;
          point.set(selection.centers[i*3],selection.centers[i*3+1],selection.centers[i*3+2]);transform.transformPoint(point,point);
          return point.x*plane[0]+point.y*plane[1]+point.z*plane[2]+plane[3]>=-1e-6;
        });
      }),'Sectioned selection included removed splats');
    }
    check(await menu.evaluate(m=>m.editing.displayedSelectionName==='Selection 1'),
      'Unsaved XR selection did not show a default name');
    await control(options,'Selection name'); await type('region'); await control(options,'Save selection');
    check(await h.evaluate(h=>h.selection.areas.some(a=>a.saved&&a.name==='region')),'XR selection not saved');
    await control(options,'Blue');
    await control(options,'Yellow');
    check(await h.evaluate(h=>h.selection.areas.find(a=>a.name==='region')?.color===0xfdd836),
      'XR swatch did not replace the previous selection color');
    await page.evaluate(()=>window.xrDevice.controllers.left.updateButtonValue('x-button',1)); await settle(h);
    check(await h.evaluate(h=>h.selection.areas.find(a=>a.name==='region')?.color===0x1e88e6),
      'Left X did not undo the XR color change');
    await page.evaluate(()=>window.xrDevice.controllers.left.updateButtonValue('x-button',0)); await settle(h);
    await page.evaluate(()=>window.xrDevice.controllers.left.updateButtonValue('y-button',1)); await settle(h);
    check(await h.evaluate(h=>h.selection.areas.find(a=>a.name==='region')?.color===0xfdd836),
      'Left Y did not redo the XR color change');
    await page.evaluate(()=>window.xrDevice.controllers.left.updateButtonValue('y-button',0)); await settle(h);
    const saved=await h.evaluate(h=>h.selection.areas.filter(a=>a.saved).length);
    await control(options,'Isolate'); check(await h.evaluate(h=>h.selection.summary.isolated),'XR isolate failed');
    await control(options,'Show all');
    await control('XR tool bar','Annotate'); await control(options,'Annotate a selection');
    if (await h.evaluate(h=>!!h.selection.centers)) {
      const selectedAim=await h.evaluate(async h=>{
        const selection=h.selection,area=selection.areas.find(a=>a.saved),bits=area.snapshot.masks[0].bits,
          centers=selection.centers,transform=selection.component.entity.getWorldTransform(),V=selection.bounds(null).center.constructor,
          bounds=selection.bounds(null),point=new V();
        const candidates=[];
        for(let index=0;index<area.snapshot.masks[0].length&&candidates.length<80;index++){
          if(!(bits[index>>3]&(1<<(index&7))))continue;
          point.set(centers[index*3],centers[index*3+1],centers[index*3+2]);transform.transformPoint(point,point);
          if(point.x<bounds.center.x-bounds.halfExtents.x*.35)candidates.push([point.x,point.y,point.z+.3]);
        }
        for(const ray of candidates){const hit=await selection.surfaceHit(new V(...ray),new V(0,0,-1));
          if(hit&&selection.areaAt(hit.part,hit.index))return ray;}
        return null;
      });
      check(selectedAim,'No saved splat face is hoverable from the selection stroke');
      aim=selectedAim;
    }
    await move(aim); await settle(h);
    if (!(await menu.evaluate(m=>m.editing.message.startsWith('Click ')))) console.log('REGION DEBUG',await h.evaluate(h=>{
      const i=h.app._callbacks.get('prerender').find(c=>c.scope?.pointers&&c.scope?.hits).scope,s=h.app.xr.input.inputSources.find(s=>s.handedness==='right'),hit=i.hit(s);
      return {hit,area:hit&&h.selection.areaAt(hit.part,hit.index),selected:h.selection.summary.selected,areas:h.selection.areas.map(a=>({id:a.id,name:a.name,saved:a.saved}))};
    }));
    check(await menu.evaluate(m=>m.editing.message.startsWith('Click ')),'XR saved region did not highlight');
    await settle(h);
    const hoverCanvas=await h.evaluateHandle(h=>h.app.graphicsDevice.canvas);
    const highlighted=await hoverCanvas.asElement().screenshot();
    await h.evaluate(h=>{
      if(h.selection.previews) for(const groups of h.selection.previews.values())for(const g of groups)g.instance.visible=false;
      else h.app.graphicsDevice.scope.resolve('portalHoverOpacity').setValue(0);
    }); await settle(h);
    await page.screenshot({path:path.join(output,`${id}-xr-region-no-hover.png`)});
    check(!highlighted.equals(await hoverCanvas.asElement().screenshot()),'Region hover has no visible scene pixels');
    await h.evaluate(h=>{
      if(h.selection.previews) for(const groups of h.selection.previews.values())for(const g of groups)g.instance.visible=true;
      else h.app.graphicsDevice.scope.resolve('portalHoverOpacity').setValue(.8);
    }); await settle(h);
    if (await h.evaluate(h=>!!h.selection.centers)) {
      const stable=await hoverCanvas.asElement().screenshot();
      for(let frame=0;frame<4;frame++)await settle(h);
      check(stable.equals(await hoverCanvas.asElement().screenshot()),'Splat hover flickered while controller and asset were still');
    }
    await page.screenshot({path:path.join(output,`${id}-xr-region-hover.png`)});
    await tap(); check(await menu.evaluate(m=>m.editing.step==='marker'),'Selection annotation did not advance to marker');
    await tap(); check(await menu.evaluate(m=>m.editing.step==='details'),'Selection annotation did not advance to details');
    await control(options,'Title'); await type('note');
    await control(options,'Description'); await type('surface'); await control(options,'Save annotation');
    check(await ws.evaluate(ws=>ws.current.annotations.records.length===1&&ws.current.annotations.records[0].region),'XR region annotation was not saved');
    await move(aim); await settle(h);
    check(await h.evaluate(h=>h.app.root.findByName('XR annotation description')?.parent.enabled),'XR annotated-region hover omitted description');
    check(await menu.evaluate(m=>m.editing.tooltipLayer.clearDepthBuffer &&
      m.editing.tooltip.entity.element.layers.includes(m.editing.tooltipLayer.id)),
      'XR annotation callout is not rendered above mesh depth');
    await page.screenshot({path:path.join(output,`${id}-xr-annotated-selection.png`)});
    await control(options,'note'); await control(options,'Title'); await type('x'); await control(options,'Save annotation');
    check(await ws.evaluate(ws=>ws.current.annotations.records[0].title==='notex'),'XR annotation editing failed');
    await control(options,'New annotation'); await control(options,'Annotate with a point'); await move(aim); await tap();
    await control(options,'Title'); await type('point'); await control(options,'Save annotation');
    check(await ws.evaluate(ws=>ws.current.annotations.records.length===2),'XR point annotation failed');
    await control(options,'point'); await control(options,'Move annotation 2');
    await control(options,'Collapse tool options');
    const marker=await ws.evaluate(ws=>ws.current.annotations.records[1].position.toArray());
    const markerWorld=await h.evaluate((h,p)=>{const V=h.app.root.getPosition().constructor;return h.space.toWorld(new V(...p)).toArray();},marker);
    await move([markerWorld[0],markerWorld[1],bounds.front+.3]);
    await page.evaluate(()=>window.xrDevice.controllers.right.updateButtonValue('trigger',1)); await settle(h);
    check(await menu.evaluate(m=>m.editing.dragging),'XR marker did not grab under trigger');
    await page.evaluate(()=>window.xrDevice.controllers.right.position.x+=.03); await settle(h);
    await page.evaluate(()=>window.xrDevice.controllers.right.updateButtonValue('trigger',0)); await settle(h);
    await page.waitForFunction(menu=>!menu.editing.busy,{},menu);
    check(await menu.evaluate(m=>m.editing.step==='details'),'XR marker drag failed to finish');
    await control(options,'Expand tool options'); await control(options,'Save annotation');
    check(await ws.evaluate((ws,p)=>ws.current.annotations.records[1].position.distance({x:p[0],y:p[1],z:p[2]})>1e-4,marker),'XR annotation marker did not move');
    await control(options,'Collapse tool options'); await control(options,'Expand tool options');
    await control('XR tool bar','Navigate (Q)');
    check(await h.evaluate((h,count)=>h.selection.areas.filter(a=>a.saved).length===count,saved),'Navigate removed saved selection');
    await control('XR tool bar','Select'); await control(options,'region');
    await control(options,'Clear Selection');
    check(await h.evaluate(h=>h.selection.summary.selected===0),'XR clear selection failed');
    await h.evaluate(h=>{
      h.app.__volumeTimings=[];
      const select=h.selection.selectVolume.bind(h.selection);
      h.selection.selectVolume=async volume=>{
        const started=performance.now();
        try{return await select(volume);}finally{h.app.__volumeTimings.push(performance.now()-started);}
      };
    });
    // Volumes commit on release and share the existing selection document.
    for (const shape of ['Box','Lasso']) {
      await control(options,shape);
      await control(options,'Collapse tool options');
      await move(aim);
      await page.evaluate(()=>window.xrDevice.controllers.right.updateButtonValue('trigger',1)); await settle(h);
      check(await menu.evaluate(m=>!!m.editing.volumeVisual && !!m.editing.gesture),
        shape+' did not show a 3D envelope on trigger press');
      for(const [x,y] of (shape==='Box' ? [[.08,-.08]] : [[.08,0],[0,-.08],[-.08,0]])) {
        await page.evaluate(([x,y])=>{window.xrDevice.controllers.right.position.x+=x;window.xrDevice.controllers.right.position.y+=y;},[x,y]); await settle(h);
      }
      const drawingVolume=await menu.evaluate(m=>{
        const visual=m.editing.volumeVisual,gesture=m.editing.gesture;
        if(!visual||!gesture)return null;
        const anchor=m.editing.handle.space.toWorld(gesture.anchor);
        const front=visual.handleWorld();
        return {depth:visual.volume.depth,front:front.clone().sub(anchor).dot(m.editing.handle.viewports.perspectivePanel.camera.entity.forward)};
      });
      check(drawingVolume?.depth>0,shape+' did not show a 3D volume during the stroke');
      check(drawingVolume.front<0,shape+' volume did not project forward of the picked surface');
      const committedAt=performance.now();
      await page.evaluate(()=>window.xrDevice.controllers.right.updateButtonValue('trigger',0)); await settle(h);
      await page.waitForFunction(menu=>!menu.editing.busy,{},menu);
      const volumeResult=await h.evaluate(h=>({selected:h.selection.summary.selected,
        visual:h.app.root.findByName('XR selection volume')?.enabled,
        message:h.app.xr.input._callbacks.get('selectstart').find(c=>c.scope?.editing)?.scope.editing.message,
        volume:h.app.xr.input._callbacks.get('selectstart').find(c=>c.scope?.editing)?.scope.editing.volumeVisual?.volume}));
      check(volumeResult.selected>0,shape+' XR gesture selected nothing '+JSON.stringify(volumeResult));
      check(volumeResult.visual,'XR '+shape+' volume was not visible');
      console.log('XR VOLUME',id,shape,'selected',volumeResult.selected,'commit ms',Math.round(performance.now()-committedAt));
      if(shape==='Box') {
        check(await h.evaluate(h=>{
          const root=h.app.root.findByName('Immersive artifact'),handle=h.app.root.findByName('XR volume depth handle');
          const before=handle.getPosition().clone(),origin=root.getPosition().clone();
          root.setPosition(origin.clone().add({x:.02,y:0,z:0}));
          const delta=handle.getPosition().x-before.x;
          root.setPosition(origin);
          return Math.abs(delta-.02)<.002;
        }),'The selection volume did not follow artifact navigation');
      }
      const volumeCanvas=await h.evaluateHandle(h=>h.app.graphicsDevice.canvas);
      const withVolume=await volumeCanvas.asElement().screenshot();
      await menu.evaluate(m=>{m.editing.volumeVisual.entity.enabled=false;});
      await settle(h);
      check(!withVolume.equals(await volumeCanvas.asElement().screenshot()),'XR '+shape+' translucent mesh had no visible pixels');
      await menu.evaluate(m=>{m.editing.volumeVisual.entity.enabled=true;m.editing.volumeVisual.handleEntity.enabled=false;});
      await settle(h);
      check(!withVolume.equals(await volumeCanvas.asElement().screenshot()),'XR '+shape+' depth handle had no visible pixels');
      await menu.evaluate(m=>{m.editing.volumeVisual.handleEntity.enabled=true;});
      await settle(h);
      await page.screenshot({path:path.join(output,`${id}-xr-${shape.toLowerCase()}-volume.png`)});
      if(shape==='Box') {
        const handle=await menu.evaluate(m=>m.editing.volumeVisual.handleWorld().toArray());
        await move([handle[0],handle[1],handle[2]+.2]);
        check(await input.evaluate((i,target)=>{
          const source=[...i.pointers.keys()].find(s=>s.handedness==='right');
          const tip=i.pointers.get(source).positions;
          return Math.hypot(tip[3]-target[0],tip[4]-target[1],tip[5]-target[2])<.003;
        },handle),'Controller ray did not stop at the depth handle');
        await page.evaluate(()=>window.xrDevice.controllers.right.updateButtonValue('trigger',1)); await settle(h);
        check(await menu.evaluate(m=>m.editing.depthDragging),'Box depth handle did not grab');
        const before=await menu.evaluate(m=>m.editing.volumeVisual.volume.depth);
        const axis=await menu.evaluate(m=>m.editing.volumeVisual.axisWorld().normalize().toArray());
        await page.evaluate(axis=>{const c=window.xrDevice.controllers.right;c.position.x+=axis[0]*.05;
          c.position.y+=axis[1]*.05;c.position.z+=axis[2]*.05;},axis); await settle(h);
        check(await menu.evaluate((m,previous)=>Math.abs(m.editing.volumeVisual.volume.depth-previous)>1e-4,before),
          'Dragging the 3D box handle did not adjust depth');
        await page.evaluate(()=>window.xrDevice.controllers.right.updateButtonValue('trigger',0)); await settle(h);
        await page.waitForFunction(menu=>!menu.editing.busy,{},menu);
        check(await h.evaluate(h=>h.selection.summary.selected>0),'Changing volume depth removed the entire draft');
      }
      await control(options,'Expand tool options');
      if(shape==='Lasso') {
        await control('XR tool bar','Navigate (Q)');
        check(await h.evaluate(h=>h.selection.summary.selected===0 && !h.app.root.findByName('XR selection volume')),
          'Leaving Selection kept the unsaved volume or its draft');
        await control('XR tool bar','Select');
      } else await control(options,'Clear Selection');
    }
    console.log('XR VOLUME QUERIES',id,await h.evaluate(h=>h.app.__volumeTimings.map(ms=>Math.round(ms))));
    if(process.env.XR_VOLUME_PROFILE) console.log('XR VOLUME FULL-ASSET',id,await h.evaluate(async h=>{
      const b=h.selection.bounds(null),min=b.getMin(),max=b.getMax();
      const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,min.z-.01,1];
      const x0=min.x-.01,x1=max.x+.01,y0=min.y-.01,y1=max.y+.01;
      const rectangle=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
      const radius=Math.hypot(x1-x0,y1-y0),cx=(x0+x1)/2,cy=(y0+y1)/2;
      const lasso=Array.from({length:128},(_,i)=>[cx+radius*Math.cos(i*Math.PI/64),cy+radius*Math.sin(i*Math.PI/64)]);
      const result=[];
      for(const [shape,outline] of [['rectangle',rectangle],['lasso',lasso]]){
        const start=performance.now(), masks=await h.selection.selectVolume({shape,matrix,outline,depth:max.z-min.z+.02});
        result.push({shape,ms:Math.round(performance.now()-start),selected:masks.reduce((n,m)=>n+m.reduce((s,v)=>s+Number(!!v),0),0)});
      }
      return result;
    }));
    const idle=await input.evaluate(i=>[...i.hits.values()].map(s=>s.time));
    for(let i=0;i<5;i++)await settle(h);
    check(await input.evaluate((i,times)=>[...i.hits.values()].every((s,j)=>s.time===times[j]),idle),'Stationary controllers kept issuing surface queries');
    await control(options,'region');
    check(await h.evaluate(h=>h.selection.summary.selected>0),'Saved region did not reopen');
    await control(options,'Clear Selection');
    check(await h.evaluate(h=>h.selection.summary.selected===0),'Clear Selection did not clear the active saved region');
    const draftAim=await h.evaluate(async h=>{
      const b=h.selection.bounds(null),V=b.center.constructor;
      for(const x of [-.7,-.5,-.3,0,.3,.5,.7])for(const y of [-.7,-.5,-.3,0,.3,.5,.7]){
        const origin=new V(b.center.x+b.halfExtents.x*x,b.center.y+b.halfExtents.y*y,b.getMax().z+.3);
        const hit=await h.selection.surfaceHit(origin,new V(0,0,-1));
        if(hit&&!h.selection.areaAt(hit.part,hit.index))return origin.toArray();
      }
      return null;
    });
    check(draftAim,'No unsaved test surface outside the saved selection');
    await control(options,'Brush'); await move(draftAim);
    await page.evaluate(()=>window.xrDevice.controllers.right.updateButtonValue('trigger',1)); await settle(h);
    await page.evaluate(()=>window.xrDevice.controllers.right.position.x+=.04); await settle(h);
    await page.evaluate(()=>window.xrDevice.controllers.right.updateButtonValue('trigger',0)); await settle(h);
    await page.waitForFunction(menu=>!menu.editing.busy,{},menu);
    if (!(await h.evaluate(h=>h.selection.areas.some(a=>!a.saved)))) console.log('DRAFT DEBUG', await h.evaluate(h=>({summary:h.selection.summary,areas:h.selection.areas.map(a=>({saved:a.saved,name:a.name})),message:h.app.xr.input._callbacks.get('selectstart').find(c=>c.scope?.editing)?.scope.editing.message})));
    check(await h.evaluate(h=>h.selection.areas.some(a=>!a.saved)),'XR selection draft was not created');
    await control('XR tool bar','Annotate');
    check(await h.evaluate(h=>h.selection.summary.selected===0&&h.selection.areas.every(a=>a.saved)),'XR tool switch retained an unsaved selection');
    await control('XR tool bar','Select');
    await control(options,'Delete selection region');
    check(await h.evaluate(h=>h.selection.areas.every(a=>a.name!=='region')&&h.selection.summary.selected===0),
      'XR saved-list deletion did not remove the selection');
    check(await ws.evaluate(ws=>ws.current.annotations.records.length===1&&ws.current.annotations.records[0].title==='point'),
      'XR deletion did not remove only the linked annotation');
    await move(aim);
    await page.evaluate(()=>{window.xrDevice.controllers.left.updateButtonValue('trigger',1);
      window.xrDevice.controllers.right.updateButtonValue('trigger',1);}); await settle(h);
    check(await h.evaluate(h=>h.selection.summary.selected===0),'Both-trigger frame gesture also selected the asset');
    await page.evaluate(()=>{window.xrDevice.controllers.left.updateButtonValue('trigger',0);
      window.xrDevice.controllers.right.updateButtonValue('trigger',0);}); await settle(h);
    await h.evaluate(h=>new Promise(resolve=>h.app.xr.end(resolve))); await settle(h);
    await page.click('[aria-label="Annotate"]');
    await page.waitForSelector('.annotation-list');
    check(await page.$eval('.selection-toolbar [role="status"]',e=>e.textContent.startsWith('0 /')),'Desktop selection summary did not synchronize from XR');
    check(await page.$eval('.annotation-list',e=>!e.textContent.includes('notex')&&e.textContent.includes('point')),'XR deletion did not synchronize to desktop');
    await page.screenshot({path:path.join(output,`${id}-xr-editing-back-on-desktop.png`)});
    console.log('PASS',id,'ray clipping, hover, select/save/paint/isolate → annotation, point annotation/edit/collapse, desktop sharing');
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
    const loadStarted = performance.now();
    await page.goto(`${base}/artifacts/${id}`);
    await page.evaluate(environment => window.xrDevice.sem.loadEnvironment(environment), room);
    await page.waitForSelector('[aria-label="Select"]:not([disabled])', { timeout: 90000 });
    if (!process.env.XR_PASSIVE_ONLY) await page.waitForSelector('[aria-label="View in VR"]');
    if (!process.env.XR_PASSIVE_ONLY) check(await page.evaluate(() => {
      const footer = document.querySelector(".viewer-footer"), vr = footer?.querySelector('[aria-label="View in VR"]');
      const ar = footer?.querySelector('[aria-label="View in your room"]');
      const full = footer?.querySelector('[aria-label="Fullscreen"]');
      const bounds = footer?.getBoundingClientRect(), vrBounds = vr?.getBoundingClientRect(), fullBounds=full?.getBoundingClientRect();
      return !!(vr && ar && full && bounds && vrBounds && fullBounds && vrBounds.width >= 36 &&
        fullBounds.width >= 36 && fullBounds.right < vrBounds.left && vrBounds.bottom <= bounds.bottom &&
        !document.querySelector(".viewer-help") && !document.querySelector('[aria-label="Four views"]'));
    }), "Bottom-right Fullscreen, VR and AR controls are missing or too small");
    await page.$eval(".viewer-frame", element => element.scrollIntoView());
    const h = await handle();
    console.log("LOAD",id,Math.round(performance.now()-loadStarted),"primitives",await h.evaluate(h=>h.selection.summary.total));
    if (process.env.XR_PASSIVE_ONLY) {
      const idle = async () => h.evaluate(async h => {
        let draws=0, quiet=0, previous=0;
        const rendered=()=>draws++;
        h.app.on('postrender',rendered);
        try {
          for(let i=0;i<240&&quiet<20;i++) {
            await new Promise(resolve=>h.app.once('frameend',resolve));
            quiet=draws===previous?quiet+1:0;previous=draws;
          }
          const start=draws;
          for(let i=0;i<60;i++)await new Promise(resolve=>h.app.once('frameend',resolve));
          return {quiet,draws:draws-start,autoRender:h.app.autoRender};
        } finally {h.app.off('postrender',rendered);}
      });
      check((await idle()).draws===0,'Passive viewer kept rendering while idle');
      const canvas=await page.$('.viewer-canvas canvas'),r=await canvas.boundingBox();
      const before=await canvas.screenshot();
      const assetPixels=await page.evaluate(async png=>{
        const image=new Image();image.src='data:image/png;base64,'+png;await image.decode();
        const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
        const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
        const pixels=ctx.getImageData(image.width*.2,image.height*.15,image.width*.5,image.height*.7).data;
        let count=0;for(let i=0;i<pixels.length;i+=4)if(Math.abs(pixels[i]-192)+Math.abs(pixels[i+1]-192)+Math.abs(pixels[i+2]-192)>36)count++;
        return count;
      },before.toString('base64'));
      check(assetPixels>100,'Passive viewer has no rendered asset pixels');
      await page.mouse.move(r.x+r.width*.45,r.y+r.height*.4);
      await page.mouse.down();await page.mouse.move(r.x+r.width*.55,r.y+r.height*.45,{steps:10});await page.mouse.up();
      check((await idle()).draws===0,'Camera damping did not return to render-on-demand');
      check(!before.equals(await canvas.screenshot()),'Passive camera orbit did not render');
      await page.mouse.move(r.x+r.width*.6,r.y+r.height*.5,{steps:10});
      check((await idle()).draws===0,'Pointer hover restarted passive scene rendering');
      await page.screenshot({path:path.join(output,`${id}-passive-orbit.png`)});
      console.log('PASS',id,'idle rendering, orbit redraw, damping settles, pointer hover stays idle');
      continue;
    }
    if (process.env.XR_PROFILE_ONLY) continue;
    if (process.env.XR_EDITING_ONLY) {
      // A Quest's 2D browser can deliver tap/release rather than a held drag.
      // Two touch taps must still define a box before immersive entry.
      await page.click('[aria-label="Select"]');
      await page.locator('.selection-shapes button ::-p-text(Box)').click();
      const center = await h.evaluate(h => {
        const b = h.selection.bounds(null), camera = h.viewports.perspectivePanel.camera;
        return camera.worldToScreen(b.center).toArray();
      });
      const canvasRect = await page.$eval('.viewer-canvas canvas', canvas => {
        const r = canvas.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height };
      });
      const touch = await page.createCDPSession();
      await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true });
      const span = assets[id].type === 'splat' ? 200 : 50;
      for (const [x, y] of [[center[0] - span, center[1] - span], [center[0] + span, center[1] + span]]) {
        const clientX = x + canvasRect.left, clientY = y + canvasRect.top;
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: clientX, y: clientY, id: 1 }] });
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
      await page.waitForFunction(h => h.selection.summary.selected > 0, { timeout: 30000 }, h);
      await touch.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await touch.detach();
      await page.keyboard.press('q');
      await page.waitForFunction(h => h.selection.summary.selected === 0, {}, h);
      if(process.env.XR_EDITING_SECTION && id!=='surface-fixture') {
        await page.click('[aria-label="Cross section"]');
        await page.locator('.section-buttons button ::-p-text(Enable section)').click();
        await page.locator('[aria-label="Section name"]').fill('Editing cut');
        await page.locator('.section-options button ::-p-text(Save section)').click();
        await page.keyboard.press('q');
      }
      await page.click(process.env.XR_EDITING_AR ? '[aria-label="View in your room"]' : '[aria-label="View in VR"]');
      await page.waitForFunction(()=>document.querySelector('.viewer-frame')?.dataset.immersive==='true'); await settle(h);
      if(process.env.XR_EDITING_AR) {
        await page.evaluate(()=>{const c=window.xrDevice.controllers.left;c.position.set(.3,1.3,-.5);c.quaternion.set(-Math.sin(7*Math.PI/36),0,0,Math.cos(7*Math.PI/36));});
        await page.waitForFunction(h=>h.app.root.findByName('AR placement target')?.enabled,{timeout:15000},h);
        await page.evaluate(()=>window.xrDevice.controllers.right.updateButtonValue('trigger',1)); await settle(h);
        check(await h.evaluate(h=>!h.app.root.findByName('Immersive artifact')?.enabled),'Right trigger placed the AR asset');
        await page.evaluate(()=>window.xrDevice.controllers.right.updateButtonValue('trigger',0)); await settle(h);
        await page.evaluate(()=>window.xrDevice.controllers.left.updateButtonValue('trigger',1));
        await page.waitForFunction(h=>h.app.root.findByName('Immersive artifact')?.enabled,{timeout:15000},h);
        await page.evaluate(()=>window.xrDevice.controllers.left.updateButtonValue('trigger',0)); await settle(h);
        // Simulate the user's grip move after floor placement, bringing the model
        // into the visible editing workspace before testing surface gestures.
        await h.evaluate(h=>{
          const root=h.app.root.findByName('Immersive artifact'),center=h.selection.bounds(null).center;
          root.setPosition(root.getPosition().add(center.clone().set(0,1.5,-1.5).sub(center)));
        }); await settle(h);
      }
      await editingRegression(h,id); continue;
    }
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
            const c=window.xrDevice.controllers.left;
            c.position.set(.3,1.3,-.5);
            c.quaternion.set(-Math.sin(7*Math.PI/36),0,0,Math.cos(7*Math.PI/36));
          });
          await page.waitForFunction(h => h.app.root.findByName("AR placement target")?.enabled, {timeout:15000}, h);
          await page.evaluate(() => window.xrDevice.controllers.left.updateButtonValue("trigger",1));
          await page.waitForFunction(h => h.app.root.findByName("Immersive artifact")?.enabled, {timeout:15000}, h);
          await page.evaluate(() => window.xrDevice.controllers.left.updateButtonValue("trigger",0));
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
          await clickToolbar(h, 130);
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
          await page.evaluate(() => { window.xrDevice.controllers.left.updateButtonValue("trigger", 1); window.xrDevice.controllers.right.updateButtonValue("trigger", 1); });
          await settle(h);
          const framed = await h.evaluate((h, localCenter) => {
            const Vec3 = h.app.root.getPosition().constructor;
            const center = h.app.root.findByName("Immersive artifact").getWorldTransform().transformPoint(new Vec3(...localCenter));
            const camera = h.viewports.perspectivePanel.camera.entity;
            return center.clone().sub(camera.getPosition()).dot(camera.forward);
          }, initialBounds.center);
          check(Math.abs(framed - 1.5) < .02, `Trigger chord did not frame the artifact in front of the headset: ${framed}`);
          await page.evaluate(() => { window.xrDevice.controllers.left.updateButtonValue("trigger", 0); window.xrDevice.controllers.right.updateButtonValue("trigger", 0); });
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
    await panelClick("XR tool bar", 130, 25);
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
      await panelClick("XR measurement options", 225, height - 14 - 9);
    };
    await collapse();
    check(await h.evaluate(h => h.app.root.findByName("XR measurement options").element.height === 32), "Collapse did not reduce XR options to its bar and grab handle");
    await page.screenshot({ path:path.join(output, `${id}-measurement-collapsed.png`) });
    await collapse();
    check(await h.evaluate(h => h.app.root.findByName("XR measurement options").element.height > 32), "Expand did not restore XR options");
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
    await panelClick("XR tool bar", 130, 25);
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
    await panelClick("XR tool bar", 130, 25);
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
  console.log(process.env.XR_PASSIVE_ONLY ? "PASS passive viewer rendering and navigation" :
    "PASS XR denied-entry recovery, placement, head tracking, AR alpha, stereo mesh/splat rendering, four-view restoration, teardown", output);
} catch (error) {
  for (const page of await browser.pages()) console.log("XR FAILURE", page.url(), await page.evaluate(() => document.body.innerText));
  throw error;
} finally { await browser.close(); }
