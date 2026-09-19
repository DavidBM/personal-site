import {spatialStorage} from './spatial-schedule.mjs';
import {EVENT_POSE_WORDS} from './event-gpu.mjs';
import {CORRECTION_WORDS,CORRECTIONS_PER_POPULATION} from './correction-gpu.mjs';
export function populationCopies(before,after) {
  const a=spatialStorage(before),b=spatialStorage(after);
  const oldDirectory=a.linkWords+before*EVENT_POSE_WORDS,newDirectory=b.linkWords+after*EVENT_POSE_WORDS;
  return [
    ['a',0,0,before*192],['b',0,0,before*192],['history',0,0,before*768],
    ['heads',0,0,a.counter*4],['heads',a.counter*4,b.counter*4,8],
    ['links',a.linkWords*4,b.linkWords*4,before*EVENT_POSE_WORDS*4],
    ['links',oldDirectory*4,newDirectory*4,before*4],
    ['links',(oldDirectory+before)*4,(newDirectory+after)*4,before*CORRECTIONS_PER_POPULATION*CORRECTION_WORDS*4],
  ];
}
