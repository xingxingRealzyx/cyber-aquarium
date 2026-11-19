// Generate offline species-picker portraits from the same models used by the tank.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = new URL('../public/species/', import.meta.url);
const virtualId = 'virtual:species-portraits';
const previewModule = `
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createResidentModel } from '/src/aquarium.js';
import { disposeGrazerMaps } from '/src/grazer-materials.js';
import { SPECIES } from '/src/simulation.js';

export async function renderPortraits(selection) {
  const renderer = new THREE.WebGLRenderer({alpha:true, antialias:true, preserveDrawingBuffer:true});
  renderer.setSize(420, 192);
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const surface = pmrem.fromScene(environment, .06);
  scene.environment = surface.texture;
  scene.environmentIntensity = .45;
  scene.add(new THREE.HemisphereLight('#e5f6ff','#737054',1.35));
  const key = new THREE.DirectionalLight('#fff5df',2.9);
  key.position.set(2.2,4,3); scene.add(key);
  const rim = new THREE.DirectionalLight('#aedce5',1.3);
  rim.position.set(-3,1,-2); scene.add(rim);
  const camera = new THREE.OrthographicCamera(-1,1,.5,-.5,.01,12);
  const portraits = {};
  for(const species of selection.length ? selection : Object.keys(SPECIES)) {
    if (!Object.hasOwn(SPECIES, species)) throw new Error('Unknown species: ' + species);
    const manager = new THREE.LoadingManager();
    const decoded = new Promise((resolve, reject) => {
      manager.onLoad = resolve;
      manager.onError = url => reject(new Error('Could not load portrait texture: ' + url));
    });
    manager.itemStart('portrait');
    const subject = createResidentModel(species, .37, manager);
    manager.itemEnd('portrait');
    await decoded;
    subject.rotation.y = -.15; scene.add(subject);
    const box = new THREE.Box3().setFromObject(subject);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const width = Math.max(size.x, size.y * 420/192) * 1.1;
    camera.left=-width/2; camera.right=width/2;
    camera.top=width*192/420/2; camera.bottom=-camera.top;
    const elevation = species === 'shrimp' || species === 'snail' ? .68 : .055;
    camera.position.copy(center).add(new THREE.Vector3(0,elevation,3));
    camera.lookAt(center); camera.updateProjectionMatrix();
    renderer.render(scene,camera);
    portraits[species] = renderer.domElement.toDataURL('image/png').split(',')[1];
    scene.remove(subject);
    disposeGrazerMaps(manager);
  }
  renderer.dispose(); pmrem.dispose(); surface.dispose(); environment.dispose();
  return portraits;
}`;
const server = await createServer({
  root, configFile:false, logLevel:'error', server:{host:'127.0.0.1',port:0},
  plugins:[{
    name:'aquarium-portraits',
    resolveId(id) { if(id===virtualId) return `\0${id}`; },
    load(id) { if(id===`\0${virtualId}`) return previewModule; },
  }],
});
let browser;
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH});
  const page = await browser.newPage();
  await page.route('**/portrait-stage', route => route.fulfill({contentType:'text/html',body:'<!doctype html><title>Species portraits</title>'}));
  await page.goto(new URL('portrait-stage', origin).href);
  const portraits = await page.evaluate(async selection => (await import('/@id/__x00__virtual:species-portraits')).renderPortraits(selection), process.argv.slice(2));
  await mkdir(output,{recursive:true});
  for(const [species,data] of Object.entries(portraits)) {
    await writeFile(new URL(`${species}.png`,output),Buffer.from(data,'base64'));
  }
  console.log(`Rendered ${Object.keys(portraits).length} species portraits`);
} finally {
  await browser?.close();
  await server.close();
}
