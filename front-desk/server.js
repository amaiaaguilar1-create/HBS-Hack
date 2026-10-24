// Front desk: sorts callers into human / booking agent / sales agent, serves the live-calls
// screen and the owner dashboard, and speaks an A2A-style + x402-style protocol to agents.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { createPublicClient, defineChain, http } from 'viem';
import { business, callbackBy, clock, defaultRules, freshCalls, kpis, newId } from './data.js';
import { llmJSON, provider } from './llm.js';

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const AGENT_URL = (process.env.AGENT_URL || 'http://localhost:4000').replace(/\/$/, '');
const BUSINESS_ADDRESS = process.env.BUSINESS_ADDRESS || '0x0000000000000000000000000000000000000000';
const NETWORK = 'eip155:10143';
const explorerTx = (hash) => `https://testnet.monadvision.com/tx/${hash}`;

const monad = createPublicClient({
  chain: defineChain({ id: 10143, name: 'Monad Testnet', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [process.env.MONAD_RPC || 'https://testnet-rpc.monad.xyz'] } } }),
  transport: http(),
});

// ---- state ---------------------------------------------------------------------------------
let calls = freshCalls();
let rules = defaultRules();
const humanCalls = new Map();   // callId -> { messages, logId, urgent, callbackBy }
const runs = new Map();         // runId -> { kind, t0, events, done, simulated, payments, booking, note }
const sessions = new Map();     // session_id -> { classification, holdTx }

const app = express();
app.use(express.json());
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url)), { setHeaders: (res) => res.set('Cache-Control', 'no-store') }));

// ---- agent run log (what the live screen shows) -------------------------------------------
function emit(run, dir, label, json, extra = {}) {
  if (!run) return;
  run.events.push({ tMs: Date.now() - run.t0, dir, label, json, ...extra });
}
const runFor = (req) => runs.get(req.get('X-Run-Id'));

async function verifyTx(hash) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash || '')) return false;
  try {
    const receipt = await Promise.race([
      monad.getTransactionReceipt({ hash }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    return receipt.status === 'success';
  } catch { return false; }
}

// ---- A2A-style endpoints for calling agents -----------------------------------------------
const agentCard = () => ({
  name: `${business.name} front desk`,
  description: `Books plumbing and HVAC visits. Agents post a $${business.holdUsd.toFixed(2)} refundable USDC hold on Monad; bookings need a $${business.depositUsd} deposit.`,
  version: '0.1.0',
  supportedInterfaces: [{ url: `${PUBLIC_URL}/a2a`, protocolBinding: 'HTTP+JSON', protocolVersion: '1.0' }],
  capabilities: { streaming: false },
  defaultInputModes: ['application/json'],
  defaultOutputModes: ['application/json'],
  skills: [{ id: 'book-visit', name: 'Book a visit', description: 'Quote, hold a slot, collect a deposit', tags: ['booking', 'deposit', 'x402'] }],
});

app.get('/.well-known/agent-card.json', (req, res) => {
  const card = agentCard();
  emit(runFor(req), 'out', 'Served our agent card', card);
  res.json(card);
});

const classify = (body = {}) => (/sell|market|partner|seo|warrant|lead/i.test(`${body.intent} ${body.pitch || ''}`) ? 'sales_agent' : 'booking_agent');

app.post('/a2a/hello', async (req, res) => {
  const run = runFor(req);
  const classification = classify(req.body);
  const tx = req.get('X-PAYMENT-TX');

  if (!tx) {
    emit(run, 'in', classification === 'sales_agent'
      ? `Hello from ${req.body.agent}: “${req.body.pitch || 'sales call'}”`
      : `Hello from ${req.body.agent}, booking for a homeowner`, req.body);
    if (!rules.agentHold) {
      const session_id = newId('S-');
      sessions.set(session_id, { classification });
      const body = { session_id, classification, note: 'Owner rules: no hold required' };
      emit(run, 'out', classification === 'sales_agent' ? 'No hold required: sales bot gets through to the owner' : 'Session open, no hold required', body);
      return res.json(body);
    }
    const body = {
      classification,
      payment_required: { amount_usd: business.holdUsd, purpose: 'refundable_hold', asset: 'USDC', network: NETWORK, pay_to: BUSINESS_ADDRESS },
    };
    emit(run, 'out', `${classification === 'sales_agent' ? 'Sales agent' : 'Booking agent'} · refundable hold required: $${business.holdUsd.toFixed(2)} (HTTP 402)`, body, { status: 402 });
    return res.status(402).json(body);
  }

  const verified = await verifyTx(tx);
  emit(run, 'in', `Hold paid · $${business.holdUsd.toFixed(2)}${verified ? ' · verified on Monad' : ''}`, { tx, explorerUrl: explorerTx(tx), verified }, { txUrl: explorerTx(tx), purpose: 'hold' });
  const session_id = newId('S-');
  sessions.set(session_id, { classification, holdTx: tx });
  const body = { session_id, classification };
  emit(run, 'out', 'Session open', body);
  res.json(body);
});

function offer() {
  return rules.holdForHumans
    ? { slot: business.slots.open, diagnostic_fee_usd: business.visitFeeUsd, policy_note: `${business.slots.held.replace('Today ', '')} is held for human callers by the owner's rules` }
    : { slot: business.slots.held, diagnostic_fee_usd: business.visitFeeUsd };
}

function confirmBooking(run, { depositTx, simulated }) {
  const o = offer();
  const body = { booking_id: 'RPH-1042', slot: o.slot, status: 'confirmed', ...(rules.agentHold ? { hold_refund: { amount_usd: business.holdUsd } } : {}) };
  calls.push({
    id: newId('c'), time: clock(), caller: 'Google Gemini for a homeowner', type: 'booking_agent',
    outcome: `Booked ${o.slot.toLowerCase()}`, visitUsd: business.visitFeeUsd,
    depositUsd: rules.agentDeposit ? business.depositUsd : 0,
    receiptUrl: depositTx && !simulated ? explorerTx(depositTx) : null, live: true,
  });
  emit(run, 'out', `Booking confirmed · ${body.booking_id} · ${o.slot}`, body);
  return body;
}

app.post('/a2a/book', async (req, res) => {
  const run = runFor(req);
  const session = sessions.get(req.body?.session_id);
  if (!session) return res.status(401).json({ error: 'Unknown session. Call /a2a/hello first.' });
  if (session.classification === 'sales_agent') return res.status(403).json({ error: 'Sales agents cannot book.' });
  const tx = req.get('X-PAYMENT-TX');

  if (!tx) {
    emit(run, 'in', `Request: ${req.body.issue} · ${req.body.zip} · ${req.body.window}`, req.body);
    const o = offer();
    if (!rules.agentDeposit) {
      emit(run, 'out', `Offer: ${o.slot} · $${o.diagnostic_fee_usd} visit · no deposit required`, { offer: o });
      return res.json(confirmBooking(run, {}));
    }
    const body = {
      offer: o,
      payment_required: { amount_usd: business.depositUsd, purpose: 'deposit', asset: 'USDC', network: NETWORK, pay_to: BUSINESS_ADDRESS },
    };
    emit(run, 'out', `Offer: ${o.slot} · $${o.diagnostic_fee_usd} visit · $${business.depositUsd} deposit required (HTTP 402)`, body, { status: 402 });
    return res.status(402).json(body);
  }

  const verified = await verifyTx(tx);
  emit(run, 'in', `Deposit paid · $${business.depositUsd}.00${verified ? ' · verified on Monad' : ''}`, { tx, explorerUrl: explorerTx(tx), verified }, { txUrl: explorerTx(tx), purpose: 'deposit' });
  res.json(confirmBooking(run, { depositTx: tx }));
});

// ---- running the demo agents ---------------------------------------------------------------
function newRun(kind) {
  const id = newId('run');
  const run = { id, kind, t0: Date.now(), events: [], done: false, simulated: false, payments: [] };
  runs.set(id, run);
  return run;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Used when the caller-agent service or the chain is unavailable. Clearly labelled as simulated.
async function simulateBooking(run, reason) {
  run.events = [];
  run.t0 = Date.now();
  run.simulated = true;
  run.note = reason;
  const fake = 'simulated';
  const hello = { agent: 'Google Gemini (demo stand-in)', on_behalf_of: 'homeowner, Somerville MA 02144', intent: 'book_service' };
  const steps = [
    [120, 'out', 'Served our agent card', agentCard()],
    [260, 'in', 'Hello from Google Gemini (demo stand-in), booking for a homeowner', hello],
    [380, 'out', `Booking agent · refundable hold required: $${business.holdUsd.toFixed(2)} (HTTP 402)`, { classification: 'booking_agent', payment_required: { amount_usd: business.holdUsd, purpose: 'refundable_hold', asset: 'USDC', network: NETWORK, pay_to: BUSINESS_ADDRESS } }],
    [900, 'in', `Hold paid · $${business.holdUsd.toFixed(2)} (simulated)`, { tx: fake }],
    [1000, 'out', 'Session open', { session_id: 'S-sim', classification: 'booking_agent' }],
    [1150, 'in', 'Request: kitchen sink leak · 02144 · today', { issue: 'kitchen sink leak', zip: '02144', window: 'today', max_price_usd: 150 }],
    [1300, 'out', `Offer: ${offer().slot} · $${business.visitFeeUsd} visit · $${business.depositUsd} deposit required (HTTP 402)`, { offer: offer() }],
    [1950, 'in', `Deposit paid · $${business.depositUsd}.00 (simulated)`, { tx: fake }],
  ];
  for (const [at, dir, label, json] of steps) {
    await wait(Math.max(0, at - (Date.now() - run.t0)));
    emit(run, dir, label, json);
  }
  await wait(150);
  run.booking = confirmBooking(run, { simulated: true });
  await wait(500);
  emit(run, 'out', `Hold refunded · $${business.holdUsd.toFixed(2)} (simulated)`, { tx: fake });
  run.payments = [{ purpose: 'deposit', amountUsd: business.depositUsd, settledMs: 650, simulated: true }];
  run.done = true;
}

app.post('/api/agent/start', (req, res) => {
  const run = newRun('booking');
  res.json({ runId: run.id });
  (async () => {
    try {
      const r = await fetch(`${AGENT_URL}/api/caller/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frontDeskUrl: PUBLIC_URL, runId: run.id }),
        signal: AbortSignal.timeout(25000),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error || `caller agent returned ${r.status}`);
      run.payments = result.payments || [];
      run.booking = result.booking;
      const refund = run.payments.find((p) => p.purpose === 'refund');
      if (refund) emit(run, 'out', `Hold refunded · $${refund.amountUsd.toFixed(2)}`, refund, { txUrl: refund.explorerUrl, purpose: 'refund' });
      run.agentTotalMs = result.totalMs;
      run.done = true;
    } catch (e) {
      console.warn('Live agent run failed, simulating:', e.message);
      await simulateBooking(run, `Live payment unavailable: ${e.message}`);
    }
  })();
});

app.post('/api/salesbot/start', (req, res) => {
  const run = newRun('sales');
  res.json({ runId: run.id });
  const finish = (simulated) => {
    const blocked = rules.agentHold;
    emit(run, 'out', blocked ? 'Blocked: hold not paid · Luis never interrupted' : 'Sales bot reached the owner (hold rule is off)', { blocked });
    calls.push({ id: newId('c'), time: clock(), caller: 'GrowthLeads outbound agent', type: 'sales_agent', outcome: blocked ? 'Blocked: hold not paid' : 'Reached owner (no hold rule)', live: true });
    run.simulated = simulated;
    run.done = true;
  };
  (async () => {
    try {
      const r = await fetch(`${AGENT_URL}/api/salesbot/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frontDeskUrl: PUBLIC_URL, runId: run.id }),
        signal: AbortSignal.timeout(8000),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      await wait(Math.max(0, 700 - (Date.now() - run.t0)));
      if (rules.agentHold) emit(run, 'in', 'Sales agent declined to pay the hold', { decision: result.decision });
      finish(false);
    } catch (e) {
      console.warn('Sales bot service unavailable, simulating:', e.message);
      emit(run, 'in', 'Hello from GrowthLeads outbound agent: “Get 3x more leads with our local SEO package”', { intent: 'sell_services' });
      await wait(200);
      emit(run, 'out', `Sales agent · refundable hold required: $${business.holdUsd.toFixed(2)} (HTTP 402)`, { classification: 'sales_agent' });
      await wait(500);
      finish(true);
    }
  })();
});

app.get('/api/run/:id', (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) return res.status(404).json({ error: 'unknown run' });
  res.json({ ...run, elapsedMs: Date.now() - run.t0 });
});

// ---- human lane ----------------------------------------------------------------------------
const GREETING = `Hi, you've reached Rivera Plumbing. Luis is on a job right now. I'm an automated assistant, and this call is transcribed so he gets your message. What can I pass on to him?`;

const SYSTEM_PROMPT = `You are an automated assistant answering the phone for Rivera Plumbing & Heating in Somerville, MA, while the owner, Luis, is on a job. You already told the caller that you are automated and that the call is transcribed. Your only job with human callers is to take a clear message and promise a callback. Never book appointments, quote prices or diagnose. Speak warmly and plainly, 1-2 short sentences per reply. If water is actively leaking, tell them to turn the valve under the sink clockwise to shut it off. Callback promise: urgent callers (active leak, no heat, elderly, alone, distressed) within 15 minutes; everyone else within 2 hours. Respond ONLY as JSON: {"reply": string, "message": {"name": string or null, "issue": string or null, "urgency": "low" | "normal" | "high", "callback_by": string or null}, "done": boolean}.`;

function scriptedReply(text, call) {
  const t = text.toLowerCase();
  const urgentWords = /alone|78|elderly|worried|scared|flood|no heat|emergency|spreading/.test(t);
  const leak = /leak|water|sink|pipe|drip/.test(t);
  const thanks = /thank|bye|wait for/.test(t);
  if (thanks) return { reply: `You're welcome. Keep that valve closed, and Luis will call you by ${call.callbackBy || callbackBy(call.urgent)}. Take care.`, urgency: call.urgent ? 'high' : 'normal', issue: null, done: true };
  if (urgentWords) return { reply: `You won't be handling this alone. I've marked it urgent, Luis will call you back by ${callbackBy(true)}, and I'm texting you that now.`, urgency: 'high', issue: call.issue || 'Active leak under the kitchen sink', done: false };
  if (leak) return { reply: `I'm sorry, that sounds stressful. Open the cabinet under the sink and turn the valve clockwise until it stops; that shuts the water off. I'll get this to Luis right away.`, urgency: 'normal', issue: 'Active leak under the kitchen sink', done: false };
  return { reply: `Thank you, I've added that to your message for Luis. He'll call you back by ${callbackBy(call.urgent)}.`, urgency: call.urgent ? 'high' : 'normal', issue: null, done: false };
}

app.post('/api/human/start', (req, res) => {
  const callId = newId('h');
  const log = { id: newId('c'), time: clock(), caller: 'Mrs. Alvarez · (617) 555-0142', type: 'human', outcome: 'Luis on a job: assistant taking a message', humanReached: false, live: true };
  calls.push(log);
  humanCalls.set(callId, { messages: [{ role: 'assistant', text: GREETING }], logId: log.id, urgent: false, issue: null });
  res.json({ callId, greeting: GREETING, detection: { type: 'human', confidence: 0.96, reasons: ['no agent card or agent header', 'natural speech patterns'] } });
});

app.post('/api/human/reply', async (req, res) => {
  const call = humanCalls.get(req.body?.callId);
  const text = String(req.body?.text || '').slice(0, 500);
  if (!call || !text) return res.status(400).json({ error: 'callId and text are required' });
  call.messages.push({ role: 'user', text });

  let source = 'scripted';
  let out = null;
  const ai = await llmJSON(SYSTEM_PROMPT, call.messages.slice(1).length ? call.messages : [{ role: 'user', text }]);
  if (ai && typeof ai.reply === 'string' && ['low', 'normal', 'high'].includes(ai.message?.urgency)) {
    out = { reply: ai.reply, urgency: ai.message.urgency, issue: ai.message.issue, done: Boolean(ai.done) };
    source = provider();
  } else {
    out = scriptedReply(text, call);
  }
  call.messages.push({ role: 'assistant', text: out.reply });

  const becameUrgent = out.urgency === 'high' && !call.urgent;
  if (out.issue) call.issue = out.issue;
  if (out.urgency === 'high') call.urgent = true;
  if (becameUrgent || !call.callbackBy) call.callbackBy = callbackBy(call.urgent);

  const log = calls.find((c) => c.id === call.logId);
  if (log) {
    log.callback = { by: call.callbackBy, urgent: call.urgent, status: 'waiting', issue: call.issue || 'Plumbing issue' };
    log.outcome = `Message taken${call.urgent ? ' (URGENT)' : ''}: ${call.issue || 'plumbing issue'}`;
  }

  const cards = {};
  if (call.issue) cards.message = { urgent: call.urgent, text: `Mrs. Alvarez: ${call.issue.toLowerCase()}${call.urgent ? ', 78 and alone' : ''}.` };
  if (call.urgent) {
    cards.sms = `Rivera Plumbing: Luis will call you by ${call.callbackBy}. If water spreads, turn the valve under the sink clockwise.`;
    cards.queue = `Top of Luis's callback list · call back by ${call.callbackBy}`;
  }
  res.json({ reply: out.reply, urgency: out.urgency, callbackBy: call.callbackBy, cards, done: out.done, source });
});

// ---- detection (used for any free-form first utterance) ------------------------------------
app.post('/api/detect', async (req, res) => {
  const { firstUtterance = '', headers = {} } = req.body || {};
  const reasons = [];
  let agent = false;
  if (headers['x-agent-card'] || /agent-card|\.well-known/.test(firstUtterance)) { agent = true; reasons.push('offered an agent card'); }
  if (/automated assistant|calling on behalf of|this call is from google|i'?m an ai/i.test(firstUtterance)) { agent = true; reasons.push('announced it is automated'); }
  if (!agent) return res.json({ type: 'human', confidence: 0.9, reasons: ['no agent signals'] });
  const sales = /offer|services|partnership|seo|warranty|leads|marketing/i.test(firstUtterance);
  const confidence = reasons.length > 1 ? 0.97 : 0.85;
  // Asymmetric errors: a person wrongly sent to a bot is worse than a bot sent to the owner.
  if (confidence < 0.8) return res.json({ type: 'human', confidence, reasons: [...reasons, 'below 0.8: treated as human'] });
  res.json({ type: sales ? 'sales_agent' : 'booking_agent', confidence, reasons: [...reasons, sales ? 'intent: selling' : 'intent: book a service'] });
});

// ---- owner dashboard ---------------------------------------------------------------------
app.get('/api/dashboard', (req, res) => {
  res.json({ business, rules, kpis: kpis(calls), calls: [...calls].reverse(), llm: provider() || 'scripted' });
});

app.post('/api/calls/:id/callback-done', (req, res) => {
  const c = calls.find((x) => x.id === req.params.id);
  if (!c?.callback) return res.status(404).json({ error: 'no callback for that call' });
  c.callback.status = 'done';
  c.humanReached = true;
  c.outcome = c.outcome.replace(/^Message taken/, 'Callback completed');
  res.json({ ok: true });
});

app.post('/api/calls/:id/correct', (req, res) => {
  const c = calls.find((x) => x.id === req.params.id);
  const type = req.body?.type;
  if (!c || !['human', 'booking_agent', 'sales_agent'].includes(type)) return res.status(400).json({ error: 'bad request' });
  if (c.type !== type) { c.correctedFrom = c.correctedFrom || c.type; c.type = type; }
  if (c.correctedFrom === type) delete c.correctedFrom;
  res.json({ ok: true });
});

app.post('/api/rules', (req, res) => {
  for (const k of Object.keys(rules)) if (typeof req.body?.[k] === 'boolean') rules[k] = req.body[k];
  res.json(rules);
});

app.post('/api/reset', (req, res) => {
  calls = freshCalls();
  rules = defaultRules();
  humanCalls.clear(); runs.clear(); sessions.clear();
  fetch(`${AGENT_URL}/api/reset`, { method: 'POST', signal: AbortSignal.timeout(20000) })
    .then((r) => r.json()).then((j) => console.log('wallet reset:', j.returnedUsd ?? j.skipped ?? j.error))
    .catch((e) => console.warn('wallet reset skipped:', e.message));
  res.json({ ok: true });
});

app.get('/api/config', (req, res) => res.json({ llm: provider() || 'scripted', agentUrl: AGENT_URL, business }));

app.listen(PORT, () => console.log(`Front desk on ${PUBLIC_URL}  (LLM: ${provider() || 'scripted replies'})`));
