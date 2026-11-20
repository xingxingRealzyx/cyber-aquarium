import * as THREE from 'three';
import { FISH_PROFILES as PROFILES } from './fish-profiles.js';
import { fishMouth, suctionReach } from './fish-feeding.js';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createFishMaterials, applyDecayMaterial, gillCoverEdge, hasFinAtlas } from './fish-materials.js';
import { BITE_DURATION_SECONDS } from './simulation.js';

const stations = [0, .10, .25, .43, .61, .75, .86, .94, .99, 1];
const upper = [.21,.35,.68,.94,1,.90,.67,.40,.13,0];
const lower = [.23,.30,.56,.84,1,.94,.71,.40,.14,0];
const width = [.16,.28,.52,.82,.99,1,.81,.52,.19,0];

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

const jawHinge=.875, headBands=12, trunkBands=35;
function jawWeight(u) {
  const t=THREE.MathUtils.clamp((u-jawHinge)/(1-jawHinge),0,1);
  return t*t*(2-t);
}
function jawDelta(p,u,mandible) {
  const weight=jawWeight(u)*p.length;
  return v3(weight*(mandible ? -.012 : .010),weight*(mandible ? -.073 : .019));
}
function snoutPoint(p,u,v) {
  // The slit curves gently down from the corners of the mouth onto the snout.
  const t=THREE.MathUtils.clamp((u-jawHinge)/(1-jawHinge),0,1);
  const angle=v*pi2;
  return section(p,u,angle-.14*Math.sin(angle)*Math.sin(Math.PI*t));
}
const restingGape=.035;

function addGillCovers(geometry,p) {
  const {uv,position,normal} = geometry.attributes;
  const shifts = new Float32Array(position.count*3);
  const opened = position.clone();
  for (let i=0;i<position.count;i++) {
    const u=uv.getX(i), angle=uv.getY(i)*pi2, h=.5-.5*Math.cos(angle);
    const edge=gillCoverEdge(h);
    // The rear rim lifts away from the flank. The attachment beneath the eye,
    // the throat and the dorsal midline stay in place.
    const lift=smooth(u,edge-.035,edge+.006)*(1-smooth(u,edge+.006,.87))
      * (1-smooth(Math.abs(h-.51),.20,.37));
    shifts[3*i]=-.018*p.length*lift;
    shifts[3*i+2]=.24*p.width*lift*Math.sin(angle);
    opened.setXYZ(i,position.getX(i)+shifts[3*i],position.getY(i),position.getZ(i)+shifts[3*i+2]);
  }
  const lifted=new THREE.BufferGeometry().setAttribute('position',opened).setIndex(geometry.index);
  lifted.computeVertexNormals();
  const normals=new Float32Array(shifts.length);
  for (let i=0;i<position.count;i++) {
    // Include the neighbours of the lifted rim in its shading, leaving the
    // hand-smoothed normals at the belly seam and split mouth intact.
    if (uv.getX(i)<.65 || uv.getX(i)>=jawHinge || Math.abs(Math.sin(uv.getY(i)*pi2))<.15) continue;
    for (let j=0;j<3;j++) normals[3*i+j]=lifted.attributes.normal.array[3*i+j]-normal.array[3*i+j];
  }
  for (const [attribute,array] of [['position',shifts],['normal',normals]]) {
    const morph=new THREE.BufferAttribute(array,3);
    morph.name='operculum';
    geometry.morphAttributes[attribute].push(morph);
  }
  lifted.dispose();
}

function bodyGeometry(p) {
  const rows=trunkBands+headBands, cols=32;
  const station=i=>i<=trunkBands ? i/40 : jawHinge+(1-jawHinge)*(i-trunkBands)/headBands;
  const geometry=surface(rows,cols,(t,v)=>snoutPoint(p,station(Math.round(t*rows)),v));
  const normals=geometry.attributes.normal;
  for(let i=0;i<=rows;i++) {
    const a=i*(cols+1), b=a+cols;
    const combined = v3().fromBufferAttribute(normals,a).add(v3().fromBufferAttribute(normals,b)).normalize();
    normals.setXYZ(a,combined.x,combined.y,combined.z);
    normals.setXYZ(b,combined.x,combined.y,combined.z);
  }
  for(let j=0;j<=cols;j++) normals.setXYZ(rows*(cols+1)+j,1,0,0);

  // Split the jaw at its two corners. Upper and lower skins share their UVs
  // and neutral normals, but the moving lower lip has its own boundary.
  const pos=Array.from(geometry.attributes.position.array), norm=Array.from(normals.array);
  const uv=Array.from(geometry.attributes.uv.array), indices=geometry.index.array;
  const baseCount=pos.length/3, lowerEdge=new Map();
  for (let i=0;i<=rows;i++) for (let j=0;j<=cols;j++) {
    const k=i*(cols+1)+j;
    uv[2*k]=station(i);
    if (i<=trunkBands || (j!==cols/4 && j!==3*cols/4)) continue;
    lowerEdge.set(k,pos.length/3);
    pos.push(pos[3*k],pos[3*k+1],pos[3*k+2]);
    norm.push(norm[3*k],norm[3*k+1],norm[3*k+2]);
    uv.push(uv[2*k],uv[2*k+1]);
  }
  for (let i=trunkBands;i<rows;i++) for (const j of [cols/4-1,3*cols/4]) {
    const start=(i*cols+j)*6;
    for (let k=start;k<start+6;k++) indices[k]=lowerEdge.get(indices[k]) ?? indices[k];
  }
  const movement=[], normalDelta=[], normal=v3(0,0);
  for (let k=0;k<pos.length/3;k++) {
    const u=uv[k*2], v=uv[k*2+1], lower=v<.25 || v>.75 || k>=baseCount;
    const shift=jawDelta(p,u,lower);
    pos[3*k]+=restingGape*shift.x; pos[3*k+1]+=restingGape*shift.y;
    movement.push(shift.x,shift.y,0);
    // Transform the neutral normal by the local slope of the deformed jaw.
    const t=THREE.MathUtils.clamp((u-jawHinge)/(1-jawHinge),0,1);
    const slope=(4*t-3*t*t)/(1-jawHinge);
    normal.fromArray(norm,3*k);
    normal.x=(normal.x-normal.y*slope*(lower ? -.073 : .019))/(1+slope*(lower ? -.012 : .010));
    normal.normalize();
    normalDelta.push(normal.x-norm[3*k],normal.y-norm[3*k+1],normal.z-norm[3*k+2]);
  }
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute(norm,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  setGape(geometry,movement,normalDelta);
  addGillCovers(geometry,p);
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

function setGape(geometry,positions,normals) {
  const zeros=()=>new Float32Array(geometry.attributes.position.count*3);
  for (const [key,values] of [['position',positions],['normal',normals]]) {
    const delta=new THREE.Float32BufferAttribute(values ?? zeros(),3);
    delta.name='gape';
    geometry.morphAttributes[key]=[delta];
  }
  geometry.morphTargetsRelative=true;
}

function oralCavity(p) {
  const depth=[0,.035,.095,.22,.46,.74,1];
  // The outer ring is sewn to the same vertices as the skin. Its four arcs
  // run corner-to-tip around the lower lip and return along the upper lip.
  function lining(open) {
    return surface(depth.length-1,headBands*4,(r,v)=>{
      const i=Math.round(v*headBands*4)%(headBands*4);
      const arc=Math.floor(i/headBands), f=(i%headBands)/headBands;
      const u=jawHinge+(1-jawHinge)*(arc%2===0 ? f : 1-f);
      const lower=arc<2;
      const lip=snoutPoint(p,u,(arc===0 || arc===3) ? .75 : .25);
      lip.addScaledVector(jawDelta(p,u,lower),restingGape+open);
      const d=depth[Math.round(r*(depth.length-1))];
      const throat=v3(p.nose-p.length*.12,(p.noseLift ?? .012)*.35-.004-open*p.length*.008);
      lip.lerp(throat,d);
      const roll=Math.sin(Math.PI*Math.min(1,d/.095))*jawWeight(u)*p.length*.003;
      lip.x+=roll; lip.y+=lower ? roll : -roll;
      return lip;
    });
  }
  const closed=lining(0), opened=lining(1);
  const colors=[], color=new THREE.Color();
  const upperLip=['#786c60','#938778','#785f56','#5c403d','#3b2a2c','#291e23','#201b1f'];
  const lowerLip=['#948979','#af9e86','#886a5c','#654842','#413033','#2a2024','#201b1f'];
  for (let i=0;i<depth.length;i++) for (let j=0;j<=4*headBands;j++) {
    color.set((j<2*headBands ? lowerLip : upperLip)[i]); colors.push(color.r,color.g,color.b);
  }
  closed.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  const difference=key=>opened.attributes[key].array.map((value,i)=>value-closed.attributes[key].array[i]);
  setGape(closed,difference('position'),difference('normal'));
  opened.dispose();
  return closed;
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

    const nostril=snoutPoint(p,.945,side>0?.31:.69);
    const shift=jawDelta(p,.945,false);
    nostril.addScaledVector(shift,restingGape);
    const dot=new THREE.SphereGeometry(.003,6,4);dot.translate(nostril.x,nostril.y,nostril.z);
    colorGeometry(dot,'#494b41');details.push(dot);
    const positions=[];
    for(let i=0;i<dot.attributes.position.count;i++) positions.push(shift.x,shift.y,0);
    setGape(dot,positions);
  }
  for (const part of details) if (!part.morphAttributes.position) setGape(part);
  details.push(oralCavity(p));
  const joined=mergeGeometries(details);
  joined.morphAttributes.position[0].name='gape';
  joined.morphAttributes.normal[0].name='gape';
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
  geometry.morphAttributes.position=[...positions.map(data=>new THREE.Float32BufferAttribute(data,3)),...(geometry.morphAttributes.position ?? [])];
  geometry.morphAttributes.normal=[...normalDeltas.map(data=>new THREE.Float32BufferAttribute(data,3)),...(geometry.morphAttributes.normal ?? [])];
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
      // Jaw and operculum affect disjoint regions. Bound each moving vertex
      // in both its neutral and its fully extended pose.
      const [jaw,gills]=g.morphAttributes.position ?? [];
      const dx=(jaw?.getX(j) ?? 0)+(gills?.getX(j) ?? 0);
      const dy=jaw?.getY(j) ?? 0, dz=gills?.getZ(j) ?? 0;
      for (let pose=0;pose<=(dx || dy || dz ? 1 : 0);pose++) {
        vertex.fromBufferAttribute(positions,j);
        vertex.x+=pose*dx; vertex.y+=pose*dy; vertex.z+=pose*dz;
        vertex.z-=sweep;
        box.expandByPoint(vertex);
        extremes.push(vertex.clone());
        vertex.z+=2*sweep;
        box.expandByPoint(vertex);
        if (sweep) extremes.push(vertex.clone());
      }
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
  group.add(body,tail,fins,face);
  group.userData={kind:'fish',parts:[body,tail,fins],face,swimPhase:seed*pi2,breathPhase:seed*pi2};
  return group;
}

function animateMouth(data, animal, profile, dt, tankSeconds, food) {
  // An absolute tank clock preserves the breathing pose across pauses,
  // camera redraws and reloading a paused tank. Each fish has its own rhythm.
  const seconds = tankSeconds ?? (data.breathSeconds ?? 0) + dt;
  data.breathSeconds = seconds;
  const hz = (.99 + .13*Math.sin(data.breathPhase))*Math.sqrt(.68/profile.length);
  const phase = data.breathPhase + pi2*((seconds*hz)%1);
  const exertion = Math.min(1, data.strokeSpeed);
  const normal = .025 + (.32 + .09*exertion)*(.5 - .5*Math.cos(phase));
  const gasp = .10 + .64*(.5 - .5*Math.cos(2*phase));
  const stressed = Number(animal.behavior === 'gasping');
  data.breathStress = THREE.MathUtils.damp(data.breathStress ?? stressed, stressed, 4, dt);
  let gape = THREE.MathUtils.lerp(normal, gasp, data.breathStress);
  // The covers vent water a little later in the same breathing cycle.
  const delay=pi2*.23;
  const lift=(.46+.15*exertion)*(.5-.5*Math.cos(phase-delay));
  const laboredLift=.08+.84*(.5-.5*Math.cos(2*phase-delay));
  let gillOpening=THREE.MathUtils.lerp(lift,laboredLift,data.breathStress);

  if (food && animal.behavior === 'seeking' && animal.position && animal.velocity) {
    const lips = fishMouth(animal), reach = suctionReach(animal);
    const dx = food.x-lips.x, dy = food.y-lips.y, dz = food.z-lips.z;
    const distance = Math.hypot(dx,dy,dz);
    const facing = distance < 1e-6 ? 1 : (dx*lips.fx + dy*lips.fy + dz*lips.fz)/distance;
    gape = Math.max(gape, .76*(1-smooth(distance,reach,2*reach))*smooth(facing,.35,.85));
  }
  if (animal.biteFlash > 0) {
    // Suction peaks just after capture; the jaw then closes around the food.
    const age = BITE_DURATION_SECONDS-animal.biteFlash;
    const strike = (.56+.44*smooth(age,0,.065))*(1-smooth(age,.085,.34));
    gape = Math.max(gape, strike);
    gillOpening=Math.max(gillOpening,smooth(age,.05,.18)*(1-smooth(age,.20,BITE_DURATION_SECONDS)));
  }
  const body = data.parts[0], face = data.face;
  body.morphTargetInfluences[body.morphTargetDictionary.gape] = gape;
  face.morphTargetInfluences[face.morphTargetDictionary.gape] = gape;
  body.morphTargetInfluences[body.morphTargetDictionary.operculum] = gillOpening;
}

export function animateFish(model,animal,dt,swimSpeed,decay,tankSeconds,food) {
  const data=model.userData;
  const alive=animal.alive!==false, seeking=animal.behavior==='seeking';
  if (!alive) {
    if (!data.decayUniform) {
      data.decayUniform = {value: decay};
      for (const part of [...data.parts, data.face]) applyDecayMaterial(part.material, data.decayUniform);
      for (const part of data.parts) part.morphTargetInfluences.fill(0);
      data.face.morphTargetInfluences.fill(0);
    }
    data.decayUniform.value = decay;
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
  animateMouth(data,animal,profile,Math.max(0,dt),tankSeconds,food);
}
