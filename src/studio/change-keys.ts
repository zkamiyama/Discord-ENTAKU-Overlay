import type {StudioScene} from './manifest.ts';

/** Invalidation is based on the inputs an owner actually consumes, not a broad
 * settings revision. Keep these definitions shared by domain and browser. */
export function studioVisualKey(scene:StudioScene):string {
 return JSON.stringify([scene.schemaVersion,scene.tableAnchor,scene.tableEnvelope,scene.objects,scene.broadcast]);
}
export function studioCameraKey(scene:StudioScene):string {
 // Structural changes retain the existing safety-wide behavior. Camera-only
 // blocker edits must replan but must not rebuild the visual asset graph.
 return JSON.stringify([studioVisualKey(scene),scene.camera]);
}
