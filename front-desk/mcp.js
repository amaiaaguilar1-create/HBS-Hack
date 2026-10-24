// MCP connector so consumer agents (e.g. Meta Muse) can quote and book through the front desk.
// Streamable HTTP, stateless: POST /mcp. Optional bearer token via MCP_TOKEN.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const text = (t) => ({ content: [{ type: 'text', text: t }] });

// hooks: { info(), quote({agentName, issue, zip, when}) -> {run, offer}, book({...}) -> {run, booking, receiptUrl, simulated} }
function buildServer(hooks) {
  const server = new McpServer({ name: 'rivera-plumbing-front-desk', version: '0.1.0' });

  server.registerTool('get_business_info', {
    title: 'Business info',
    description: 'Services, prices, hours and booking policies for Rivera Plumbing & Heating (Somerville, MA). Call this first.',
    inputSchema: {},
  }, async () => text(hooks.info()));

  server.registerTool('get_quote', {
    title: 'Get a quote and open slot',
    description: 'Ask Rivera Plumbing for a price and the earliest slot for a plumbing problem. Does not book or charge anything.',
    inputSchema: {
      issue: z.string().describe('The problem, e.g. "kitchen sink leak"'),
      zip: z.string().optional().describe('ZIP code of the job'),
      when: z.string().optional().describe('When the customer wants the visit, e.g. "today"'),
      agent_name: z.string().optional().describe('Name of the calling assistant, e.g. "Meta Muse"'),
    },
  }, async (args) => {
    const { offer } = await hooks.quote(args);
    return text(
      `${offer.slot} · $${offer.diagnostic_fee_usd} visit · $15 testnet deposit (5¢ hold refunded).\n` +
      `Reply to the customer in one short line, e.g. "Rivera Plumbing can come ${offer.slot.replace(/^Today /, "today at ")} for $${offer.diagnostic_fee_usd}. Book it?" ` +
      'If they say yes, call book_visit with confirm=true.'
    );
  });

  server.registerTool('book_visit', {
    title: 'Book the visit and pay the deposit',
    description: 'Book the offered slot after the customer has confirmed. Pays a refundable $0.05 hold and a $15 deposit in USDC on Monad testnet from the agent wallet, then returns the booking and receipt link.',
    inputSchema: {
      issue: z.string().describe('The problem, e.g. "kitchen sink leak"'),
      customer_name: z.string().optional().describe('Customer name for the booking'),
      zip: z.string().optional(),
      when: z.string().optional(),
      confirm: z.boolean().describe('Must be true: the customer confirmed the slot, price and deposit'),
      agent_name: z.string().optional().describe('Name of the calling assistant, e.g. "Meta Muse"'),
    },
  }, async (args) => {
    if (!args.confirm) return text('Not booked yet. Ask the customer "Book it?" in one line, then call again with confirm=true.');
    const r = await hooks.book(args);
    if (!r.booking) return text(`Booking did not complete: ${r.error || 'unknown error'}. Nothing further was charged.`);
    return text(
      `Booked ${r.booking.slot} · ${r.booking.booking_id}` + (r.simulated ? ' (simulated payment).' : `. Receipt: ${r.receiptUrl}`) + '\n' +
      `Reply to the customer in one short line, e.g. "Booked: Luis will be there ${r.booking.slot.replace(/^Today /, "today at ")}." Add the receipt link only if they ask.`
    );
  });

  return server;
}

export function mountMcp(app, hooks) {
  app.post('/mcp', async (req, res) => {
    const token = process.env.MCP_TOKEN;
    if (token && req.get('authorization') !== `Bearer ${token}`) return res.status(401).json({ error: 'Missing or invalid bearer token' });
    try {
      const server = buildServer(hooks);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error('MCP error:', e);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    }
  });
  const notAllowed = (req, res) => res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
  app.get('/mcp', notAllowed);
  app.delete('/mcp', notAllowed);
}
