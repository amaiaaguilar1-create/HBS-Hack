// Real phone line via Vapi. People are transferred straight to the owner; AI agents get the booking
// fast lane through the same quote/book logic as the MCP connector. Every step is pushed to the live screen.
export function mountPhone(app, { newRun, emit, hooks, recordHumanCall }) {
  const calls = new Map();   // vapi call id -> run

  const runFor = (call) => {
    const id = call?.id || 'unknown';
    if (!calls.has(id)) {
      const run = newRun('phone', { source: 'phone', caller: call?.customer?.number || 'Unknown number', classification: null });
      calls.set(id, run);
      emit(run, 'in', `Incoming call from ${run.caller}`, { callId: id });
    }
    return calls.get(id);
  };

  app.post('/vapi/webhook', async (req, res) => {
    const m = req.body?.message || {};
    const run = runFor(m.call);

    if (m.type === 'tool-calls') {
      const results = [];
      for (const tc of m.toolCallList || []) {
        const name = tc.function?.name;
        let args = tc.function?.arguments || {};
        if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
        let result;
        try {
          if (name === 'report_caller') {
            run.classification = args.type;
            const label = { human: 'Person on the line: ringing Luis now', booking_agent: 'AI agent calling to book: fast lane', sales_agent: 'Sales bot: declined, Luis not interrupted' }[args.type] || `Caller type: ${args.type}`;
            emit(run, 'out', label, args, { classification: args.type });
            if (args.type === 'human') recordHumanCall(run);
            result = 'noted';
          } else if (name === 'get_quote') {
            const { offer } = await hooks.quote({ ...args, agent_name: args.agent_name || 'AI agent on the phone' });
            emit(run, 'out', `Quoted ${offer.slot} · $${offer.diagnostic_fee_usd}`, offer);
            result = `${offer.slot}, diagnostic visit $${offer.diagnostic_fee_usd}. A refundable 5 cent hold and a 15 dollar deposit are paid in USDC on Monad to book.${offer.policy_note ? ` ${offer.policy_note}.` : ''}`;
          } else if (name === 'book_visit') {
            const r = await hooks.book({ ...args, confirm: true, agent_name: args.agent_name || 'AI agent on the phone' });
            emit(run, 'out', r.booking ? `Booked ${r.booking.slot} · ${r.booking.booking_id}` : 'Booking failed', r);
            result = r.booking ? `Booked for ${r.booking.slot}, booking number ${r.booking.booking_id.split('').join(' ')}. Deposit received.` : 'The booking could not be completed.';
          } else {
            result = 'unknown tool';
          }
        } catch (e) {
          console.error('vapi tool error', e);
          results.push({ toolCallId: tc.id, error: e.message });
          continue;
        }
        results.push({ toolCallId: tc.id, result });
      }
      return res.json({ results });
    }

    if (m.type === 'status-update') {
      if (m.status === 'in-progress') emit(run, 'out', 'Answered: “Rivera Plumbing, automated assistant, this call may be transcribed.”', { status: m.status });
      if (m.status === 'forwarding') emit(run, 'out', 'Transferring to Luis…', { status: m.status });
      if (m.status === 'ended') { emit(run, 'out', `Call ended${m.endedReason ? ` (${m.endedReason})` : ''}`, { status: m.status }); run.done = true; }
    } else if (m.type === 'transfer-destination-request' || m.type === 'transfer-update') {
      emit(run, 'out', 'Ringing Luis’s phone…', { type: m.type });
    } else if (m.type === 'transcript' && m.transcriptType === 'final') {
      emit(run, m.role === 'user' ? 'in' : 'out', `${m.role === 'user' ? 'Caller' : 'Front desk'}: “${m.transcript}”`, null, { transcript: true });
    } else if (m.type === 'end-of-call-report') {
      run.done = true;
    }
    res.json({ ok: true });
  });
}
