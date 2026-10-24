// Caller agent: a stand-in for Google Gemini booking a plumber for a homeowner, plus a sales bot.
// It talks to the front desk over plain HTTP + JSON (A2A-style card, x402-style 402 payment steps)
// and pays on Monad testnet. In this demo it signs for both wallets, so it also sends the hold refund;
// in production the hold would sit in an escrow contract.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { balances, configured, pay, requireGas, usdcBalanceOf, wallets } from './chain.js';

const PORT = Number(process.env.AGENT_PORT || 4000);
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  if (req.path.startsWith('/api/')) console.log(req.method, req.path);
  next();
});
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));

const lastPayments = [];
const remember = (p) => { lastPayments.unshift({ ...p, at: new Date().toISOString() }); lastPayments.length = Math.min(lastPayments.length, 10); return p; };
const fail = (res, e, extra = {}) => res.status(500).json({ error: e.shortMessage || e.message, ...extra });

app.get('/api/health', async (req, res) => res.json(await balances()));
app.get('/api/last', (req, res) => res.json(lastPayments));

app.post('/api/deposit/pay', async (req, res) => {
  try {
    const { amountUsd = 1, to = wallets.business?.address, purpose = 'test' } = req.body || {};
    res.json(remember(await pay({ from: 'caller', to, amountUsd, purpose })));
  } catch (e) { fail(res, e); }
});

app.post('/api/refund', async (req, res) => {
  try {
    const { amountUsd = 0.05 } = req.body || {};
    res.json(remember(await pay({ from: 'business', to: wallets.caller.address, amountUsd, purpose: 'refund' })));
  } catch (e) { fail(res, e); }
});

app.post('/api/reset', async (req, res) => {
  try {
    if (!configured()) return res.json({ skipped: 'wallets not configured' });
    const held = await usdcBalanceOf('business');
    if (held < 0.000001) return res.json({ returnedUsd: 0 });
    const p = remember(await pay({ from: 'business', to: wallets.caller.address, amountUsd: held, purpose: 'reset' }));
    res.json({ returnedUsd: held, ...p });
  } catch (e) { fail(res, e); }
});

// ---- the booking agent ----------------------------------------------------------------
async function call(frontDeskUrl, path, { method = 'GET', body, headers = {} } = {}) {
  const r = await fetch(frontDeskUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  let json = null;
  try { json = await r.json(); } catch { /* empty body */ }
  return { status: r.status, json };
}

app.post('/api/caller/run', async (req, res) => {
  const { frontDeskUrl, runId, agentName = 'Google Gemini (demo stand-in)', request: overrides = {} } = req.body || {};
  const t0 = Date.now();
  const steps = [];
  const payments = [];
  const step = (label, json, from = 'agent', to = 'front-desk') => steps.push({ tMs: Date.now() - t0, from, to, label, json });
  const runHeaders = runId ? { 'X-Run-Id': runId } : {};

  try {
    if (!frontDeskUrl) throw new Error('frontDeskUrl is required');
    if (!configured()) throw new Error('Wallets are not configured. Run "npm run wallets" and fund them.');
    await requireGas('caller');
    await requireGas('business');

    const card = await call(frontDeskUrl, '/.well-known/agent-card.json', { headers: runHeaders });
    step('Fetched the front desk’s agent card', card.json, 'front-desk', 'agent');

    const hello = { agent: agentName, on_behalf_of: overrides.customer_name ? `${overrides.customer_name}, homeowner` : 'homeowner, Somerville MA 02144', intent: 'book_service' };
    const h1 = await call(frontDeskUrl, '/a2a/hello', { method: 'POST', body: hello, headers: runHeaders });
    step('Hello: booking a plumber for a homeowner', hello);
    let session = h1.json;
    let hold = null;
    if (h1.status === 402) {
      step('Front desk asks for a refundable hold (402)', h1.json, 'front-desk', 'agent');
      hold = await pay({ from: 'caller', to: h1.json.payment_required.pay_to, amountUsd: h1.json.payment_required.amount_usd, purpose: 'hold' });
      payments.push(remember(hold));
      step('Paid the refundable hold', hold);
      const h2 = await call(frontDeskUrl, '/a2a/hello', { method: 'POST', body: hello, headers: { ...runHeaders, 'X-PAYMENT-TX': hold.hash } });
      if (h2.status !== 200) throw new Error(`Hold not accepted (${h2.status})`);
      session = h2.json;
    } else if (h1.status !== 200) throw new Error(`Unexpected hello response ${h1.status}`);
    step('Session open', session, 'front-desk', 'agent');

    const request = { session_id: session.session_id, issue: overrides.issue || 'kitchen sink leak', zip: overrides.zip || '02144', window: overrides.window || 'today', max_price_usd: 150 };
    const b1 = await call(frontDeskUrl, '/a2a/book', { method: 'POST', body: request, headers: runHeaders });
    step('Service request', request);
    if (b1.status === 200) {
      step('Booking confirmed, no deposit required', b1.json, 'front-desk', 'agent');
      return res.json({ steps, payments, booking: b1.json, totalMs: Date.now() - t0 });
    }
    if (b1.status !== 402) throw new Error(`Expected 402 offer, got ${b1.status}`);
    step('Offer and deposit request (402)', b1.json, 'front-desk', 'agent');

    const fee = b1.json.offer.diagnostic_fee_usd;
    const accept = fee <= request.max_price_usd;
    step(accept ? `Accepted: $${fee} is within the $${request.max_price_usd} budget` : 'Declined: over budget', { accept, fee, budget: request.max_price_usd }, 'agent', 'agent');
    if (!accept) return res.json({ steps, payments, booking: null, totalMs: Date.now() - t0 });

    const deposit = await pay({ from: 'caller', to: b1.json.payment_required.pay_to, amountUsd: b1.json.payment_required.amount_usd, purpose: 'deposit' });
    payments.push(remember(deposit));
    step('Paid the deposit', deposit);

    const b2 = await call(frontDeskUrl, '/a2a/book', { method: 'POST', body: { ...request, accept: true }, headers: { ...runHeaders, 'X-PAYMENT-TX': deposit.hash } });
    if (b2.status !== 200) throw new Error(`Booking not confirmed (${b2.status})`);
    step('Booking confirmed', b2.json, 'front-desk', 'agent');

    if (hold && b2.json.hold_refund) {
      const refund = await pay({ from: 'business', to: wallets.caller.address, amountUsd: b2.json.hold_refund.amount_usd, purpose: 'refund' });
      payments.push(remember(refund));
      step('Hold refunded by the front desk', refund, 'front-desk', 'agent');
    }

    res.json({ steps, payments, booking: b2.json, totalMs: Date.now() - t0 });
  } catch (e) {
    console.error('caller run failed:', e.shortMessage || e.message);
    fail(res, e, { steps, payments, totalMs: Date.now() - t0 });
  }
});

// ---- the sales bot: asks for the owner, refuses to pay the hold ---------------------------
app.post('/api/salesbot/run', async (req, res) => {
  const { frontDeskUrl, runId } = req.body || {};
  const t0 = Date.now();
  try {
    const hello = { agent: 'GrowthLeads outbound agent', on_behalf_of: 'GrowthLeads SEO agency', intent: 'sell_services', pitch: 'Get 3x more leads with our local SEO package' };
    const h = await call(frontDeskUrl, '/a2a/hello', { method: 'POST', body: hello, headers: runId ? { 'X-Run-Id': runId } : {} });
    res.json({ paid: false, status: h.status, decision: 'Hold not paid: outbound sales bots do not pay to reach businesses', totalMs: Date.now() - t0 });
  } catch (e) { fail(res, e); }
});

app.listen(PORT, () => console.log(`Caller agent on http://localhost:${PORT}  (wallets ${configured() ? 'configured' : 'NOT configured'})`));
