import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { StudioSet } from '../../shared/studio';
import { studioSetAsset } from './studioSet';

/**
 * Loads one of the studio sets and fits it to the cafe's furniture scale, as #582's first version did: desks raised to a
 * seated host's height with their props lifted along, monitors spread apart. The root sits at the set's origin in the room.
 */
export async function studioSetVisual(set: StudioSet) {
  const response = await fetch(studioSetAsset(set.preset));
  if (!response.ok) throw new Error('The studio set could not be loaded.');
  const root = (await new GLTFLoader().parseAsync(await response.arrayBuffer(), '')).scene;
  const node = (name: string) => {
    const object = root.getObjectByName(name);
    if (!object) throw new Error(`The studio set is missing ${name}.`);
    return object;
  };
  const desk = (name: string, top: number, props: string[]) => {
    const object = node(name), before = new THREE.Box3().setFromObject(object, true);
    object.scale.y *= (top - .2225) / (before.max.y - before.min.y);
    object.updateMatrixWorld(true);
    object.position.y += .2225 - new THREE.Box3().setFromObject(object, true).min.y;
    for (const name of props) node(name).position.y += top - before.max.y;
  };
  if (set.preset === 'presenter') {
    desk('host_desk', 1.1, ['host_monitor', 'host_desktop_microphone', 'host_coffee_mug', 'host_desk_plant']);
    node('host_monitor').position.x = -.82; node('host_monitor').position.z = .06;
    node('host_desk_plant').position.z = -.23;
  } else if (set.preset === 'gaming') {
    desk('gaming_desk', 1.1, ['gaming_dual_monitor_arm', 'gaming_monitor_left', 'gaming_monitor_right', 'gaming_boom_microphone', 'gaming_keyboard', 'gaming_mouse', 'gaming_streamdeck', 'gaming_headphone_stand', 'gaming_mug']);
    // The monitors sit off to the side, turned toward the host, so they never cover the host from the front camera.
    const workstation = new THREE.Group(); root.add(workstation);
    for (const name of ['gaming_dual_monitor_arm', 'gaming_monitor_left', 'gaming_monitor_right']) workstation.attach(node(name));
    workstation.scale.setScalar(.6); workstation.rotation.y = Math.PI / 3; workstation.position.set(-1.15, 1.1 * .4, 0);
  } else {
    const props = ['course_laptop', 'course_gooseneck_microphone', 'course_tea_cup'];
    desk('course_lectern', 1.05, props);
    for (const name of ['course_lectern', ...props]) { node(name).position.x -= 1; node(name).position.z += .25; }
    node('course_laptop').position.x -= .4;
    node('course_softbox').position.x -= .55; node('course_softbox').position.z += .45;
  }
  root.position.set(set.x, 0, set.z);
  root.updateMatrixWorld(true);
  root.traverse(object => { if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; } });
  return {
    root,
    dispose() {
      root.removeFromParent();
      const materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
      root.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        for (const material of [object.material].flat()) {
          materials.add(material);
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        }
      });
      materials.forEach(material => material.dispose()); textures.forEach(texture => texture.dispose());
    },
  };
}
