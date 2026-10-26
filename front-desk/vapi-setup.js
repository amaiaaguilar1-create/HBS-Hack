// Creates (or updates) the Vapi assistant and phone number for the front desk.
// Run after the tunnel is up: `npm run phone`. Safe to re-run when the tunnel URL changes.
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const envPath = new URL('../.env', import.meta.url);
const KEY = process.env.VAPI_PRIVATE_API_KEY || process.env.VAPI_API_KEY;
if (!KEY) { console.error('Add VAPI_PRIVATE_API_KEY to .env first.'); process.exit(1); }

const digits = String(process.env.OWNER_PHONE || process.env.GOOGLE_VOICE_PHONE_NUMBER || '').replace(/\D/g, '');
if (digits.length < 10) { console.error('Add OWNER_PHONE (the phone that rings as Luis) to .env.'); process.exit(1); }
const OWNER = `+${digits.length === 10 ? `1${digits}` : digits}`;

async function publicUrl() {
  if (process.env.TUNNEL_URL) return process.env.TUNNEL_URL.replace(/\/$/, '');
  const r = await fetch('http://localhost:3901/quicktunnel').then((x) => x.json()).catch(() => null);
  if (!r?.hostname) { console.error('No tunnel found. Start it first, or set TUNNEL_URL in .env.'); process.exit(1); }
  return `https://${r.hostname}`;
}

async function vapi(method, path, body) {
  const r = await fetch(`https://api.vapi.ai${path}`, {
    method, headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(json.message || json)}`);
  return json;
}

function saveEnv(pairs) {
  let env = readFileSync(envPath, 'utf8');
  for (const [k, v] of Object.entries(pairs)) {
    const line = `${k}=${v}`;
    env = new RegExp(`^${k}=.*$`, 'm').test(env) ? env.replace(new RegExp(`^${k}=.*$`, 'm'), line) : `${env.replace(/\n?$/, '\n')}${line}\n`;
  }
  writeFileSync(envPath, env);
}

const PROMPT = `You are the automated front desk for Rivera Plumbing & Heating in Somerville, Massachusetts. You already greeted the caller and said you are automated and that the call may be transcribed. Decide from the caller's first words who is calling, then act right away:

1. A PERSON (the default; if you are unsure, treat them as a person): call report_caller with type "human", say only "Let me get you to Luis right now.", then call transferCall. Do not ask questions or take details first. People always reach a person.

2. An AI AGENT or automated assistant booking a service for someone (it says it is an AI, an assistant, Muse, Gemini, or calling on behalf of a customer): call report_caller with type "booking_agent", say "You've reached our agent fast lane.", call get_quote with the problem, tell it the slot and price, and when it confirms, call book_visit. Read back the booking number, thank it, and call endCall.

3. A SALES or marketing bot (selling SEO, leads, warranties, partnerships): call report_caller with type "sales_agent", say "This line doesn't take sales calls. Goodbye.", and call endCall.

Keep every reply to one short sentence.`;

const url = await publicUrl();
let secret = process.env.VAPI_WEBHOOK_SECRET;
if (!secret) {
  secret = randomBytes(24).toString('hex');
  saveEnv({ VAPI_WEBHOOK_SECRET: secret });
  console.log('Created VAPI_WEBHOOK_SECRET in .env. Add the same value as a secret where the app is deployed.');
}
const webhook = `${url}/vapi/webhook/${secret}`;
const fn = (name, description, properties, required = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
  server: { url: webhook },
});

const assistant = {
  name: 'Rivera Plumbing front desk',
  firstMessage: 'Rivera Plumbing. I’m an automated assistant, and this call may be transcribed. How can I help?',
  firstMessageMode: 'assistant-speaks-first',
  model: {
    provider: 'openai',
    model: 'gpt-4o',
    messages: [{ role: 'system', content: PROMPT }],
    tools: [
      { type: 'transferCall', destinations: [{ type: 'number', number: OWNER, message: 'Connecting you to Luis now.', description: 'Luis Rivera, the owner. Every human caller goes here.' }] },
      { type: 'endCall' },
      fn('report_caller', 'Record who is calling. Call this first, before anything else.', {
        type: { type: 'string', enum: ['human', 'booking_agent', 'sales_agent'] },
        summary: { type: 'string', description: 'One line on why' },
      }, ['type']),
      fn('get_quote', 'Get the price and earliest slot for a plumbing problem (AI agents only).', {
        issue: { type: 'string' }, zip: { type: 'string' }, when: { type: 'string' }, agent_name: { type: 'string' },
      }, ['issue']),
      fn('book_visit', 'Book the quoted slot after the agent confirms; pays the hold and deposit (AI agents only).', {
        issue: { type: 'string' }, customer_name: { type: 'string' }, agent_name: { type: 'string' },
      }, ['issue']),
    ],
  },
  voice: { provider: 'vapi', voiceId: 'Elliot' },
  server: { url: webhook },
  serverMessages: ['status-update', 'tool-calls', 'transcript', 'end-of-call-report', 'transfer-destination-request'],
  maxDurationSeconds: 300,
};

let assistantId = process.env.VAPI_ASSISTANT_ID;
if (assistantId) {
  await vapi('PATCH', `/assistant/${assistantId}`, assistant);
  console.log('Updated assistant');
} else {
  assistantId = (await vapi('POST', '/assistant', assistant)).id;
  saveEnv({ VAPI_ASSISTANT_ID: assistantId });
  console.log('Created assistant');
}

let number = process.env.VAPI_PHONE_NUMBER;
if (process.env.VAPI_PHONE_NUMBER_ID) {
  await vapi('PATCH', `/phone-number/${process.env.VAPI_PHONE_NUMBER_ID}`, { assistantId, server: { url: webhook } });
  console.log('Updated phone number');
} else {
  let created = null;
  for (const area of ['617', '857', '781', '339', '508']) {
    try {
      created = await vapi('POST', '/phone-number', { provider: 'vapi', assistantId, name: 'Rivera Plumbing', numberDesiredAreaCode: area, server: { url: webhook } });
      break;
    } catch (e) { console.warn(`Area code ${area} unavailable: ${e.message}`); }
  }
  if (!created) { console.error('Could not create a phone number.'); process.exit(1); }
  number = created.number || created.sipUri || '(provisioning, check the Vapi dashboard)';
  saveEnv({ VAPI_PHONE_NUMBER_ID: created.id, VAPI_PHONE_NUMBER: number });
}

console.log(`\nRivera Plumbing line: ${number}`);
console.log(`People are transferred to the owner phone ending in ${OWNER.slice(-4)}.`);
console.log(`Webhook: ${url}/vapi/webhook/<secret>`);
