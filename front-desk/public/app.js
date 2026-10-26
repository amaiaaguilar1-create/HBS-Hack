// Live calls screen + owner dashboard. Plain JS, no build step.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => r.json());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- branding --------------------------------------------------------------------------
(function applyBrand() {
  const b = window.BRAND || {};
  const map = { bg: '--bg', surface: '--surface', line: '--line', fg: '--fg', muted: '--muted', human: '--human', humanSoft: '--human-soft', agent: '--agent', agentSoft: '--agent-soft', spam: '--spam', ok: '--ok', paper: '--paper', ink: '--ink', inkMuted: '--ink-muted', humanInk: '--human-ink', agentInk: '--agent-ink' };
  for (const [k, v] of Object.entries(b.colors || {})) if (map[k]) document.documentElement.style.setProperty(map[k], v);
  $('brandName').textContent = b.name || 'Front desk';
  $('brandTagline').textContent = b.tagline || '';
  document.title = `${b.name || 'Front desk'} · Live calls`;
})();

// ---- views -----------------------------------------------------------------------------
function showView() {
  const view = ({ '#dashboard': 'dashboard', '#live': 'live' })[location.hash] || 'stage';
  for (const v of ['stage', 'live', 'dashboard']) $(v).hidden = v !== view;
  document.body.classList.toggle('on-dash', view === 'dashboard');
  document.body.classList.toggle('on-stage', view === 'stage');
  $('tabStage').classList.toggle('active', view === 'stage');
  $('tabLive').classList.toggle('active', view === 'live');
  $('tabDash').classList.toggle('active', view === 'dashboard');
  if (view === 'dashboard') loadDashboard();
}
window.addEventListener('hashchange', showView);

// ---- voice -----------------------------------------------------------------------------
let voiceOn = true;
let voice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices();
  voice = vs.find((v) => v.name === 'Google US English') || vs.find((v) => v.name === 'Samantha') || vs.find((v) => v.lang === 'en-US') || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.addEventListener('voiceschanged', pickVoice); }
function speak(text) {
  if (!voiceOn || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  u.rate = 1.05;
  speechSynthesis.speak(u);
}
$('speakBtn').onclick = () => {
  voiceOn = !voiceOn;
  $('speakBtn').setAttribute('aria-pressed', String(voiceOn));
  $('speakBtn').textContent = voiceOn ? '🔊 Voice on' : '🔇 Voice off';
  if (!voiceOn && 'speechSynthesis' in window) speechSynthesis.cancel();
};

// ---- human lane ------------------------------------------------------------------------
const LINES = [
  "Hi, there's water coming out from under my kitchen sink and I don't know what to do.",
  "I'm 78 and I live alone, I'm really worried. Can someone come today?",
  "Thank you, dear. I'll wait for his call.",
];
let human = null;   // { callId, started, timer, busy }

function bubble(who, text, extra = '') {
  const el = document.createElement('div');
  el.className = `bubble ${who} ${extra}`;
  el.innerHTML = `<small>${who === 'desk' ? 'Assistant' : 'Mrs. Alvarez'}</small>${esc(text)}`;
  $('transcript').appendChild(el);
  $('transcript').scrollTop = $('transcript').scrollHeight;
  return el;
}

function setCards(cards) {
  const box = $('humanCards');
  const add = (key, title, text, cls = '') => {
    if (!text || box.querySelector(`[data-k="${key}"]`)) return;
    const el = document.createElement('div');
    el.className = `card ${cls}`;
    el.dataset.k = key;
    el.innerHTML = `<b>${esc(title)}</b>${esc(text)}`;
    box.appendChild(el);
  };
  if (cards.message) {
    const existing = box.querySelector('[data-k="message"]');
    if (existing && cards.message.urgent && !existing.classList.contains('urgent')) existing.remove();
    add('message', cards.message.urgent ? 'Message for Luis · URGENT' : 'Message for Luis', cards.message.text, cards.message.urgent ? 'urgent' : '');
  }
  add('sms', 'Text sent to caller', cards.sms);
  add('queue', 'Owner’s callback list', cards.queue, 'urgent');
  box.scrollTop = box.scrollHeight;
}

async function startHuman() {
  if (human) return;
  $('humanBtn').disabled = true;
  $('humanEmpty').hidden = true;
  $('humanCard').hidden = false;
  $('transcript').innerHTML = '';
  $('humanCards').innerHTML = '';
  const started = Date.now();
  human = { started, busy: true, timer: setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    $('humanTimer').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 250) };
  const res = await post('/api/human/start');
  human.callId = res.callId;
  $('humanBadge').textContent = `Human caller · ${res.detection.confidence.toFixed(2)}`;
  $('humanBadge').title = res.detection.reasons.join(', ');
  $('humanStatus').textContent = 'Ringing Luis…';
  await wait(2000);
  $('humanStatus').textContent = 'Luis is on a job, no answer. Assistant is taking a message.';
  bubble('desk', res.greeting);
  speak(res.greeting);
  $('suggest').hidden = false;
  human.busy = false;
}

async function say(text) {
  if (!human || human.busy || !human.callId || !text) return;
  human.busy = true;
  bubble('caller', text);
  const typing = bubble('desk', '…', 'typing');
  const res = await post('/api/human/reply', { callId: human.callId, text });
  typing.remove();
  bubble('desk', res.reply);
  speak(res.reply);
  setCards(res.cards || {});
  if (res.callbackBy) $('humanStatus').textContent = `Callback promised by ${res.callbackBy}${res.urgency === 'high' ? ' · urgent' : ''}`;
  human.busy = false;
}
$('humanBtn').onclick = startHuman;
$('suggest').addEventListener('click', (e) => { const b = e.target.closest('button[data-line]'); if (b) say(LINES[Number(b.dataset.line)]); });
$('freeForm').onsubmit = (e) => { e.preventDefault(); const v = $('freeText').value.trim(); $('freeText').value = ''; say(v); };

// ---- agent lane ------------------------------------------------------------------------
let agentRun = null;

function renderEvent(list, ev, kind) {
  const li = document.createElement('li');
  li.className = `ev ${ev.dir}${ev.txUrl ? ' pay' : ''}`;
  const dir = ev.dir === 'in' ? (kind === 'sales' ? 'Bot → Front desk' : 'Agent → Front desk') : 'Front desk → Agent';
  const label = ev.txUrl ? `${esc(ev.label)} · <a href="${esc(ev.txUrl)}" target="_blank" rel="noopener">tx ↗</a>` : esc(ev.label);
  li.innerHTML = `<span class="t">${(ev.tMs / 1000).toFixed(2)}s</span><div><div class="dir">${dir}</div><div class="label">${label}</div></div>` +
    (ev.json ? `<details><summary>JSON</summary><pre>${esc(JSON.stringify(ev.json, null, 2))}</pre></details>` : '');
  list.appendChild(li);
  list.scrollTop = list.scrollHeight;
}

function showReceipt(run) {
  const r = $('receipt');
  const evs = run.events;
  const lastT = evs.length ? evs[evs.length - 1].tMs : 0;
  const deposit = run.payments.find((p) => p.purpose === 'deposit');
  const link = (purpose, text) => { const e = evs.find((x) => x.purpose === purpose && x.txUrl); return e ? `<a href="${esc(e.txUrl)}" target="_blank" rel="noopener">${text} ↗</a>` : ''; };
  const settled = deposit?.settledMs ? `${(deposit.settledMs / 1000).toFixed(1)} s` : '–';
  const asset = deposit?.asset === 'MON' ? 'MON (test USDC unavailable)' : 'USDC on Monad';
  r.innerHTML = `
    <div><div class="head">Paid</div><div class="sub">${settled} · ${asset} · no card fees</div></div>
    <div class="amount">$15.00</div>
    <div class="links">${link('deposit', 'View on-chain receipt')}${link('hold', 'Hold tx')}${link('refund', 'Refund tx')}</div>
    ${run.simulated ? '<div class="sim">Simulated payment</div>' : ''}`;
  r.hidden = false;
  $('agentTimer').textContent = `${(lastT / 1000).toFixed(1)} s`;
}

async function startAgent() {
  if (agentRun) return;
  $('agentBtn').disabled = true;
  $('agentEmpty').hidden = true;
  $('agentCard').hidden = false;
  $('stream').innerHTML = '';
  $('receipt').hidden = true;
  $('agentBadge').textContent = 'Identifying caller…';
  const { runId } = await post('/api/agent/start');
  agentRun = { runId, shown: 0, t0: performance.now() };
  const tick = setInterval(() => { if (agentRun) $('agentTimer').textContent = `${((performance.now() - agentRun.t0) / 1000).toFixed(1)} s`; }, 100);
  let lastLen = -1;
  for (;;) {
    const run = await fetch(`/api/run/${runId}`).then((r) => r.json());
    if (run.events.length < lastLen) { $('stream').innerHTML = ''; agentRun.shown = 0; agentRun.t0 = performance.now(); }  // switched to simulation
    lastLen = run.events.length;
    for (const ev of run.events.slice(agentRun.shown)) {
      renderEvent($('stream'), ev, 'booking');
      if (/^Hello from|Booking agent/.test(ev.label)) $('agentBadge').textContent = 'Booking agent · Google Gemini · 0.97';
    }
    agentRun.shown = run.events.length;
    if (run.done) { clearInterval(tick); showReceipt(run); break; }
    await wait(150);
  }
  agentRun = null;
}
$('agentBtn').onclick = startAgent;

// ---- sales bot -------------------------------------------------------------------------
let salesBusy = false;
async function startSales() {
  if (salesBusy) return;
  salesBusy = true;
  $('salesBtn').disabled = true;
  const flow = $('spamflow');
  flow.innerHTML = '<span class="chip">GrowthLeads outbound agent calling…</span>';
  const { runId } = await post('/api/salesbot/start');
  let shown = 0;
  for (;;) {
    const run = await fetch(`/api/run/${runId}`).then((r) => r.json());
    for (const ev of run.events.slice(shown)) {
      const chip = document.createElement('span');
      const blocked = /^Blocked/.test(ev.label);
      chip.className = `chip${blocked ? ' blocked' : ''}`;
      chip.textContent = blocked ? `${ev.label} · ${(ev.tMs / 1000).toFixed(1)} s` : ev.label.replace(/^Hello from GrowthLeads outbound agent: /, 'Sales pitch: ');
      flow.appendChild(chip);
    }
    shown = run.events.length;
    if (run.done) break;
    await wait(150);
  }
  $('salesBtn').disabled = false;
  salesBusy = false;
}
$('salesBtn').onclick = startSales;

// ---- reset -----------------------------------------------------------------------------
async function resetDemo() {
  await post('/api/reset');
  if (human?.timer) clearInterval(human.timer);
  human = null;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  $('humanBtn').disabled = false; $('agentBtn').disabled = false; $('salesBtn').disabled = false;
  $('humanCard').hidden = true; $('agentCard').hidden = true; $('suggest').hidden = true; $('receipt').hidden = true;
  $('humanEmpty').hidden = false; $('agentEmpty').hidden = false;
  $('transcript').innerHTML = ''; $('humanCards').innerHTML = ''; $('stream').innerHTML = '';
  $('humanTimer').textContent = '0:00'; $('agentTimer').textContent = '0.0 s'; $('humanStatus').textContent = '';
  $('spamflow').innerHTML = '<span class="dim">Bots are asked for the same 5¢ refundable hold. They don’t pay, so they never reach the owner.</span>';
  if (location.hash === '#dashboard') loadDashboard();
}
$('resetBtn').onclick = resetDemo;

// ---- dashboard -------------------------------------------------------------------------
const TYPE_LABEL = { human: 'Person', booking_agent: 'Agent', sales_agent: 'Bot' };
const RULE_LABEL = {
  holdForHumans: 'Keep today’s 2:00 PM for people',
  agentHold: 'Agents post a 5¢ hold',
  agentDeposit: 'Agents pay a $15 deposit. People never pay.',
};

async function loadDashboard() {
  const d = await fetch('/api/dashboard').then((r) => r.json());
  const k = d.kpis;
  $('kpis').innerHTML = [
    ['h', `${k.humansReached.reached} of ${k.humansReached.total}`, 'Reached Luis'],
    ['h', k.callbacksWaiting, 'Callbacks waiting'],
    ['a', `$${k.agentBookingsUsd}`, `${k.agentBookings} agent bookings`],
    ['', k.spamBlocked, 'Bots blocked'],
    ['', `${k.misclassified.count} of ${k.misclassified.total}`, 'Corrected by Luis'],
    ['', `${k.hoursSaved} h`, 'Hours saved'],
  ].map(([c, v, l]) => `<div class="kpi ${c}"><span class="v">${esc(v)}</span><span class="k">${esc(l)}</span></div>`).join('');

  const waiting = d.calls.filter((c) => c.callback?.status === 'waiting').sort((a, b) => (b.callback.urgent ? 1 : 0) - (a.callback.urgent ? 1 : 0));
  $('callbacks').innerHTML = waiting.length ? waiting.map((c) => `
    <li class="${c.callback.urgent ? 'urgent' : ''}"><div><b>${esc(c.caller)}</b><div class="meta">${c.callback.urgent ? 'URGENT · ' : ''}${esc(c.callback.issue || c.outcome)} · call by ${esc(c.callback.by)}</div></div>
    <button data-done="${c.id}">Mark called</button></li>`).join('') : '<li>No one is waiting.</li>';

  $('rules').innerHTML = Object.entries(d.rules).map(([key, on]) => `
    <label class="toggle" for="rule-${key}"><span>${esc(RULE_LABEL[key] || key)}</span><input type="checkbox" id="rule-${key}" data-rule="${key}" ${on ? 'checked' : ''}></label>`).join('');

  $('log').innerHTML = d.calls.map((c) => `
    <tr class="${c.live ? 'fresh' : ''}"><td>${esc(c.time)}</td><td>${esc(c.caller)}</td>
    <td><span class="pill ${c.type}">${TYPE_LABEL[c.type]}</span>${c.correctedFrom ? `<span class="corrected">corrected from ${TYPE_LABEL[c.correctedFrom]}</span>` : ''}</td>
    <td>${esc(c.outcome)}</td>
    <td>${c.depositUsd ? `$${c.depositUsd}` : '–'}${c.receiptUrl ? ` · <a href="${esc(c.receiptUrl)}" target="_blank" rel="noopener">receipt ↗</a>` : ''}</td>
    <td><select data-correct="${c.id}" aria-label="Correct the caller type"><option value="">Wrong type?</option>${Object.entries(TYPE_LABEL).filter(([t]) => t !== c.type).map(([t, l]) => `<option value="${t}">This was a ${t === 'human' ? 'person' : l.toLowerCase()}</option>`).join('')}</select></td></tr>`).join('');
}

$('callbacks').addEventListener('click', async (e) => {
  const id = e.target.dataset?.done;
  if (id) { await post(`/api/calls/${id}/callback-done`); loadDashboard(); }
});
$('rules').addEventListener('change', async (e) => {
  const key = e.target.dataset?.rule;
  if (key) { await post('/api/rules', { [key]: e.target.checked }); loadDashboard(); }
});
$('log').addEventListener('change', async (e) => {
  const id = e.target.dataset?.correct;
  if (id && e.target.value) { await post(`/api/calls/${id}/correct`, { type: e.target.value }); loadDashboard(); }
});

// ---- keyboard shortcuts ----------------------------------------------------------------
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'd') location.hash = '#dashboard';
  else if (k === 'l') location.hash = '#live';
  else if (k === 't') location.hash = '#stage';
  else if (k === 'r') resetDemo();
  else if (location.hash !== '#live') return;   // stage keys live in stage.js
  else if (k === 'h') startHuman();
  else if (k === 'a') startAgent();
  else if (k === 's') startSales();
  else if (['1', '2', '3'].includes(k)) say(LINES[Number(k) - 1]);
});

if (!location.hash) history.replaceState(null, '', '#stage');
showView();
