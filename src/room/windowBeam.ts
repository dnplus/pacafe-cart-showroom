import * as THREE from 'three';
import { windowLightFloor, type WindowAnchor } from './windowLighting';
import { roomFloor } from '../../shared/room-dimensions';

// One draw call per window; shared aperture leaves frame-shaped gaps in the air.
const slices = 64;
export function createWindowBeam(map: THREE.Texture) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(slices * 12), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(slices * 8), 2));
  geometry.setAttribute('travel', new THREE.BufferAttribute(new Float32Array(slices * 4), 1));
  geometry.setIndex(Array.from({ length: slices }, (_, i) => [i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3]).flat());
  const material = new THREE.ShaderMaterial({
    uniforms: { aperture: { value: map }, color: { value: new THREE.Color('#ffe3ad') }, strength: { value: 0 }, blockerDepth: { value: null }, occlusionEnabled: { value: 0 }, beamDistance: { value: 0 }, beamFloor: { value: windowLightFloor + .004 }, box: { value: new THREE.Vector4(roomFloor.minX + .18, roomFloor.maxX - .18, roomFloor.minZ + .18, roomFloor.maxZ - .18) } },
    vertexShader: `attribute float travel; varying vec2 beamUv; varying float distanceAlong; varying vec3 worldPoint;
void main() { beamUv=uv; distanceAlong=travel; worldPoint=(modelMatrix*vec4(position,1.)).xyz; gl_Position=projectionMatrix*viewMatrix*vec4(worldPoint,1.); }`,
    fragmentShader: `uniform sampler2D aperture; uniform vec3 color; uniform float strength; uniform sampler2D blockerDepth; uniform float occlusionEnabled; uniform float beamDistance; uniform float beamFloor; uniform vec4 box;
varying vec2 beamUv; varying float distanceAlong; varying vec3 worldPoint;
void main() {
  if(worldPoint.y<beamFloor || worldPoint.x<box.x || worldPoint.x>box.y || worldPoint.z<box.z || worldPoint.z>box.w) discard;
  if(occlusionEnabled>0. && distanceAlong*beamDistance > texture2D(blockerDepth,beamUv).r*20.) discard;
  float a=texture2D(aperture,beamUv).a;
  float edge=smoothstep(0.,.025,min(min(beamUv.x,1.-beamUv.x),min(beamUv.y,1.-beamUv.y)));
  float fade=pow(1.-distanceAlong,1.4)*smoothstep(beamFloor,beamFloor+.18,worldPoint.y);
  gl_FragColor=vec4(color,a*edge*fade*strength);
}`,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material); mesh.frustumCulled = false; mesh.renderOrder = 2;
  return {
    mesh,
    update(window: WindowAnchor, ray: THREE.Vector3, opacity: number, color: string) {
      mesh.visible = opacity > 0 && ray.y < -.05;
      material.uniforms.strength.value = opacity * .85 * 20 / slices;
      material.uniforms.color.value.set(color);
      if (!mesh.visible) return;
      const tangent = new THREE.Vector3(window.inward[2], 0, -window.inward[0]).normalize();
      const distance = Math.min(6, (window.position[1] + window.height / 2 - (windowLightFloor + .004)) / -ray.y);
      material.uniforms.beamDistance.value = distance;
      const position = geometry.getAttribute('position'), uv = geometry.getAttribute('uv'), travel = geometry.getAttribute('travel');
      for (let slice = 0; slice < slices; slice++) {
        const t = (slice + .5) / slices;
        for (const [corner, [u, v]] of [[0, 0], [1, 0], [1, 1], [0, 1]].entries()) {
          const point = new THREE.Vector3(...window.position).addScaledVector(tangent, (u - .5) * window.width).addScaledVector(ray, t * distance);
          point.y += (v - .5) * window.height;
          const i = slice * 4 + corner;
          position.setXYZ(i, point.x, point.y, point.z); uv.setXY(i, u, v); travel.setX(i, t);
        }
      }
      position.needsUpdate = true; uv.needsUpdate = true; travel.needsUpdate = true;
    },
    dispose() { mesh.removeFromParent(); geometry.dispose(); material.dispose(); },
  };
}
