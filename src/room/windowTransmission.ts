import * as THREE from 'three';

const glazing = new Set(['Blue grey glazing', 'Glazing highlight', 'blueGlass']);
function isGlazing(mesh: THREE.Mesh) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.length > 0 && materials.every(material => glazing.has(material.name));
}

// Solid walls bound the opening. Window occlusion belongs exclusively to the
// aperture mask; ordinary shadow casting would project a floating outer frame.
// Shipping panes remain stylized opaque glass. Other furniture is unaffected.
export function prepareWindowTransmission(root: THREE.Object3D) {
  const owned = new Set<THREE.Material>();
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    node.castShadow = false;
    if (!isGlazing(node)) return;
    const copy = (material: THREE.Material) => { const clone = material.clone(); clone.userData.windowGlass = true;
      const reflection = { value: 0 }; clone.userData.windowReflection = reflection;
      clone.customProgramCacheKey = () => 'window-glass-reflection-v1';
      clone.onBeforeCompile = shader => {
        shader.uniforms.windowReflection = reflection;
        shader.vertexShader = 'varying vec3 windowLocal;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nwindowLocal = position;');
        shader.fragmentShader = 'uniform float windowReflection; varying vec3 windowLocal;\n' + shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float band = abs(sin((windowLocal.x + windowLocal.y * .38) * 2.4));
          float highlight = smoothstep(.78, .98, band);
          float fresnel = pow(1. - abs(dot(normalize(vViewPosition), normal)), 3.);
          totalEmissiveRadiance += vec3(.92, .96, 1.) * windowReflection * (.025 + .14 * highlight) * (.65 + .35 * fresnel);`);
      };
      owned.add(clone); return clone; };
    node.material = Array.isArray(node.material) ? node.material.map(copy) : copy(node.material);
  });
  return () => { owned.forEach(material => material.dispose()); owned.clear(); };
}

interface ApertureTriangle { glass: boolean; points: { u: number; v: number }[] }
export function apertureTriangles(root: THREE.Object3D, center: THREE.Vector3, inward: THREE.Vector3, width: number, height: number, ray: THREE.Vector3): ApertureTriangle[] {
  const incidence = ray.dot(inward);
  if (incidence <= 0) return [];
  const tangent = new THREE.Vector3(inward.z, 0, -inward.x).normalize();
  const triangles: ApertureTriangle[] = [];
  root.updateWorldMatrix(true, true);
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    const positions = node.geometry.getAttribute('position'), index = node.geometry.index;
    if (!positions) return;
    const count = index?.count ?? positions.count;
    for (let i = 0; i < count; i += 3) {
      const points = [0, 1, 2].map(offset => {
        const point = new THREE.Vector3().fromBufferAttribute(positions, index ? index.getX(i + offset) : i + offset).applyMatrix4(node.matrixWorld).sub(center);
        point.addScaledVector(ray, -point.dot(inward) / incidence);
        return { u: .5 + point.dot(tangent) / width, v: .5 + point.y / height };
      });
      triangles.push({ glass: isGlazing(node), points });
    }
  });
  return triangles;
}
