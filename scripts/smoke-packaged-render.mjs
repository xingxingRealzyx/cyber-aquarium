import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const target = process.argv[2];
assert.ok(target, 'Pass the path to the packaged Windows .exe or macOS .app');
const executablePath = target.endsWith('.app')
  ? path.resolve(target, 'Contents', 'MacOS', 'Cyber Aquarium')
  : path.resolve(target);
const profile = await mkdtemp(path.join(tmpdir(), 'cyber-aquarium-gpu-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;

function adapterKind(renderer, featureStatus) {
  if (/swiftshader|llvmpipe|softpipe|software|basic render|\bwarp\b/i.test(renderer)) return 'software';
  if (/svga|vmware|virgl|virtualbox|parallels|hyper-v|virtual gpu/i.test(renderer)) return 'virtual';
  if (!featureStatus.startsWith('enabled')) return 'unverified';
  if (/nvidia|geforce|intel|radeon|\bamd\b|apple m\d|adreno|qualcomm/i.test(renderer)) return 'hardware';
  return 'unverified';
}

const requireHardware = env.REQUIRE_HARDWARE_GPU === '1';
async function verifyFrame(application, backend) {
  const page = await application.firstWindow({ timeout: 90000 });
  const shell = await application.evaluate(({ app }) => ({
    packaged: app.isPackaged, appPath: app.getAppPath(), profile: app.getPath('userData'),
    platform: process.platform, arch: process.arch,
  }));
  assert.equal(shell.packaged, true);
  assert.equal(path.resolve(shell.profile), profile);
  assert.match(shell.appPath, /app\.asar$/);

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  const ready = () => window.aquariumDiagnostics?.stats.triangles > 0 || document.querySelector('#error')?.hidden === false;
  await page.waitForFunction(ready, null, { timeout: 120000 });
  assert.match(page.url(), /^file:.*app\.asar\/dist\/index\.html$/);
  const graphics = await application.evaluate(({ app }) => {
    const features = app.getGPUFeatureStatus();
    return { accelerationEnabled: app.isHardwareAccelerationEnabled(),
      webglFeature: features.webgl, gpuCompositing: features.gpu_compositing };
  });
  console.log(JSON.stringify({backend, ...graphics}));
  if (await page.locator('#error').isVisible()) {
    const reason = await page.locator('#error small').textContent();
    const noContext = /creating WebGL context|WebGL 2.*(?:unavailable|not supported)/i.test(reason);
    const hardwareUnavailable = !graphics.accelerationEnabled || !graphics.webglFeature?.startsWith('enabled');
    if (backend === 'default' && noContext && hardwareUnavailable) {
      console.log('The default adapter could not create a WebGL 2 context:', reason);
      return false;
    }
    throw new Error(reason);
  }
  await page.waitForFunction(() => document.querySelector('#aquarium canvas')?.style.visibility !== 'hidden');
  const result = await page.evaluate(async () => {
    // Sample the real, just-drawn transparent tank before Chromium discards its frame.
    await new Promise(requestAnimationFrame);
    const canvas = document.querySelector('#aquarium canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl || gl.isContextLost()) throw new Error('No live WebGL 2 context on the aquarium canvas');
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    const sample = document.createElement('canvas');
    sample.width = 180;
    sample.height = 120;
    const context = sample.getContext('2d');
    context.drawImage(canvas, 0, 0, sample.width, sample.height);
    const { data } = context.getImageData(0, 0, sample.width, sample.height);
    const colors = new Set();
    let opaque = 0, clear = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) clear++;
      if (data[i + 3] > 240) {
        opaque++;
        colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      }
    }
    return {
      version: gl.getParameter(gl.VERSION),
      renderer: gl.getParameter(extension?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER),
      webglError: gl.getError(), stats: window.aquariumDiagnostics.stats,
      opaquePixels: opaque, clearPixels: clear, uniqueOpaqueColors: colors.size,
    };
  });
  const kind = adapterKind(result.renderer, graphics.webglFeature ?? '');
  const report = {
    backend, platform: shell.platform, arch: shell.arch, ...graphics, adapterKind: kind, ...result,
  };
  console.log(JSON.stringify(report, null, 2));
  assert.match(result.version, /^WebGL 2/);
  assert.equal(result.webglError, 0);
  assert.ok(result.stats.drawCalls > 0 && result.stats.triangles > 0);
  assert.ok(result.opaquePixels > 5 && result.uniqueOpaqueColors > 5 && result.clearPixels > 0, 'the GPU frame contains scenery and clear desktop pixels');
  // Placing the diver also exercises the articulated meshes, skinning shaders
  // and the local texture URLs on the actual WebGL backend.
  await page.locator('#aquarium canvas').dispatchEvent('contextmenu', {button:2});
  await page.locator('[data-tab="scenery"]').dispatchEvent('click');
  await page.locator('[data-add-toy="author"]').dispatchEvent('click');
  await page.waitForFunction(() => window.aquariumDiagnostics.screenToys.some(toy =>
    toy.kind === 'author' && toy.visible && toy.snorkelTip.y > toy.mouth.y && toy.bubbles.length > 0),
  null, {timeout:90000});
  const afterPlacement = await page.evaluate(() =>
    document.querySelector('#aquarium canvas').getContext('webgl2').getError());
  assert.equal(afterPlacement, 0, 'the swimming model renders without WebGL errors');
  assert.deepEqual(errors, []);
  if (requireHardware) {
    assert.equal(graphics.accelerationEnabled, true);
    assert.equal(kind, 'hardware', 'this runner must use a recognized hardware WebGL adapter');
    assert.match(graphics.gpuCompositing ?? '', /^enabled/);
  }
  return true;
}

async function run(backend, switches = []) {
  const args = ['--user-data-dir=' + profile, ...switches];
  const application = await electron.launch({executablePath, args, env, timeout: 90000});
  try {
    return await verifyFrame(application, backend);
  } finally {
    await application.close();
  }
}

try {
  if (!await run('default')) {
    assert.ok(!requireHardware && process.argv.includes('--allow-ci-software'),
      'this host requires an available WebGL 2 adapter');
    // Only this disposable local-app test process opts in to a software adapter.
    await run('CI software fixture', ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']);
  }
} finally {
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
