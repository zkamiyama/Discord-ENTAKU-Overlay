import * as THREE from 'three';
import { avatarBounds, type AvatarProfile } from '../../assets/avatar-profile.ts';
import { createDistanceField } from '../../assets/alpha-distance.ts';
const vertexShader = `varying vec2 vUv;varying float vWorldY;
void main(){vUv=uv;vWorldY=(modelMatrix*vec4(position,1.)).y;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
/** Textures and field are generated once per asset/configuration, never per speaking event. */
export class CustomAvatarVisual {
  readonly root = new THREE.Group();
  private image: THREE.CanvasTexture;
  private distance: THREE.DataTexture;
  private geometry: THREE.PlaneGeometry;
  private body: THREE.ShaderMaterial;
  private glow: THREE.ShaderMaterial;
  constructor(bitmap: ImageBitmap, readonly profile: AvatarProfile) {
    if (bitmap.width !== profile.image.width || bitmap.height !== profile.image.height) throw new Error('IMAGE_DIMENSIONS_MISMATCH');
    const ratio = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * ratio)), height = Math.max(1, Math.round(bitmap.height * ratio)), pad = 24;
    const canvas = document.createElement('canvas'); canvas.width = width + 2 * pad; canvas.height = height + 2 * pad;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(bitmap, pad, pad, width, height);
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const alpha = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3]!;
    if (!alpha.some(v => v >= 128)) throw new Error('EMPTY_AVATAR_IMAGE');
    const field = createDistanceField(alpha, canvas.width, canvas.height);
    this.image = new THREE.CanvasTexture(canvas); this.image.colorSpace = THREE.SRGBColorSpace;
    this.distance = new THREE.DataTexture(field.data, field.width, field.height, THREE.RedFormat);
    this.distance.flipY = true; this.distance.minFilter = this.distance.magFilter = THREE.LinearFilter;
    this.distance.generateMipmaps = false; this.distance.needsUpdate = true;
    const b = avatarBounds(profile), sx = (b.right - b.left) / width, sy = (b.top - b.bottom) / height;
    this.geometry = new THREE.PlaneGeometry(canvas.width * sx, canvas.height * sy);
    this.geometry.translate((b.left + b.right) / 2, (b.top + b.bottom) / 2, 0);
    this.body = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.image }, opacity: { value: 1 } }, vertexShader,
      fragmentShader: `uniform sampler2D map;uniform float opacity;varying vec2 vUv;varying float vWorldY;
      void main(){vec4 c=texture2D(map,vUv);if(c.a<.1||vWorldY<0.)discard;
      c.rgb*=gl_FrontFacing?1.:.35;gl_FragColor=vec4(c.rgb,c.a*opacity);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`, transparent: true, depthWrite: true, depthTest: true, side: THREE.DoubleSide,
    });
    this.glow = new THREE.ShaderMaterial({
      uniforms: { field: { value: this.distance }, strength: { value: 0 }, spread: { value: field.spread }, resolution: { value: new THREE.Vector2(field.width,field.height) } }, vertexShader,
      fragmentShader: `uniform sampler2D field;uniform float strength;uniform float spread;uniform vec2 resolution;varying vec2 vUv;varying float vWorldY;
      void main(){float d=(texture2D(field,vUv).r-.5)*2.*spread;
      float texelsPerPixel=max(length(dFdx(vUv)*resolution),length(dFdy(vUv)*resolution));
      float pixelDistance=d/max(texelsPerPixel,.02);
      if(pixelDistance < -2. || pixelDistance > 14. || vWorldY<0.)discard;
      float core=1.-smoothstep(1.,2.5,abs(pixelDistance));
      float soft=exp(-pow(max(0.,pixelDistance-1.5),2.)/18.)*.32;
      float alpha=max(core,soft)*strength*(gl_FrontFacing?1.:.55);
      gl_FragColor=vec4(vec3(.20,.95,.35),alpha);
      #include <colorspace_fragment>
      }`, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, toneMapped: false,
    });
    const body = new THREE.Mesh(this.geometry, this.body), glow = new THREE.Mesh(this.geometry, this.glow);
    glow.renderOrder = 1; this.root.add(body, glow);
  }
  update(opacity: number, glow: number): void { this.body.uniforms.opacity!.value = opacity; this.glow.uniforms.strength!.value = glow; }
  dispose(): void {
    this.root.removeFromParent(); this.geometry.dispose(); this.image.dispose(); this.distance.dispose(); this.body.dispose(); this.glow.dispose();
  }
}
