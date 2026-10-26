# Firsthand

**Keep the call human.** People reach the owner, AI agents book and pay in seconds, and bots stay out.

Today's AI receptionists put a bot on every caller and turn AI agents away as spam. Firsthand does the opposite for small service businesses:

- **People reach a person.** A caller hears one disclosed greeting and rings straight through to the owner. There's no phone tree and no bot conversation.
- **AI agents get a fast lane.** Agents like Meta's Muse get a quote as data, post a **5¢ refundable hold**, and pay a **$15 deposit** in USDC on **Monad**. It settles in under a second, and the hold comes back.
- **Bots stay out.** Sales and spam bots are asked for the same 5¢ hold. They don't pay, so the owner never hears them. A 5¢ hold only works on-chain, since card fees alone are about 30¢.

The owner sets the rules: which slots stay with people, and what agents may commit to. Agents get speed, not priority.

Built in one day for the HBS × MIT Hackathon (October 24, 2026) by Amaia Aguilar and Ashwini Krishnamurthy. **4th place.**

## What's in the demo

| Piece | What it shows |
|---|---|
| **Live stage** (`/`) | One call at a time, readable from the back of a room: who is calling (Person, AI agent, Bot), each step as it happens, and the payment receipt with a QR code to the transaction |
| **Phone line** (Vapi) | A real number. People are transferred to the owner's phone; agents get the booking lane; sales bots are ended |
| **Agent connector** (`/mcp`) | An MCP server any agent can use (tested live with Meta Muse): `get_business_info`, `get_quote`, `book_visit` |
| **A2A-style endpoints** | `/.well-known/agent-card.json`, plus `/a2a/hello` and `/a2a/book`, with x402-style HTTP 402 payment requests |
| **Owner dashboard** (`/#dashboard`) | People reached, callbacks waiting, agent bookings, bots blocked, owner corrections and rules |

## Run it locally

```bash
npm install
npm run wallets   # one time: creates two throwaway testnet wallets in .env
npm start         # front desk on :3000, caller agent on :4000
```

Open http://localhost:3000. The caller agent's status page, with wallet balances and test buttons, is at http://localhost:4000.

**Fund the test wallets** (`npm run wallets` prints the addresses):
- MON for gas, to both wallets: https://faucet.monad.xyz
- 20 test USDC, to the CALLER wallet: https://faucet.circle.com (network "Monad Testnet")

Without funds, payments run as clearly labelled simulations, so the demo never gets stuck.

**Demo keys:** `H` person · `A` agent · `S` bot · `R` reset (also returns the test USDC) · `M` mute · `D` dashboard

## Deploy it

**Replit:** Create Repl → Import from GitHub → this repo. The included `.replit` runs `npm start` on port 3000. Add the secrets below, then Publish as a **Reserved VM**: the live screen keeps call state in memory, so it needs one always-on instance. Set visibility to **Public**.

**Anywhere else** (Render, Railway, Fly): a Node 20+ web service with build `npm install` and start `npm start`. The front desk listens on `PORT`; the caller agent runs alongside it on port 4000, internal only.

| Secret | Purpose |
|---|---|
| `CALLER_PRIVATE_KEY`, `BUSINESS_PRIVATE_KEY`, `BUSINESS_ADDRESS` | Testnet wallets from `npm run wallets`. Never put real funds here. |
| `VAPI_PHONE_NUMBER` | Optional: shown on the stage, for example `+18575550100` |
| `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` | Optional: an LLM writes the in-browser assistant's replies; otherwise they're scripted |

**After deploying, reconnect the outside services to the new URL:**
- **Phone line:** run `TUNNEL_URL=https://your-new-url npm run phone` locally. It needs `VAPI_PRIVATE_API_KEY` and `OWNER_PHONE` in `.env`, and it updates the existing Vapi assistant and number when `VAPI_ASSISTANT_ID` and `VAPI_PHONE_NUMBER_ID` are set.
- **Muse or another agent:** point its custom connector at `https://your-new-url/mcp` (streamable HTTP, no auth).

## How it fits together

```
front-desk/    stage, dashboard, MCP connector, A2A endpoints, Vapi phone webhook
caller-agent/  agent stand-in + sales bot + Monad wallets (viem), internal on :4000
docs/          spec, build plan, pitch script and judge Q&A from the hackathon
```

Payment steps follow the x402 pattern: an HTTP 402 with a payment request, then a retry with an `X-PAYMENT-TX` header. The front desk verifies each transaction on Monad before confirming. In this demo the caller-agent service signs for both wallets, so it also sends the refund; in production the hold would sit in an escrow contract.

Branding lives in `front-desk/public/brand.js` and `theme.css`.
