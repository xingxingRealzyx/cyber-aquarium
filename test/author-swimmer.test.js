import test from 'node:test';
import assert from 'node:assert/strict';
import { Color, LoadingManager, Texture, TextureLoader, Vector3 } from 'three';
import { createAuthorSwimmer, animateAuthorSwimmer } from '../src/author-swimmer.js';

function buildRig(t) {
  // Geometry and bone transforms run in Node without an image decoder or GPU.
  t.mock.method(TextureLoader.prototype,'load',(_url, ready) => {
    const texture = new Texture();
    ready(texture);
    return texture;
  });
  return createAuthorSwimmer(new LoadingManager());
}

test('arms and legs blend continuously across all four bending joints', t => {
  const swimmer = buildRig(t);
  const limbs = [];
  swimmer.traverse(mesh => { if (mesh.isSkinnedMesh) limbs.push(mesh); });
  assert.equal(limbs.length, 4);
  for (const mesh of limbs) {
    const { skinWeight } = mesh.geometry.attributes;
    let distal = -1, blended = 0;
    for (let i=0; i<skinWeight.count; i++) {
      const proximalWeight = skinWeight.getX(i), distalWeight = skinWeight.getY(i);
      assert.ok(proximalWeight>=0 && distalWeight>=0);
      assert.ok(Math.abs(proximalWeight+distalWeight-1)<1e-6);
      if (distalWeight>.999 && distal<0) distal=i;
      if (distalWeight>.01 && distalWeight<.99) blended++;
    }
    assert.ok(distal>=0 && blended>0,'skin includes both fully attached and blended vertices');
    animateAuthorSwimmer(swimmer,0);
    swimmer.updateMatrixWorld(true);
    const first=mesh.getVertexPosition(distal,new Vector3());
    let excursion=0;
    for(let i=1;i<=24;i++) {
      animateAuthorSwimmer(swimmer,i*.15);
      swimmer.updateMatrixWorld(true);
      excursion=Math.max(excursion,first.distanceTo(mesh.getVertexPosition(distal,new Vector3())));
    }
    assert.ok(excursion>.01,'the elbow or knee actually deforms the visible limb mesh');
  }
});

test('alternating hip-led kicks bend the fins, sculling moves the arms, and the mouth lifts for air', t => {
  const swimmer=buildRig(t);
  const [left,right]=swimmer.userData.rig.limbs;
  const point=new Vector3();
  function finTip(limb) {
    const position=limb.blade.geometry.attributes.position;
    let tip=0;
    for(let i=1;i<position.count;i++) if(position.getZ(i)<position.getZ(tip)) tip=i;
    return tip;
  }
  const leftTip=finTip(left), rightTip=finTip(right);
  const firstWrist=left.wrist.quaternion.clone(), firstElbow=left.elbow.quaternion.clone();
  let minDifference=Infinity, maxDifference=-Infinity;
  let minFlex=Infinity, maxFlex=-Infinity, wristTurn=0, elbowTurn=0;
  for (let i=0;i<=96;i++) {
    animateAuthorSwimmer(swimmer,i/16);
    swimmer.updateMatrixWorld(true);
    assert.ok(left.hip.rotation.x*right.hip.rotation.x<=1e-6,'left and right hip kicks oppose each other');
    for (const limb of [left,right]) {
      assert.ok(limb.knee.rotation.x>=0 && limb.knee.rotation.x<Math.PI/2,'knees flex without hyperextension');
    }
    const leftHeight=left.blade.localToWorld(left.blade.getVertexPosition(leftTip,point)).y;
    const rightHeight=right.blade.localToWorld(right.blade.getVertexPosition(rightTip,point)).y;
    minDifference=Math.min(minDifference,leftHeight-rightHeight);
    maxDifference=Math.max(maxDifference,leftHeight-rightHeight);
    const flex=left.blade.morphTargetInfluences[0];
    minFlex=Math.min(minFlex,flex); maxFlex=Math.max(maxFlex,flex);
    wristTurn=Math.max(wristTurn,firstWrist.angleTo(left.wrist.quaternion));
    elbowTurn=Math.max(elbowTurn,firstElbow.angleTo(left.elbow.quaternion));
  }
  assert.ok(minDifference<-.12 && maxDifference>.12,'both fin tips alternate above and below each other');
  assert.ok(minFlex<-.3 && maxFlex>.3,'water pressure flexes the blade in both directions');
  assert.ok(elbowTurn>.25 && wristTurn>.25,'both elbows and wrists take part in the stroke');

  animateAuthorSwimmer(swimmer,2,0);
  const submerged=swimmer.userData.mouth.getWorldPosition(point).y;
  animateAuthorSwimmer(swimmer,2,1);
  assert.ok(swimmer.userData.mouth.getWorldPosition(point).y>submerged+.04,
    'the articulated neck lifts the mouth at the surface');
});

test('the original full-size cat head and teal fins share the swimmer with both breathing anchors', t => {
  const swimmer=buildRig(t);
  const { neck, limbs }=swimmer.userData.rig;
  const head=neck.children.find(part=>part.userData.mouth);
  assert.deepEqual(head.scale.toArray(),[1,1,1]);
  assert.deepEqual(head.position.toArray(),[0,.058,.109]);
  assert.equal(swimmer.userData.mouth,head.userData.mouth);
  assert.equal(swimmer.userData.snorkelTip,head.userData.snorkelTip);
  assert.notEqual(swimmer.userData.mouth,swimmer.userData.snorkelTip);
  const tip=head.userData.snorkelTip.getWorldPosition(new Vector3());
  assert.ok(tip.y>head.userData.mouth.getWorldPosition(new Vector3()).y+.12);

  const expected=new Color('#287c83'), actual=new Color();
  for(const {blade} of limbs) {
    const colors=blade.geometry.attributes.color;
    let hasTeal=false;
    for(let i=0;i<colors.count;i++) {
      actual.fromBufferAttribute(colors,i);
      if(Math.abs(actual.g-expected.g)+Math.abs(actual.b-expected.b)<1e-5) hasTeal=true;
    }
    assert.ok(hasTeal);
  }
});
