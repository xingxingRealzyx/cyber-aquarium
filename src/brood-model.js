import * as THREE from 'three';
import { REPRODUCTION } from './reproduction.js';
import { substrateHeight } from './simulation.js';

const up = new THREE.Vector3(0, 1, 0);
const down = new THREE.Vector3(0, -1, 0);

// Instances share the egg shell geometry. Only deposited clutches and carried
// shrimp eggs are drawn; guppy embryos develop inside the mother.
export function createBroodDisplay(tank, hardscape) {
  const clutches = new Map();
  const geometry = new THREE.SphereGeometry(1, 12, 8);
  const material = new THREE.MeshStandardMaterial({ roughness: .38 });
  const dummy = new THREE.Object3D(), point = new THREE.Vector3(), normal = new THREE.Vector3();
  const color = new THREE.Color();
  const ray = new THREE.Raycaster();
  let lastHardscape;

  function makeClutch(brood, kind) {
    const eggs = new THREE.InstancedMesh(geometry, material, brood.count);
    eggs.name = REPRODUCTION[brood.species].label;
    eggs.receiveShadow = true;
    const { x, y, z } = brood.position;
    for (let i = 0; i < brood.count; i++) {
      const angle = i * 2.4, radius = .052 * Math.sqrt(i);
      dummy.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      dummy.scale.set(.027, .026, .027);
      if (kind === 'scatter') {
        const px = x + dummy.position.x * 5, pz = z + dummy.position.z * 5;
        // Eggs settle on top of existing rocks and wood as well as on sand.
        ray.set(point.set(px, 4.2, pz), down);
        const hit = ray.intersectObjects(hardscape.children.filter(m => m.visible), false)[0];
        dummy.position.set(px - x, Math.max(substrateHeight(px, pz), hit?.point.y ?? 0) + .024 - y, pz - z);
      } else if (kind === 'capsule') {
        dummy.scale.set(.049, .015, .031);
      } else if (kind === 'carried') {
        dummy.position.set(.025 - i * .038, .065, .027 * (i % 2 ? -1 : 1));
        dummy.scale.set(.022, .026, .021);
      }
      dummy.updateMatrix();
      eggs.setMatrixAt(i, dummy.matrix);
      color.set(kind === 'capsule' ? '#f6ecd0' : kind === 'carried' ? '#ccba61' : '#e7cc8f');
      color.multiplyScalar(1 - .08 * (i % 3));
      eggs.setColorAt(i, color);
    }
    tank.add(eggs);
    return eggs;
  }

  function update(broods, animals, leafSites, time) {
    if (!clutches.size && !broods.length) return;
    const surfaces = hardscape.children.map(m => m.geometry.id).join('/');
    const bedChanged = lastHardscape !== surfaces;
    lastHardscape = surfaces;
    for (const [id, eggs] of clutches) {
      const brood = broods.find(b => b.id === id);
      if (brood && !(bedChanged && REPRODUCTION[brood.species].kind === 'scatter')) continue;
      tank.remove(eggs);
      eggs.dispose();
      clutches.delete(id);
    }
    for (const brood of broods) {
      const kind = REPRODUCTION[brood.species].kind;
      if (kind === 'livebearer') continue;
      let eggs = clutches.get(brood.id);
      if (!eggs) {
        eggs = makeClutch(brood, kind);
        clutches.set(brood.id, eggs);
      }
      if (kind === 'carried') {
        const mother = animals.get(brood.motherId);
        eggs.visible = !!mother;
        if (mother) {
          eggs.position.copy(mother.position);
          eggs.quaternion.copy(mother.quaternion);
          eggs.scale.copy(mother.scale);
        }
        continue;
      }
      eggs.position.copy(brood.position);
      if (brood.plantId) {
        const sites = leafSites?.get(brood.plantId);
        eggs.visible = !!sites?.length;
        if (!eggs.visible) continue;
        if (eggs.userData.sites !== sites) {
          const nearby = [...sites].sort((a, b) =>
            a.point.distanceToSquared(brood.position) - b.point.distanceToSquared(brood.position));
          // Pairs sharing a plant can use different leaves near their spawning site.
          let hash = 0;
          for (const char of brood.id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
          eggs.userData.site = nearby[hash % Math.min(4, nearby.length)];
          eggs.userData.sites = sites;
        }
        const site = eggs.userData.site;
        normal.copy(site.normal).multiplyScalar(kind === 'leaf' ? -1 : 1);
        eggs.quaternion.setFromUnitVectors(up, normal);
        eggs.position.copy(site.point).addScaledVector(normal, .019);
        // Match the leaf shader's water-current displacement at the attachment.
        const phase = site.point.x * .82 + site.point.z * .78;
        eggs.position.x += site.flex * (.057 * Math.sin(.75 * time + phase) + .016 * Math.sin(1.2 * time + phase * 2));
        eggs.position.z += site.flex * .029 * Math.sin(.59 * time + phase * 1.4);
      } else if (kind === 'capsule' || kind === 'guarded') {
        const side = Math.sign(brood.position.z) || 1;
        eggs.position.z = side * (2 - .015);
        eggs.quaternion.setFromUnitVectors(up, normal.set(0, 0, -side));
      }
    }
  }

  function dispose() {
    for (const eggs of clutches.values()) {
      tank.remove(eggs);
      eggs.dispose();
    }
    clutches.clear();
    geometry.dispose();
    material.dispose();
  }
  return { update, clutches, dispose };
}
