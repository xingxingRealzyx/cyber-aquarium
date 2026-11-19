import {
  Color, Float32BufferAttribute, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial,
  SphereGeometry, TubeGeometry, CatmullRomCurve3, Vector3,
} from 'three';
import { ParametricGeometry } from 'three/addons/geometries/ParametricGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { grazerMaps } from './grazer-materials.js';

const tau = Math.PI * 2;
const lipCenter = new Vector3(-.002,.045,0);
const smooth = value => {
  const t = Math.max(0,Math.min(1,value));
  return t*t*(3-2*t);
};

// The last whorl enfolds the animal. Smaller, older whorls form a shallow
// logarithmic suture on its posterior shoulder, ending at the eccentric spire.
function shellPoint(u, v, target) {
  const t=v**1.55, a=u*tau, c=Math.cos(a), s=Math.sin(a);
  const crown=(1-t)**2.15;
  const radius=Math.sin(2.38*t)**.83;
  const winding=Math.log(Math.max(.003,t)/.018)/1.18 - u + .08;
  const d=winding-Math.round(winding);
  const groove=Math.exp(-((d/.082)**2)), shoulder=Math.exp(-(((d-.12)/.12)**2));
  const relief=(.0026*shoulder-.0064*groove)*smooth(t/.06)*(1-smooth((t-.39)/.39));
  const zRadius=.120*radius+relief*t;
  const xRadius=.171*radius+relief*t;
  const lipX = c + .44*Math.max(0,-.45-c)*smooth((t-.84)/.16);
  return target.set(-.034-.092*crown+.032*t*t + xRadius*lipX,
    .035+.256*Math.cos(1.52*t) + radius*(.031*c+.011*s) + relief*(1-.6*t),
    .070*crown + zRadius*s);
}

function applyColors(geometry, sample) {
  const { position, uv } = geometry.attributes;
  const values = [], color = new Color();
  for (let i=0; i<position.count; i++) {
    sample(color,uv.getX(i),uv.getY(i),position.getX(i),position.getY(i),position.getZ(i));
    values.push(color.r,color.g,color.b);
  }
  geometry.setAttribute('color',new Float32BufferAttribute(values,3));
  return geometry;
}

function makeShell(seed) {
  const shell = new ParametricGeometry(shellPoint,64,52);
  const uv=shell.attributes.uv;
  for (let i=0; i<uv.count; i++) {
    const t=uv.getY(i)**1.55;
    uv.setXY(i,uv.getX(i) + .16*Math.log1p(8*t) + seed*.81,1-t);
  }

  // The aperture faces the sand, tilted slightly toward the feeding head.
  // Its short inner shelf meets the mantle underneath the body whorl.
  const aperture = new ParametricGeometry((u,v,p) => {
    shellPoint(u,1,p);
    const drop=.004*Math.sin(v*Math.PI);
    p.lerp(lipCenter,v);
    p.y-=drop;
  },48,15);
  const edge=new Color('#b7a077'), porcelain=new Color('#dac9a4');
  const mantle=new Color('#514d37');
  applyColors(aperture,(color,u,v) => {
    const shelf=.05+.17*((1-Math.cos(u*tau))*.5)**3;
    color.copy(edge).lerp(porcelain,smooth(v/.035));
    color.lerp(mantle,smooth((v-shelf)/.045));
  });
  return {shell,aperture};
}

function ellipsoid(center, radii) {
  return new SphereGeometry(1,14,9).scale(...radii).translate(...center);
}

function feeler(points, base, tip) {
  const curve = new CatmullRomCurve3(points.map(p=>new Vector3(...p)));
  const segments=14, sides=8;
  const tube = new TubeGeometry(curve,segments,1,sides,false);
  const pos=tube.attributes.position, center=new Vector3(), vertex=new Vector3();
  for (let j=0; j<=segments; j++) {
    const t=j/segments, radius=tip+(base-tip)*(1-t)**1.32;
    curve.getPointAt(t,center);
    for (let k=0; k<=sides; k++) {
      const i=j*(sides+1)+k;
      vertex.fromBufferAttribute(pos,i).sub(center).multiplyScalar(radius).add(center);
      pos.setXYZ(i,vertex.x,vertex.y,vertex.z);
    }
  }
  return tube;
}

// The pedal sole is flat against the sand. Its thin, flared edge rises into
// a thicker neck anteriorly and tapers down behind the overhanging shell.
function footGeometry() {
  return new ParametricGeometry((u,v,p) => {
    const phi=v*tau, top=(1+Math.cos(phi))*.5;
    const width=.098 * Math.max(.00001,Math.sin(Math.PI*u))**.58 * (.84+.21*u);
    const hem=1+.024*Math.sin(u*60+3*Math.cos(phi))*(1-top);
    const height=.068 + .053*smooth((u-.34)/.48);
    p.set(-.169+.363*u,.001+height*Math.sin(Math.PI*u)**.72*top**2.1,
      -Math.sin(phi)*width*hem);
  },32,22);
}

function setSkin(geometry, pigment, motion) {
  const white = new Color(pigment), paleRim = new Color('#ddd1ad');
  applyColors(geometry,(c,u,v,x,y) => {
    c.copy(white);
    const sole = Math.max(0,1-y/.018);
    c.lerp(paleRim,.42*sole);
  });
  const { position, uv } = geometry.attributes;
  const waves = [[],[]];
  for (let i=0; i<position.count; i++) {
    const u=uv.getX(i), v=uv.getY(i);
    const x=position.getX(i), y=position.getY(i), z=position.getZ(i);
    for (let k=0;k<2;k++) {
      const phase=k*Math.PI/2;
      if (motion === 'foot') {
        const hem=Math.min(1,Math.abs(z)/.075)**2 * Math.max(0,1-y/.032);
        const wave=Math.sin(phase-u*12);
        waves[k].push(.0017*hem*wave,0,Math.sign(z)*.0013*hem*wave);
      } else if (motion) {
        const bend=u*u, side=motion, phi=phase+side*.85-u*.72;
        waves[k].push(-.003*bend*Math.sin(phi),.006*bend*Math.cos(phi),side*.011*bend*Math.sin(phi));
      } else waves[k].push(0,0,0);
    }
    if (motion === 'foot') uv.setXY(i,1.4*u,v);
  }
  geometry.morphTargetsRelative=true;
  geometry.morphAttributes.position=waves.map(w=>new Float32BufferAttribute(w,3));
  return geometry;
}

function join(parts) {
  const geometry=mergeGeometries(parts);
  parts.forEach(part=>part.dispose());
  return geometry;
}

export function createSnailModel(seed=.5, manager) {
  const group=new Group(), {shell,aperture}=makeShell(seed);
  const shellMaterial = new MeshPhysicalMaterial({
    ...grazerMaps('snail-shell',manager), color:new Color().setRGB(1,.96+.04*seed,.94+.05*seed),
    roughness:.86,bumpScale:.00086,ior:1.28,specularIntensity:.70,clearcoat:.14,clearcoatRoughness:.42,
  });
  const soft = [setSkin(footGeometry(),'#a5aeaa','foot')];
  soft.push(setSkin(ellipsoid([.121,.052,0],[.070,.038,.054]),'#b3b9b1'));
  const details=[aperture];
  for (const side of [-1,1]) {
    soft.push(setSkin(ellipsoid([.171,.047,side*.015],[.023,.017,.020]),'#b9beb0'));
    // Aquatic nerites carry the eye on a short separate stalk at the
    // outer base of each long sensory tentacle.
    soft.push(setSkin(feeler([[.132,.065,side*.038],[.145,.078,side*.054],[.149,.081,side*.063]],
      .009,.0055),'#cdc3a9'));
    const eye=ellipsoid([.149,.082,side*.064],[.0056,.0053,.0051]);
    details.push(applyColors(eye,c=>c.set('#151814')));
    soft.push(setSkin(feeler([[.149,.073,side*.035],[.178,.087,side*.052],
      [.205,.103,side*.082],[.249,.116,side*.097]],.0066,.00085),'#e8dfbf',side));
  }
  const skin=new Mesh(join(soft),new MeshStandardMaterial({
    ...grazerMaps('snail-skin',manager),vertexColors:true,roughness:.95,bumpScale:.00065,
  }));
  const shellMesh=new Mesh(shell,shellMaterial);
  shellMesh.castShadow = shellMesh.receiveShadow = true;
  skin.castShadow = skin.receiveShadow = true;
  const rim=new Mesh(join(details),new MeshStandardMaterial({vertexColors:true,roughness:.44}));
  shellMesh.name='nerite whorls'; skin.name='pedal sole and feelers'; rim.name='aperture and eyes';
  group.add(shellMesh,skin,rim);
  group.userData={kind:'snail',softBody:skin,phase:seed*tau};
  const phase=group.userData.phase;
  skin.morphTargetInfluences[0]=.49*Math.cos(phase);
  skin.morphTargetInfluences[1]=.49*Math.sin(phase);
  return group;
}

export function animateSnail(model, dt, speed, grazing) {
  if (!(dt>0)) return;
  const data=model.userData;
  const travel=Math.min(1,speed/.075);
  data.phase=(data.phase+dt*(.64+.74*travel))%tau;
  const strength=.46+.21*travel+(grazing ? .22 : 0);
  const weights=data.softBody.morphTargetInfluences;
  weights[0]=strength*Math.cos(data.phase);
  weights[1]=strength*Math.sin(data.phase);
}
