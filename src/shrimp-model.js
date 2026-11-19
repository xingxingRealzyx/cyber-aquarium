import {
  BufferGeometry, Color, DefaultLoadingManager, DoubleSide, Float32BufferAttribute,
  Group, MathUtils, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, SphereGeometry, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { grazerMaps } from './grazer-materials.js';

const tau = 2 * Math.PI;
const clamp = MathUtils.clamp;
const cream = new Color('#c7986f'), joint = new Color('#963c2c'), cuticle = new Color('#c76b4f');

// A longitudinal section through the animal, from the tail hinge to the eyes.
// The high second abdominal segment and long single head shield give a caridean
// shrimp its arched profile. Its feet and tail fan sit close to the substrate.
const bodySections = [
  [-.207,.065,.043,.014], [-.17,.098,.047,.022], [-.126,.137,.060,.032],
  [-.080,.163,.071,.041], [-.031,.176,.074,.047], [.012,.177,.067,.049],
  [.063,.169,.060,.052], [.113,.157,.059,.047], [.148,.146,.069,.040],
  [.164,.135,.085,.030], [.175,.119,.101,.013], [.179,.1112,.110,.001],
];
function sectionAt(x) {
  let i = 1;
  while (i < bodySections.length - 1 && x > bodySections[i][0]) i++;
  const a = bodySections[i-1], b = bodySections[i];
  const t = clamp((x-a[0])/(b[0]-a[0]),0,1);
  return [1,2,3].map(j => MathUtils.lerp(a[j],b[j],t));
}

function patch(rows, columns, sample) {
  const positions = [], colors = [], uvs = [], indices = [];
  for (let i = 0; i <= rows; i++) {
    for (let j = 0; j <= columns; j++) {
      const {point, color, uv} = sample(i / rows, j / columns);
      positions.push(...point);
      colors.push(color.r, color.g, color.b);
      uvs.push(...uv);
      if (i < rows && j < columns) {
        const a = i*(columns+1)+j, b = a+columns+1;
        indices.push(a, a+1, b, a+1, b+1, b);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

function carapace(seed) {
  // Trailing lips and narrow recessed sutures, cut obliquely around one
  // continuous abdomen. The cephalothorax has no abdominal subdivisions.
  const boundaries = [-.207,-.165,-.131,-.095,-.058,-.023,.014,.179];
  const steps = [0,.08,.19,.35,.57,.79,1];
  const rings = [];
  for (let plate=0; plate<boundaries.length-1; plate++) {
    const samples=plate===6 ? Array.from({length:23},(_,i)=>i/22) : steps;
    for (const t of samples) if (t<1 || plate===6) rings.push({plate,t});
  }
  const sections=rings.length-1;
  const shell = patch(sections, 28, (u,v) => {
    const row = Math.round(u*sections);
    const {plate,t} = rings[row];
    const a = (v-.5)*tau, h = Math.cos(a), side = Math.sin(a);
    let x = MathUtils.lerp(boundaries[plate],boundaries[plate+1],t);
    const atEnds = clamp(Math.min(x+.207,.179-x)/.027,0,1);
    // The low second pleuron overlaps the preceding plate on each flank.
    x -= atEnds*(plate===4 ? .016 : .008)*(1-h)*.5;
    const [top,bottom,width] = sectionAt(x);
    const seam = row === sections || row === 0 ? 0 : 1-Math.min(1,t/.19);
    const rim = Math.sin(Math.PI*Math.min(t/.30,1)) * (plate===6 ? .6 : 1);
    const radius = 1-.067*seam+.035*rim;
    const y = (top+bottom)*.5 + h*(top-bottom)*.5*radius;
    const z = side*width*radius;
    const pigment = .94 + .06*Math.sin(plate*1.7+seed*6);
    const tint = new Color().setRGB(pigment, pigment*(.89+.11*(1-h)*.5), pigment*.92);
    tint.multiplyScalar(1-.13*seam+.07*rim);
    if (plate===6) {
      // The thin branchial shield reveals the darker gill chamber beneath it.
      const gx=(x-.070)/.044, gy=(h+.18)/.45;
      const gill=Math.exp(-gx*gx-gy*gy);
      const lip=(h+.48+.16*Math.sin(t*Math.PI))/.15;
      const margin=Math.exp(-lip*lip)*Math.sin(t*Math.PI);
      tint.r*=1-.10*gill; tint.g*=1-.36*gill; tint.b*=1-.28*gill;
      tint.multiplyScalar(1+.11*margin);
    }
    return {point:[x,y,z],color:tint,uv:[clamp((x+.208)/.386,.005,.995),.02+.96*(h+1)*.5]};
  });
  // The circumferential texture seam is under the abdomen. Weld its lighting
  // normals while preserving distinct UVs at the ends of the ring.
  const normals = shell.attributes.normal, average = new Vector3(), other = new Vector3();
  for (let row=0; row<=sections; row++) {
    const start = row*29, end = start+28;
    average.fromBufferAttribute(normals,start).add(other.fromBufferAttribute(normals,end)).normalize();
    normals.setXYZ(start,average.x,average.y,average.z);
    normals.setXYZ(end,average.x,average.y,average.z);
  }
  return shell;
}

// A tapered three-dimensional limb. Each pair of points describes an actual
// joint, so the elbows stay angular and distal articles get progressively finer.
function limb(points,radii,base=joint,tip=cream,sides=7) {
  const path = points.map(p=>new Vector3(...p));
  const tangent = new Vector3(), across = new Vector3(), up = new Vector3(), p = new Vector3();
  const axis = new Vector3(0,0,1), vertical = new Vector3(0,1,0);
  return patch(path.length-1, sides,(u,v) => {
    const i=Math.round(u*(path.length-1));
    tangent.subVectors(path[Math.min(path.length-1,i+1)],path[Math.max(0,i-1)]).normalize();
    across.crossVectors(tangent,Math.abs(tangent.z) < .92 ? axis : vertical).normalize();
    up.crossVectors(tangent,across);
    p.copy(path[i]).addScaledVector(across,Math.cos(v*tau)*radii[i]).addScaledVector(up,Math.sin(v*tau)*radii[i]);
    return {point:p.toArray(),color:base.clone().lerp(tip,u),uv:[u,v]};
  });
}

function ellipsoid(x,y,z,rx,ry,rz,color) {
  const geometry = new SphereGeometry(1,14,10).scale(rx,ry,rz).translate(x,y,z);
  const colors = new Float32Array(geometry.attributes.position.count*3);
  for (let i=0; i<colors.length; i+=3) color.toArray(colors,i);
  geometry.setAttribute('color', new Float32BufferAttribute(colors,3));
  return geometry;
}

// Membranes are cupped along their central supports. Fan ribs converge on the
// hinge and branch across the outer paddles; the free margins are scalloped.
function fanLobe(lobe) {
  const spread = lobe*.34, outer = Math.abs(lobe), width = [.010,.015,.018][outer];
  const length = [.068,.070,.071][outer];
  return patch(12,20,(u,v)=>{
    const cross = v*2-1, rounded = Math.sin(Math.PI*(.025+.954*u))**(outer ? .55 : .83);
    const tip = (outer ? .002 : .0008)*Math.cos(10*Math.PI*v)*u**5;
    const spine = length*u + tip;
    const lateral = width*rounded*cross;
    const x = -.200 - spine*Math.cos(spread) + lateral*Math.sin(spread);
    const z = lobe*.0027 + spine*Math.sin(spread) + lateral*Math.cos(spread);
    const rib = (.5+.5*Math.cos(v*8*tau))**7;
    const y = .053 - .024*u + .008*outer*u + .004*rounded*(1-cross*cross) + .0012*rib*rounded;
    const edge = Math.max(rib,Math.abs(cross)**4);
    const color = new Color().setRGB(.96,.65+.27*edge,.55+.26*edge);
    return {point:[x,y,z],color,uv:[.02+.12*(1-u),.30+.38*v]};
  });
}

function join(parts) {
  const geometry = mergeGeometries(parts);
  parts.forEach(part=>part.dispose());
  return geometry;
}

// Walking legs, fan-like pleopods and the feelers are drawn in two meshes.
// Two relative shape keys give each extremity its own phase and anchor its root.
function motionKeys(geometry, deformations) {
  const count = geometry.attributes.position.count;
  const sin = new Float32Array(count*3), cos = new Float32Array(count*3);
  let index = 0;
  for (const {part,deform} of deformations) {
    const pos = part.attributes.position;
    for (let i=0; i<pos.count; i++,index++) {
      const [x,y,z,phase] = deform(pos.getX(i),pos.getY(i),pos.getZ(i));
      sin.set([x*Math.cos(phase),y*Math.cos(phase),z*Math.cos(phase)],index*3);
      cos.set([x*Math.sin(phase),y*Math.sin(phase),z*Math.sin(phase)],index*3);
    }
  }
  geometry.morphTargetsRelative = true;
  geometry.morphAttributes.position = [new Float32BufferAttribute(sin,3), new Float32BufferAttribute(cos,3)];
}

// In a side view the egg mass is visible between the transparent swimmerets.
function appendages() {
  const legs=[], feelers=[], stalks=[], eyes=[];
  for (const side of [-1,1]) {
    const sidePhase = side > 0 ? Math.PI : 0;
    const mirror = points => points.map(([x,y,z]) => [x,y,z*side]);
    for (let i=0; i<5; i++) {
      const x=.126-.023*i;
      const picking = i < 2;
      const reach = picking ? .054-.011*i : .003-.015*(i-2);
      const footX = x+reach, y=picking ? .024+i*.002 : .009;
      const phase = sidePhase+i*2.42;
      const gait = (vx,vy) => {
        const free = clamp((.070-vy)/(.070-y),0,1);
        return [free*(picking ? .0067 : .0095), free*(picking ? .007 : .005),side*free*.0015,phase];
      };
      const leg = limb(mirror([[x,.073,.027],[x-.010,.059,.046],[x-.005,.046,.057],
        [footX-.012,y+.013,.064],[footX,y,.071]]),[.0041,.0037,.0027,.0018,.0010]);
      legs.push({part:leg,deform:gait});
      if (picking) {
        for (const finger of [-1,1]) {
          const claw = limb(mirror([[footX-.005,y+.006,.069],[footX+.003,y+.002,.071+finger*.003],
            [footX+.009,y+.006,.071+finger*.001]]),[.0018,.00125,.0005],cuticle,cream,5);
          legs.push({part:claw,deform:gait});
        }
      }
    }
    for (let i=0;i<5;i++) {
      const x=.003-i*.033, y=.081-i*.002;
      const phase=sidePhase*.25+i*.93;
      const beat=(vx,vy)=>{
        const free=clamp((y-vy)/.041,0,1);
        return [.008*free,.002*free,.002*side*free,phase];
      };
      const base = limb(mirror([[x,y,.021],[x-.006,y-.010,.024],[x-.011,y-.018,.029]]),
        [.0033,.0029,.0020],joint,cuticle,6);
      legs.push({part:base,deform:beat});
      for (const fork of [-1,1]) {
        const paddle=patch(7,5,(u,v)=>{
          const taper=Math.sin(Math.PI*(.012+.978*u));
          const lateral=taper*(v-.5)*.0072;
          const color=cuticle.clone().lerp(cream,.60*u);
          return {point:[x-.011-.020*u+fork*.004*u+lateral, y-.018-.021*u,
            side*(.029+.003*u+fork*.005*u+.003*taper*Math.sin(Math.PI*v))],color,uv:[u,v]};
        });
        legs.push({part:paddle,deform:beat});
      }
    }
    // The long antenna and shorter, forked antennules emerge on different
    // articles. Break their arcs into fine sections to retain taper at scale.
    const antenna = (points,radii,phase) => {
      const part=limb(mirror(points),radii,cuticle,cream,6);
      const origin=points[0][0], length=points[points.length-1][0]-origin;
      feelers.push({part,deform:(x)=>{
        const tip=clamp((x-origin)/length,0,1)**1.6;
        return [-.002*tip,.008*tip,side*.008*tip,sidePhase*.32+phase];
      }});
    };
    antenna([[.143,.102,.031],[.169,.115,.047],[.199,.124,.054],[.235,.131,.060],
      [.277,.135,.067],[.324,.132,.081],[.361,.122,.094],[.387,.110,.108]],
      [.0040,.0030,.0020,.00155,.0013,.0010,.0007,.00042],0);
    antenna([[.153,.115,.018],[.180,.130,.027],[.207,.143,.035],[.245,.153,.046],
      [.284,.161,.058],[.316,.166,.072]], [.0039,.0029,.0019,.0014,.00095,.0005],1.15);
    antenna([[.194,.137,.030],[.219,.144,.047],[.242,.145,.064],[.261,.135,.076]],
      [.0016,.0013,.0009,.0005],2.4);
    // A leaf-shaped antennal scale shields the base of each long feeler.
    stalks.push(patch(10,6,(u,v)=>{
      const width=.0065*Math.sin(Math.PI*(.01+.98*u))**.77*(v*2-1);
      return {point:[.149+.053*u,.116+.008*Math.sin(Math.PI*u)+width*.26,side*(.034+.018*u+width)],
        color:cuticle.clone().lerp(cream,.32+.55*u),uv:[u,v]};
    }));
    stalks.push(limb(mirror([[.142,.128,.022],[.150,.137,.039],[.156,.142,.046]]),[.009,.007,.006],joint,cuticle));
    eyes.push(ellipsoid(.157,.144,side*.048,.0107,.0101,.0088,new Color('#251916')));
    stalks.push(limb(mirror([[.146,.095,.022],[.161,.078,.029],[.172,.063,.026],
      [.165,.050,.023]]),[.0045,.0035,.0025,.0010],joint,cream));
  }
  return {legs,feelers,stalks,eyes};
}

export function createShrimpModel(seed=.5, manager=DefaultLoadingManager) {
  const group = new Group();
  group.userData.kind='shrimp';
  const maps=grazerMaps('shrimp-color',manager);
  const shellMaterial = new MeshPhysicalMaterial({name:'Cherry shrimp cuticle', ...maps,
    vertexColors:true, roughness:.69, ior:1.36, clearcoat:.12, clearcoatRoughness:.47, bumpScale:.0006, side:DoubleSide});
  const shellParts=[carapace(seed)];
  for (let lobe=-2;lobe<=2;lobe++) shellParts.push(fanLobe(lobe));
  // Tapered, serrated rostrum projecting between the eyestalks.
  shellParts.push(limb([[.141,.143,0],[.168,.141,0],[.198,.145,0],[.218,.150,0]],
    [.010,.0062,.0031,.00055],new Color('#edbaa1'),cream));
  for (let i=0;i<5;i++) {
    const x=.156+i*.0090, y=.145+Math.max(0,i-1)*.0015;
    shellParts.push(limb([[x,y,0],[x+.005,y+.006-i*.00055,0]],[.0023,.00025],cuticle,cream,5));
  }
  const shell=new Mesh(join(shellParts),shellMaterial);
  shell.castShadow = shell.receiveShadow = true;
  group.add(shell);
  const {legs,feelers,stalks,eyes}=appendages();
  const limbMaterial=new MeshStandardMaterial({name:'Shrimp antennae and walking legs',vertexColors:true,
    roughness:.67,map:maps.map ?? null,side:DoubleSide,transparent:true,opacity:.85,depthWrite:false});
  // Sparse clusters of the same red pigment show through otherwise amber,
  // translucent limbs. Their distal articles carry progressively less color.
  limbMaterial.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #ifdef USE_MAP
        vec3 shellPigment = texture2D(map, vMapUv).rgb;
        float stain = (1.0-smoothstep(.38,.66,shellPigment.r))*(1.0-.72*vMapUv.x);
        diffuseColor.rgb *= mix(vec3(1.0),vec3(.75,.085,.055),.24+.76*stain);
        diffuseColor.a *= .68+.32*stain;
      #endif
    `);
  };
  limbMaterial.forceSinglePass=true;
  const moving = (elements,name) => {
    const parts=elements.map(e=>e.part);
    const geometry=mergeGeometries(parts);
    motionKeys(geometry,elements);
    parts.forEach(p=>p.dispose());
    const mesh=new Mesh(geometry,limbMaterial);
    mesh.name=name;
    group.add(mesh);
    return mesh;
  };
  group.add(new Mesh(join(stalks),limbMaterial));
  group.add(new Mesh(join(eyes), new MeshPhysicalMaterial({name:'Compound eye',vertexColors:true,
    roughness:.22,clearcoat:.42,clearcoatRoughness:.16})));
  group.userData.legs=moving(legs,'Walking legs and pleopods');
  group.userData.feelers=moving(feelers,'Antennae and antennules');
  group.userData.stepPhase=tau*seed;
  group.userData.feelerPhase=tau*(1-seed);
  animateShrimp(group,0,0,true);
  return group;
}

export function animateShrimp(model,dt,speed,grazing) {
  const data=model.userData;
  const travel=clamp(speed/.22,0,1.5);
  data.stepPhase=(data.stepPhase + dt*(grazing ? 4.0+travel*3.1 : 2.8+travel*3.1))%tau;
  data.feelerPhase=(data.feelerPhase+dt*(1.40+.39*travel))%tau;
  const setPhase=(part,phase)=>{
    part.morphTargetInfluences[0]=Math.sin(phase);
    part.morphTargetInfluences[1]=Math.cos(phase);
  };
  setPhase(data.legs,data.stepPhase);
  setPhase(data.feelers,data.feelerPhase);
}
