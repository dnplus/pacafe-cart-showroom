import * as THREE from 'three';

const ids = new WeakMap<object, number>(); let issued = 0;
const idOf = (item: object) => { let id = ids.get(item); if (id === undefined) ids.set(item, id = ++issued); return id; };

/**
 * Everything a draw reads from the scene, flattened to numbers: world matrices, visibility, shadow flags, material colours,
 * uniforms, texture and geometry versions, lights with their shadow setup and the camera. Two equal readings draw the same
 * picture, shadows included, so an idle room can skip the draw even when a shadow redraw was asked for.
 */
export function frameSignature() {
  let last: number[] = [], next: number[] = [];
  const push = (value: unknown) => {
    if (typeof value === 'number') next.push(value);
    else if (typeof value === 'boolean') next.push(value ? 1 : 0);
    else if (value instanceof THREE.Texture) next.push(value.id, value.version, value.offset.x, value.offset.y, value.repeat.x, value.repeat.y, value.rotation);
    else if (value instanceof THREE.Color) next.push(value.r, value.g, value.b);
    else if (value instanceof THREE.Vector2) next.push(value.x, value.y);
    else if (value instanceof THREE.Vector3) next.push(value.x, value.y, value.z);
    else if (value instanceof THREE.Vector4 || value instanceof THREE.Quaternion) next.push(value.x, value.y, value.z, value.w);
    else if (value instanceof THREE.Matrix3 || value instanceof THREE.Matrix4) next.push(...value.elements);
    else if (Array.isArray(value)) value.forEach(push);
    else next.push(value == null ? -1 : NaN);
  };
  const material = (m: THREE.Material) => {
    const any = m as THREE.Material & Partial<Record<'color' | 'emissive' | 'map' | 'emissiveIntensity' | 'alphaMap' | 'emissiveMap' | 'envMapIntensity', unknown>>;
    next.push(idOf(m), m.version, m.opacity, m.visible ? 1 : 0);
    push(any.color); push(any.emissive); push(any.emissiveIntensity); push(any.map); push(any.alphaMap); push(any.emissiveMap); push(any.envMapIntensity);
    if (m instanceof THREE.ShaderMaterial) for (const uniform of Object.values(m.uniforms)) push(uniform.value);
  };
  const object = (node: THREE.Object3D) => {
    next.push(node.id, node.visible ? 1 : 0);
    if (!node.visible) return;
    next.push(...node.matrixWorld.elements, node.renderOrder, node.castShadow ? 1 : 0, node.receiveShadow ? 1 : 0);
    if (node instanceof THREE.Mesh || node instanceof THREE.Sprite || node instanceof THREE.Points || node instanceof THREE.Line) {
      const geometry = node.geometry as THREE.BufferGeometry;
      next.push(geometry.id, geometry.drawRange.start, geometry.drawRange.count);
      for (const attribute of Object.values(geometry.attributes)) next.push('version' in attribute ? attribute.version : -1);
      if (geometry.index) next.push(geometry.index.version);
      for (const m of Array.isArray(node.material) ? node.material : [node.material]) material(m);
    }
    if (node instanceof THREE.InstancedMesh) next.push(node.count, node.instanceMatrix.version, node.instanceColor?.version ?? -1);
    if (node instanceof THREE.Light) { next.push(node.intensity); push(node.color); }
    const shadow = node instanceof THREE.Light && node.castShadow ? (node as THREE.Light & { shadow?: THREE.LightShadow }).shadow : undefined;
    if (shadow) { next.push(shadow.mapSize.x, shadow.mapSize.y, shadow.bias, shadow.normalBias, shadow.radius, ...shadow.camera.projectionMatrix.elements); }
    for (const child of node.children) object(child);
  };
  return {
    /** Reads the scene and says whether it differs from the previous reading. */
    changed(scene: THREE.Scene, camera: THREE.Camera, extra: readonly number[]) {
      scene.updateMatrixWorld(); camera.updateMatrixWorld();
      next.length = 0; next.push(...extra, ...camera.matrixWorld.elements, ...camera.projectionMatrix.elements);
      push(scene.background); push(scene.environment); object(scene);
      const same = next.length === last.length && next.every((value, k) => Object.is(value, last[k]));
      [last, next] = [next, last];
      return !same;
    },
    /** Forgets the last reading so the next one counts as changed. */
    reset() { last = []; },
  };
}
