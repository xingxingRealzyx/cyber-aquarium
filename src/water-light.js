import * as THREE from 'three';

// Wave vector (x, z), amplitude in tank units, angular frequency and phase.
// Toys and both GPU passes sample this same surface and its derivatives.
const ripples = [
  [4.8, 2.1, .008, .92, .41],
  [-2.7, 6.5, .0065, 1.12, 2.16],
  [7.2, -3.0, .0045, -.88, 1.34],
  [5.0, 8.6, .0025, 1.34, .09],
  [-8.2, -4.2, .0024, 1.02, 3.2],
];

export function sampleWaterSurface(x, z, time, field) {
  field.set(0, 0, 0);
  for (const [kx, kz, amplitude, speed, phase] of ripples) {
    const angle = x * kx + z * kz + time * speed + phase;
    const slope = amplitude * Math.cos(angle);
    field.x += amplitude * Math.sin(angle);
    field.y += kx * slope;
    field.z += kz * slope;
  }
  return field;
}

const waves = /* glsl */ `
  void ripple(inout vec3 field, vec2 p, float t, vec2 k, float amplitude, float speed, float phase) {
    float a = dot(p,k) + t*speed + phase;
    field += amplitude * vec3(sin(a), k*cos(a));
  }
  vec3 waterField(vec2 p, float t) {
    vec3 field = vec3(0.0);
    ${ripples.map(([kx, kz, a, speed, phase]) =>
      `ripple(field,p,t,vec2(${kx.toFixed(1)},${kz.toFixed(1)}),${a},${speed},${phase});`).join('\n    ')}
    return field;
  }
`;

export function waterSurfaceMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms, side:THREE.DoubleSide, transparent:true, depthWrite:false, forceSinglePass:true,
    vertexShader: /* glsl */ `
      uniform float aquaTime;
      varying vec3 waterPosition;
      ${waves}
      void main() {
        vec4 world = modelMatrix * vec4(position,1.0);
        world.y += waterField(world.xz,aquaTime).x;
        waterPosition = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      uniform float aquaTime, clarity, lightOn;
      varying vec3 waterPosition;
      ${waves}
      void main(){
        vec3 wave = waterField(waterPosition.xz,aquaTime);
        vec3 normal = normalize(vec3(-wave.y,1.,-wave.z));
        vec3 eye = normalize(cameraPosition - waterPosition);
        float grazing = pow(1.0-abs(dot(normal,eye)),4.5);
        vec3 reflected = reflect(-eye,normal);
        vec3 lamp = normalize(vec3(-2.8,9.0,3.2)-waterPosition);
        float shine = pow(max(dot(reflected,lamp),0.0),100.);
        vec3 water = mix(vec3(.32,.49,.42),vec3(.78,.9,.84),grazing);
        water += shine*vec3(.65,.63,.48);
        gl_FragColor = vec4(water*(.32+.68*lightOn),.045+grazing*.21+shine*.15+(1.-clarity)*.16);
      }`
  });
}

// A small GPU light map. Refract overhead rays at the rippling surface onto a
// receiving plane. Compressed bundles illuminate a smaller area more brightly.
// The spot light projects this map through its ordinary shadow and PBR passes.
export function createWaterLight(renderer, time) {
  const size = 256;
  const target = new THREE.WebGLRenderTarget(size,size,{
    depthBuffer:false, generateMipmaps:true, minFilter:THREE.LinearMipmapLinearFilter,
  });
  const material = new THREE.ShaderMaterial({
    uniforms:{aquaTime:time, resolution:{value:size}},
    depthTest:false, depthWrite:false, side:THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float aquaTime;
      varying vec2 source;
      ${waves}
      void main() {
        source = position.xy*.5+.5;
        vec3 wave = waterField(source*12.0,aquaTime);
        vec3 normal = normalize(vec3(-wave.y,1.,-wave.z));
        vec3 ray = refract(vec3(0.,-1.,0.),normal,1./1.333);
        vec2 projected = source + ray.xz * (3.4/12.) / -ray.y;
        gl_Position = vec4(projected*2.-1.,0.,1.);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 source;
      uniform float resolution;
      void main() {
        vec2 dx=dFdx(source)*resolution, dy=dFdy(source)*resolution;
        float density=abs(dx.x*dy.y-dx.y*dy.x);
        float light=clamp(.23+.43*density,.42,1.);
        gl_FragColor=vec4(vec3(light),1.);
      }`
  });
  // Overscan keeps rays along the edge of the map from uncovering empty texels.
  const geometry = new THREE.PlaneGeometry(2.14,2.14,128,128);
  const pass = new THREE.Scene();
  pass.add(new THREE.Mesh(geometry,material));
  const camera = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  pass.children[0].frustumCulled = false;
  let lastTime = -Infinity;
  function update(enabled,lowQuality) {
    if(!enabled || (time.value>=lastTime && time.value-lastTime < (lowQuality?.2:1/15))) return;
    lastTime = time.value;
    const previousTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(pass,camera);
    renderer.setRenderTarget(previousTarget);
  }
  return {
    texture:target.texture,update,
    dispose(){geometry.dispose();material.dispose();target.dispose();}
  };
}
