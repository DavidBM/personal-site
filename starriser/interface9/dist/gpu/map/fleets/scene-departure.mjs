/** Presentation-only departure latch. Logical arrival cannot discard a late
 * gate approach. Observes one representative per fleet, never individual ships. */
export function createSceneDepartures() {
  const rows = new Map();
  function captured(row, center, now) {
    const near = center && Math.hypot(center.x-row.plan.exit.x, center.y-row.plan.exit.y, center.z-row.plan.exit.z) <= .004;
    const slow = center && Math.hypot(center.vx??0, center.vy??0, center.vz??0) <= .002;
    if (!near || !slow) { row.readySince = null; return false; }
    row.readySince ??= now;
    return now-row.readySince >= 150;
  }
  function stage(fleet,plan,center) {
    let row=rows.get(fleet.id);
    if (!row) {
      row={generation:fleet.generation,systemId:fleet.systemId,
        fleet:{...fleet},state:fleet.state,plan,deadline:fleet.state.startTime+fleet.state.durationMs,
        waiting:false,launched:0,readySince:null,ready:false,jump:null};
      rows.set(fleet.id,row);
    }
    row.ready=captured(row,center,fleet.nowMs);
    return plan;
  }
  function retainsJourney(row,state) {
    if (!state) return false;
    if (state.state==='jumping') {
      if (state.startNode.solarSystemId===row.systemId) row.jump??=state;
      return row.jump?.startTime===state.startTime;
    }
    return !!row.jump && state.state==='cooldown' && state.node.solarSystemId===row.jump.endNode.solarSystemId;
  }
  function release(row,fleet,plan,outbound) {
    if (!row.launched) {
      row.waiting=false;row.launched=fleet.nowMs;row.warp=outbound(row.jump,row.fleet);
    }
    if (fleet.nowMs<row.launched+row.warp.warpSec*1000) {
      fleet.state=row.jump;return row.warp;
    }
    rows.delete(fleet.id);return plan;
  }
  return {
    resolve(fleet,plan,center,outbound) {
      const id=fleet.id,old=rows.get(id);
      if (old && (old.generation!==fleet.generation || old.systemId!==fleet.systemId)) rows.delete(id);
      if (plan.phase==='stage') return stage(fleet,plan,center);
      const row=rows.get(id);
      if (!row) return plan;
      if (!retainsJourney(row,fleet.state)) {rows.delete(id);return plan;}
      row.ready=captured(row,center,fleet.nowMs);
      if (!row.launched && !row.ready) {
        row.waiting=true;row.lateMs=Math.max(0,fleet.nowMs-row.deadline);
        fleet.state=row.state;return row.plan;
      }
      return release(row,fleet,plan,outbound);
    },
    pending(id) { const row=rows.get(id); return !!row && !row.launched && !row.ready; },
    retained(id) { const row=rows.get(id); return !!row && (row.waiting || row.launched>0); },
    activity(id) { const row=rows.get(id); return row?.waiting ? {action:'Reach departure gate',micro:`${row.lateMs>3000?'Late beyond grace':'Departure grace'} · ${(row.lateMs/1000).toFixed(1)}s`} : null; },
    reconcile(ids) { for (const id of rows.keys()) if (!ids.has(id)) rows.delete(id); },
    clear() { rows.clear(); },
  };
}
