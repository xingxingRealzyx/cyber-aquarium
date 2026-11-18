import * as THREE from 'three';
import { createWaterLight, waterSurfaceMaterial } from './water-light.js';
import { createDesktopView } from './desktop-view.js';
import { corpseDecay, MAX_FOOD_PELLETS, substrateHeight as sandHeight } from './simulation.js';
import { createSubstrate } from './substrate.js';
import { createTankBase } from './tank-base.js';
import { createHardscape } from './hardscape.js';
import { createFishModel as fishModel, animateFish } from './fish-model.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createAquaticPlants } from './aquatic-plants.js';
import { createBroodDisplay } from './brood-model.js';
import { createToyModel } from './toy-model.js';
import { poseToy } from './toy-motion.js';
import { createAuthorSwimmer, animateAuthorSwimmer } from './author-swimmer.js';
import { createAuthorDisplay } from './author-motion.js';
import { animalTurnRate } from './behavior.js';

// All geometry is local. The framebuffer remains transparent outside the tank.
const WIDTH = 8, HEIGHT = 4.4, DEPTH = 4, WATER_LEVEL = 4.14;
const clamp = THREE.MathUtils.clamp;
const fract = (n) => n - Math.floor(n);
const random = (seed) => fract(Math.sin(seed * 127.1 + 311.7) * 43758.5453123);
const seedOf = (value) => typeof value === 'number' && Number.isFinite(value) ? value : [...String(value)].reduce((a, c) => a * 1.03 + c.charCodeAt(0), 1);

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: .58, ...options });
}
function mesh(geometry, mat, parent, position, scale) {
  const m = new THREE.Mesh(geometry, mat);
  if (position) m.position.set(...position);
  if (scale) m.scale.set(...scale);
  if (parent) parent.add(m);
  return m;
}
function tube(points, radius, mat, parent, segments = 24) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return mesh(new THREE.TubeGeometry(curve, segments, radius, 7, false), mat, parent);
}
function disposeObject(object) {
  object.traverse((item) => {
    item.userData.disposeTextures?.();
    if (item.isInstancedMesh) item.dispose();
    item.geometry?.dispose();
    const materials = Array.isArray(item.material) ? item.material : [item.material];
    materials.forEach((m) => m?.dispose());
  });
}

function makeFin(points, color, opacity = .8) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  points.slice(1).forEach((p) => shape.lineTo(p[0], p[1]));
  shape.closePath();
  return mesh(new THREE.ShapeGeometry(shape), material(color, {
    transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
    roughness: .35, metalness: .08,
  }));
}

function shrimpModel(seed) {
  const group = new THREE.Group();
  const red = material('#b8412b', { roughness:.28, metalness:.13 });
  const pale = material('#dc7755', { roughness:.35 });
  for (let i = 0; i < 6; i++) {
    const t = i/5;
    mesh(new THREE.SphereGeometry(1,12,8), i%2 ? red:pale, group, [.13-i*.055, .08+Math.sin(t*Math.PI)*.05,0], [.052,.055-t*.018,.045]);
  }
  const tail = makeFin([[-.13,.07],[-.27,.1],[-.23,.035]], '#c6533a', .8);
  group.add(tail);
  for (const s of [-1,1]) {
    mesh(new THREE.SphereGeometry(.012,8,6), material('#11100d'), group, [.18,.13,s*.026]);
    tube([[.16,.11,s*.02],[.25,.16,s*.06],[.39,.15,s*.12]],.003,pale,group,8);
    for(let i=0;i<4;i++) tube([[.11-i*.05,.07,s*.025],[.08-i*.05,.025,s*.065],[.16-i*.06,0,s*.1]],.004,pale,group,6);
  }
  group.userData = { kind:'shrimp' };
  return group;
}
function snailModel(seed) {
  const group = new THREE.Group();
  const shellMat = material('#a98a43', {roughness:.45,metalness:.1});
  mesh(new THREE.SphereGeometry(1,20,14),material('#5a6546'),group,[0,.04,0],[.22,.045,.09]);
  mesh(new THREE.SphereGeometry(1,24,16),shellMat,group,[-.015,.17,0],[.16,.17,.13]);
  const points=[];
  for(let i=0;i<90;i++) {
    const t=i/89, a=t*Math.PI*5;
    points.push([-.015+Math.cos(a)*t*.135,.17+Math.sin(a)*t*.14,.12*Math.sqrt(Math.max(0,1-t*t))+.012]);
  }
  tube(points,.009,material('#574b2c'),group,90);
  for(const s of [-1,1]) tube([[.15,.06,s*.035],[.23,.14,s*.055],[.25,.17,s*.06]],.006,material('#65734e'),group,6);
  group.userData={kind:'snail'};
  return group;
}

export function createResidentModel(species, seed) {
  if (species === 'shrimp') return shrimpModel(seed);
  if (species === 'snail') return snailModel(seed);
  return fishModel(species, seed);
}

export function createAquarium(container, { onSelect = () => {}, onStats = () => {} } = {}) {
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ alpha:true, antialias:true, premultipliedAlpha:true, powerPreference:'high-performance' });
  renderer.setClearColor(0x000000,0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.setAttribute('aria-label','可旋转的透明淡水鱼缸');
  renderer.domElement.style.cssText='display:block;width:100%;height:100%;outline:none;touch-action:none;';
  // Present the first frame once the local scans have decoded. An uninitialised
  // colour or roughness sampler would otherwise flash black or chrome at startup.
  renderer.domElement.style.visibility='hidden';
  let decoded=false;
  const sceneryLoader=new THREE.LoadingManager(()=>{decoded=true;});
  sceneryLoader.onStart=()=>{decoded=false;};
  container.appendChild(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(36,1,.1,60);
  const controls = new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;
  controls.dampingFactor=.075;
  controls.enablePan=false;
  controls.enableZoom=false;
  controls.touches.TWO=null; // The optical view handles two-finger zoom.
  controls.minPolarAngle=.35;
  controls.maxPolarAngle=Math.PI*.54;
  controls.autoRotateSpeed=.38;
  controls.target.set(0,2.05,0);
  const desktopView=createDesktopView(camera,controls,renderer.domElement);
  function resetView() { desktopView.reset(); camera.position.set(8.2,6.7,12.9); controls.target.set(0,2.05,0); controls.update(); }
  resetView();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room,.06);
  scene.environment=environment.texture;
  room.dispose();
  pmrem.dispose();
  const time={value:0};
  const waterClock={value:0};
  const waterLight=createWaterLight(renderer,waterClock);
  const daylight={environment:.36,ambient:1.2,key:6.1,fill:.88};
  scene.environmentIntensity=daylight.environment;
  const ambientLight=new THREE.HemisphereLight('#e3f0e9','#797563',daylight.ambient);
  scene.add(ambientLight);
  const keyLight=new THREE.SpotLight('#fff4de',daylight.key,0,.76,.34,0);
  keyLight.position.set(-2.8,9,3.2);
  keyLight.target.position.set(0,.6,0);
  keyLight.map=waterLight.texture;
  keyLight.castShadow=true;
  keyLight.shadow.mapSize.set(2048,2048);
  keyLight.shadow.camera.near=2; keyLight.shadow.camera.far=16;
  keyLight.shadow.normalBias=.009; keyLight.shadow.bias=-.00025;
  keyLight.shadow.radius=2.2;
  scene.add(keyLight,keyLight.target);
  const fillLight=new THREE.DirectionalLight('#c4e4e7',daylight.fill);
  fillLight.position.set(4,4,-3); scene.add(fillLight);
  const tank = new THREE.Group(); scene.add(tank);

  // Clear butt-jointed panes leave the substrate and the water surface visible at the edges.
  const bottomGlass=material('#a3c7b4',{roughness:.12,transparent:true,opacity:.12,depthWrite:false});
  const glassThickness=.055, glassCenter=.042;
  const base=createTankBase(WIDTH,DEPTH,glassCenter-glassThickness/2);
  tank.add(base);
  mesh(new THREE.BoxGeometry(WIDTH,glassThickness,DEPTH),bottomGlass,tank,[0,glassCenter,0]);
  const glassMat=new THREE.MeshPhysicalMaterial({color:'#c9e8dc',metalness:0,roughness:.04,transparent:true,opacity:.065,side:THREE.DoubleSide,depthWrite:false,envMapIntensity:.6});
  const panes=[
    [new THREE.PlaneGeometry(WIDTH,HEIGHT),[0,HEIGHT/2,-DEPTH/2],[0,0,0]],
    [new THREE.PlaneGeometry(WIDTH,HEIGHT),[0,HEIGHT/2,DEPTH/2],[0,0,0]],
    [new THREE.PlaneGeometry(DEPTH,HEIGHT),[-WIDTH/2,HEIGHT/2,0],[0,Math.PI/2,0]],
    [new THREE.PlaneGeometry(DEPTH,HEIGHT),[WIDTH/2,HEIGHT/2,0],[0,Math.PI/2,0]],
  ];
  panes.forEach(([g,p,r])=>{const pane=mesh(g,glassMat,tank,p);pane.rotation.set(...r);pane.renderOrder=20;});
  const waterUniforms={aquaTime:waterClock, clarity:{value:1}, lightOn:{value:1}};
  const surfaceMat=waterSurfaceMaterial(waterUniforms);
  const surface=mesh(new THREE.PlaneGeometry(7.96,3.96,55,28),surfaceMat,tank,[0,WATER_LEVEL,0]);
  surface.rotation.x=-Math.PI/2;surface.renderOrder=15;
  const waterTintMat=new THREE.MeshBasicMaterial({color:'#6ca781',transparent:true,opacity:.022,side:THREE.BackSide,depthWrite:false});
  mesh(new THREE.BoxGeometry(7.96,WATER_LEVEL-.1,3.96),waterTintMat,tank,[0,(WATER_LEVEL+.1)/2,0]);

  const substrate = createSubstrate(sceneryLoader);
  tank.add(substrate);
  const dummy = new THREE.Object3D();

  const hardscape = createHardscape(sceneryLoader);
  tank.add(hardscape.group);
  const toys = new Map();

  const filterGroup=new THREE.Group();tank.add(filterGroup);
  const filterMat=material('#273731',{roughness:.65});
  mesh(new THREE.BoxGeometry(.36,1.05,.32),filterMat,filterGroup,[3.55,3.45,-1.67]);
  tube([[3.55,3.9,-1.65],[3.55,4.33,-1.65],[3.28,4.46,-1.64],[3.12,4.12,-1.62]],.075,filterMat,filterGroup,14);
  tube([[3.55,3.1,-1.62],[3.55,2.4,-1.62],[3.55,1.02,-1.62]],.055,filterMat,filterGroup);
  for(let i=0;i<7;i++)mesh(new THREE.TorusGeometry(.066,.012,5,12),filterMat,filterGroup,[3.55,1.05+i*.055,-1.62]).rotation.x=Math.PI/2;

  let plantsSignature=null;
  let plantsGroup=null;
  function rebuildPlants(plants) {
    const replacement = createAquaticPlants(plants,time,sceneryLoader);
    tank.add(replacement);
    if (plantsGroup) {
      tank.remove(plantsGroup);
      disposeObject(plantsGroup);
    }
    plantsGroup = replacement;
  }

  const animals=new Map();
  const fauna=new THREE.Group();tank.add(fauna);
  const broodDisplay = createBroodDisplay(tank, hardscape.group);
  const particleCount=170;
  const particlePositions=new Float32Array(particleCount*3);
  const particleGeo=new THREE.BufferGeometry();particleGeo.setAttribute('position',new THREE.BufferAttribute(particlePositions,3));
  const particleMat=new THREE.PointsMaterial({color:'#dbedd3',size:.018,transparent:true,opacity:.22,depthWrite:false,sizeAttenuation:true});
  const particles=new THREE.Points(particleGeo,particleMat);tank.add(particles);
  const bubbleCount=35;
  const bubbles=new THREE.InstancedMesh(new THREE.SphereGeometry(1,8,6),new THREE.MeshPhysicalMaterial({color:'#d9f7ec',roughness:.03,metalness:.1,transparent:true,opacity:.3,depthWrite:false}),bubbleCount);
  tank.add(bubbles);
  const foodBits=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.044,0),material('#c99542',{
    roughness:.86,emissive:'#754315',emissiveIntensity:.2,
  }),MAX_FOOD_PELLETS);
  foodBits.count=0;foodBits.frustumCulled=false;tank.add(foodBits);
  const feedRipples=[];
  for(let i=0;i<3;i++){
    const ripple=mesh(new THREE.RingGeometry(.94,1,64),new THREE.MeshBasicMaterial({
      color:'#e4d3a5',transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false,
    }),tank);
    ripple.rotation.x=-Math.PI/2;ripple.visible=false;feedRipples.push(ripple);
  }
  // A camera-facing corner marker keeps the chosen individual identifiable.
  const bracketPoints=[];
  for(const sx of [-1,1])for(const sy of [-1,1]){
    bracketPoints.push(sx*.4,sy*.25,0,sx*.55,sy*.25,0,
      sx*.55,sy*.25,0,sx*.55,sy*.13,0);
  }
  const selectionGeometry=new THREE.BufferGeometry();
  selectionGeometry.setAttribute('position',new THREE.Float32BufferAttribute(bracketPoints,3));
  const selectionMarker=new THREE.LineSegments(selectionGeometry,new THREE.LineBasicMaterial({
    color:'#d9efad',transparent:true,opacity:.85,depthWrite:false,depthTest:false,
  }));
  selectionMarker.visible=false;selectionMarker.renderOrder=30;scene.add(selectionMarker);
  let selectedAnimalId=null;
  const raycaster=new THREE.Raycaster();
  const pointer=new THREE.Vector2();
  const projected=new THREE.Vector3();
  const tankBounds=new THREE.Box3(new THREE.Vector3(-4.03,-.11,-2.03),new THREE.Vector3(4.03,4.48,2.03));
  const baseBounds=new THREE.Box3().setFromObject(base);
  const targetQuaternion=new THREE.Quaternion();
  const headingEuler=new THREE.Euler(0,0,0,'YZX');
  function setRay(clientX,clientY){
    const r=renderer.domElement.getBoundingClientRect();
    pointer.set((clientX-r.left)/r.width*2-1,-(clientY-r.top)/r.height*2+1);
    camera.updateMatrixWorld();raycaster.setFromCamera(pointer,camera);
  }
  function hitTest(clientX,clientY){setRay(clientX,clientY);return raycaster.ray.intersectsBox(tankBounds)||raycaster.ray.intersectsBox(baseBounds);}
  function screenPoint(point, rect) {
    point.project(camera);
    return {
      x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2,
      visible: Math.abs(point.z) <= 1 && Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1,
    };
  }
  function getAnimalScreenPositions(){
    const rect=renderer.domElement.getBoundingClientRect();
    camera.updateMatrixWorld();
    return [...animals.entries()].map(([id,model])=>{
      // Bottom dwellers have their local origin at their feet.
      const y = model.userData.kind === 'snail' ? .15 : model.userData.kind === 'shrimp' ? .09 : 0;
      model.localToWorld(projected.set(0, y, 0));
      return { id, scale: model.scale.x, ...screenPoint(projected, rect) };
    });
  }
  function getBroodScreenPositions(){
    const rect=renderer.domElement.getBoundingClientRect();
    camera.updateMatrixWorld();
    return [...broodDisplay.clutches].filter(([,mesh])=>mesh.visible).map(([id,mesh])=>{
      mesh.getMatrixAt(0, dummy.matrix);
      mesh.localToWorld(projected.setFromMatrixPosition(dummy.matrix));
      return { id, count: mesh.count, ...screenPoint(projected, rect) };
    });
  }
  function getToyScreenPositions(){
    const rect=renderer.domElement.getBoundingClientRect();
    camera.updateMatrixWorld();
    return [...toys].map(([id,model])=>{
      const author=model.userData.author;
      (author?.swimmer ?? model).getWorldPosition(projected);
      const {x,y,z}=projected;
      return {id,kind:model.userData.toyKind,world:{x,y,z},...screenPoint(projected,rect),...author?.diagnostics()};
    });
  }
  function pickAnimal(clientX,clientY,cycleFrom=null){
    setRay(clientX,clientY);fauna.updateMatrixWorld(true);
    const hits=raycaster.intersectObjects([...animals.values()],true);
    const candidates = new Set();
    for(const hit of hits){
      let object=hit.object;
      if(object.userData.pickIgnore)continue;
      while(object&&!object.userData.animalId)object=object.parent;
      if(object){
        if (!cycleFrom) return object.userData.animalId;
        candidates.add(object.userData.animalId);
      }
    }
    // Tiny fry remain selectable near their center. Consecutive clicks on
    // a cluster cycle through overlapping parents and offspring.
    const radius = candidates.size ? 8 : 18;
    const nearby = getAnimalScreenPositions().filter(p => p.visible)
      .map(p => ({ id: p.id, distance: Math.hypot(p.x-clientX, p.y-clientY) }))
      .filter(p => p.distance < radius).sort((a,b) => a.distance - b.distance);
    for (const { id } of nearby) candidates.add(id);
    const ids = [...candidates];
    return ids.length ? ids[(ids.indexOf(cycleFrom) + 1) % ids.length] : null;
  }
  function setSelectedAnimal(id){selectedAnimalId=id??null;}
  let pointerDown=null, lastPick=null;
  const onPointerDown=(event)=>{
    pointerDown=event.button===0?{x:event.clientX,y:event.clientY,id:event.pointerId,dragged:false}:null;
  };
  const onPointerMove=(event)=>{
    if(pointerDown&&Math.hypot(event.clientX-pointerDown.x,event.clientY-pointerDown.y)>5)pointerDown.dragged=true;
    renderer.domElement.style.cursor=pointerDown?.dragged?'grabbing':pickAnimal(event.clientX,event.clientY)?'pointer':'grab';
  };
  const onPointerUp=(event)=>{
    const down=pointerDown;pointerDown=null;
    if(event.button!==0||!down||down.id!==event.pointerId||down.dragged||Math.hypot(event.clientX-down.x,event.clientY-down.y)>5)return;
    const cycle = lastPick && event.timeStamp-lastPick.time < 1100 &&
      Math.hypot(event.clientX-lastPick.x,event.clientY-lastPick.y) < 4;
    const id=pickAnimal(event.clientX,event.clientY,cycle ? lastPick.id : null);
    lastPick={x:event.clientX,y:event.clientY,time:event.timeStamp,id};
    if(id){setSelectedAnimal(id);onSelect(id);}
  };
  const onPointerCancel=()=>{pointerDown=null;renderer.domElement.style.cursor='grab';};
  const onPointerLeave=()=>{if(!pointerDown)renderer.domElement.style.cursor='grab';};
  renderer.domElement.addEventListener('pointerdown',onPointerDown);
  renderer.domElement.addEventListener('pointermove',onPointerMove);
  renderer.domElement.addEventListener('pointerup',onPointerUp);
  renderer.domElement.addEventListener('pointercancel',onPointerCancel);
  renderer.domElement.addEventListener('pointerleave',onPointerLeave);
  let width=0,height=0,quality='high',frames=0,statsTime=0;
  function resize(){
    const r=container.getBoundingClientRect();width=Math.max(1,r.width);height=Math.max(1,r.height);
    renderer.setSize(width,height,false);desktopView.resize(width,height);
  }
  const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(container);resize();
  let lastLight=true;
  function update(state,deltaSeconds,elapsedSeconds,motionDt=deltaSeconds){
    const t=Number.isFinite(elapsedSeconds)?elapsedSeconds:time.value+Math.max(0,deltaSeconds);
    time.value=t;
    waterClock.value=state.currentSeconds ?? t;
    const light=state.equipment?.light!==false;
    if(light!==lastLight){
      fillLight.intensity=light?daylight.fill:.13;
      scene.environmentIntensity=light?daylight.environment:.07;
      ambientLight.intensity=light?daylight.ambient:.34;
      lastLight=light;
    }
    waterUniforms.lightOn.value=light?1:.2;
    const clarity=clamp(state.water?.clarity??1,0,1);
    keyLight.intensity=light?daylight.key*(.68+.32*clarity):0;
    waterLight.update(light,quality==='low');
    waterUniforms.clarity.value=clarity;
    waterTintMat.opacity=.022+(1-clarity)*.21;
    waterTintMat.color.set(clarity>.5?'#6ca781':'#8c9958');
    particleMat.opacity=.15+(1-clarity)*.36;
    hardscape.update(state.hardscape || []);
    const placedToys=state.toys || [];
    for(const [id,model] of toys){
      if(placedToys.some(toy=>toy.id===id))continue;
      tank.remove(model);disposeObject(model);toys.delete(id);
    }
    for(const toy of placedToys){
      let model=toys.get(toy.id);
      if(!model){
        if (toy.kind === 'author') {
          const swimmer = createAuthorSwimmer(sceneryLoader);
          model = createAuthorDisplay(swimmer, animateAuthorSwimmer, toy.slot, WATER_LEVEL, hardscape.driftFloor);
        } else {
          model=createToyModel(toy.kind, toy.color, sceneryLoader);
        }
        model.userData.toyKind=toy.kind;
        tank.add(model);toys.set(toy.id,model);
      }
      if (model.userData.author) {
        const age = Math.max(0, (state.behaviorSeconds ?? 0) - (toy.placedAtSeconds ?? 0));
        model.userData.author.update(age, hardscape.revision);
      } else {
        poseToy(model,toy,waterClock.value,WATER_LEVEL,hardscape.driftFloor);
      }
    }
    const signature=(state.plants||[]).map(p=>`${p.id}:${p.species}:${p.slot}:${Math.round((p.biomass??1)*4)}`).join('|');
    if(signature!==plantsSignature){plantsSignature=signature;rebuildPlants(state.plants||[]);}
    const currentIds=new Set();
    for(const animal of state.animals||[]){
      currentIds.add(animal.id);
      let model=animals.get(animal.id);
      const seed=seedOf(animal.seed??animal.id);
      if(!model){
        model=createResidentModel(animal.species,seed);
        model.userData.animalId=animal.id;model.userData.seed=seed;animals.set(animal.id,model);fauna.add(model);
      }
      const alive=animal.alive!==false;
      const p=animal.position;
      const hasPosition=p&&[p.x,p.y,p.z].every(Number.isFinite);
      const velocity=animal.velocity||{x:0,y:0,z:0};
      const fish = model.userData.kind === 'fish';
      const decay = !alive && fish ? corpseDecay(animal) : 0;
      const size = animal.size ?? 1;
      model.scale.set(size, size * (1 - .13 * decay), size * (1 - .28 * decay));
      // State owns all locomotion and feeding; rendering never consumes food.
      if(hasPosition) model.position.set(p.x,p.y,p.z);
      else if(!model.userData.positionInitialized){
        const x=(random(seed+2)-.5)*5.5,z=(random(seed+7)-.5)*2.3;
        model.position.set(x,model.userData.kind==='fish'?1.3+random(seed+3)*1.7:sandHeight(x,z),z);
      }
      model.userData.positionInitialized=true;
      const horizontal=Math.hypot(velocity.x||0,velocity.z||0);
      const swimSpeed=Math.hypot(velocity.x||0,velocity.y||0,velocity.z||0);
      if(alive){
        const yaw=horizontal>.001?Math.atan2(-(velocity.z||0),velocity.x||0):(model.userData.headingYaw??0);
        model.userData.headingYaw=yaw;
        const pitch=fish&&swimSpeed>.001?clamp(Math.atan2(velocity.y||0,horizontal),-.85,.85):0;
        headingEuler.set(0,yaw,pitch,'YZX');targetQuaternion.setFromEuler(headingEuler);
      }else{
        const yaw = animal.deathHeading ?? model.userData.headingYaw ?? 0;
        const seconds = Math.max(0, state.behaviorSeconds - (animal.deathBehaviorSeconds ?? 0));
        const side = seed < .5 ? -1 : 1;
        // Roll about the fish's own long axis while retaining its last heading.
        const roll = side * (fish ? Math.PI * .48 : .34) * (1 - Math.exp(-seconds * .7));
        headingEuler.set(roll,yaw,0,'YZX');
        targetQuaternion.setFromEuler(headingEuler);
      }
      if(!model.userData.orientationInitialized){
        model.quaternion.copy(targetQuaternion);
        model.userData.orientationInitialized=true;
      }else if (!state.paused) {
        model.quaternion.rotateTowards(targetQuaternion,animalTurnRate(animal.species)*Math.max(0,motionDt));
      }
      if (fish) animateFish(model,animal,state.paused ? 0 : motionDt,swimSpeed,decay);
    }
    for(const [id,model] of animals)if(!currentIds.has(id)){fauna.remove(model);disposeObject(model);animals.delete(id);}
    broodDisplay.update(state.broods ?? [], animals, plantsGroup?.userData.leafSites, t);
    for(let i=0;i<particleCount;i++){
      particlePositions[i*3]=(random(i+31)-.5)*7.7+Math.sin(t*.1+i)*.025;
      particlePositions[i*3+1]=.5+fract(random(i+64)+t*.007)*3.55;
      particlePositions[i*3+2]=(random(i+91)-.5)*3.75;
    }
    particleGeo.attributes.position.needsUpdate=true;
    bubbles.visible=state.equipment?.aerator!==false;
    if(bubbles.visible)for(let i=0;i<bubbleCount;i++){
      const progress=fract(t*(.12+random(i+8)*.08)+i/bubbleCount);
      dummy.position.set(3.32+Math.sin(t*2+i)*.035+progress*.12,.42+progress*3.68,-1.34+Math.cos(t*2.3+i)*.035);
      dummy.scale.setScalar(.013+random(i+14)*.022+progress*.009);dummy.rotation.set(0,0,0);dummy.updateMatrix();bubbles.setMatrixAt(i,dummy.matrix);
    }
    bubbles.instanceMatrix.needsUpdate=true;
    const pellets=(state.foodPellets||[]).filter(p=>p.mass>1e-8&&[p.x,p.y,p.z].every(Number.isFinite));
    foodBits.count=pellets.length;
    for(let i=0;i<foodBits.count;i++){
      const p=pellets[i];
      dummy.position.set(p.x,p.y,p.z);
      dummy.scale.setScalar(clamp(Math.cbrt(p.mass/.0025),.5,1.6));
      dummy.rotation.set(p.seed||0,(p.seed||0)*3,0);
      dummy.updateMatrix();foodBits.setMatrixAt(i,dummy.matrix);
    }
    foodBits.instanceMatrix.needsUpdate=true;
    const fresh=pellets.filter(p=>(p.ageSeconds||0)<2);
    for(let i=0;i<feedRipples.length;i++){
      const ripple=feedRipples[i];ripple.visible=fresh.length>0;
      if(!fresh.length)continue;
      const age=Math.min(...fresh.map(p=>p.ageSeconds||0));
      ripple.position.set(fresh.reduce((n,p)=>n+p.x,0)/fresh.length,WATER_LEVEL+.014+i*.001,fresh.reduce((n,p)=>n+p.z,0)/fresh.length);
      ripple.scale.setScalar(.14+age*.36+i*.13);
      ripple.material.opacity=(1-age/2)*(.24-i*.045);
    }
    controls.update();
    const chosen=animals.get(selectedAnimalId);
    selectionMarker.visible=!!chosen;
    if(chosen){
      chosen.getWorldPosition(selectionMarker.position);
      selectionMarker.quaternion.copy(camera.quaternion);
      selectionMarker.scale.setScalar(chosen.scale.x*(chosen.userData.kind==='fish'?1:.65));
      selectionMarker.material.opacity=.72+Math.sin(t*2)*.12;
    }
    renderer.render(scene,camera);
    if(decoded && renderer.domElement.style.visibility) renderer.domElement.style.removeProperty('visibility');
    frames++;statsTime+=Math.max(0,deltaSeconds);
    if(statsTime>=1){onStats({fps:Math.round(frames/statsTime),drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles});frames=0;statsTime=0;}
  }
  function setQuality(value){quality=value;renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,quality==='low'?1:2));renderer.shadowMap.enabled=quality!=='low';resize();}
  function dispose(){
    resizeObserver.disconnect();desktopView.dispose();controls.dispose();
    renderer.domElement.removeEventListener('pointerdown',onPointerDown);
    renderer.domElement.removeEventListener('pointermove',onPointerMove);
    renderer.domElement.removeEventListener('pointerup',onPointerUp);
    renderer.domElement.removeEventListener('pointercancel',onPointerCancel);
    renderer.domElement.removeEventListener('pointerleave',onPointerLeave);
    broodDisplay.dispose();
    disposeObject(scene);waterLight.dispose();keyLight.shadow.dispose();environment.dispose();renderer.dispose();renderer.domElement.remove();
  }
  return {update,resize,resetView,setDesktopLayout:desktopView.setLayout,setAutoRotate:(value)=>{controls.autoRotate=Boolean(value);},setQuality,dispose,renderer,camera,controls,hitTest,setSelectedAnimal,getAnimalScreenPositions,getBroodScreenPositions,getToyScreenPositions};
}
