import { updateWindowGlass, windowGlass } from './windowGlass';
import { createWindowBeam } from './windowBeam';
import { apertureTriangles } from './windowTransmission';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { roomFloor, roomSize, roomWalls } from '../../shared/room-dimensions';
import type { Daylight } from './daylight';
import { windowLighting, windowPatch, windowLightFloor, type WindowAnchor } from './windowLighting';

interface Track { material<T extends THREE.Material>(m: T): T; geometry<T extends THREE.BufferGeometry>(g: T): T; texture<T extends THREE.Texture>(t: T): T }
const FLOOR = .232;

function canvasTexture(size: [number, number], paint: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, track: Track) {
  const canvas = document.createElement('canvas'); [canvas.width, canvas.height] = size; paint(canvas.getContext('2d')!, ...size);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return track.texture(texture);
}
function decal(geometry: THREE.BufferGeometry, map: THREE.Texture, track: Track, blending: THREE.Blending = THREE.NormalBlending, color = '#ffffff', opacity = 1) {
  const material = track.material(new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity, depthWrite: false, blending, toneMapped: false }));
  const mesh = new THREE.Mesh(track.geometry(geometry), material); mesh.renderOrder = 1; return mesh;
}

export function buildLight(scene: THREE.Scene, renderer: THREE.WebGLRenderer, group: THREE.Group, track: Track) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = track.texture(pmrem.fromScene(new RoomEnvironment(), .04).texture); pmrem.dispose();
  scene.environment = environment; scene.environmentIntensity = .28;
  const hemi = new THREE.HemisphereLight('#ffeccc', '#8a7560', 1.05); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffd9a8', 2.9); sun.position.set(-5, 13, -9); sun.castShadow = true;
  const shadowSize = matchMedia('(pointer: coarse)').matches ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  // The simple shadow of the medium graphics tier: a quarter of the texels, drawn without filtering.
  const shadowDetail = (simple: boolean) => {
    const size = simple ? shadowSize / 2 : shadowSize; if (sun.shadow.mapSize.x === size) return;
    sun.shadow.mapSize.set(size, size); sun.shadow.map?.dispose(); sun.shadow.map = null;
  };
  sun.shadow.normalBias = .03; sun.shadow.bias = -.0002; sun.shadow.radius = 3.5;
  scene.add(sun, sun.target);
  // The shadow map covers the room and no more, so shadows stay as crisp as the room's size allows.
  const roomCorners = [roomFloor.minX, roomFloor.maxX].flatMap(x => [roomFloor.minZ, roomFloor.maxZ].flatMap(z => [-.46, roomWalls.top].map(y => new THREE.Vector3(x, y, z))));
  const fitShadow = () => {
    const camera = sun.shadow.camera; camera.position.copy(sun.position); camera.lookAt(sun.target.position); camera.updateMatrixWorld();
    const local = roomCorners.map(corner => corner.clone().applyMatrix4(camera.matrixWorldInverse));
    const xs = local.map(point => point.x), ys = local.map(point => point.y), depths = local.map(point => -point.z);
    Object.assign(camera, { left: Math.min(...xs) - .5, right: Math.max(...xs) + .5, bottom: Math.min(...ys) - .5, top: Math.max(...ys) + .5, near: Math.max(.5, Math.min(...depths) - 1), far: Math.max(...depths) + 20 });
    camera.updateProjectionMatrix();
  };
  fitShadow();
  const fill = new THREE.DirectionalLight('#e4e9f7', .55); fill.position.set(9, 7, 12); scene.add(fill);
  const bandMap = canvasTexture([8, 64], (ctx, w, h) => { const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#000000ff'); g.addColorStop(1, '#00000000'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }, track);
  const depth = .95;
  const bands = mergeGeometries([
    new THREE.PlaneGeometry(roomSize.width - .3, depth).rotateX(-Math.PI / 2).translate(roomSize.centreX, FLOOR, roomWalls.back.z + depth / 2),
    new THREE.PlaneGeometry(roomSize.depth - .3, depth).rotateX(-Math.PI / 2).rotateY(Math.PI / 2).translate(roomWalls.left.x + depth / 2, FLOOR, roomSize.centreZ),
  ]);
  const wallBands=decal(bands, bandMap, track, THREE.NormalBlending, '#4a3523', .2);group.add(wallBands);

  const patches = new Map<string, { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>; texture: THREE.CanvasTexture; canvas: HTMLCanvasElement; beam: ReturnType<typeof createWindowBeam> }>();
  const patchRoot = new THREE.Group(); scene.add(patchRoot);
  const warm = new THREE.Color();
  function update(d: Daylight, windows: readonly WindowAnchor[], tint: string, brightness = 1) {
    const lighting = windowLighting(d, windows, brightness);
    sun.color.set(lighting.key).multiply(warm.set(tint)); sun.intensity = lighting.keyIntensity;
    sun.position.set(...lighting.position); sun.target.position.set(...lighting.target); fitShadow();
    hemi.color.set(lighting.sky); hemi.groundColor.set(lighting.ground); hemi.intensity = lighting.hemi;
    fill.color.set(lighting.fill); fill.intensity = lighting.fillIntensity; scene.environmentIntensity = lighting.environment;
    const ray = new THREE.Vector3(...lighting.target).sub(new THREE.Vector3(...lighting.position)).normalize();
    for (const [id, patch] of patches) if (!windows.some(window => window.id === id)) { patch.mesh.removeFromParent(); patch.mesh.geometry.dispose(); patch.mesh.material.dispose(); patch.texture.dispose(); patch.beam.dispose(); patches.delete(id); }
    for (const window of windows) {
      let patch = patches.get(window.id);
      if (!patch) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24), 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(16), 2));
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(32), 4));
        geometry.setIndex([0, 2, 1, 0, 3, 2, 0, 4, 3, 0, 5, 4, 0, 6, 5, 0, 7, 6]);
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
        const texture = new THREE.CanvasTexture(canvas); texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter;
        const material = new THREE.MeshStandardMaterial({ map: texture, color: d.patch, transparent: true, vertexColors: true, depthWrite: false, roughness: 1, metalness: 0, blending: THREE.AdditiveBlending });
        const mesh = new THREE.Mesh(geometry, material); mesh.name = `window-transmission:${window.id}`; mesh.renderOrder = 1; mesh.frustumCulled = false; mesh.receiveShadow = true;
        const beam = createWindowBeam(texture); beam.mesh.name = `window-beam:${window.id}`; patchRoot.add(beam.mesh);
        patch = { mesh, texture, canvas, beam };
        patches.set(window.id, patch); patchRoot.add(mesh);
      }
      const glass = windowGlass(window.kind ?? '');
      if (window.source) updateWindowGlass(window.source, d, window.kind ?? '');
      const projection = windowPatch(window, d, ray);
      projection.opacity *= glass.transmission;
      const transmittedColor = new THREE.Color(d.patch).multiply(new THREE.Color(glass.tint));
      patch.mesh.visible = projection.opacity > 0 && Boolean(window.source);
      patch.mesh.material.color.copy(transmittedColor);
      const context = patch.canvas.getContext('2d')!;
      context.clearRect(0, 0, 256, 256);
      if (patch.mesh.visible && window.source) {
        const triangles = apertureTriangles(window.source, new THREE.Vector3(...window.position), new THREE.Vector3(...window.inward), window.width, window.height, ray);
        for (const glass of [true, false]) {
          context.globalCompositeOperation = glass ? 'source-over' : 'destination-out';
          context.fillStyle = '#ffffff';
          for (const triangle of triangles) if (triangle.glass === glass) {
            context.beginPath(); triangle.points.forEach((point, index) => { const x = point.u * 256, y = (1 - point.v) * 256; if (index === 0) context.moveTo(x, y); else context.lineTo(x, y); }); context.closePath(); context.fill();
          }
        }
        context.globalCompositeOperation = 'source-over';
      }
      patch.texture.needsUpdate = true;
      patch.beam.update(window, ray, patch.mesh.visible ? projection.opacity : 0, `#${transmittedColor.getHexString()}`);
      const position = patch.mesh.geometry.getAttribute('position'), uv = patch.mesh.geometry.getAttribute('uv'), color = patch.mesh.geometry.getAttribute('color');
      projection.vertices.forEach((point, i) => {
        position.setXYZ(i, point.x, windowLightFloor, point.z); uv.setXY(i, point.u, point.v);
        color.setXYZW(i, 1, 1, 1, projection.opacity * 2);
      });
      position.needsUpdate = true; uv.needsUpdate = true; color.needsUpdate = true;
      patch.mesh.geometry.setDrawRange(0, Math.max(0, projection.vertices.length - 2) * 3);
    }
    return lighting;
  }
  function dispose() { for (const patch of patches.values()) { patch.mesh.geometry.dispose(); patch.mesh.material.dispose(); patch.texture.dispose(); patch.beam.dispose(); } patches.clear(); patchRoot.removeFromParent(); }
  return { hemi, sun, fill, update, dispose, shadowDetail, openings(active:boolean){ wallBands.visible=!active;patchRoot.visible=!active; } };
}

export function buildStage(scene: THREE.Scene, track: Track, floor: number) {
  const glow = track.material(new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color('#ead6b8') }, strength: { value: .6 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
    fragmentShader: `uniform vec3 color; uniform float strength; varying vec2 vUv;
void main() { vec2 p = vUv * 2.0 - 1.0; float a = strength * ( 1.0 - smoothstep( 0.1, 1.0, length( p * vec2( 0.9, 1.1 ) ) ) ) * ( 1.0 - smoothstep( 0.82, 1.0, max( abs( p.x ), abs( p.y ) ) ) );
gl_FragColor = linearToOutputTexel( vec4( color, 1.0 ) ) * a; }`,
    depthTest: false, depthWrite: false, toneMapped: false,
  }));
  const backdrop = new THREE.Mesh(track.geometry(new THREE.PlaneGeometry(2, 2)), glow); backdrop.frustumCulled = false; backdrop.renderOrder = -10; scene.add(backdrop);
  const shadowMap = canvasTexture([256, Math.round(256 * (roomSize.depth + 2.8) / (roomSize.width + 3.4))], (ctx, w, h) => { ctx.filter = 'blur(14px)'; ctx.fillStyle = '#000000'; ctx.beginPath(); ctx.roundRect(34, 34, w - 68, h - 68, 26); ctx.fill(); }, track);
  const shadow = decal(new THREE.PlaneGeometry(roomSize.width + 3.4, roomSize.depth + 2.8).rotateX(-Math.PI / 2), shadowMap, track, THREE.NormalBlending, '#5b4128', .34);
  shadow.position.set(roomSize.centreX + .45, floor - .01, roomSize.centreZ + .55); shadow.renderOrder = -1; scene.add(shadow);
  return { glow: glow.uniforms.color.value as THREE.Color, shadow: shadow.material as THREE.MeshBasicMaterial };
}
