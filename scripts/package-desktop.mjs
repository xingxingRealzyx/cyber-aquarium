import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const platform = process.argv[2];
if (!['darwin','win32'].includes(platform) || process.platform !== platform) {
  throw new Error('请在对应操作系统中运行 npm run package:mac 或 npm run package:win。');
}
const mac = platform === 'darwin';
const arch = mac ? process.arch : 'x64';
const root = fileURLToPath(new URL('../', import.meta.url));
const release = path.join(root, 'release');
const electronDir = path.join(root, 'node_modules', 'electron');
const name = 'Cyber Aquarium';

await access(path.join(root, 'dist', 'index.html'));
const electron = JSON.parse(await readFile(path.join(electronDir, 'package.json'), 'utf8'));
const checksums = JSON.parse(await readFile(path.join(electronDir, 'checksums.json'), 'utf8'));
const [output] = await packager({
  dir: root,
  out: release,
  name,
  executableName: name,
  platform,
  arch,
  electronVersion: electron.version,
  download: { checksums },
  overwrite: true,
  asar: true,
  // Vite bundles the renderer's dependencies. The native shell only imports
  // Electron and Node built-ins, so the application needs these three entries.
  prune: false,
  ignore: /^\/(?!electron(?:\/|$)|dist(?:\/|$)|package\.json$)/,
  appBundleId: 'com.cyberaquarium.desktop',
  appCategoryType: 'public.app-category.entertainment',
  extendInfo: {
    CFBundleDisplayName: '澄境 · Cyber Aquarium',
    NSHighResolutionCapable: true,
    LSUIElement: true,
  },
});

const app = path.join(output, name + '.app');
const resources = mac ? path.join(app, 'Contents', 'Resources') : path.join(output, 'resources');
const exe = mac ? path.join(app, 'Contents', 'MacOS', name) : path.join(output, name + '.exe');
await access(path.join(resources, 'app.asar'));
if (mac) {
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
}
const actualArch = execFileSync(exe, ['-p', 'process.arch'], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
  timeout: 30000,
}).trim();
if (actualArch !== arch) throw new Error(`Expected ${arch} executable, got ${actualArch}`);

const archive = path.join(release, `Cyber-Aquarium-${mac ? 'macos' : 'windows'}-${arch}.zip`);
if (mac) {
  // Preserve executable bits and the symlinks in Electron Framework.framework.
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, archive], { stdio: 'inherit' });
} else {
  // A portable installation may share its directory with user files. The updater
  // needs the exact package inventory to replace and retire only our own files.
  const manifest = 'resources/update-files.json';
  const files = [manifest];
  for (const entry of await readdir(output, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const relative = path.relative(output, path.join(entry.parentPath, entry.name)).split(path.sep).join('/');
    if (relative !== manifest) files.push(relative);
  }
  await writeFile(path.join(output, manifest), JSON.stringify(files.sort()));
  const tar = path.join(process.env.SystemRoot, 'System32', 'tar.exe');
  execFileSync(tar, ['-a', '-cf', archive, '-C', output, '.'], { stdio: 'inherit' });
}
console.log(archive);
