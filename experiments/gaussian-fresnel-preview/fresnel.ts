import type {SparkRenderer,SplatMesh} from '@sparkjsdev/spark';
import {installGaussianSpeechGlow,setGaussianSpeechGlow,clearGaussianSpeechGlow} from '../../src/web/gaussian/speech-glow.ts';
/** Reproduce the approved experiment with the production shader. */
export function installFresnelPreview(spark:SparkRenderer,speakers:Map<SplatMesh,number>){
 const effect=installGaussianSpeechGlow(spark);effect.setMode(0);
 return {...effect,setMode(mode:0|1|2){
  for(const [mesh,strength] of speakers)setGaussianSpeechGlow(mesh,strength);
  effect.setMode(mode);
 },dispose(){for(const mesh of speakers.keys())clearGaussianSpeechGlow(mesh);effect.dispose();}};
}
