import {pressureDefinition,pressureKey} from './pressure-orders.mjs';
import {eventFrameOverflow} from './event-frame.mjs';
// Preflight before journal consumption. If a burst needs more simultaneous
// fields than the pool, snapshot recovery may collapse missed blend history;
// resource exhaustion must not consume a packet containing authoritative facts.
export function validatePressureBudget(events,pressure) {
  const keys=new Set(pressure.slots.filter(record=>record&&(!record.retiring||pressure.used(record.slot))).map(pressureKey));
  for(const event of events)for(const command of event.commands) {
    if(command.pressure===undefined)continue;
    const {definition}=pressureDefinition(pressure,command.pressure);keys.add(pressureKey(definition));
    if(keys.size>pressure.layout.fields)throw eventFrameOverflow('Pressure field budget exhausted; reconcile current memberships');
  }
}
