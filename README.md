# Firsthand (working name)

A phone front desk for small service businesses that sorts every caller into one of three kinds:

- **Humans reach a human.** It rings the owner first. If he's on a job, a disclosed assistant takes a message, promises a callback time and texts it. It never books or quotes for people.
- **Booking agents get a fast lane.** An AI assistant (here, a stand-in for Google Gemini) posts a **5¢ refundable hold**, gets a quote and slot as JSON within the owner's rules, pays a **$15 deposit** in USDC on **Monad testnet**, and gets the hold back.
- **Sales and spam bots** are asked for the same hold, don't pay, and never reach the owner.

Built for the HBS × MIT Hackathon (Oct 24, 2026) by Amaia Aguilar and Ashwini Krishnamurthy.

## Run it

```bash
npm install
npm run wallets   # one time: creates two throwaway testnet wallets in .env
npm start         # front desk on :3000, caller agent on :4000
```

Open http://localhost:3000. The caller agent's status page, with wallet balances and test buttons, is at http://localhost:4000.

**Fund the test wallets** (addresses are printed by `npm run wallets` and shown on the :4000 status page):
- MON for gas, to both wallets: https://faucet.monad.xyz
- 20 test USDC, to the CALLER wallet: https://faucet.circle.com (network "Monad Testnet")

Until the wallets have funds, the agent lane runs a clearly labelled **simulated** payment, so the demo never gets stuck.

## Demo keys (Live calls screen)

`H` human call · `1` `2` `3` caller lines · `A` booking agent · `S` sales bot · `D` dashboard · `L` live calls · `R` reset (also returns the test USDC to the caller wallet)

## How it fits together

```
front-desk/   (Amaia)   Live calls + owner dashboard, A2A-style endpoints
  GET  /.well-known/agent-card.json
  POST /a2a/hello  → 402 refundable hold ($0.05) → 200 session
  POST /a2a/book   → 402 offer + $15 deposit    → 200 confirmed (+ hold refund)
caller-agent/ (Ashwini) Gemini stand-in + sales bot + Monad wallets (viem)
  POST /api/caller/run, /api/salesbot/run, /api/deposit/pay, /api/refund, /api/reset
```

Payment steps follow the x402 pattern: HTTP 402 with a payment request, then a retry with an `X-PAYMENT-TX` header. The front desk checks each transaction on Monad before confirming. In this demo the caller-agent service signs for both wallets, so it also sends the refund; in production the hold would sit in an escrow contract.

## Settings (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `CALLER_PRIVATE_KEY`, `BUSINESS_PRIVATE_KEY` | created by `npm run wallets` | Testnet wallets. Never put real funds here. |
| `BUSINESS_ADDRESS` | created by `npm run wallets` | Where holds and deposits are paid |
| `PUBLIC_URL` | `http://localhost:3000` | The front desk's public URL (set it when deployed) |
| `AGENT_URL` | `http://localhost:4000` | The caller agent's URL |
| `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` | none | Optional: an LLM writes the assistant's replies. Without a key it uses scripted replies. |

## Live demo pieces

- **Stage view** (default screen): follows the newest call from any source. Rehearsal keys: `H` person, `A` AI agent, `S` sales bot, `R` reset, `M` mute.
- **Muse / any MCP agent:** connect a custom connector to `<public URL>/mcp` (streamable HTTP, no auth). Tools: `get_business_info`, `get_quote`, `book_visit`.
- **Phone line:** `npm run phone` creates the Vapi assistant and number (needs `VAPI_PRIVATE_API_KEY` and `OWNER_PHONE` in `.env`, and `TUNNEL_URL` set to the public URL). People are transferred to the owner; agents get the booking lane; sales bots are ended.
- **Deployed copy:** https://candid-stable-actionscript.replit.app

## Branding

The name, tagline and colors are placeholders in `front-desk/public/brand.js`. Change them there only.

## Docs

- `docs/replit.md`: full spec, contract, build prompts, schedule, pitch script and judge Q&A
- `docs/build-plan.html`: the same plan as a page
