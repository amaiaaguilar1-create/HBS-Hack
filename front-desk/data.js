// In-memory business data: the demo plumber, the owner's rules and today's call log.
export const business = {
  name: 'Rivera Plumbing & Heating',
  city: 'Somerville, MA',
  owner: 'Luis Rivera',
  visitFeeUsd: 89,
  depositUsd: 15,
  holdUsd: 0.05,
  slots: { held: 'Today 2:00 PM', open: 'Today 4:00 PM' },
};

export const defaultRules = () => ({
  holdForHumans: true,   // keep same-day slots for people who call
  agentHold: true,       // every agent posts a $0.05 refundable hold
  agentDeposit: true,    // agents pay a $15 deposit to hold a slot
});

const seed = [
  { time: '8:02 AM', caller: 'Mr. Chen', type: 'human', outcome: 'Talked to Luis', humanReached: true },
  { time: '8:40 AM', caller: 'ChatGPT agent for J. Park', type: 'booking_agent', outcome: 'Booked tomorrow 9:00 AM', depositUsd: 15, visitUsd: 89 },
  { time: '9:15 AM', caller: 'SEO agency bot', type: 'sales_agent', outcome: 'Blocked' },
  { time: '9:31 AM', caller: 'Dana Whitfield (landlord)', type: 'human', outcome: 'Callback completed', humanReached: true, callback: { by: '9:45 AM', urgent: false, status: 'done' } },
  { time: '10:05 AM', caller: 'Google AI for a homeowner', type: 'booking_agent', outcome: 'Booked tomorrow 11:30 AM', depositUsd: 15, visitUsd: 89 },
  { time: '10:22 AM', caller: 'Extended warranty bot', type: 'sales_agent', outcome: 'Blocked' },
  { time: '10:48 AM', caller: 'Unknown caller', type: 'human', correctedFrom: 'booking_agent', outcome: 'Called back', humanReached: true, callback: { by: '11:00 AM', urgent: false, status: 'done' } },
  { time: '11:30 AM', caller: 'Mr. Okafor', type: 'human', outcome: 'Message: water heater pilot light', humanReached: false, callback: { by: '1:30 PM', urgent: false, status: 'waiting' } },
  { time: '11:52 AM', caller: 'Perplexity agent for R. Diaz', type: 'booking_agent', outcome: 'Quote only' },
  { time: '12:10 PM', caller: 'Lead-gen bot', type: 'sales_agent', outcome: 'Blocked' },
];

let nextId = 1;
export const freshCalls = () => seed.map((c) => ({ id: `c${nextId++}`, ...structuredClone(c) }));
export const newId = (prefix) => `${prefix}${nextId++}`;

const TZ = 'America/New_York';
export const clock = (date = new Date()) =>
  date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });

// Urgent callers: now + 15 minutes, rounded up to the next 5 minutes. Others: within 2 hours.
export function callbackBy(urgent) {
  const d = new Date(Date.now() + (urgent ? 15 : 120) * 60000);
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5);
  return clock(d);
}

export function kpis(calls) {
  const humans = calls.filter((c) => c.type === 'human');
  const agents = calls.filter((c) => c.type === 'booking_agent');
  const spam = calls.filter((c) => c.type === 'sales_agent');
  const handledHumans = humans.filter((c) => c.callback).length;
  return {
    humansReached: { reached: humans.filter((c) => c.humanReached).length, total: humans.length },
    callbacksWaiting: humans.filter((c) => c.callback?.status === 'waiting').length,
    agentBookingsUsd: agents.reduce((s, c) => s + (c.visitUsd || 0), 0),
    agentBookings: agents.filter((c) => c.visitUsd).length,
    depositsUsd: agents.reduce((s, c) => s + (c.depositUsd || 0), 0),
    spamBlocked: spam.length,
    misclassified: { count: calls.filter((c) => c.correctedFrom).length, total: calls.length },
    hoursSaved: Math.round(((agents.length + spam.length) * 3.6 + handledHumans * 4) / 6) / 10,
  };
}
