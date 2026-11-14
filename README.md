# Prime Way Web — cross-chain bridge powered by Relay

A web bridge for friends and family. Connect an injected EVM wallet,
pick networks and tokens from live Relay data, get a live quote, review
the exact route and fees, sign in your wallet, and track the transfer
until it lands or is refunded.

## What is real

- Chains and tokens come from Relay live (`GET /chains`,
  `POST /currencies/v2`) — never a hardcoded list.
- Quotes come from Relay live (`POST /quote/v2`) through the server.
- Execution sends the quote's own steps (approve, then deposit) with
  the user's wallet via viem. No private keys or seed phrases are
  ever requested or stored.
- Status comes from Relay live (`GET /intents/status/v3`), polled
  until success or refund.
- History comes from Relay (`GET /requests/v3`, when the server runs
  with the key) plus sends recorded locally in the browser. Nothing
  is invented.

## Attribution — verified against the official docs

Relay identifies an integrator by the API key: the `x-api-key` header
authenticates requests for one App, and those requests are attributed
to that App and appear in Dashboard → Requests (with `appId` and
`apiKeyName`). The Prime Way App is
`app_id_5eeb5253-79c6-41ab-bfb6-e576b5c332d9` ("Prime way").

This app routes every quote through a backend holding that App's key —
either this server (with `RELAY_API_KEY` set) or the live Prime Way
backend on Render, which holds the same key. Every quote also carries
`referrer: "prime-way-web"`, an optional surface tag Relay echoes back
on requests and webhooks for filtering. No `appFees` are charged:
no fee is taken from users.

Note: on 2026-11-13, bridges executed through a direct API helper
did not show in the Prime Way dashboard. The documented explanation
is that the helper's credential belongs to a different App than
"Prime way" — attribution follows the key, not the caller. This app
avoids that by using only the Prime Way backend/key path above.

## Run it

```sh
# Frontend (development, proxied to the local server on :3000)
cd web && npm install && npm run dev

# Server (development without a key: quotes/status forward to the
# live Prime Way backend; history falls back to local records)
node server/server.js

# Server (production: calls Relay directly, with attribution)
RELAY_API_KEY=your-relay-api-key NODE_ENV=production node server/server.js
```

Build the frontend and serve it from the same server:

```sh
cd web && npm run build
cd .. && node server/server.js   # serves web/dist + the API
```

## Deploy

One service (Render free tier works): root directory is this project,
build command `npm install && npm --prefix web install && npm --prefix web run build`,
start command `node server/server.js`. Set `RELAY_API_KEY` in the
service's Environment (never in the repo) and `NODE_ENV=production`.
The key is the Prime Way App key from the Relay dashboard.

Do not deploy until the user has reviewed the running app and said go.

## Known limits (stated, not hidden)

- Origin chain must be EVM: the wallet signs the deposit on the origin
  chain, so only EVM origins work with an EVM wallet.
  Destination chains can be any Relay chain, including non-EVM.
- Wallet connection is wagmi: browser wallets (MetaMask, Rabby, Brave)
  and Coinbase Wallet. WalletConnect / Reown AppKit is not wired in —
  it needs a Reown Cloud project id, which does not exist for this app.
- Token lists cap at 100 per chain (Relay's `/currencies/v2` limit).
- Relay history (`/requests`) needs the server key; without it the
  Activity tab shows sends recorded in the browser, with live status.
