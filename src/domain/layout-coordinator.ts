import {requiredAvatarPitch,type AvatarProfile} from '../assets/avatar-profile.ts';
import {makeSessionLayout,type DeskLayout} from '../geometry/capsule.ts';
import {TABLE} from './defaults.ts';
import type {SeatAllocator} from './seat-allocator.ts';

/** Growth is monotonic and locks the original moderator end. Kept independent of
 * transport clocks and camera safety so every change can use the same rules. */
export function updateSeatLayout(allocator:SeatAllocator,present:readonly string[],profiles:ReadonlyMap<string,AvatarProfile>,utc:string):DeskLayout {
 const saved=allocator.snapshot();
 if(saved.reservations.length)allocator.lockGrowthAnchor(makeSessionLayout(saved).straightLength);
 allocator.updatePresent(present,utc);
 const pitch=Math.max(TABLE.seatPitch,...allocator.snapshot().reservations.map(r=>{const p=profiles.get(r.userId);return p?requiredAvatarPitch(p):TABLE.seatPitch;}));
 allocator.expandPitch(pitch);
 const next=makeSessionLayout(allocator.snapshot());
 if(allocator.snapshot().reservations.length)allocator.lockGrowthAnchor(next.straightLength);
 allocator.retainLength(next.straightLength);
 return next;
}
