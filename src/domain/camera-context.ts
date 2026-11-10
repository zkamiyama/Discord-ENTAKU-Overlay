import type {AvatarProfile} from '../assets/avatar-profile.ts';
import {avatarEnvelopeBounds,avatarFramingBounds,isGaussianProfile} from '../assets/avatar-profile.ts';
import {gaussianFaceSize} from '../assets/gaussian-profile.ts';
import type {Participant,SeatSession,SeatTransform} from '../contracts/domain.ts';
import type {DeskLayout} from '../geometry/capsule.ts';
import type {AvatarExtent} from './camera-planner.ts';

/** Cached geometry excludes speech and clocks. Rebuild only on membership,
 * seating or profile changes. Cached maps stay private to the engine. */
export class CameraContext {
  private cached?:{seats:Map<string,SeatTransform>;extents:Map<string,AvatarExtent>};
  readonly pairs=new Map<string,boolean>();
  readonly splits=new Map<string,boolean>();
  invalidate():void {this.cached=undefined;this.pairs.clear();this.splits.clear();}
  geometry(session:()=>SeatSession,layout:DeskLayout,participants:ReadonlyMap<string,Participant>,profiles:ReadonlyMap<string,AvatarProfile>){
    if(this.cached)return this.cached;
    const seats=new Map<string,SeatTransform>();
    for(const r of session().reservations){
      if(participants.get(r.userId)?.presence!=='present')continue;
      const seat=layout.seats[r.slotIndex]!,p=profiles.get(r.userId),yaw=seat.baseYawRad;
      seats.set(r.userId,p?{...seat,faceAnchor:[seat.faceAnchor[0]+Math.cos(yaw)*p.offsetX+Math.sin(yaw)*(isGaussianProfile(p)?p.offsetZ:0),seat.faceAnchor[1]+p.offsetY,seat.faceAnchor[2]-Math.sin(yaw)*p.offsetX+Math.cos(yaw)*(isGaussianProfile(p)?p.offsetZ:0)]}:seat);
    }
    const extents=new Map<string,AvatarExtent>();
    for(const [id,p] of profiles){
      const b=avatarFramingBounds(p),body=avatarEnvelopeBounds(p);
      const face=isGaussianProfile(p)?gaussianFaceSize(p):{halfHeight:.14*p.scale,halfWidth:.14*p.scale*(p.faceRect[2]*p.image.width)/(p.faceRect[3]*p.image.height)};
      extents.set(id,{bodyHalfWidth:Math.max(-body.left,body.right),bodyTopY:1.25+p.offsetY+body.top,bodyBottomY:Math.max(0,1.25+p.offsetY+body.bottom),faceHalfHeight:face.halfHeight,faceHalfWidth:face.halfWidth,halfWidth:Math.max(-b.left,b.right)+Math.abs(p.offsetX),topY:1.25+p.offsetY+b.top,bottomY:Math.max(0,1.25+p.offsetY+b.bottom)});
    }
    return this.cached={seats,extents};
  }
  pair(a:string,b:string,compute:()=>boolean):boolean {
    const key=[a,b].sort().join(',');if(!this.pairs.has(key))this.pairs.set(key,compute());return this.pairs.get(key)!;
  }
}
