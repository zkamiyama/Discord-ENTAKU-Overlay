import {BroadcastSet} from './broadcast-set.ts';
import * as THREE from 'three';
import type {StudioScene} from '../../studio/manifest.ts';
import type {StudioClient} from '../shared/client.ts';
import {loadStudioBundle,disposeObject} from './loader.ts';

/** A candidate owns all resources until it is complete. Only then can it replace
 * the active group. Failed or obsolete candidates never dispose the active one. */
export class StudioVisual {
  readonly root = new THREE.Group();
  private generation = 0;
  private revision = 0;
  private signature = '';
  private disposed = false;
  private loaded: THREE.Group | null = null;
  private broadcast: BroadcastSet | null = null;
  private definition: StudioScene | null = null;
  loading = false;
  error = '';
  authoredLights = 0;

  get renderGeneration(): number {return this.revision;}
  get readyForCamera(): boolean {return this.loaded !== null;}

  constructor(
    private client: StudioClient,
    private renderer: THREE.WebGLRenderer,
    private loadModel: typeof loadStudioBundle = loadStudioBundle,
  ) {}

  async update(definition: StudioScene): Promise<void> {
    if (this.disposed) return;
    const signature = JSON.stringify({...definition,revision:0,exposure:undefined,quality:undefined,post:undefined,direction:undefined});
    if (signature === this.signature) return;
    this.signature = signature;
    const version = ++this.generation, stage = new THREE.Group();
    let broadcast: BroadcastSet | null = null;
    this.loading = true;
    this.error = '';
    try {
      if (definition.broadcast?.enabled) {
        broadcast = new BroadcastSet(definition.broadcast.title,definition.broadcast.subtitle);
        broadcast.position.fromArray(definition.tableAnchor.position);
        broadcast.rotation.y = THREE.MathUtils.degToRad(definition.tableAnchor.yawDeg);
        stage.add(broadcast);
      }
      for (const item of definition.objects) {
        let object: THREE.Object3D;
        if (item.kind === 'model') object = await this.loadModel(this.client,this.renderer,item.bundleId);
        else if (item.kind === 'box') object = new THREE.Mesh(new THREE.BoxGeometry(...item.size),new THREE.MeshStandardMaterial({color:item.color,roughness:.75}));
        else if (item.kind === 'plane') {
          const plane = new THREE.Mesh(new THREE.PlaneGeometry(...item.size),new THREE.MeshStandardMaterial({color:item.color,side:THREE.DoubleSide,roughness:.9}));
          plane.rotation.x = -Math.PI/2;
          object = new THREE.Group();
          object.add(plane);
        } else object = new THREE.PointLight(item.color,item.intensity);
        if ('transform' in item) {
          object.position.fromArray(item.transform.position);
          object.rotation.y = THREE.MathUtils.degToRad(item.transform.yawDeg);
          object.scale.fromArray(item.transform.scale);
        } else object.position.fromArray(item.position);
        object.name = item.id;
        stage.add(object);
        if (version !== this.generation) {disposeObject(stage);return;}
      }
      if (version !== this.generation) {disposeObject(stage);return;}
      let lights = 0;
      stage.traverseVisible(o => {if (o instanceof THREE.Light && o.intensity > 0) lights++;});
      // Publish before releasing the old scene. No asynchronous gap is allowed here.
      const previous = this.loaded;
      this.root.add(stage);
      this.loaded = stage;
      this.broadcast = broadcast;
      this.definition = definition;
      this.authoredLights = lights;
      this.revision++;
      this.root.updateMatrixWorld(true);
      if (previous) disposeObject(previous);
    } catch (error) {
      disposeObject(stage);
      if (version === this.generation) this.error = error instanceof Error ? error.message : 'STUDIO_LOAD_FAILED';
    } finally {
      if (version === this.generation) this.loading = false;
    }
  }

  setLength(length: number, offsetZ = 0): string {
    this.broadcast?.setLength(length,offsetZ);
    const overflow = !!this.definition && length > this.definition.tableEnvelope.maxStraightLength;
    this.root.visible = this.loaded !== null && !(overflow && this.definition?.tableEnvelope.overflow === 'hide-studio');
    return this.error ? 'STUDIO_LOAD_FAILED' : this.loading ? 'STUDIO_LOADING' : overflow ? 'STUDIO_CAPACITY_OVERFLOW' : 'READY';
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    if (this.loaded) disposeObject(this.loaded);
    this.loaded = this.broadcast = null;
    this.definition = null;
    this.loading = false;
    this.authoredLights = 0;
    this.root.removeFromParent();
  }
}
