import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createFishMaterials } from './fish-materials.js';

// Dimensions in scene units, measured from the caudal peduncle to the snout.
// The separate upper/lower profiles let a tetra, a gravid-looking guppy and a
// laterally compressed angelfish have different silhouettes from every angle.
const PROFILES = {
  neon: { length: .63, nose: .31, top: .125, belly: .116, width: .074, tail: .19, spread: .117, fork: .46, eye: .032 },
  guppy: { length: .63, nose: .32, top: .120, belly: .135, width: .086, tail: .30, spread: .202, fork: -.13, eye: .034 },
  angelfish: { length: .71, nose: .34, top: .259, belly: .252, width: .077, tail: .225, spread: .172, fork: -.05, eye: .043 },
  zebra: { length: .78, nose: .38, top: .104, belly: .108, width: .072, tail: .186, spread: .126, fork: .54, eye: .030 },
  harlequin: { length: .68, nose: .33, top: .165, belly: .160, width: .084, tail: .203, spread: .146, fork: .52, eye: .035 },
};
const stations = [0, .10, .25, .43, .61, .75, .86, .94, .99, 1];
const upper = [.21,.35,.68,.94,1,.90,.67,.40,.13,0];
const lower = [.23,.30,.56,.84,1,.94,.71,.40,.14,0];
const width = [.16,.28,.52,.82,.99,1,.81,.52,.19,0];
const angelUpper = [.12,.27,.67,.96,1,.83,.56,.30,.12,0];
const angelLower = [.12,.25,.59,.95,1,.97,.70,.36,.13,0];
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
  const isAngel = p === PROFILES.angelfish;
  const height = up > 0 ? p.top*sampleProfile(isAngel?angelUpper:upper,u) : p.belly*sampleProfile(isAngel?angelLower:lower,u);
  const noseLift = (p === PROFILES.guppy ? .035 : .012) * smooth(u,.74,1);
  return v3(p.nose - p.length*(1-u),up*height + noseLift,p.width*sampleProfile(width,u)*Math.sin(angle));
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
    const length=p.tail*(1-p.fork*(1-edge**1.32))*(1-.045*edge**12);
    const scallop=1-.018*(1-Math.cos(v*pi2*11))*.5;
    const y=spread*(p.top*.19*(1-u)+p.spread*u*scallop);
    const z=.009*Math.sin(v*pi2*9)*u**1.5+.012*Math.cos(spread*Math.PI)*u*u;
    return v3(baseX-length*u, y, z);
  });
}

function midlineFin(p,{front,back,tip,sign,height,sweep}) {
  return surface(6,24,(u,v)=>{
    const station=front+(back-front)*v;
    const body=section(p,station,sign>0?Math.PI:0);
    // The high first rays and shorter trailing rays create a swept soft margin.
    const leading=Math.sin(Math.min(1,v/tip)*Math.PI/2);
    const trailing=1-smooth(v,tip,1)*.93;
    const extension=height*(.015+.985*leading)*trailing;
    const ripple=.005*Math.sin(v*22*Math.PI)*u;
    return v3(body.x-sweep*u*(.25+.75*leading),body.y+sign*(extension*u-.009),ripple);
  });
}

function pairedFin(p,side,pelvic) {
  const isAngel=p===PROFILES.angelfish;
  const anchor=section(p,pelvic?.56:.70,side>0?(pelvic?.12:.205)*pi2:(pelvic?.88:.795)*pi2);
  if(pelvic && isAngel) {
    return surface(16,3,(u,v)=>v3(anchor.x-.12*u-.08*u*u+(v-.5)*.027*(1-.97*u),anchor.y-.40*u,
      anchor.z+side*(.025*Math.sin(Math.PI*u)+.018*u)));
  }
  return surface(7,14,(u,v)=>{
    const lobe=.25+.75*Math.sin(v*Math.PI)**.75;
    const size=pelvic?.105:.144;
    return v3(anchor.x-size*u*lobe+(v-.5)*.022,anchor.y + (v-.5)*(.013+u*(pelvic?.11:.10))-.035*u,
      anchor.z+side*((pelvic?.035:.088)*u*lobe+.003*Math.cos(v*Math.PI*9)*u));
  });
}

function finGeometry(p) {
  const isAngel=p===PROFILES.angelfish, isGuppy=p===PROFILES.guppy, isZebra=p===PROFILES.zebra;
  const dorsal=midlineFin(p,{front:isAngel?.70:isZebra?.47:.62,back:isAngel?.045:.24,tip:isAngel?.30:.24,sign:1,
    height:isAngel?.25:isGuppy?.127:.093,sweep:isAngel?.15:isGuppy?.125:.06});
  const anal=midlineFin(p,{front:isAngel?.61:.45,back:.12,tip:.22,sign:-1,height:isAngel?.23:isZebra?.09:.067,sweep:isAngel?.15:.052});
  const surfaces=[dorsal,anal];
  for(const side of [-1,1]) surfaces.push(pairedFin(p,side,false),pairedFin(p,side,true));
  if(p===PROFILES.neon)surfaces.push(midlineFin(p,{front:.19,back:.09,tip:.38,sign:1,height:.021,sweep:.012}));
  const joined=mergeGeometries(surfaces);
  surfaces.forEach(g=>g.dispose());
  return joined;
}

function faceGeometry(p) {
  const details=[];
  const irisColor = p===PROFILES.angelfish ? '#8b4434' : p===PROFILES.neon ? '#79847d' : p===PROFILES.harlequin ? '#998061' : '#938966';
  const iris = new THREE.Color(irisColor);
  const pupil = new THREE.Color('#11171a');
  const limbus = new THREE.Color('#343c39');
  const innerRim = new THREE.Color('#5e6051');
  for(const side of [-1,1]) {
    const eyeMount=section(p,.845,(side>0?.282:.718)*pi2);
    const eye=surface(12,32,(r,t)=>{
      const radius=p.eye*.94*r, a=t*pi2;
      return v3(eyeMount.x+radius*Math.cos(a),eyeMount.y+radius*.97*Math.sin(a),
        eyeMount.z+side*(.004+Math.sqrt(1-r*r)*p.eye*.21));
    });
    const colors=[];
    for(let i=0;i<=12;i++)for(let j=0;j<=32;j++) {
      const angle=j/32*pi2;
      let color=pupil;
      if(i===9) color=innerRim;
      if(i===10||i===11) {
        color=iris.clone().multiplyScalar(.80+.13*Math.cos(angle*7)+.07*Math.sin(angle*13));
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
function swimMorphs(geometry,p,pairedFins=false) {
  const pos=geometry.attributes.position,normals=geometry.attributes.normal;
  const positions=[[],[]], normalDeltas=[[],[]];
  const amplitudeAt=x=>Math.max(0,(p.nose*.56-x)/(p.length+p.tail))**1.65 * .22;
  for(let i=0;i<pos.count;i++) {
    const x=pos.getX(i),z=pos.getZ(i),phase=(p.nose-x)*7.1;
    for(let wave=0;wave<2;wave++) {
      const offset=wave*Math.PI/2;
      const displacement=amplitudeAt(x)*Math.sin(phase+offset);
      // Tilt the normals by the spatial derivative of the bending surface.
      const ahead=amplitudeAt(x+.0001)*Math.sin(phase-.00071+offset);
      const slope=(ahead-displacement)/.0001;
      const pectoral=pairedFins ? Math.sign(z)*smooth(Math.abs(z),p.width,p.width+.078)*Math.sin(phase+offset)*.032 : 0;
      positions[wave].push(0,0,displacement+pectoral);
      normalDeltas[wave].push(-slope*normals.getZ(i),0,0);
    }
  }
  geometry.morphTargetsRelative=true;
  geometry.morphAttributes.position=positions.map(data=>new THREE.Float32BufferAttribute(data,3));
  geometry.morphAttributes.normal=normalDeltas.map(data=>new THREE.Float32BufferAttribute(data,3));
  return geometry;
}

export function createFishModel(species,seed) {
  const profile=PROFILES[species] || PROFILES.neon;
  const materials=createFishMaterials(species,seed);
  const group=new THREE.Group();
  const body=new THREE.Mesh(swimMorphs(bodyGeometry(profile),profile),materials.body);
  const tail=new THREE.Mesh(swimMorphs(tailGeometry(profile),profile),materials.tail);
  const fins=new THREE.Mesh(swimMorphs(finGeometry(profile),profile,true),materials.fin);
  const face=new THREE.Mesh(faceGeometry(profile),new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.49}));
  // Two-sided membranes are thin and translucent. Draw each in one pass.
  for(const part of [fins,tail])part.material.forceSinglePass=true;
  const mouthGlow=new THREE.Mesh(new THREE.SphereGeometry(.021,10,8),new THREE.MeshBasicMaterial({color:'#ebcd88',transparent:true,opacity:0,depthWrite:false}));
  mouthGlow.position.copy(section(profile,1,0));mouthGlow.visible=false; mouthGlow.userData.pickIgnore=true;
  group.add(body,tail,fins,face,mouthGlow);
  group.userData={kind:'fish',parts:[body,tail,fins],mouthGlow,swimPhase:seed*pi2};
  return group;
}

export function animateFish(model,animal,dt,swimSpeed) {
  const data=model.userData;
  const alive=animal.alive!==false, seeking=animal.behavior==='seeking';
  const angel=animal.species==='angelfish';
  const rate=(angel?5.8:8.3)+Math.min(swimSpeed,2)*4+(seeking?2.5:0);
  data.swimPhase=(data.swimPhase+Math.max(0,dt)*(alive?rate:.7))%pi2;
  const amplitude=alive?(angel?.42:.57)+Math.min(swimSpeed,.95)*.34:.035;
  const sine=Math.sin(data.swimPhase)*amplitude, cosine=Math.cos(data.swimPhase)*amplitude;
  for(const part of data.parts) {
    part.morphTargetInfluences[0]=cosine;
    part.morphTargetInfluences[1]=-sine;
  }
  const bite=alive?Math.min(1,(animal.biteFlash||0)/.45):0;
  data.mouthGlow.visible=bite>0;
  data.mouthGlow.material.opacity=.66*bite;
  data.mouthGlow.scale.setScalar(1+(1-bite)*1.4);
}
