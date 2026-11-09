import { TABLE } from './defaults.ts';
import type { SeatSession } from '../contracts/domain.ts';

export function compareIds(a: string, b: string): number { return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0); }
function validId(id: unknown): id is string { return typeof id === 'string' && /^\d{1,20}$/.test(id); }
export function validateSession(input: unknown): SeatSession {
  const s = input as SeatSession;
  if (!s || s.schemaVersion !== 1 || typeof s.sessionId !== 'string' || !s.sessionId || !validId(s.channelId)) throw new Error('INVALID_SESSION');
  if (!Number.isInteger(s.minSeats) || s.minSeats < 1 || s.minSeats > 32 || !Number.isInteger(s.capacity) || s.capacity < s.minSeats || s.capacity > 32) throw new Error('INVALID_CAPACITY');
  if (!Number.isInteger(s.revision) || s.revision < 0 || !Number.isInteger(s.peakPresentCount) || s.peakPresentCount < 0) throw new Error('INVALID_REVISION');
  if (!Array.isArray(s.reservations) || !Array.isArray(s.waitingUserIds)) throw new Error('INVALID_RESERVATIONS');
  const users = new Set<string>(), seats = new Set<string>(), slots = new Set<number>();
  for (const r of s.reservations) {
    if (!r || !validId(r.userId) || typeof r.seatId !== 'string' || !r.seatId || !Number.isInteger(r.slotIndex) || r.slotIndex < 0 || r.slotIndex >= s.capacity || !Number.isFinite(Date.parse(r.reservedAtUtc))) throw new Error('INVALID_RESERVATION');
    if (users.has(r.userId) || seats.has(r.seatId) || slots.has(r.slotIndex)) throw new Error('DUPLICATE_RESERVATION');
    users.add(r.userId); seats.add(r.seatId); slots.add(r.slotIndex);
  }
  for (const id of s.waitingUserIds) { if (!validId(id) || users.has(id)) throw new Error('INVALID_WAITING_LIST'); users.add(id); }
  const pitch=s.seatPitch??TABLE.seatPitch;
  if(!Number.isFinite(pitch)||pitch<TABLE.seatPitch||pitch>3)throw new Error('INVALID_SEAT_PITCH');
  const moderatorIds=s.moderatorIds??[];
  if(!Array.isArray(moderatorIds)||moderatorIds.length>2||new Set(moderatorIds).size!==moderatorIds.length||moderatorIds.some(id=>!validId(id)||!s.reservations.some(r=>r.userId===id)))throw new Error('INVALID_MODERATORS');
  const moderatorSlots=s.moderatorSlots??(moderatorIds.length?moderatorIds.map(id=>s.reservations.find(r=>r.userId===id)!.slotIndex):[0]);
  if(!Array.isArray(moderatorSlots)||moderatorSlots.length<1||moderatorSlots.length>2||new Set(moderatorSlots).size!==moderatorSlots.length||moderatorSlots.some(i=>!Number.isInteger(i)||i<0||i>=s.capacity))throw new Error('INVALID_MODERATORS');
  const assignedHosts=moderatorSlots.flatMap(slot=>{const r=s.reservations.find(r=>r.slotIndex===slot);return r?[r.userId]:[];});
  const floor=s.straightLengthFloor??0;
  if(!Number.isFinite(floor)||floor<0||floor>100)throw new Error('INVALID_LAYOUT_FLOOR');
  if(s.growthAnchorLength!==undefined&&(!Number.isFinite(s.growthAnchorLength)||s.growthAnchorLength<0||s.growthAnchorLength>100))throw new Error('INVALID_GROWTH_ANCHOR');
  return {...structuredClone(s),seatPitch:pitch,moderatorIds:assignedHosts,moderatorSlots:[...moderatorSlots],straightLengthFloor:floor};
}
export function newSession(channelId: string, sessionId: string, minSeats: number = TABLE.minSeats): SeatSession {
  return validateSession({ schemaVersion: 1, sessionId, channelId, revision: 0, minSeats, capacity: minSeats, peakPresentCount: 0, reservations: [], waitingUserIds: [] });
}
export class SeatAllocator {
  private session: SeatSession;
  private present = new Set<string>();
  constructor(session: SeatSession) { this.session = validateSession(session); }
  clone(): SeatAllocator {const copy=new SeatAllocator(this.session);copy.present=new Set(this.present);return copy;}
  snapshot(): SeatSession { return structuredClone(this.session); }
  expandPitch(pitch:number):boolean{
    if(!Number.isFinite(pitch)||pitch<0||pitch>3)throw new Error('INVALID_SEAT_PITCH');
    if(pitch<=(this.session.seatPitch??TABLE.seatPitch)+1e-9)return false;
    this.session.seatPitch=pitch;this.session.revision++;return true;
  }
  lockGrowthAnchor(length:number):void {
    if(!Number.isFinite(length)||length<0||length>100)throw new Error('INVALID_GROWTH_ANCHOR');
    if(this.session.growthAnchorLength===undefined){this.session.growthAnchorLength=length;this.session.revision++;}
  }
  retainLength(length:number):void {
    if(!Number.isFinite(length)||length<0||length>100)throw new Error('INVALID_LAYOUT_FLOOR');
    if(length>(this.session.straightLengthFloor??0)+1e-8){this.session.straightLengthFloor=length;this.session.revision++;}
  }
  setModerators(ids:readonly string[]):void {
    if(ids.length<1||ids.length>2||new Set(ids).size!==ids.length||ids.some(id=>!this.session.reservations.some(r=>r.userId===id)))throw new Error('INVALID_MODERATORS');
    this.session.moderatorIds=[...ids];this.session.moderatorSlots=ids.map(id=>this.session.reservations.find(r=>r.userId===id)!.slotIndex);this.session.revision++;
  }
  updatePresent(ids: readonly string[], utc: string): { changed: boolean; grew: boolean } {
    if (ids.some(id => !validId(id)) || new Set(ids).size !== ids.length || !Number.isFinite(Date.parse(utc))) throw new Error('INVALID_PARTICIPANTS');
    const before = JSON.stringify(this.session), capacity = this.session.capacity;
    this.present = new Set(ids);
    this.session.peakPresentCount = Math.max(this.session.peakPresentCount, ids.length);
    const assigned = new Set(this.session.reservations.map(r => r.userId));
    // Existing waiting users retain priority; simultaneous new arrivals sort deterministically.
    const waiting = this.session.waitingUserIds.filter(id => this.present.has(id));
    const candidates = [...waiting, ...ids.filter(id => !assigned.has(id) && !waiting.includes(id)).sort(compareIds)];
    this.session.waitingUserIds = [];
    for (const userId of candidates) {
      const occupied = new Set(this.session.reservations.map(r => r.slotIndex));
      let slotIndex = 0;
      while (occupied.has(slotIndex)) slotIndex++;
      if (slotIndex >= TABLE.maxSeats) { this.session.waitingUserIds.push(userId); continue; }
      this.session.capacity = Math.max(this.session.capacity, slotIndex + 1);
      this.session.reservations.push({ userId, seatId: `seat-${slotIndex}`, slotIndex, reservedAtUtc: utc });
    }
    this.refreshModerators();
    const changed = JSON.stringify(this.session) !== before;
    if (changed) this.session.revision++;
    return { changed, grew: this.session.capacity > capacity };
  }
  private refreshModerators():void {
    this.session.moderatorIds=(this.session.moderatorSlots??[0]).flatMap(slot=>{
      const r=this.session.reservations.find(r=>r.slotIndex===slot);return r?[r.userId]:[];
    });
  }
  /** Move to a physical slot; occupied slots swap, including their moderator role. */
  move(userId:string,targetSlot:number):void {
    if(!Number.isInteger(targetSlot)||targetSlot<0||targetSlot>=this.session.capacity)throw new Error('INVALID_SEAT_TARGET');
    const moving=this.session.reservations.find(r=>r.userId===userId);
    if(!moving)throw new Error('RESERVATION_NOT_FOUND');
    if(moving.slotIndex===targetSlot)return;
    const other=this.session.reservations.find(r=>r.slotIndex===targetSlot),old=moving.slotIndex;
    moving.slotIndex=targetSlot;moving.seatId=`seat-${targetSlot}`;
    if(other){other.slotIndex=old;other.seatId=`seat-${old}`;}
    this.refreshModerators();this.session.revision++;
  }
  release(userId: string, currentPresentIds?: readonly string[]): void {
    // Membership updates may still be waiting in the layout debounce window.
    if (currentPresentIds && currentPresentIds.some(id => !validId(id))) throw new Error('INVALID_PARTICIPANTS');
    const currentPresent = currentPresentIds ? new Set(currentPresentIds) : this.present;
    if (currentPresent.has(userId)) throw new Error('CANNOT_RELEASE_PRESENT_USER');
    const index = this.session.reservations.findIndex(r => r.userId === userId);
    if (index < 0) throw new Error('RESERVATION_NOT_FOUND');
    this.session.reservations.splice(index, 1);
    this.refreshModerators();
    this.session.revision++;
  }
}
