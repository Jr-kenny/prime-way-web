# PRODUCT.md — Prime Way Web (cross-chain bridge)

## What it is
A web cross-chain bridge for friends and family, powered by Relay.
The user connects their own wallet, picks a source chain/token and a
destination chain/token, gets a live Relay quote, reviews the exact
route/fees, signs the quote steps in their wallet, and tracks the
transfer until it lands or is refunded.

## What it is not
Not a landing page. Not a demo. Not a new brand. It is the web
surface of Prime Way, the product already live as a mobile app and
already backed by the Prime Way Relay backend.

## Mode
Operate — the visitor completes a task (bridging). Precision and
restraint outrank expression. Brand lives in precise details.

## Verified facts (live, 2026-11-14)
- Relay API: `https://api.relay.link`, quote endpoint `POST /quote/v2`,
  status `GET /intents/status/v3?requestId=...`, chains `GET /chains`,
  currencies `POST /currencies/v2`, requests `GET /requests/v3`.
- Attribution: the `x-api-key` header identifies the Relay App
  (`app_id_5eeb5253-79c6-41ab-bfb6-e576b5c332d9`, "Prime way").
  Every authenticated request is attributed to that App and appears
  in Dashboard → Requests with `appId` / `apiKeyName`.
  `referrer` is an optional free-form string on the quote
  (e.g. `prime-way-web`) used for filtering, not the App identity.
  No `appFees` are charged — no fee is taken from users.
- Prime Way backend (already live, holds the key server-side):
  `https://prime-way-backend.onrender.com` — `GET /health`,
  `GET /chains`, `GET /currencies?chainId=...`, `POST /quote`,
  `GET /status?requestId=...`, `GET /token-icon?...`.
  Live quote 2026-11-14: 1 USDC Base → Arbitrum = 0.976716 USDC out,
  $0.024263 fees, steps approve + deposit.
- Wallet: injected EVM wallets (MetaMask/Rabby/etc.) via viem.
  No WalletConnect project id exists, so no WalletConnect.
  No private keys or seed phrases are ever requested or stored.
- Chains/tokens/balances come from Relay live data, never hardcoded.
  History comes from Relay `/requests/v3` via the backend, plus
  locally recorded sends (requestId, hashes, status) — never invented.

## Surfaces
1. Bridge — the only primary screen: from/to selectors, amount,
   balance, quote, review, sign, track.
2. Activity — real transaction history for the connected wallet.

## Design direction (user's brief)
Mature, deliberate, premium financial product. Financial credibility,
technical sophistication, reliability, simplicity, precision,
confidence. No generic gradients, no glassmorphism, no glowing
borders, no decorative shapes, no emoji as icons, no fake stats,
no placeholder content presented as real.
