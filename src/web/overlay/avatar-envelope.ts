import {MathUtils} from 'three';
import type {Participant} from '../../contracts/domain.ts';

/** A single visual envelope drives image, Gaussian and linked mesh bodies.
 * Damping is analytic: a slow frame or a suspended tab consumes the full
 * elapsed time, without a fixed-step catch-up loop or a frame-rate-dependent fade.
 */
export class AvatarEnvelope {
 opacity=0;
 glow=0;
 intensity=0;

 update(user:Pick<Participant,'presence'|'speaking'>,elapsedSeconds:number,timeMs:number,connected:boolean):void {
  const dt=Number.isFinite(elapsedSeconds)?Math.max(0,elapsedSeconds):0;
  const presence=user.presence==='present'?1:user.presence==='stale'?.45:0;
  this.opacity=MathUtils.damp(this.opacity,presence,1/.2,dt);
  const speaking=connected&&user.presence==='present'&&user.speaking==='active';
  this.glow=MathUtils.damp(this.glow,speaking?1:0,1/(speaking?.06:.18),dt);
  if(!speaking&&this.glow<.001)this.glow=0;
  const pulse=.875+.125*Math.sin(timeMs*Math.PI*.004);
  this.intensity=this.glow*this.opacity*pulse;
 }
}
