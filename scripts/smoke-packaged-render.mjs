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

let application;
try {
  application = await electron.launch({ executablePath, args: ['--user-data-dir=' + profile], env, timeout: 90000 });
  const page = await application.firstWindow({ timeout: 90000 });
  const shell = await application.evaluate(({ app }) => ({
    packaged: app.isPackaged, appPath: app.getAppPath(), profile: app.getPath('userData'),
    platform: process.platform, arch: process.arch, accelerationEnabled: app.isHardwareAccelerationEnabled(),
    features: app.getGPUFeatureStatus(),
  }));
  assert.equal(shell.packaged, true);
  assert.equal(path.resolve(shell.profile), profile);
  assert.equal(shell.accelerationEnabled, true, 'the application enables hardware acceleration');
  assert.match(shell.appPath, /app\.asar$/);

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  const ready = () => window.aquariumDiagnostics?.stats.triangles > 0 || document.querySelector('#error')?.hidden === false;
  await page.waitForFunction(ready, null, { timeout: 120000 });
  assert.match(page.url(), /^file:.*app\.asar\/dist\/index\.html$/);
  assert.equal(await page.locator('#error').isVisible(), false, await page.locator('#error').textContent());
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
  const kind = adapterKind(result.renderer, shell.features.webgl ?? '');
  const report = {
    platform: shell.platform, arch: shell.arch, accelerationEnabled: shell.accelerationEnabled,
    adapterKind: kind, webglFeature: shell.features.webgl,
    gpuCompositing: shell.features.gpu_compositing, ...result,
  };
  console.log(JSON.stringify(report, null, 2));
  assert.match(result.version, /^WebGL 2/);
  assert.equal(result.webglError, 0);
  assert.ok(result.stats.drawCalls > 0 && result.stats.triangles > 0);
  assert.ok(result.opaquePixels > 5 && result.uniqueOpaqueColors > 5 && result.clearPixels > 0, 'the GPU frame contains scenery and clear desktop pixels');
  assert.deepEqual(errors, []);
  if (env.REQUIRE_HARDWARE_GPU === '1') {
    assert.equal(kind, 'hardware', 'this runner must use a recognized hardware WebGL adapter');
    assert.match(shell.features.gpu_compositing ?? '', /^enabled/);
  }
} finally {
  await application?.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
