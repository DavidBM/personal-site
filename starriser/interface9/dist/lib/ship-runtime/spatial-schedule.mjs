import {CONTACT_QUERY_WORDS} from './contact-queries.mjs';
import {CONTACT_WORDS} from './contact-cache.mjs';
import {HASH_BUCKETS} from './spacing.mjs';
export function spatialStorage(count) {const counter=HASH_BUCKETS+count;return {counter,ranges:count*(2+CONTACT_WORDS+CONTACT_QUERY_WORDS),headWords:counter+1,linkWords:count*(2+CONTACT_WORDS+CONTACT_QUERY_WORDS)+2*HASH_BUCKETS};}
// Reorder GPU invocations, never persistent slots or contact-list order.
// links[0..count) are atomic insertion ranks; links[count..2*count) are work indices.
// Compact neighbor records occupy the remaining CONTACT_WORDS per slot.
// The extra head word after target counts is the schedule allocation counter.
export const SCHEDULE_WGSL=/* wgsl */`
fn scheduleCounter()->u32{return 32768u+u32(u.clock.z);}
fn clearSchedule(index:u32){if(index==0u){atomicStore(&heads[scheduleCounter()],0u);}}
fn contactRange(bucket:u32)->u32{return u32(u.clock.z)*${2+CONTACT_WORDS+CONTACT_QUERY_WORDS}u+bucket*2u;}
fn firstContact(bucket:u32)->u32{return links[contactRange(bucket)];}
@compute @workgroup_size(128) fn scheduleAgents(@builtin(global_invocation_id) gid:vec3<u32>) {
  let count=u32(u.clock.z);
  if(gid.x<32768u) {
    links[contactRange(gid.x)]=0u;links[contactRange(gid.x)+1u]=0u;
    let size=atomicLoad(&heads[gid.x]);
    if(size>0u) {
      let offset=atomicAdd(&heads[scheduleCounter()],size);
      links[contactRange(gid.x)]=offset+1u;links[contactRange(gid.x)+1u]=offset+size;
    }
  }
  // Warp and inactive slots have no contact-list entry but still need their step.
  if(gid.x<count&&!contributes(old[gid.x])) {
    let offset=atomicAdd(&heads[scheduleCounter()],1u);links[count+offset]=gid.x;
  }
}
`;
