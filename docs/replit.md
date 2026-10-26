# Firsthand: project spec for Replit Agent

> **How to use this file.** Upload it to the root of **both** Repls as `replit.md`. Replit Agent reads `replit.md` as standing project context. Then paste the build prompts from section 9 one at a time, in order.
> - **Repl A** "dualtone" (front desk, owned by Amaia): build sections 1–6, 8, and the Repl A prompts.
> - **Repl B** "dualtone-agent" (caller agent + wallets, owned by Ashwini): build sections 1–3, 7, 8, and the Repl B prompts.
>
> Sections 10–12 are for the team (schedule, pitch, judge Q&A). Agent: ignore them when building.
>
> "Firsthand" and all colors are **placeholders**. Keep them in one file (`src/brand.ts`) so they can be changed at the end.

---

## 1. What we're building

A hackathon demo (HBS × MIT Hackathon, Oct 24 2026; submit by 3:30 PM, 90-second live demo at 3:45) of an AI phone front desk for small service businesses. The demo business is a plumber.

Every incoming call is first sorted into **one of three kinds of caller**:

| Caller | What Firsthand does |
|---|---|
| **Human** | Rings the owner first. If he's busy, a *disclosed* automated assistant takes a message, promises a callback time and texts it to the caller. It never books, quotes or diagnoses for humans. Urgent callers go to the top of the owner's callback list. Humans never pay anything. |
| **Booking agent** (an AI assistant booking a job for someone, e.g. Google Gemini) | Asks for a **$0.05 refundable hold**, then switches to a fast structured exchange (quote + slot as JSON, within the owner's rules), collects a **$15 deposit**, confirms, and **refunds the hold**. All in USDC on Monad testnet, in about 2 seconds. |
| **Sales / spam agent** | Asked for the same $0.05 hold. It doesn't pay, so it is blocked in about 1 second and never reaches the owner. |

**Core rules**
- When unsure whether a caller is human or agent, **treat them as human**. A person wrongly sent to a bot is worse than a bot sent to the owner.
- No screening question or phone tree for humans. Classification is passive.
- Agents get **speed, not priority**: the owner decides which slots stay with human callers.
- Every call greeting discloses that it's automated and transcribed (Massachusetts requires every party's consent to record).

## 2. Demo business (fictional)

- **Rivera Plumbing & Heating**, Somerville, MA. Owner: **Luis Rivera**, currently out on a job.
- Open slots: today 2:00 PM and 4:00 PM; tomorrow 9:00 AM and 11:30 AM.
- Diagnostic visit: $89.

### Owner rules (in memory, shown as toggles on the dashboard)
- Hold same-day slots for human callers: **on** (today 2:00 PM is held).
- Agents may do on their own: quote published prices, book open non-held slots, take a $15 deposit.
- Needs owner approval: custom quotes, jobs over $500, after-hours emergencies.
- Every agent posts a $0.05 refundable hold. Refunded if the call is legitimate; kept if it was sales or spam.
- Deposit to hold a slot: AI agents only ($15).

## 3. Architecture: two Repls

```
Repl A  "dualtone"  (front desk)              Repl B  "dualtone-agent"  (caller agent + wallets)
  Live calls screen + owner dashboard           Stand-in for Google Gemini
  /.well-known/agent-card.json                  Holds the homeowner's test USDC
  /a2a/hello, /a2a/book  (402 / 200)  <------>  /api/caller/run, /api/deposit/pay,
  /api/human/reply, /api/dashboard              /api/refund, /api/reset, /api/health
                         \                       /
                          Monad testnet (USDC): 5¢ hold, $15 deposit, 5¢ refund
```

**Secrets**
- Repl A: `PUBLIC_URL` (its own public URL), `AGENT_URL` (Repl B's URL), `BUSINESS_ADDRESS` (the business wallet address), and `GEMINI_API_KEY` only if Replit AI Integrations isn't available.
- Repl B: `CALLER_PRIVATE_KEY`, `BUSINESS_PRIVATE_KEY`. These are throwaway testnet keys only.

## 4. Contract between the Repls (do not change field names)

```
Repl A exposes:
  GET  /.well-known/agent-card.json      A2A-style Agent Card

  POST /a2a/hello  body {"agent","on_behalf_of","intent"}   intent: "book_service" | "sell_services"
       no X-PAYMENT-TX header → 402 {"classification":"booking_agent" | "sales_agent",
                                     "payment_required":{"amount_usd":0.05,"purpose":"refundable_hold",
                                     "asset":"USDC","network":"eip155:10143","pay_to":"<BUSINESS_ADDRESS>"}}
       with X-PAYMENT-TX      → 200 {"session_id":"S-…","classification":"booking_agent"}

  POST /a2a/book   body {"session_id","issue","zip","window","max_price_usd"}
       no X-PAYMENT-TX header → 402 {"offer":{"slot":"Today 4:00 PM","diagnostic_fee_usd":89,
                                     "policy_note":"2:00 PM is held for human callers by the owner's rules"},
                                     "payment_required":{"amount_usd":15,"purpose":"deposit",
                                     "asset":"USDC","network":"eip155:10143","pay_to":"<BUSINESS_ADDRESS>"}}
       with X-PAYMENT-TX      → 200 {"booking_id":"RPH-1042","slot":"Today 4:00 PM","status":"confirmed",
                                     "hold_refund":{"amount_usd":0.05}}

Repl B exposes:
  POST /api/caller/run  body {"frontDeskUrl"} → {"steps":[{"tMs","from","to","label","json"}],
                                                 "payments":[{"purpose","hash","explorerUrl","settledMs"}],
                                                 "booking":{...}, "totalMs"}
  POST /api/reset       returns the test USDC to the caller wallet (run before every demo)

In the demo, Repl B signs for both wallets, so it also sends the 5¢ refund.
In production the hold would sit in an escrow contract.
Explorer link format: https://testnet.monadvision.com/tx/<hash>
```

**Agent Card** (served by Repl A; `PUBLIC_URL` comes from the secret):
```json
{"name":"Rivera Plumbing & Heating front desk",
 "description":"Books plumbing and HVAC visits. Agents post a $0.05 refundable USDC hold on Monad; bookings need a $15 deposit.",
 "version":"0.1.0",
 "supportedInterfaces":[{"url":"PUBLIC_URL/a2a","protocolBinding":"HTTP+JSON","protocolVersion":"1.0"}],
 "capabilities":{"streaming":false},
 "defaultInputModes":["application/json"],"defaultOutputModes":["application/json"],
 "skills":[{"id":"book-visit","name":"Book a visit","description":"Quote, hold a slot, collect a deposit","tags":["booking","deposit","x402"]}]}
```

## 5. Repl A screens

**Stack:** React (Vite) + Express + TypeScript, one app, in-memory data seeded on startup. No login. Projector-friendly: body text ≥ 18px; the Live calls screen fits 1440×900 with no page scrolling. Animate new cards in with a 150–300 ms stagger and respect `prefers-reduced-motion`.

**Placeholder branding** in `src/brand.ts`: name "Firsthand", tagline "The front desk that speaks human and agent." Colors: dark #10141C, light #F5F2EC, human orange #FF8A4C, agent blue #7FA6FF, muted #B9C2D3. System fonts. No logo work.

### Screen 1: "Live calls" (`/`)
Two equal columns plus a thin bottom row.

**Left: "Humans reach a human" (orange)**
- Button "Mrs. Alvarez calls". Call card: name, (617) 555-0142, live timer, badge "Human caller".
- Status "Ringing Luis…" for 2 s, then "Luis is on a job, no answer".
- Greeting bubble (must disclose): "Hi, you've reached Rivera Plumbing. Luis is on a job right now. I'm an automated assistant, and this call is transcribed so he gets your message. What can I pass on to him?"
- Transcript bubbles, plus 3 suggested-line buttons (nobody types on stage):
  1. "Hi, there's water coming out from under my kitchen sink and I don't know what to do."
  2. "I'm 78 and I live alone, I'm really worried. Can someone come today?"
  3. "Thank you, dear. I'll wait for his call."
  Plus a small free-text input.
- Result cards: "Message for Luis: URGENT. Mrs. Alvarez, active leak under the kitchen sink, 78 and alone." / "Text sent to caller: Luis will call you by 2:15 PM. If water spreads, turn the valve under the sink clockwise." / "Top of Luis's callback list".

**Right: "Booking agents get a fast lane" (blue)**
- Button "Gemini calls for a homeowner". The badge flips from "Identifying caller…" to "Booking agent · Google Gemini · 0.97", with reasons: "announced it is automated", "offered an agent card", "intent: book a service".
- A stream of message cards. Each shows a ms timestamp, a direction ("Agent → Front desk" / "Front desk → Agent"), a plain-English label, and the JSON in a collapsible monospace block.
- Steps: agent card fetched · agent_hello · hold required (402, $0.05 refundable) · hold paid · service_request · offer (4:00 PM, $89, policy note) · deposit required (402, $15) · deposit paid · booking_confirmed (RPH-1042) · hold refunded.
- A large timer showing total seconds (e.g. "2.1 s") next to "Typical phone call: 3 min 40 s".
- Receipt card: "Deposit secured · $15.00 · settled in X s · 5¢ hold returned" with "View on-chain receipt ↗" links. If the run was simulated, label it "Simulated payment" and show no link.

**Bottom row: "Sales & spam bots" (grey)**
- Button "Sales bot calls": "GrowthLeads outbound agent", intent sell_services → badge "Sales agent" → "Hold required: $0.05" → no payment within 1 s → "Blocked in 0.9 s · Luis never interrupted". Logged to the dashboard.

**Top bar:** product name (from brand.ts), business name, tabs "Live calls" / "Owner dashboard", and a small "Reset demo" button.

**Keyboard shortcuts:** H human call · 1/2/3 the suggested lines · A agent call · S sales bot · D dashboard · L live calls · R reset.

### Screen 2: "Owner dashboard" (`/dashboard`)
- KPI tiles:
  - Humans who reached a human (e.g. "9 of 10")
  - Callbacks waiting
  - Agent bookings ($)
  - Spam agents blocked
  - Misclassified this week (from owner corrections)
  - Hours saved (agent calls × 3.6 min + human calls handled × 4 min)
- **Callback list:** urgent first, with the promised time and a "Mark called" button.
- **Call log:** time, caller, type pill with the word (Human / Booking agent / Sales agent), outcome, deposit, receipt link, and a "Wrong type?" button ("This was a person" / "This was a bot") that updates the misclassification KPI.
- **Owner rules panel:** the rules from section 2, shown as toggles.
- **Seed data:** 10 earlier calls, mixing humans (Mr. Chen, a landlord), booking agents ("ChatGPT agent for J. Park", "Google AI for a homeowner") and sales agents ("SEO agency bot", "Extended warranty bot"), including one misclassified and corrected. Live demo calls are appended and the KPIs update.

### Repl A API routes
- `GET /.well-known/agent-card.json`, `POST /a2a/hello`, `POST /a2a/book`: as in section 4. Log every /a2a request.
- `POST /api/human/reply {callId, text}`
- `POST /api/detect {firstUtterance, headers}` → `{type: "human" | "booking_agent" | "sales_agent", confidence, reasons[]}`
- `POST /api/agent/simulate`
- `POST /api/salesbot/simulate`
- `GET /api/dashboard`
- `POST /api/reset`

## 6. Repl A: human-lane AI and detection

- **LLM:** Replit AI Integrations if available on the account; otherwise the Gemini API (`gemini-2.5-flash`, key in `GEMINI_API_KEY`). Put every call behind one `llm()` helper.
- **System prompt for `/api/human/reply`:**
  > You are an automated assistant answering the phone for Rivera Plumbing & Heating in Somerville, MA, while the owner, Luis, is on a job. You already told the caller that you are automated and that the call is transcribed. Your only job with human callers is to take a clear message and promise a callback. Never book appointments, quote prices or diagnose. Speak warmly and plainly, 1–2 short sentences per reply. If water is actively leaking, tell them to turn the valve under the sink clockwise to shut it off. Callback promise: urgent callers (active leak, no heat, elderly, alone, distressed) within 15 minutes; everyone else within 2 hours. Respond ONLY as JSON: `{"reply": string, "message": {"name": string|null, "issue": string|null, "urgency": "low"|"normal"|"high", "callback_by": string|null}, "done": boolean}`.
- Compute `callback_by` on the server (urgent: now + 15 min, rounded up to 5 min). Validate with zod.
- **Fallback:** if the LLM fails, takes more than 4 s, or returns invalid JSON, use the scripted reply so the demo never breaks.
- **Voice:** read replies aloud with browser `speechSynthesis`. Wait for `voiceschanged`; prefer "Google US English" or "Samantha"; rate 1.05. Speaker toggle on by default.
- **Detection:**
  - Rules first: an agent card, an `X-Agent-Card` header, or phrases such as "automated assistant", "calling on behalf of", "this call is from Google" mean agent.
  - Booking vs. sales comes from intent words ("book", "appointment", "quote" vs. "offer", "services", "partnership", "SEO", "warranty").
  - Otherwise ask the LLM.
  - **If confidence is below 0.8, return "human".**

## 7. Repl B: caller agent and Monad payments

**Stack:** Node.js + Express + TypeScript + viem. CORS open. Log every request. Never crash; return clear JSON errors.

**Monad testnet config** (use viem `defineChain`):
```
MONAD_TESTNET_CHAIN_ID=10143            # CAIP-2: eip155:10143, native token MON (18 decimals)
MONAD_RPC=https://testnet-rpc.monad.xyz
MONAD_RPC_FALLBACK=https://rpc.ankr.com/monad_testnet
EXPLORER=https://testnet.monadvision.com          # tx links: /tx/<hash>
USDC_TESTNET=0x534b2f3A21130d7a60830c2Df862319e593943A3   # Circle testnet USDC, 6 decimals, use erc20Abi
MON_FAUCET=https://faucet.monad.xyz
USDC_FAUCET=https://faucet.circle.com             # network "Monad Testnet", 20 USDC per address every 2 h
```
**Important:** Monad charges the gas **limit** you set, so pass `gas: 80000n` on ERC-20 transfers. Confirm the USDC address on the explorer before relying on it.

**Routes**
- `GET /api/health`: MON and USDC balances of both wallets, chain id, latest block.
- `POST /api/deposit/pay {amountUsd, to?, purpose?}`: USDC from CALLER to `to` (default BUSINESS). Amounts as small as 0.05 must work. Wait for the receipt. Returns `{purpose, hash, explorerUrl, blockNumber, settledMs, from, to, amountUsd, asset:"USDC", network:"eip155:10143"}`. If USDC fails, send a tiny native MON transfer and return `asset:"MON"` with a note.
- `POST /api/refund {amountUsd}`: USDC from BUSINESS back to CALLER. Same response shape.
- `POST /api/reset`: return all of BUSINESS's USDC to CALLER.
- `GET /api/last`: the last payments.
- `POST /api/caller/run {frontDeskUrl}`: the agent flow below. Records each step with `tMs` and returns the shape in section 4.
  1. GET the agent card.
  2. POST `/a2a/hello` `{"agent":"Google Gemini (demo stand-in)","on_behalf_of":"homeowner, Somerville MA 02144","intent":"book_service"}` → expect 402 (hold).
  3. Pay the $0.05 hold (purpose "hold").
  4. POST `/a2a/hello` again with `X-PAYMENT-TX` → expect 200 with a session_id.
  5. POST `/a2a/book` `{"session_id", "issue":"kitchen sink leak","zip":"02144","window":"today","max_price_usd":150}` → expect 402 (offer + deposit).
  6. Accept if `diagnostic_fee_usd ≤ max_price_usd`; record the decision.
  7. Pay the $15 deposit (purpose "deposit").
  8. POST `/a2a/book` again with `X-PAYMENT-TX` and `{"accept":true}` → expect 200 confirmed with hold_refund.
  9. Refund the hold from BUSINESS to CALLER; record it as "Hold refunded by the front desk".

  On any failure, return an error JSON that includes the steps completed so far.
- **Status page `/`:** both addresses, live balances, the last payments with explorer links, and buttons "Send $1 test payment", "Reset (return USDC to caller)" and "Run test call" (with an input for the front desk URL).

**Minimal payment code**
```ts
import { createWalletClient, createPublicClient, http, defineChain, parseUnits, erc20Abi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const monadTestnet = defineChain({
  id: 10143, name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'MonadVision', url: 'https://testnet.monadvision.com' } },
  testnet: true,
});
const USDC = '0x534b2f3A21130d7a60830c2Df862319e593943A3';
const pub = createPublicClient({ chain: monadTestnet, transport: http() });

export async function payUsdc(privateKey: `0x${string}`, to: `0x${string}`, amountUsd: number) {
  const wallet = createWalletClient({ account: privateKeyToAccount(privateKey), chain: monadTestnet, transport: http() });
  const t0 = Date.now();
  const hash = await wallet.writeContract({
    address: USDC, abi: erc20Abi, functionName: 'transfer',
    args: [to, parseUnits(amountUsd.toFixed(6), 6)], gas: 80000n,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  return { hash, status: receipt.status, settledMs: Date.now() - t0,
           explorerUrl: `https://testnet.monadvision.com/tx/${hash}` };
}
```

## 8. Demo safety rules (both Repls)
- The demo must never get stuck. Every live dependency has a fallback:
  - LLM: scripted reply after 4 s.
  - Repl B unreachable or slower than 10 s: Repl A runs `/api/agent/simulate` and labels the receipt "Simulated payment".
- Never present a simulated payment as real.
- Before each run: Reset demo; the CALLER wallet holds at least 15.05 USDC.
- Publish both Repls as **Autoscale** (not Static) and add the production secrets.

---

## 9. Build prompts, in order

Paste one at a time. Use Plan mode for P1 and P2b. If Agent breaks something, roll back to the last checkpoint rather than arguing with it.

| # | Repl | When | Prompt |
|---|---|---|---|
| P0 | A | 12:05 | "Quick check before we build anything. Create a minimal Express server with one route, GET /api/ping-llm, that sends 'Reply with the single word: ready' to an LLM using Replit AI Integrations (Claude Sonnet if available, otherwise any model) and returns the reply as JSON. Tell me clearly whether Replit AI Integrations worked on this account." If it didn't: create a free key at aistudio.google.com/apikey, save it as the secret GEMINI_API_KEY, and tell Agent to use Gemini behind one llm() helper. |
| P2a | B | 12:05 | "Create a Node.js + TypeScript project with viem. Add `npm run wallets`, which generates two private keys with generatePrivateKey() and prints the label, address and key for CALLER (the homeowner's agent wallet, pays) and BUSINESS (the plumber's wallet, receives). Run it and show me the output. Build nothing else yet." Then save the keys as secrets, send Amaia the BUSINESS address, and get funds from the faucets: MON to both addresses, 20 USDC to CALLER. |
| P1 | A | 12:15 | "Read replit.md. Build Repl A as specified in sections 1–6 and 8, using scripted replies and a scripted agent lane for now (no LLM, no chain yet). Show me the plan first." |
| P2b | B | 12:20 | "Read replit.md. Build the payment part of Repl B from section 7: health, deposit/pay, refund, reset, last, and the status page. Don't build /api/caller/run yet. Show me the plan first." Goal: one real transaction on the explorer by 1:00. |
| P4 | B | 1:00 | "Read replit.md section 7 and add POST /api/caller/run exactly as specified (steps 1–9), plus the 'Run test call' button on the status page." |
| P3 | A | 1:20 | "Read replit.md section 6. Replace the scripted human-lane replies with the LLM (system prompt, zod validation, 4-second fallback), add browser voice, and add /api/detect with the below-0.8-means-human rule." |
| P5 | A | 2:00 | "Connect the agent lane to Repl B: on 'Gemini calls', POST {AGENT_URL}/api/caller/run with {frontDeskUrl: PUBLIC_URL}, replay the returned steps with their real timing, and use the real explorer links in the receipt. Fall back to /api/agent/simulate (labelled 'Simulated payment') if AGENT_URL is missing, the call errors, or it takes over 10 s. Reset also calls {AGENT_URL}/api/reset. Optional: verify each X-PAYMENT-TX with viem getTransactionReceipt before answering 200." |
| P6 | A | 2:15 | "Polish for a projector without changing working behavior or branding: the keyboard shortcuts from section 5 with a hint line, the timer and receipt most prominent after the agent call, text ≥ 18px, empty states ('Waiting for a call'), no console errors, fits 1440×900." |
| P7 | A | 2:20 | "Final branding pass. Change only src/brand.ts and what reads from it: name '[NEW NAME]', tagline '[TAGLINE]', colors [COLORS], a simple logo [DESCRIBE]. Don't change layout or behavior; keep distinct human and agent colors and readable contrast." |

---

## 10. Team schedule (not for Agent)

| Time | Amaia (Repl A) | Ashwini (Repl B) |
|---|---|---|
| 12:00 | Redeem the Replit trial, create Repl A, upload this file, run P0 | Redeem the trial, create Repl B, upload this file, run P2a, save the secrets |
| 12:15 | P1 (Plan mode); share the deck | Faucets (Monad Foundation table if blocked); P2b |
| 12:30 | Lunch at the keyboard; review P1 and fix in small prompts | Lunch; first real transaction by 1:00 |
| 1:00 | Small fixes; set BUSINESS_ADDRESS and PUBLIC_URL | P4; while it builds, validation calls (section 12) |
| **1:15** | **Checkpoint 1:** both lanes run scripted, and one real transaction exists. Otherwise choose a fallback. | |
| 1:20 | P3 | Test caller/run against Repl A's /a2a endpoints |
| 1:45 | Publish Repl A | Publish Repl B |
| **2:00** | **Checkpoint 2:** set AGENT_URL, run P5, do 3 full runs with reset in between | |
| 2:15 | P6; agree on the name and look, then P7 | Add the validation number to the deck; time the script |
| **2:30** | **Feature freeze.** Republish. Record a 60 s backup video (Cmd+Shift+5). | |
| 2:40 | Submit the app URL and deck link | Check balances, reset |
| 3:00 | Done. 30 min buffer before 3:30, then rehearse until 3:45. | |

## 11. Pitch script (~205 words, ~85 s)

| Time | Who | Line |
|---|---|---|
| 0:00 | Amaia | "Last month, Google let Gemini phone businesses for you, from your own number. So the next call a plumber misses may be an AI, shopping five plumbers at once." |
| 0:12 | Amaia | "Nearly half of calls to home-service shops never reach a person. Google's AI calls to plumbers jumped 650% in a month, and a third went unanswered." |
| 0:22 | Amaia | "Firsthand sorts three kinds of callers. Mrs. Alvarez, 78, has a leak. Firsthand rings Luis first; he's on a job, so a disclosed assistant takes her message, texts her he'll call by 2:15, and puts her at the top of his list." *(Ashwini drives: H, 1, 2)* |
| 0:40 | Ashwini | "This is Meta's new Muse agent, live. It got a quote from our plumber as data, and it asked me first. Yes, book it. A refundable 5-cent hold, a $15 deposit on Monad, settled in under a second, hold returned. A sales bot? It won't pay the hold, so it never reaches Luis." *(Amaia drives: A, receipt link, S)* |
| 1:02 | Ashwini | "Big tech is building payment rails for agents; nobody is building the front desk that receives them. And agents get speed, not priority: owners decide which slots stay with people." |
| 1:14 | Ashwini | "96,000 plumbing and HVAC shops, at $199 a month: a $230 million start." |
| 1:20 | Amaia | "We're Firsthand. We'd love introductions to plumbers for our pilot." |

## 12. Evidence, validation and judge Q&A (not for Agent)

**Validation calls (Ashwini, 1:00–1:15)**
1. Call 5 small Somerville/Boston plumbers.
2. Log whether a person, voicemail or an AI picked up.
3. If a person answers, say you're a Harvard student doing research, then ask:
   - "If Google's AI called you to book a job, would you know?"
   - "Would you take a $15 deposit to hold a slot if the customer's assistant paid instantly?"
   - "How many sales or robocalls do you get a week?"
4. Use only the real result: "At 1 PM today we called 5 Boston plumbers; [X] reached a person."

**Sourced numbers**
- **44%** of callers never reach a person: Invoca 2026 benchmarks, 70M+ calls from Invoca's own customers. Don't use the "62% unanswered" figure; it comes from a small, old study that counted voicemail as unanswered.
- **96,222** US plumbing/HVAC firms with under 20 employees: Census SUSB 2022, NAICS 238220.
- Google's AI has called businesses since Jul 16 2025 (TechCrunch). Gemini "Call for Me", from the user's own number, reported Sep 24 2026 (TechCrunch).
- **0 of 14** SMB AI receptionists treat AI callers as a separate channel: our review of vendor pages, Oct 24 2026.
- **Assumptions, labelled as such in the deck:** $199/mo price; $1.4B yearly prepaid job volume (10 jobs × $120 per firm per month). We have no data yet on what share of plumbers' calls come from agents.

**Likely questions**
- **Why Monad, not Stripe?** A 5¢ refundable hold can't exist on cards (~30¢ fixed fee). On Monad it costs a fraction of a cent and settles in under 1 s. Spam won't pay, and the holds build a record of which agents pay, book and show up.
- **Agents that don't disclose?** We use an agent card handshake, disclosure, and a classifier on the first lines. Below 0.8 confidence the caller is treated as human. Owners correct mistakes, and we report the misclassification rate.
- **Friction for humans?** None: no screening question and no phone tree. Humans ring straight through.
- **What can the AI commit to?** Only published prices, open non-held slots and the $15 deposit. Anything else needs the owner's approval.
- **Recording laws?** The greeting discloses the assistant and the transcription; Massachusetts and California require every party's consent.
- **Money transmission?** In production, holds and deposits go through a licensed stablecoin payments provider or an escrow contract. Today's demo uses testnet funds.
- **Why won't Google, Yelp or Goodcall copy this?** Big tech builds rails (A2A, AP2, ACP, x402), not SMB front desks. An incumbent could add an "agent mode", so our moat is detection accuracy plus the reputation data from holds.
- **Fairness?** Agents get speed, not priority. Owners hold slots for people, and humans never pay up front.
