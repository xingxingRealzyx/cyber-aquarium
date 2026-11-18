import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createToyMaterial } from './toy-materials.js';
import { createAuthorHead } from './author-head.js';

const red = '#cf2639', redHem = '#a81b2e', shorts = '#25282e';
const skin = '#dbad87', finBlue = '#287c83', finRail = '#87c2b5', graphite = '#29363b';

function joint(parent, name, x, y, z) {
  const group = new THREE.Bone();
  group.name = name;
  group.position.set(x,y,z);
  parent.add(group);
  return group;
}

// Elliptical cross-sections along the body's length. The same continuous
// outline gives sleeves a straight cuff and limbs tapered wrists and ankles.
function loft(sections, segments = 20) {
  const positions = [], uvs = [], index = [];
  const start = sections[0][0], length = sections.at(-1)[0] - start;
  for (const [row, [z, width, depth, y = 0]] of sections.entries()) {
    for (let i = 0; i <= segments; i++) {
      const angle = i / segments * 2 * Math.PI;
      positions.push(width * Math.cos(angle), y + depth * Math.sin(angle), z);
      uvs.push(i / segments, (z - start) / length);
      if (row && i) {
        const a = (row-1) * (segments+1) + i-1, b = a + segments+1;
        index.push(a, a+1, b, a+1, b+1, b);
      }
    }
  }
  // Separate cap vertices keep their flat normals off the curved silhouette.
  for(const row of [0,sections.length-1]) {
    const startIndex=positions.length/3;
    const [z,,,cy=0]=sections[row];
    positions.push(0,cy,z);uvs.push(.5,.5);
    for(let i=0;i<segments;i++) {
      const offset=(row*(segments+1)+i)*3;
      positions.push(positions[offset],positions[offset+1],z);
      const angle=i/segments*2*Math.PI;
      uvs.push(.5+.5*Math.cos(angle),.5+.5*Math.sin(angle));
      const a=startIndex+1+i,b=startIndex+1+(i+1)%segments;
      index.push(startIndex,row?a:b,row?b:a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  g.setIndex(index);
  g.computeVertexNormals();
  const normals=g.attributes.normal, smooth=new THREE.Vector3(), endNormal=new THREE.Vector3();
  for(let row=0;row<sections.length;row++) {
    const a=row*(segments+1), b=a+segments;
    smooth.fromBufferAttribute(normals,a).add(endNormal.fromBufferAttribute(normals,b)).normalize();
    normals.setXYZ(a,smooth.x,smooth.y,smooth.z);
    normals.setXYZ(b,smooth.x,smooth.y,smooth.z);
  }
  return g;
}

// One skin from sleeve to wrist (or shorts to ankle). Blending around the
// elbow/knee prevents cracks, flat end caps and rigid sections crossing.
function skinLimb(upper,lower,sections,direction,mat) {
  const geometry=loft(sections,24);
  const vertices=geometry.attributes.position;
  const indices=new Uint16Array(vertices.count*4), weights=new Float32Array(vertices.count*4);
  const colors=new Float32Array(vertices.count*3), tint=new THREE.Color(skin);
  for(let i=0;i<vertices.count;i++) {
    const distance=direction*(vertices.getZ(i)-lower.position.z);
    const weight=THREE.MathUtils.smoothstep(distance,-.044,.044);
    indices[i*4+1]=1;
    weights[i*4]=1-weight;
    weights[i*4+1]=weight;
    tint.toArray(colors,i*3);
  }
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
  geometry.setAttribute('skinIndex',new THREE.BufferAttribute(indices,4));
  geometry.setAttribute('skinWeight',new THREE.BufferAttribute(weights,4));
  const mesh=new THREE.SkinnedMesh(geometry,mat);
  upper.add(mesh);
  upper.updateWorldMatrix(true,true);
  const skeleton=new THREE.Skeleton([upper,lower]);
  mesh.bind(skeleton);
  mesh.castShadow=mesh.receiveShadow=true;
  mesh.frustumCulled=false;
  mesh.userData.disposeTextures=()=>skeleton.dispose();
}

function oval(x,y,z,rx,ry,rz) {
  return new THREE.SphereGeometry(1,18,12).scale(rx,ry,rz).translate(x,y,z);
}

function seam(points, radius) {
  const path = new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));
  return new THREE.TubeGeometry(path, 16, radius, 5, false);
}

function buildFinBlade(mat) {
  const positions = [], colors = [], uvs = [], index = [], bent = [];
  const rows = 12, sides = 28;
  const paint = new THREE.Color();
  for(let row=0; row<=rows; row++) {
    const t = row/rows;
    const width = .037 + .046 * THREE.MathUtils.smoothstep(t,0,.64) - .006*t*t;
    for(let i=0;i<=sides;i++) {
      const angle = i/sides*2*Math.PI, cross = Math.cos(angle);
      const rim = Math.abs(cross);
      const reinforcingRail = Math.exp(-Math.pow((rim-.76)/.095,2));
      const x = cross * width;
      const y = Math.sin(angle) * (.006 + reinforcingRail*.006 + (1-t)*.003)
        - .008 - .013*t*t;
      // The two outer corners extend slightly beyond the flexible middle.
      const z = -.077 - .291*t + .021*(1-cross*cross)*t*t*t;
      positions.push(x,y,z);
      bent.push(0,.069*t*t*(.78+.22*rim),0);
      paint.set(rim>.94 ? graphite : reinforcingRail>.50 ? finRail : finBlue);
      colors.push(paint.r,paint.g,paint.b);
      uvs.push(i/sides,t);
      if(row && i){
        const a = (row-1)*(sides+1)+i-1, b=a+sides+1;
        index.push(a,b,a+1, a+1,b,b+1);
      }
    }
  }
  const end=rows*(sides+1);
  for(let i=1;i<sides-1;i++)index.push(end,end+i+1,end+i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  g.setIndex(index);
  g.computeVertexNormals();
  // Both the silhouette and its lighting flex under the load of each kick.
  const curled = g.clone();
  const vertices=curled.attributes.position;
  for(let i=0;i<vertices.count;i++) vertices.setY(i,vertices.getY(i)+bent[i*3+1]);
  curled.computeVertexNormals();
  const normals=g.attributes.normal.array, curledNormals=curled.attributes.normal.array;
  const normalDelta = Float32Array.from(curledNormals,(value,i)=>value-normals[i]);
  curled.dispose();
  g.morphTargetsRelative=true;
  g.morphAttributes.position=[new THREE.Float32BufferAttribute(bent,3)];
  g.morphAttributes.normal=[new THREE.BufferAttribute(normalDelta,3)];
  const blade=new THREE.Mesh(g,mat);
  blade.name='flexible-fin';
  blade.castShadow=blade.receiveShadow=true;
  return blade;
}

export function createAuthorSwimmer(manager) {
  const swimmer = new THREE.Group();
  swimmer.name = 'author-swimmer';
  const materials = {
    cloth: createToyMaterial('canvas',manager), rubber: createToyMaterial('rubber',manager),
    skin: new THREE.MeshStandardMaterial({ vertexColors:true,roughness:.55 }),
  };
  // Merge all rigid details that follow one joint and use the same finish.
  const batches=new Map();
  function add(parent,finish,geometry,hex) {
    const color=new THREE.Color(hex);
    const values=new Float32Array(geometry.attributes.position.count*3);
    for(let i=0;i<values.length;i+=3)color.toArray(values,i);
    geometry.setAttribute('color',new THREE.BufferAttribute(values,3));
    if(!batches.has(parent))batches.set(parent,new Map());
    const byFinish=batches.get(parent);
    if(!byFinish.has(finish))byFinish.set(finish,[]);
    byFinish.get(finish).push(geometry);
  }

  const pelvis=joint(swimmer,'pelvis',0,0,0);
  const spine=joint(pelvis,'spine',0,0,-.047);
  add(pelvis,'cloth',loft([[-.168,.090,.058],[-.143,.124,.076],[-.092,.137,.084],[-.064,.124,.073],[-.024,.115,.066],[.018,.112,.064]]),shorts);
  // Shirt drapes across the waist, flares over the chest, then tapers at the collar.
  add(spine,'cloth',loft([[-.016,.138,.085],[-.011,.141,.087],[.013,.137,.086],
    [.075,.131,.078],[.153,.141,.088],[.239,.159,.099],[.302,.165,.090],
    [.330,.145,.077],[.353,.101,.068,.007],[.366,.068,.053,.011]],30),red);
  add(spine,'cloth',loft([[.343,.084,.065,.010],[.352,.083,.066,.011],[.368,.070,.056,.013]]),redHem);
  add(spine,'skin',loft([[.352,.058,.047,.016],[.392,.055,.047,.031],[.446,.059,.051,.058],[.475,.065,.054,.069]]),skin);
  const neck=joint(spine,'neck',0,.040,.425);
  const head=createAuthorHead(manager);
  head.position.set(0,.058,.109);
  neck.add(head);
  swimmer.userData.mouth=head.userData.mouth;
  swimmer.userData.snorkelTip=head.userData.snorkelTip;

  const limbs=[];
  for(const side of [-1,1]) {
    // Raglan panel seam follows the curved shoulder rather than floating above it.
    add(spine,'cloth',seam([[side*.066,.045,.352],[side*.083,.072,.322],
      [side*.120,.069,.281],[side*.153,.032,.253]],.0028),redHem);
    const shoulder=joint(spine,'shoulder',side*.142,0,.296);
    shoulder.rotation.order='YXZ';
    add(shoulder,'cloth',loft([[-.066,.027,.032],[-.040,.054,.056],[.003,.067,.069],
      [.055,.058,.058],[.100,.055,.051],[.109,.054,.051]]),red);
    add(shoulder,'cloth',loft([[.095,.056,.052],[.103,.056,.052],[.110,.055,.051]]),redHem);
    const elbow=joint(shoulder,'elbow',0,0,.202);
    skinLimb(shoulder,elbow,[[.071,.048,.046],[.118,.048,.045],[.159,.042,.041],
      [.187,.035,.034],[.201,.034,.034],[.223,.036,.036],[.261,.039,.035],
      [.318,.030,.028],[.368,.023,.021],[.385,.019,.017]],1,materials.skin);
    const wrist=joint(elbow,'wrist',0,0,.168);
    add(wrist,'skin',loft([[-.014,.022,.019],[.010,.026,.018],[.036,.034,.017],
      [.054,.032,.015],[.066,.024,.010],[.068,.015,.007]]),skin);
    for(const [digit,length] of [.037,.043,.040,.030].entries()){
      const x=side*(digit-1.5)*.015;
      add(wrist,'skin',oval(x,-.002,.056+length*.40,.0086,.0091,length*.62),skin);
    }
    add(wrist,'skin',oval(0,0,0,.010,.011,.027)
      .rotateY(-side*.60).translate(-side*.029,-.004,.033),skin);

    const hip=joint(pelvis,'hip',side*.072,.002,-.096);
    add(hip,'cloth',loft([[-.134,.066,.059],[-.125,.071,.066],[-.068,.075,.077],
      [.003,.073,.071],[.040,.060,.051],[.054,.047,.045]]),shorts);
    add(hip,'cloth',loft([[-.135,.069,.062],[-.130,.071,.065],[-.122,.072,.067]]),'#35373b');
    const knee=joint(hip,'knee',0,0,-.247);
    skinLimb(hip,knee,[[-.505,.025,.024],[-.483,.030,.028],[-.427,.033,.030],
      [-.364,.044,.038,.006],[-.309,.049,.044,.009],[-.271,.043,.040,.006],
      [-.248,.043,.041],[-.221,.047,.044,-.002],[-.177,.057,.055],
      [-.130,.062,.062],[-.103,.060,.059]],-1,materials.skin);
    const ankle=joint(knee,'ankle',0,0,-.237);
    add(ankle,'rubber',loft([[-.163,.031,.017],[-.133,.044,.023],[-.091,.049,.029],
      [-.045,.044,.038],[.001,.039,.041],[.031,.035,.034]]),graphite);
    add(ankle,'rubber',loft([[.013,.039,.039],[.019,.040,.041],[.030,.036,.036]]),'#466063');
    const blade=buildFinBlade(materials.rubber);
    ankle.add(blade);
    limbs.push({side,shoulder,elbow,wrist,hip,knee,ankle,blade});
  }
  for(const [parent,byFinish] of batches) {
    for(const [finish,pieces] of byFinish) {
      const mesh=new THREE.Mesh(mergeGeometries(pieces),materials[finish]);
      mesh.castShadow=mesh.receiveShadow=true;
      parent.add(mesh);
      for(const piece of pieces) piece.dispose();
    }
  }
  swimmer.userData.rig={pelvis,spine,neck,limbs};
  animateAuthorSwimmer(swimmer,0);
  return swimmer;
}

export function animateAuthorSwimmer(model, phaseSeconds, surfacing=0) {
  const {pelvis,spine,neck,limbs}=model.userData.rig;
  const time=phaseSeconds;
  const kick=time*4.6, stroke=time*1.70;
  const reach=.5-.5*Math.cos(stroke);
  pelvis.rotation.set(.018*Math.sin(kick),.026*Math.sin(kick),.045*Math.sin(kick-.38));
  spine.rotation.set(-.018*Math.sin(kick)-.055*surfacing, .021*Math.cos(stroke),
    -.037*Math.sin(kick)+.025*Math.sin(stroke));
  neck.rotation.set(.075-.20*surfacing+.017*Math.sin(stroke),
    .085*Math.sin(stroke*.52),-.027*Math.sin(stroke));
  const kickStrength=1-.48*surfacing;
  for(const {side,shoulder,elbow,wrist,hip,knee,ankle,blade} of limbs) {
    // Scull out on the catch, bend the elbow under the body, then feather the
    // palm for the narrower recovery. Keep the neck still enough to sight ahead.
    shoulder.rotation.y=side*(.54 + 1.28*reach*reach + .045*Math.sin(stroke+side*.24));
    shoulder.rotation.x=.06+.24*reach+.10*Math.sin(stroke);
    shoulder.rotation.z=side*(-.08-.11*Math.sin(stroke));
    elbow.rotation.y=-side*(.19+.92*reach+.14*Math.sin(stroke));
    elbow.rotation.x=.04+.23*reach+.15*Math.sin(stroke-.45);
    wrist.rotation.set(-.10-.13*Math.cos(stroke),-side*.11*reach,side*(.24+.47*Math.sin(stroke)));

    const phase=kick+(side>0?Math.PI:0);
    hip.rotation.set(kickStrength*.31*Math.sin(phase),-side*.046,side*.014*Math.cos(phase));
    // The hips lead each alternating stroke. Knees flex in one direction; the
    // ankles and flexible blade tips respond later as water loads the fin.
    knee.rotation.x=.065+kickStrength*.39*(.5-.5*Math.cos(phase));
    ankle.rotation.x=-.16+kickStrength*.15*Math.sin(phase-1.56);
    blade.morphTargetInfluences[0]=-kickStrength*.92*Math.cos(phase-.72);
  }
}
