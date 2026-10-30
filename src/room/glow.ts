import * as THREE from 'three';

export type GlowTone = 'ok' | 'blocked' | 'hover';
const tones: Record<GlowTone, { color: string; strength: number; pulse: boolean }> = {
  ok: { color: '#ffb43c', strength: 1, pulse: true },
  blocked: { color: '#ff5a46', strength: 1, pulse: true },
  hover: { color: '#ffcf70', strength: .65, pulse: false },
};
const shells = [{ width: .05, alpha: .9 }];
const vertexShader = 'uniform float width;\nvoid main() {\n  vec4 p = modelViewMatrix * vec4(position, 1.);\n  p.xyz += normalize(normalMatrix * normal) * width;\n  gl_Position = projectionMatrix * p;\n}';
const fragmentShader = 'uniform vec3 color;\nuniform float alpha;\nvoid main() {\n  gl_FragColor = vec4(color, alpha);\n  #include <colorspace_fragment>\n}';

export function glowLayer() {
  const lit = new Map<THREE.Object3D, { tone: GlowTone; materials: THREE.Material[]; shells: THREE.Mesh[] }>();
  function attach(node: THREE.Object3D, tone: GlowTone) {
    const materials = shells.map(shell => new THREE.ShaderMaterial({ uniforms: { color: { value: new THREE.Color(tones[tone].color) }, alpha: { value: shell.alpha }, width: { value: shell.width } }, vertexShader, fragmentShader, side: THREE.BackSide, transparent: true, depthWrite: false,
      stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp }));
    const mask = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp });
    const meshes: THREE.Mesh[] = [];
    node.traverse(part => { if (part instanceof THREE.Mesh && !Array.isArray(part.material) && !part.material.transparent) meshes.push(part); });
    const added = meshes.flatMap(mesh => [mask, ...materials].map(material => {
      const shell = new THREE.Mesh(mesh.geometry, material); shell.raycast = () => {}; shell.castShadow = false; shell.renderOrder = material === mask ? 1 : 2; mesh.add(shell); return shell;
    }));
    lit.set(node, { tone, materials: [...materials, mask], shells: added });
  }
  function detach(node: THREE.Object3D) {
    const entry = lit.get(node); if (!entry) return;
    entry.shells.forEach(shell => shell.removeFromParent()); entry.materials.forEach(material => material.dispose()); lit.delete(node);
  }
  return {
    invalidate: detach,
    set(targets: Map<THREE.Object3D, GlowTone>) {
      for (const node of [...lit.keys()]) if (!targets.has(node)) detach(node);
      for (const [node, tone] of targets) {
        const entry = lit.get(node);
        if (!entry) attach(node, tone);
        else if (entry.tone !== tone) { entry.tone = tone; entry.materials.forEach(material => { if (material instanceof THREE.ShaderMaterial) material.uniforms.color.value.set(tones[tone].color); }); }
      }
    },
    tick(time: number, calm: boolean) {
      for (const { tone, materials } of lit.values()) {
        const { strength, pulse } = tones[tone]; const wave = pulse && !calm ? (Math.sin(time / 320) + 1) / 2 : 1;
        materials.forEach((material, k) => {
          if (!(material instanceof THREE.ShaderMaterial)) return;
          material.uniforms.alpha.value = shells[k].alpha * strength * (.7 + .3 * wave);
          material.uniforms.width.value = shells[k].width * (.8 + .2 * wave);
        });
      }
    },
    dispose() { for (const node of [...lit.keys()]) detach(node); },
  };
}
