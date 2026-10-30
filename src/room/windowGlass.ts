import * as THREE from 'three';
import type { Daylight } from './daylight';

// Artistic transport gain, independent of alpha and opening geometry; not measured optics.
// Real glass at night shows the dark outside, so reflection fades with daylight instead of rising.
const clearGlass = { transmission: .82, tint: '#ffffff', dayColor: '#8eaab3', nightColor: '#161d27', dayRoughness: .32, nightRoughness: .5, dayReflection: .25, nightReflection: .04, daySheen: .3, nightSheen: .03 } as const;
export function windowGlass(kind: string) {
  switch (kind) {
    case 'collect_terra_window_casement':
    case 'collect_terra_window_arch':
    case 'collect_terra_window_panorama':
    case 'collect_terra_window_shutter': return clearGlass;
    default: return { ...clearGlass, transmission: 1 };
  }
}
export function updateWindowGlass(root: THREE.Object3D, d: Daylight, kind: string) {
  const profile = windowGlass(kind), day = THREE.MathUtils.clamp((d.sunIntensity - .6) / 2.3, 0, 1), sheen = day * day;
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (!(material instanceof THREE.MeshStandardMaterial) || !material.userData.windowGlass) continue;
      material.color.set(profile.nightColor).lerp(new THREE.Color(profile.dayColor), day).multiply(new THREE.Color(profile.tint));
      material.userData.windowReflection.value = THREE.MathUtils.lerp(profile.nightSheen, profile.daySheen, sheen);
      material.roughness = THREE.MathUtils.lerp(profile.nightRoughness, profile.dayRoughness, day);
      // Existing static RoomEnvironment highlights; this never reflects residents/furniture.
      material.metalness = 0;
      material.envMapIntensity = THREE.MathUtils.lerp(profile.nightReflection, profile.dayReflection, sheen);
      material.emissive.set(d.window).multiplyScalar(day * .035 * profile.transmission);
    }
  });
}
