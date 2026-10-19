# Browser verification for viewer changes

Use this procedure before declaring a viewer or UI bug fixed. A passing build or unit test cannot establish that a WebGL frame renders correctly, that a pointer gesture reaches its target, or that a visible highlight exists.

## Run the viewer and browser

Start the frontend from this repository:

```bash
npm run dev -- --host 127.0.0.1 --port 5175
```

Use Puppeteer with its installed browser. In this workspace Puppeteer is already installed in the sibling `mesh-splat-artifact-service` package for thumbnail generation; the portal does not need another runtime dependency. Resolve it through that package when creating an ES-module test harness outside the repository:

```js
import { createRequire } from 'node:module';
import path from 'node:path';

// Run from the portal repository. Override this path for a different checkout.
const packagePath = path.resolve('../mesh-splat-artifact-service/package.json');
const require = createRequire(packagePath);
const { default: puppeteer } = await import(require.resolve('puppeteer'));
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.stack ?? String(error)));
page.on('console', message => {
  if (message.type() === 'error') errors.push(message.text());
});

try {
  // Configure test API responses/assets, then reproduce the UI interaction.
  // Assert expected visible output and reject unexpected browser errors.
} finally {
  await browser.close();
}
```

Use the configured backend if available. Otherwise, isolate the browser test from database and deployment state: serve chosen real derivative files through a temporary localhost-only HTTP server and intercept the catalog/detail API requests with `page.setRequestInterception(true)` and `request.respond(...)`. Match the API schema in `src/api/artifacts.ts`. Serve GLB as `model/gltf-binary`, SOG metadata as `application/json`, and SOG image components as `image/webp`. Permit only the explicit derivative directory; do not expose master assets, private manifests, or credentials.

Keep temporary harnesses, screenshots, traces, and generated fixtures outside the repositories, for example under `/private/tmp`. The October 2026 annotation investigation used `gab-freeze-repro.mjs`, `gab-annotation-regression.mjs`, `gab-splat-regression.mjs`, and `gab-hover-inspect.mjs` there. If still available, inspect their current fixture assumptions before rerunning them:

```bash
node /private/tmp/gab-annotation-regression.mjs
node /private/tmp/gab-splat-regression.mjs
node /private/tmp/gab-hover-inspect.mjs
```

Those temporary files are examples, not a persistent test dependency. Recreate a focused harness from this procedure in a fresh environment. Use the environment's required permission escalation for starting local servers or browsers; do not bypass sandbox restrictions.

## Reproduce and verify the actual interaction

1. Load a representative real mesh and a real splat. Wait for loading to finish and the viewer tools to become enabled; use condition-based waits rather than arbitrary sleep delays.
2. Reproduce the user's exact action sequence before editing. Record console/page errors, affected pointer targets, and the rendered result. Distinguish a frozen render loop from a camera-input failure.
3. Use `page.mouse.move/down/up`, `page.mouse.click`, and `page.keyboard` for gestures. Compute pointer positions from the canvas's `getBoundingClientRect()`. Choose points on visible model surfaces, accounting for camera changes and tool panels. Do not test a feature exclusively by calling its controller method directly.
4. Repeat the same sequence after the fix. Assert the expected transition, then inspect the actual rendered output. A status label saying a selection was found is not proof that its highlight was drawn.
5. For navigation, compare the rendered canvas before and after orbit/pan/zoom as well as the camera pose. In the annotation regression, the camera continued to move internally while render exceptions kept the displayed image frozen.
6. For hover, compare screenshots before entering a region, while hovering it, and after leaving it. Confirm that only the targeted saved region changes visibly and that its highlight clears. Check colored and uncolored regions, repeated entry, and movement between separate selections. Measure response time; do not hide delay behind long waits in the harness.
7. For annotation changes, cover both point and selection workflows: choose a region, place the marker, enter details, focus, save, exit with Q, navigate, edit, drag the marker, hide/show, delete, and create again. Check grab/grabbing cursor feedback and the committed marker position. Confirm continued rendering without first hiding or deleting the annotation.
8. Navigate back to the collection, reopen an asset, and check for cleanup errors. Test the relevant fullscreen/resizing paths when changing overlay positioning or pointer coordinates.
9. For saved views, rotate the asset with the native gizmo while keeping the camera fixed; verify existing measurement endpoints and annotation markers follow it without changing stored distances. Exercise draft cancellation, save/edit/update/recall, world-direction navigation, orthographic framing, completed three-point alignment, and a saved view loaded into Sectioning. Confirm source child transforms and selection identities remain intact.
10. For sectioning, test both plane sides and offset limits, then measure retained surfaces and confirm removed surfaces cannot be picked. Exercise section → select → paint → bound annotation, region hover away from its marker, isolation, and X-ray selection after flipping. Use an engine-generated fixture with a known span to check exposed reverse-surface measurement; a scan alone cannot establish dimensional correctness. Verify Q while a slider has focus. Test native stereo camera views separately, and report whether an actual XR session was exercised.

Read screenshots with the image-viewing tool, not just a file-existence check. For an automated image assertion, compare canvas pixels or a stable crop containing the affected region; do not accept changes caused only by cursor, panel, or tooltip animation as proof that model rendering works. Use installed image tools when appropriate rather than adding a runtime dependency to the viewer.

## Complete and report

Run the same critical interactions against the minified production output (`npm run build`, then `npm run preview -- --host 127.0.0.1 --port 5180`). Development-server tests alone do not establish deployment correctness: minification can change class-derived engine registration names. Use explicit PlayCanvas script names for application-owned script subclasses. The Views camera regression was reproduced on both formats only in production output; verify tool activation, navigation, and teardown there before shipping.

Run the relevant unit/regression tests and production build. Preserve a small automated regression test for the diagnosed cause when practical, especially for resource ownership or state-transition faults. Keep temporary diagnostic instrumentation out of production code.

Report the exact browser workflows exercised, which asset types passed, and any material limits. Headless Chromium testing does not establish Safari, WebGPU, or headset compatibility. If a fixture or browser check times out, diagnose it or report that coverage as incomplete; do not count it as a pass. Commit/push reusable code and documentation through Git, then deploy on AWS using the existing workflow.
