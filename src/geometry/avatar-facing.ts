import {MathUtils} from 'three';
/** Stateless facing: no easing/history and no spin towards a camera behind a seat. */
export function avatarFacingYaw(baseYaw:number,dx:number,dz:number):number {
 if(![baseYaw,dx,dz].every(Number.isFinite))throw new RangeError('INVALID_AVATAR_FACING');
 if(Math.hypot(dx,dz)<1e-8)return baseYaw;
 const angle=Math.atan2(dx,dz)-baseYaw;
 const delta=Math.atan2(Math.sin(angle),Math.cos(angle)),front=Math.cos(delta);
 return baseYaw+(front>0?MathUtils.clamp(delta,-Math.PI/6,Math.PI/6)*MathUtils.smoothstep(front,0,.25):0);
}
