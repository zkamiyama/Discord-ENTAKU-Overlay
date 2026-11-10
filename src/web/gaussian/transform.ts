import * as THREE from 'three';
import type { GaussianAxis, GaussianAvatarManifest, GaussianAvatarProfile } from '../../assets/gaussian-profile.ts';

function axis(value: GaussianAxis): THREE.Vector3 {
  const vector = new THREE.Vector3();
  vector.setComponent(value[1] === 'X' ? 0 : value[1] === 'Y' ? 1 : 2, value[0] === '-' ? -1 : 1);
  return vector;
}
/** source -> canonical metres. Bounds/anchors in the manifest are already canonical. */
export function gaussianNormalization(manifest: GaussianAvatarManifest): THREE.Matrix4 {
  const up = axis(manifest.coordinates.up), forward = axis(manifest.coordinates.forward);
  const right = new THREE.Vector3().crossVectors(up, forward);
  const axes = new THREE.Matrix4().makeBasis(right, up, forward).transpose();
  const units = manifest.coordinates.units === 'cm' ? .01 : manifest.coordinates.units === 'mm' ? .001 : 1;
  const n = manifest.normalization;
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...n.rotation, 'XYZ'));
  return new THREE.Matrix4().compose(new THREE.Vector3().fromArray(n.translation), rotation, new THREE.Vector3().setScalar(n.scale * units)).multiply(axes);
}
/** Local origin is exactly the face anchor, before seat and user offsets. */
export function gaussianLocalTransform(profile: GaussianAvatarProfile): THREE.Matrix4 {
  const anchor = new THREE.Vector3().fromArray(profile.manifest.faceAnchor).negate();
  return new THREE.Matrix4().makeRotationY(profile.yawRad)
    .multiply(new THREE.Matrix4().makeScale(profile.scale, profile.scale, profile.scale))
    .multiply(new THREE.Matrix4().makeTranslation(anchor))
    .multiply(gaussianNormalization(profile.manifest));
}
