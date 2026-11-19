import * as THREE from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createFishMaterials, applyDecayMaterial, hasFinAtlas } from './fish-materials.js';

const stations = [0, .10, .25, .43, .61, .75, .86, .94, .99, 1];
const upper = [.21,.35,.68,.94,1,.90,.67,.40,.13,0];
const lower = [.23,.30,.56,.84,1,.94,.71,.40,.14,0];
const width = [.16,.28,.52,.82,.99,1,.81,.52,.19,0];
const angelUpper = [.12,.27,.67,.96,1,.83,.56,.30,.12,0];
const angelLower = [.12,.25,.59,.95,1,.97,.70,.36,.13,0];
const discUpper = [.15,.41,.76,.97,1,.89,.67,.39,.105,0];
const discLower = [.17,.44,.79,.98,1,.91,.72,.48,.13,0];
const discWidth = [.15,.31,.59,.88,1,.94,.78,.48,.17,0];
const deepBack = [.18,.31,.64,.94,1,.87,.58,.32,.10,0];

// Body dimensions are measured from the caudal peduncle to the snout.
// Median-fin front/back lie on that axis (0 = peduncle, 1 = snout).
const PROFILES = {
  neon: { length: .63, nose: .31, top: .125, belly: .116, width: .074, tail: .19, spread: .117, fork: .46, eye: .032,
    iris: '#79847d', adipose: true },
  guppy: { length: .63, nose: .32, top: .120, belly: .135, width: .086, tail: .30, spread: .202, fork: -.13, eye: .034,
    noseLift: .035, dorsal: { height: .127, sweep: .125 } },
  angelfish: { length: .71, nose: .34, top: .259, belly: .252, width: .077, tail: .225, spread: .172, fork: -.05, eye: .043,
    upper: angelUpper, lower: angelLower, iris: '#8b4434', pelvicStreamer: .40, beat: 5.8, amplitude: .42,
    dorsal: { front: .70, back: .045, tip: .30, height: .25, sweep: .15 },
    anal: { front: .61, height: .23, sweep: .15 } },
  zebra: { length: .78, nose: .38, top: .104, belly: .108, width: .072, tail: .186, spread: .126, fork: .54, eye: .030,
    dorsal: { front: .47 }, anal: { height: .09 } },
  harlequin: { length: .68, nose: .33, top: .165, belly: .160, width: .084, tail: .203, spread: .146, fork: .52, eye: .035,
    iris: '#998061' },
  discus: { length: .84, nose: .43, top: .336, belly: .321, width: .105, tail: .169, spread: .126, roundTail: true, eye: .044,
    upper: discUpper, lower: discLower, girth: discWidth, noseLift: -.018, eyeStation: .835, iris: '#d84829', irisInnerRing: 7, pairedScale: 1.10,
    pelvicStreamer: .19, beat: 6.7, amplitude: .55, flex: .245, medianStroke: .05,
    dorsal: { front: .82, back: .032, tip: .51, height: .112, sweep: .062, backHeight: .41 },
    anal: { front: .61, back: .037, tip: .40, height: .100, sweep: .076, backHeight: .41 } },
  cardinal: { length: .68, nose: .33, top: .12, belly: .113, width: .067, tail: .171, spread: .102, roundedLobes: true, fork: .56, eye: .032,
    iris: '#83938c', adipose: true, dorsal: { front: .55, back: .34, height: .085 }, beat: 9.1 },
  rummynose: { length: .70, nose: .35, top: .11, belly: .114, width: .070, tail: .21, spread: .16, roundedLobes: true, fork: .68, eye: .033,
    iris: '#ac7a60', adipose: true, dorsal: { front: .53, back: .33, height: .11 },
    anal: { front: .45, back: .09, height: .087 }, beat: 9.4 },
  blackneon: { length: .65, nose: .32, top: .129, belly: .14, width: .071, tail: .173, spread: .118, roundedLobes: true, fork: .49, eye: .034,
    iris: '#bdbc98', upperIris: '#df502b', adipose: true, dorsal: { front: .56, back: .32, height: .094 },
    anal: { front: .49, back: .10, height: .09 } },
  cherrybarb: { length: .69, nose: .35, top: .134, belly: .128, width: .089, tail: .19, spread: .127, roundedLobes: true, fork: .49, eye: .032,
    iris: '#ad805b', dorsal: { front: .63, back: .34, height: .106, sweep: .075 },
    anal: { front: .36, back: .19, height: .080 }, beat: 7.9 },
  tigerbarb: { length: .69, nose: .35, top: .199, belly: .173, width: .096, tail: .185, spread: .15, roundedLobes: true, fork: .61, eye: .035,
    upper: deepBack, iris: '#c79151', dorsal: { front: .65, back: .29, height: .147, sweep: .066 },
    anal: { front: .39, back: .17, height: .10 }, beat: 8.5 },
  galaxy: { length: .54, nose: .26, top: .097, belly: .114, width: .069, tail: .139, spread: .083, roundedLobes: true, fork: .27, eye: .032,
    iris: '#c69854', pairedScale: .79, noseLift: .018, dorsal: { front: .50, back: .23, height: .080 },
    anal: { front: .42, back: .19, height: .084 }, beat: 10.2 },
  blackskirt: { length: .68, nose: .34, top: .193, belly: .215, width: .074, tail: .173, spread: .138, roundedLobes: true, fork: .53, eye: .036,
    upper: deepBack, iris: '#94938c', adipose: true, dorsal: { front: .65, back: .40, height: .161, sweep: .06 },
    anal: { front: .56, back: .075, tip: .22, height: .138, sweep: .095, backHeight: .41 }, beat: 7.4 },
  boesemani: { length: .88, nose: .43, top: .202, belly: .174, width: .102, tail: .23, spread: .174, roundedLobes: true, fork: .48, eye: .037,
    upper: deepBack, iris: '#c69a50', pairedScale: 1.16, beat: 6.9, noseLift: .028,
    firstDorsal: { front: .59, back: .48, tip: .44, height: .091, sweep: .043 },
    dorsal: { front: .45, back: .08, tip: .42, height: .103, sweep: .066, backHeight: .39 },
    anal: { front: .57, back: .075, tip: .30, height: .098, sweep: .068, backHeight: .35 } },
  platy: { length: .62, nose: .30, top: .152, belly: .173, width: .105, tail: .157, spread: .127, roundTail: true, eye: .033,
    iris: '#a78c55', noseLift: .038, dorsal: { front: .60, back: .28, height: .124, sweep: .074 },
    anal: { front: .48, back: .34, height: .071 }, beat: 7.8 },
};
const pi2 = Math.PI * 2;
const smooth = THREE.MathUtils.smoothstep;
const v3 = (x,y,z=0) => new THREE.Vector3(x,y,z);

// Monotone cubic interpolation avoids rings where adjoining sections meet.
function sampleProfile(values, u) {
  if (u <= 0) return values[0];
  if (u >= 1) return values.at(-1);
  const i = stations.findIndex(t => t > u) - 1;
  const length = stations[i+1] - stations[i];
  const secant = j => (values[j+1]-values[j]) / (stations[j+1]-stations[j]);
  const tangent = j => {
    if (j === 0) return secant(0);
    if (j === values.length-1) return secant(j-1);
    const a = secant(j-1), b = secant(j);
    return a*b > 0 ? 2*a*b/(a+b) : 0;
  };
  const t = (u-stations[i])/length, t2 = t*t, t3 = t2*t;
  return (2*t3-3*t2+1)*values[i] + (t3-2*t2+t)*length*tangent(i)
    + (-2*t3+3*t2)*values[i+1] + (t3-t2)*length*tangent(i+1);
}

function section(p,u,angle) {
  const up = -Math.cos(angle);
  const height = up > 0 ? p.top*sampleProfile(p.upper ?? upper,u) : p.belly*sampleProfile(p.lower ?? lower,u);
  const noseLift = (p.noseLift ?? .012) * smooth(u,.74,1);
  return v3(p.nose - p.length*(1-u),up*height + noseLift,p.width*sampleProfile(p.girth ?? width,u)*Math.sin(angle));
}

function surface(rows, cols, at) {
  const positions=[],uv=[],indices=[];
  for(let i=0;i<=rows;i++) for(let j=0;j<=cols;j++) {
    const u=i/rows, v=j/cols, point=at(u,v);
    positions.push(point.x,point.y,point.z);uv.push(u,v);
    if(i<rows && j<cols) {
      const a=i*(cols+1)+j, b=a+1, c=a+cols+1, d=c+1;
      indices.push(a,c,b,b,c,d);
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  return geometry;
}

function bodyGeometry(p) {
  const rows=40, cols=32;
  const geometry=surface(rows,cols,(u,v)=>section(p,u,v*pi2));
  const normals=geometry.attributes.normal;
  for(let i=0;i<=rows;i++) {
    const a=i*(cols+1), b=a+cols;
    const combined = v3().fromBufferAttribute(normals,a).add(v3().fromBufferAttribute(normals,b)).normalize();
    normals.setXYZ(a,combined.x,combined.y,combined.z);
    normals.setXYZ(b,combined.x,combined.y,combined.z);
  }
  for(let j=0;j<=cols;j++) normals.setXYZ(rows*(cols+1)+j,1,0,0);
  return geometry;
}

// Fin u follows each ray from its base to its free edge. Both the UVs and the
// slight pleats spread naturally with the fan instead of projecting a flat decal.
function tailGeometry(p) {
  const baseX=p.nose-p.length+.018;
  return surface(10,32,(u,v)=>{
    const spread=v*2-1, edge=Math.abs(spread);
    // The longest rays of a forked tail sit inside each lobe; the short
    // outermost rays round off the tips and leave a broad strip of membrane.
    let outline;
    if (p.roundTail) outline = .38 + .62 * Math.sqrt(1-spread*spread);
    else if (p.roundedLobes) outline = 1 - p.fork*(1-smooth(edge,.02,.76)) - .16*smooth(edge,.83,1);
    else outline = (1-p.fork*(1-edge**1.32))*(1-.045*edge**12);
    const length = p.tail * outline;
    const scallop=1-.018*(1-Math.cos(v*pi2*11))*.5;
    const y=spread*(p.top*.19*(1-u)+p.spread*u*scallop);
    const z=.009*Math.sin(v*pi2*9)*u**1.5+.012*Math.cos(spread*Math.PI)*u*u;
    return v3(baseX-length*u, y, z);
  });
}

function midlineFin(p,{front,back,tip,sign,height,sweep,backHeight=.07}) {
  return surface(6,24,(u,v)=>{
    const station=front+(back-front)*v;
    const body=section(p,station,sign>0?Math.PI:0);
    // The high first rays and shorter trailing rays create a swept soft margin.
    const leading=Math.sin(Math.min(1,v/tip)*Math.PI/2);
    const trailing=1-smooth(v,tip,1)*(1-backHeight);
    const extension=height*(.015+.985*leading)*trailing;
    const ripple=.005*Math.sin(v*22*Math.PI)*u;
    return v3(body.x-sweep*u*(.25+.75*leading),body.y+sign*(extension*u-.009),ripple);
  });
}

function pairedFin(p,side,pelvic) {
  const anchor=section(p,pelvic?.56:.70,side>0?(pelvic?.12:.205)*pi2:(pelvic?.88:.795)*pi2);
  if(pelvic && p.pelvicStreamer) {
    const length = p.pelvicStreamer;
    return surface(16,3,(u,v)=>v3(anchor.x-length*(.3*u+.2*u*u)+(v-.5)*.027*(1-.97*u),anchor.y-length*u,
      anchor.z+side*(.025*Math.sin(Math.PI*u)+.018*u)));
  }
  return surface(7,14,(u,v)=>{
    const lobe=.25+.75*Math.sin(v*Math.PI)**.75;
    const scale = p.pairedScale ?? 1;
    const size=(pelvic?.105:.144)*scale;
    return v3(anchor.x-size*u*lobe+(v-.5)*.022,anchor.y + (v-.5)*(.013+u*scale*(pelvic?.11:.10))-.035*u*scale,
      anchor.z+side*((pelvic?.035:.088)*scale*u*lobe+.003*Math.cos(v*Math.PI*9)*u));
  });
}

// Four rows share one material so dorsal/anal pigments stay off the clear
// pectorals. Inset by half a texel at both ends of a row to keep its border.
function setFinAtlasRow(geometry, row) {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i,(row + (.5 + 95*uv.getY(i))/96)/4);
}

function finGeometry(p, atlas = false) {
  const dorsal = midlineFin(p,{front:.62,back:.24,tip:.24,sign:1,height:.093,sweep:.06,...p.dorsal});
  const anal = midlineFin(p,{front:.45,back:.12,tip:.22,sign:-1,height:.067,sweep:.052,...p.anal});
  const surfaces = [];
  const add = (part, row) => {
    if (p.medianStroke) {
      const uv = part.attributes.uv;
      const stroke = new Float32Array(uv.count);
      // The root stays on the body. Soft rays flex most at the free margin.
      if (row < 2) for (let i=0; i<uv.count; i++) {
        stroke[i] = p.medianStroke * uv.getX(i)**2 * Math.sin(Math.PI*uv.getY(i));
      }
      part.setAttribute('medianStroke',new THREE.BufferAttribute(stroke,1));
    }
    if (atlas) setFinAtlasRow(part, row);
    surfaces.push(part);
  };
  add(dorsal,0);
  add(anal,1);
  for(const side of [-1,1]) {
    add(pairedFin(p,side,false),2);
    add(pairedFin(p,side,true),3);
  }
  if(p.adipose) add(midlineFin(p,{front:.19,back:.09,tip:.38,sign:1,height:.021,sweep:.012}),0);
  if(p.firstDorsal) add(midlineFin(p,{...p.firstDorsal,sign:1}),0);
  const joined=mergeGeometries(surfaces);
  surfaces.forEach(g=>g.dispose());
  return joined;
}

function faceGeometry(p) {
  const details=[];
  const iris = new THREE.Color(p.iris ?? '#938966');
  const upperIris = p.upperIris ? new THREE.Color(p.upperIris) : iris;
  const pupil = new THREE.Color('#11171a');
  const limbus = new THREE.Color('#343c39');
  const innerRim = new THREE.Color('#5e6051');
  for(const side of [-1,1]) {
    const eyeMount=section(p,p.eyeStation ?? .845,(side>0?.282:.718)*pi2);
    const eye=surface(12,32,(r,t)=>{
      const radius=p.eye*.94*r, a=t*pi2;
      return v3(eyeMount.x+radius*Math.cos(a),eyeMount.y+radius*.97*Math.sin(a),
        eyeMount.z+side*(.004+Math.sqrt(1-r*r)*p.eye*.21));
    });
    const colors=[];
    for(let i=0;i<=12;i++)for(let j=0;j<=32;j++) {
      const angle=j/32*pi2;
      let color=pupil;
      const rimRow = p.irisInnerRing ?? 9;
      if(i===rimRow) color=innerRim;
      if(i>rimRow && i<12) {
        color=(Math.sin(angle)>0 ? upperIris : iris).clone().multiplyScalar(.80+.13*Math.cos(angle*7)+.07*Math.sin(angle*13));
      }
      if(i===12) color=limbus;
      colors.push(color.r,color.g,color.b);
    }
    eye.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));details.push(eye);
    const glint=new THREE.SphereGeometry(p.eye*.09,8,5);
    glint.translate(eyeMount.x+.005,eyeMount.y+.006,eyeMount.z+side*(.004+p.eye*.21));
    colorGeometry(glint,'#c9dedb');details.push(glint);

    // A slight downturn at mid-jaw turns back up into the corner of the gape.
    const gape = [[.999,.248],[.982,.236],[.955,.222],[.926,.219],[.897,.228]];
    const jawPath = shift => gape.map(([u,v]) => section(p,u,(side>0?v+shift:1-v-shift)*pi2));
    const lip=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(jawPath(0)),12,.0015,4,false);
    colorGeometry(lip,'#45423b');details.push(lip);
    const lowerLip=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(jawPath(-.005)),12,.0010,4,false);
    colorGeometry(lowerLip,'#9e9a83');details.push(lowerLip);
    const nostril=section(p,.945,(side>0?.31:.69)*pi2);
    const dot=new THREE.SphereGeometry(.003,6,4);dot.translate(nostril.x,nostril.y,nostril.z);
    colorGeometry(dot,'#494b41');details.push(dot);
  }
  const joined=mergeGeometries(details);
  details.forEach(g=>g.dispose());return joined;
}

function colorGeometry(geometry,hex) {
  const color=new THREE.Color(hex),colors=[];
  for(let i=0;i<geometry.attributes.position.count;i++)colors.push(color.r,color.g,color.b);
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
}

// Two relative morph targets form a travelling wave. Blending their sine and
// cosine coefficients on the GPU keeps the caudal peduncle and fin connected.
const bodyWaveNumber = 7.1, finWaveNumber = 14;
function swimAmplitude(p,x) {
  return Math.max(0,(p.nose*.56-x)/(p.length+p.tail))**1.65 * (p.flex ?? .22);
}

function swimMorphs(geometry,p,pairedFins=false) {
  const pos=geometry.attributes.position,normals=geometry.attributes.normal;
  const positions=[[],[]], normalDeltas=[[],[]];
  for(let i=0;i<pos.count;i++) {
    const x=pos.getX(i),z=pos.getZ(i),phase=(p.nose-x)*bodyWaveNumber;
    const margin = geometry.attributes.medianStroke?.getX(i) ?? 0;
    const finPhase = (p.nose-x)*finWaveNumber;
    for(let wave=0;wave<2;wave++) {
      const offset=wave*Math.PI/2;
      const displacement=swimAmplitude(p,x)*Math.sin(phase+offset);
      // Tilt the normals by the spatial derivative of the bending surface.
      const ahead=swimAmplitude(p,x+.0001)*Math.sin(phase-.0001*bodyWaveNumber+offset);
      const slope=(ahead-displacement)/.0001 - (margin ? finWaveNumber*margin*Math.cos(finPhase+offset) : 0);
      const pectoral=pairedFins ? Math.sign(z)*smooth(Math.abs(z),p.width,p.width+.078)*Math.sin(phase+offset)*.032 : 0;
      const ripple = margin ? margin*Math.sin(finPhase+offset) : 0;
      positions[wave].push(0,0,displacement+pectoral+ripple);
      normalDeltas[wave].push(-slope*normals.getZ(i),0,0);
    }
  }
  geometry.deleteAttribute('medianStroke');
  geometry.morphTargetsRelative=true;
  geometry.morphAttributes.position=positions.map(data=>new THREE.Float32BufferAttribute(data,3));
  geometry.morphAttributes.normal=normalDeltas.map(data=>new THREE.Float32BufferAttribute(data,3));
  return geometry;
}

const outlines = new Map();

// A few cross-sections bound the actual animated mesh tightly at the nose
// and tail. The collision solver reuses these local bounds across all fish.
export function fishCollisionOutline(species) {
  if (outlines.has(species)) return outlines.get(species);
  const p = PROFILES[species];
  const sections = Array.from({length: 9}, () => new THREE.Box3());
  const extremes = [];
  const vertex = new THREE.Vector3();
  for (const [i,g] of [bodyGeometry(p),tailGeometry(p),finGeometry(p),faceGeometry(p)].entries()) {
    const positions = g.attributes.position;
    for (let j=0; j<positions.count; j++) {
      vertex.fromBufferAttribute(positions,j);
      const t = 1 + (vertex.x - p.nose) / (p.length+p.tail);
      const box = sections[Math.max(0,Math.min(sections.length-1,Math.floor(t*sections.length)))];
      const finBeat = i === 2 ? smooth(Math.abs(vertex.z),p.width,p.width+.078)*.032 : 0;
      const margin = g.attributes.medianStroke?.getX(j) ?? 0;
      let stroke = swimAmplitude(p,vertex.x);
      if (margin) {
        // The two waves share one clock. Bound their combined excursion so
        // the free edges do not claim extra space when the waves oppose.
        const deltaPhase = (p.nose-vertex.x)*(finWaveNumber-bodyWaveNumber);
        stroke = Math.hypot(stroke+margin*Math.cos(deltaPhase), margin*Math.sin(deltaPhase));
      }
      const sweep = i === 3 ? 0 : .90*(stroke+finBeat);
      vertex.z -= sweep;
      box.expandByPoint(vertex);
      extremes.push(vertex.clone());
      vertex.z += 2*sweep;
      box.expandByPoint(vertex);
      if (sweep) extremes.push(vertex.clone());
    }
    g.dispose();
  }
  const whole = new THREE.Box3();
  const slices = sections.filter(s => !s.isEmpty()).map(s => {
    s.expandByScalar(.002);
    whole.union(s);
    return { center:s.getCenter(new THREE.Vector3()), half:s.getSize(new THREE.Vector3()).multiplyScalar(.5) };
  });
  const {min,max} = whole;
  // Against a flat pane, only the outermost vertices of any swimming pose
  // matter. A corner of a tilted section can lie well beyond the actual fin.
  const hull = new ConvexHull().setFromPoints(extremes);
  const points = new Set();
  for (const {edge} of hull.faces) {
    points.add(edge.head().point);
    points.add(edge.next.head().point);
    points.add(edge.tail().point);
  }
  const outline = { bounds:[min.x,max.x,min.y,max.y,min.z,max.z], slices, skinPoints: [...points] };
  outlines.set(species,outline);
  return outline;
}

export function createFishModel(species,seed) {
  const profile=PROFILES[species] || PROFILES.neon;
  const materials=createFishMaterials(species,seed);
  const group=new THREE.Group();
  const body=new THREE.Mesh(swimMorphs(bodyGeometry(profile),profile),materials.body);
  const tail=new THREE.Mesh(swimMorphs(tailGeometry(profile),profile),materials.tail);
  const fins=new THREE.Mesh(swimMorphs(finGeometry(profile,hasFinAtlas(species)),profile,true),materials.fin);
  const face=new THREE.Mesh(faceGeometry(profile),new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.49}));
  // Two-sided membranes are thin and translucent. Draw each in one pass.
  for(const part of [fins,tail])part.material.forceSinglePass=true;
  const mouthGlow=new THREE.Mesh(new THREE.SphereGeometry(.021,10,8),new THREE.MeshBasicMaterial({color:'#ebcd88',transparent:true,opacity:0,depthWrite:false}));
  mouthGlow.position.copy(section(profile,1,0));mouthGlow.visible=false; mouthGlow.userData.pickIgnore=true;
  group.add(body,tail,fins,face,mouthGlow);
  group.userData={kind:'fish',parts:[body,tail,fins],face,mouthGlow,swimPhase:seed*pi2};
  return group;
}

export function animateFish(model,animal,dt,swimSpeed,decay) {
  const data=model.userData;
  const alive=animal.alive!==false, seeking=animal.behavior==='seeking';
  if (!alive) {
    if (!data.decayUniform) {
      data.decayUniform = {value: decay};
      for (const part of [...data.parts, data.face]) applyDecayMaterial(part.material, data.decayUniform);
      for (const part of data.parts) part.morphTargetInfluences.fill(0);
    }
    data.decayUniform.value = decay;
    data.mouthGlow.visible = false;
    return;
  }
  const profile=PROFILES[animal.species] ?? PROFILES.neon;
  let forwardSpeed = swimSpeed;
  const p = animal.position, v = animal.velocity;
  if (data.positionInitialized && p && dt > 0 && swimSpeed > .001) {
    // The model still holds the previous frame's center. Only travel along the
    // swimming direction powers a stroke; contact can also push a fish sideways.
    const previous = model.position;
    const advance = (p.x-previous.x)*v.x + (p.y-previous.y)*v.y + (p.z-previous.z)*v.z;
    if (Number.isFinite(advance)) forwardSpeed = THREE.MathUtils.clamp(advance/(swimSpeed*dt), 0, swimSpeed);
  }
  data.strokeSpeed = THREE.MathUtils.damp(data.strokeSpeed ?? forwardSpeed, forwardSpeed, 12, Math.max(0,dt));
  const effort = smooth(data.strokeSpeed,.025,.22);
  const rate = (profile.beat ?? 8.3)*(.45+.55*effort) + Math.min(data.strokeSpeed,2)*4 + (seeking ? 2.5*effort : 0);
  data.swimPhase=(data.swimPhase+Math.max(0,dt)*rate)%pi2;
  const amplitude = (profile.amplitude ?? .57)*(.22+.78*effort) + Math.min(data.strokeSpeed,.95)*.34;
  const sine=Math.sin(data.swimPhase)*amplitude, cosine=Math.cos(data.swimPhase)*amplitude;
  for(const part of data.parts) {
    part.morphTargetInfluences[0]=cosine;
    part.morphTargetInfluences[1]=-sine;
  }
  const bite=Math.min(1,(animal.biteFlash||0)/.45);
  data.mouthGlow.visible=bite>0;
  data.mouthGlow.material.opacity=.66*bite;
  data.mouthGlow.scale.setScalar(1+(1-bite)*1.4);
}
