// Stage: one call at a time, readable from the back of the room. Follows the newest call from any
// source (demo keys, the Muse connector, the real phone line) and lights up steps as real events arrive.
(() => {
  const el = (id) => document.getElementById(id);
  const post = (url) => fetch(url, { method: 'POST' }).then((r) => r.json());
  const num = (id) => Number(String(id || '').replace(/\D/g, '')) || 0;

  // ---- two-tone chime: low for a person, high for an agent ------------------------------
  let audio = null;
  let soundOn = true;
  const unlock = () => { if (!audio) { try { audio = new AudioContext(); } catch { /* no audio */ } } else if (audio.state === 'suspended') audio.resume(); };
  function chime(kind) {
    if (!soundOn || !audio || matchMedia('(prefers-reduced-motion: reduce)').matches && kind === 'none') return;
    const notes = { person: [392, 523.25], agent: [783.99, 1046.5], done: [659.25, 987.77, 1318.5], blocked: [311.13, 233.08] }[kind] || [];
    notes.forEach((f, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      const t = audio.currentTime + i * 0.12;
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      o.connect(g).connect(audio.destination);
      o.start(t); o.stop(t + 0.5);
    });
  }

  // ---- what each kind of call looks like ------------------------------------------------
  const FLOWS = {
    person: {
      verdict: 'Person', cls: 'v-person', kicker: 'A person is calling',
      steps: [
        ['answer', 'Answered with an AI disclosure', /^Answered/],
        ['recognize', 'Recognized a person, no screening questions', /Person on the line/],
        ['ring', 'Ringing Luis’s phone', /Transferring|Ringing Luis/],
        ['connect', 'Luis picked up, person to person', /picked up|Call ended/],
      ],
    },
    agent: {
      verdict: 'AI agent', cls: 'v-agent', kicker: 'An AI agent is calling to book',
      steps: [
        ['recognize', 'Recognized an AI agent', /^Hello from|connected through our MCP|AI agent calling to book|agent card/],
        ['hold', '5¢ refundable hold paid', /^Hold paid|no hold required/i],
        ['quote', 'Quote and slot sent as data', /^Offer|^Quoted/],
        ['deposit', '$15 deposit paid in USDC', /^Deposit paid|no deposit required/i],
        ['book', 'Booked', /^Booking confirmed|^Booked/],
        ['refund', '5¢ hold returned', /^Hold refunded/],
      ],
    },
    sales: {
      verdict: 'Sales bot', cls: 'v-sales', kicker: 'A sales bot is calling',
      steps: [
        ['recognize', 'Recognized a sales bot', /^Hello from|Sales bot:/],
        ['hold', 'Asked for the same 5¢ hold', /hold required/],
        ['decline', 'It didn’t pay', /declined|Blocked|Sales bot:/],
        ['block', 'Blocked, Luis never interrupted', /^Blocked|Sales bot:/],
      ],
    },
  };

  function flowFor(run) {
    if (run.kind === 'sales') return 'sales';
    if (run.kind === 'booking') return 'agent';
    if (run.classification === 'booking_agent') return 'agent';
    if (run.classification === 'sales_agent') return 'sales';
    if (run.classification === 'human') return 'person';
    return null;   // phone call not classified yet
  }

  // ---- render ---------------------------------------------------------------------------
  let current = null;   // { id, flow, done: Set, finale, verdictShown }

  function resetStage() {
    current = null;
    el('sKicker').textContent = 'Waiting for the next call';
    el('sVerdict').textContent = 'Line open';
    el('sVerdict').className = 'verdict';
    el('sWho').textContent = 'People reach a person. AI agents get a fast lane. Sales bots pay to waste your time.';
    el('sTrack').innerHTML = '';
    el('sFinale').hidden = true;
    el('sTicker').textContent = '';
    document.getElementById('stage').dataset.flow = '';
    document.getElementById('stage').classList.remove('has-finale');
  }

  function whoLine(run, flow) {
    if (flow === 'agent') return `${run.agentName || 'AI agent'}${run.source === 'mcp' ? ', booking through our connector' : run.source === 'phone' ? ', on the phone' : ''} · kitchen sink leak · Somerville`;
    if (flow === 'sales') return 'GrowthLeads outbound agent · “3x more leads with local SEO”';
    return `Calling from ${run.caller || '(617) 555-0142'}${run.source === 'phone' ? ' · live phone call' : ''}`;
  }

  function render(run) {
    const flow = flowFor(run);
    const stage = document.getElementById('stage');
    if (!flow) {
      el('sKicker').textContent = `Incoming call · ${run.caller || ''}`;
      el('sVerdict').textContent = 'Listening…';
      el('sVerdict').className = 'verdict v-listen';
      el('sWho').textContent = 'Identifying the caller from its first words';
      renderTicker(run);
      return;
    }
    const spec = FLOWS[flow];
    if (current.flow !== flow) {
      current.flow = flow;
      current.done = new Map();
      stage.dataset.flow = flow;
      el('sKicker').textContent = spec.kicker;
      el('sVerdict').textContent = spec.verdict;
      el('sVerdict').className = `verdict ${spec.cls} reveal`;
      el('sWho').textContent = whoLine(run, flow);
      el('sTrack').innerHTML = spec.steps.map(([key, label]) => `<li data-k="${key}"><span class="dot"></span><span class="label">${label}</span><span class="time"></span></li>`).join('');
      chime(flow === 'person' ? 'person' : flow === 'agent' ? 'agent' : 'blocked');
    }
    el('sWho').textContent = whoLine(run, flow);

    for (const ev of run.events) {
      for (const [key, , re] of spec.steps) {
        if (!current.done.has(key) && re.test(ev.label)) current.done.set(key, ev);
      }
    }
    const items = [...el('sTrack').children];
    let activeSet = false;
    items.forEach((li) => {
      const ev = current.done.get(li.dataset.k);
      li.classList.toggle('done', Boolean(ev));
      if (ev) {
        li.querySelector('.time').textContent = `${(ev.tMs / 1000).toFixed(1)} s`;
        if (li.dataset.k === 'quote' && ev.json?.offer) li.querySelector('.label').textContent = `Quote sent as data: ${ev.json.offer.slot}, $${ev.json.offer.diagnostic_fee_usd}`;
        if (li.dataset.k === 'quote' && ev.json?.slot) li.querySelector('.label').textContent = `Quote sent as data: ${ev.json.slot}, $${ev.json.diagnostic_fee_usd}`;
        if (li.dataset.k === 'book' && ev.json?.booking_id) li.querySelector('.label').textContent = `Booked ${ev.json.slot} · ${ev.json.booking_id}`;
      }
      const isActive = !ev && !activeSet && !run.done;
      li.classList.toggle('active', isActive);
      if (isActive) activeSet = true;
    });
    renderTicker(run);
    renderFinale(run, flow);
  }

  function renderTicker(run) {
    el('sTicker').textContent = run.events.slice(-3).map((e) => e.label).join('   ·   ');
  }

  function renderFinale(run, flow) {
    const f = el('sFinale');
    const allDone = current.done.size === FLOWS[flow].steps.length;
    if (!allDone && !(run.done && flow !== 'person')) return;
    if (current.finale) return;
    current.finale = true;
    document.getElementById('stage').classList.add('has-finale');
    if (flow === 'agent') {
      const deposit = run.payments?.find((p) => p.purpose === 'deposit');
      const depEv = current.done.get('deposit');
      const url = depEv?.txUrl || deposit?.explorerUrl;
      const secs = deposit?.settledMs ? (deposit.settledMs / 1000).toFixed(1) : null;
      f.innerHTML = `
        <div class="amount">$15.00</div>
        <div class="fin-copy"><b>Deposit secured${secs ? ` in ${secs} s` : ''}</b>
          <span>${run.simulated ? 'Simulated payment (test wallet not funded)' : 'USDC on Monad · 5¢ hold returned · no card fees'}</span>
          ${url && !run.simulated ? `<span class="tx">${url.replace('https://', '').slice(0, 44)}…</span>` : ''}</div>
        ${url && !run.simulated ? `<img class="qr" src="/api/qr.svg?data=${encodeURIComponent(url)}" alt="QR code linking to the transaction on the Monad explorer">` : ''}`;
      chime('done');
    } else if (flow === 'person') {
      f.innerHTML = `<div class="amount person">Connected</div><div class="fin-copy"><b>Luis is on the line</b><span>${run.source === 'simulated' ? 'Rehearsal call' : 'Live call'} · the caller never talked to a bot</span></div>`;
      chime('done');
    } else {
      const last = run.events[run.events.length - 1];
      f.innerHTML = `<div class="amount sales">${last ? `${(last.tMs / 1000).toFixed(1)} s` : 'Blocked'}</div><div class="fin-copy"><b>Blocked before it reached Luis</b><span>It would not post a 5¢ hold. That’s the point.</span></div>`;
    }
    f.hidden = false;
  }

  // ---- follow the newest call --------------------------------------------------------
  async function tick() {
    if (location.hash && location.hash !== '#stage') return;
    try {
      const latest = await fetch('/api/live').then((r) => r.json());
      const newest = Object.values(latest).sort((a, b) => num(b) - num(a))[0];
      if (newest && (!current || num(newest) > num(current.id))) {
        current = { id: newest, flow: null, done: new Map(), finale: false };
        document.getElementById('stage').classList.remove('has-finale');
        el('sTrack').innerHTML = '';
        el('sFinale').hidden = true;
      }
      if (current) {
        const run = await fetch(`/api/run/${current.id}`).then((r) => (r.ok ? r.json() : null));
        if (run) render(run);
      }
    } catch { /* server restarting; try again next tick */ }
  }

  async function tally() {
    if (location.hash && location.hash !== '#stage') return;
    try {
      const d = await fetch('/api/dashboard').then((r) => r.json());
      const set = (id, v) => { const n = el(id); if (n.textContent !== String(v)) { n.textContent = v; n.classList.remove('bump'); void n.offsetWidth; n.classList.add('bump'); } };
      set('tHumans', d.kpis.humansReached.reached);
      set('tAgents', d.kpis.agentBookings);
      set('tSpam', d.kpis.spamBlocked);
    } catch { /* ignore */ }
  }

  fetch('/api/config').then((r) => r.json()).then((c) => { if (c.phoneNumber) el('lineNumber').textContent = `Call ${c.phoneNumber}`; }).catch(() => {});

  document.addEventListener('pointerdown', unlock);
  document.addEventListener('keydown', async (e) => {
    unlock();
    if (location.hash && location.hash !== '#stage') return;
    if (e.target.matches('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'h') post('/api/phone/simulate');
    else if (k === 'a') post('/api/agent/start');
    else if (k === 's') post('/api/salesbot/start');
    else if (k === 'm') soundOn = !soundOn;
    else if (k === 'r') { await post('/api/reset'); resetStage(); tally(); }
  });

  resetStage();
  setInterval(tick, 250);
  setInterval(tally, 1500);
  tally();
})();
