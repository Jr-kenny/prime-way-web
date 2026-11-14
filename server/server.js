// Prime Way Web server: Relay proxy + static frontend host.
//
// Lineage: built from the Prime Way mobile backend
// (prime-way-site/backend/server.js, verified live 2026-11-08/12),
// extended for the web bridge:
//   - every quote carries referrer "prime-way-web" (surface tag for
//     filtering in the Relay dashboard; attribution itself comes from
//     the x-api-key header, which identifies the Prime Way App)
//   - /quote returns a fee breakdown, not just a total
//   - GET /requests proxies Relay /requests/v3 for real history
//   - serves the built frontend (web/dist) when present
//
// The Relay API key is read from RELAY_API_KEY at runtime and never
// lives in this repo, in code, or in logs. In production the server
// refuses to start without it (same as the mobile backend). In
// development (NODE_ENV != "production") without a key, /quote and
// /status forward to the live Prime Way backend
// (UPSTREAM_API_BASE, default https://prime-way-backend.onrender.com),
// which holds the same Prime Way App key — so local development works
// with zero secrets and attribution is identical either way.

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const RELAY_API_BASE = (process.env.RELAY_API_BASE || "https://api.relay.link").replace(
  /\/+$/,
  ""
);
const RELAY_QUOTE_URL = `${RELAY_API_BASE}/quote/v2`;
const RELAY_STATUS_URL = `${RELAY_API_BASE}/intents/status/v3`;
const RELAY_CHAINS_URL = `${RELAY_API_BASE}/chains`;
const RELAY_CURRENCIES_URL = `${RELAY_API_BASE}/currencies/v2`;
const RELAY_REQUESTS_URL = `${RELAY_API_BASE}/requests/v3`;
const UPSTREAM_API_BASE = (process.env.UPSTREAM_API_BASE ||
  "https://prime-way-backend.onrender.com").replace(/\/+$/, "");
const REFERRER = "prime-way-web";
const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === "production";
const HAS_KEY = Boolean(process.env.RELAY_API_KEY);
const DIST_DIR = path.join(__dirname, "..", "web", "dist");

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const REQUEST_ID_RE = /^0x[0-9a-fA-F]{64}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const CACHE_TTL_MS = 60 * 60 * 1000;

const FEE_LINES = ["gas", "relayer", "app", "subsidized"];
const FEE_LABELS = {
  app: "App",
  gas: "Gas",
  relayer: "Relayer",
  subsidized: "Subsidized",
};

function sumFeesUsd(fees) {
  let total = 0;
  for (const line of FEE_LINES) {
    const entry = fees && fees[line];
    if (entry && entry.amountUsd !== undefined) {
      const n = Number(entry.amountUsd);
      if (Number.isFinite(n)) total += n;
    }
  }
  return Math.round(total * 1e6) / 1e6;
}

// Relay's `relayer` line already contains relayerGas + relayerService,
// so the breakdown lists gas / relayer / app / subsidized only.
function feeBreakdown(fees) {
  const out = [];
  for (const line of FEE_LINES) {
    const entry = fees && fees[line];
    if (!entry || entry.amountUsd === undefined) continue;
    const n = Number(entry.amountUsd);
    if (!Number.isFinite(n)) continue;
    out.push({
      amountUsd: Math.round(n * 1e6) / 1e6,
      label: FEE_LABELS[line] || line,
      symbol:
        entry.currency && typeof entry.currency.symbol === "string"
          ? entry.currency.symbol
          : undefined,
    });
  }
  return out;
}

function validateQuoteInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "request body must be a JSON object";
  }
  for (const field of ["user", "recipient", "originCurrency", "destinationCurrency"]) {
    if (typeof body[field] !== "string" || !ADDRESS_RE.test(body[field])) {
      return `${field} must be an address like 0x followed by 40 hex characters`;
    }
  }
  if (body.recipient.toLowerCase() === ZERO_ADDRESS) {
    return "recipient must not be the zero address";
  }
  for (const field of ["originChainId", "destinationChainId"]) {
    if (!Number.isInteger(body[field]) || body[field] <= 0) {
      return `${field} must be a positive integer chain id`;
    }
  }
  if (typeof body.amount !== "string" || !/^[0-9]+$/.test(body.amount)) {
    return "amount must be a positive integer string in the token's smallest units";
  }
  if (BigInt(body.amount) <= 0n) {
    return "amount must be greater than zero";
  }
  if (body.topupGas !== undefined && typeof body.topupGas !== "boolean") {
    return "topupGas must be a boolean when present";
  }
  return null;
}

function shapeChain(chain) {
  if (!chain || typeof chain !== "object" || Array.isArray(chain)) return null;
  if (!Number.isInteger(chain.id) || chain.id <= 0) return null;
  if (typeof chain.name !== "string" || !chain.name) return null;
  const currency = chain.currency;
  if (!currency || typeof currency !== "object") return null;
  if (typeof currency.symbol !== "string" || !currency.symbol) return null;
  if (!Number.isInteger(currency.decimals) || currency.decimals < 0) return null;
  const shaped = {
    id: chain.id,
    name: chain.name,
    displayName:
      typeof chain.displayName === "string" && chain.displayName
        ? chain.displayName
        : chain.name,
    nativeCurrency: { symbol: currency.symbol, decimals: currency.decimals },
    evm: chain.vmType === "evm",
    disabled: chain.disabled === true,
  };
  if (typeof chain.explorerUrl === "string" && chain.explorerUrl) {
    shaped.explorerUrl = chain.explorerUrl;
  }
  if (typeof chain.iconUrl === "string" && chain.iconUrl) {
    shaped.iconUrl = chain.iconUrl;
  }
  if (typeof chain.httpRpcUrl === "string" && chain.httpRpcUrl) {
    shaped.rpcUrl = chain.httpRpcUrl;
  }
  return shaped;
}

function shapeCurrency(currency) {
  if (!currency || typeof currency !== "object" || Array.isArray(currency)) {
    return null;
  }
  if (typeof currency.address !== "string" || !currency.address) return null;
  if (typeof currency.symbol !== "string" || !currency.symbol) return null;
  if (!Number.isInteger(currency.decimals) || currency.decimals < 0) {
    return null;
  }
  const shaped = {
    address: currency.address,
    symbol: currency.symbol,
    decimals: currency.decimals,
    name: typeof currency.name === "string" ? currency.name : "",
  };
  const metadata = currency.metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const logoURI = metadata.logoURI;
    if (typeof logoURI === "string" && /^https?:\/\//.test(logoURI)) {
      shaped.iconUrl = logoURI;
    }
  }
  return shaped;
}

const chainsCache = { data: null, fetchedAt: 0, inflight: null };
const currenciesCache = new Map();

function cacheIsFresh(entry) {
  return entry.data !== null && Date.now() - entry.fetchedAt < CACHE_TTL_MS;
}

async function fetchChainsFromRelay() {
  const res = await fetch(RELAY_CHAINS_URL);
  if (!res.ok) return null;
  let relay;
  try {
    relay = await res.json();
  } catch {
    return null;
  }
  if (!relay || !Array.isArray(relay.chains)) return null;
  const chains = [];
  const rawById = new Map();
  for (const chain of relay.chains) {
    const shaped = shapeChain(chain);
    if (shaped) {
      chains.push(shaped);
      rawById.set(chain.id, chain);
    }
  }
  if (chains.length === 0) return null;
  return { chains, rawById };
}

async function getChains() {
  if (cacheIsFresh(chainsCache)) return chainsCache.data;
  if (chainsCache.inflight) return chainsCache.inflight;
  chainsCache.inflight = (async () => {
    try {
      const fresh = await fetchChainsFromRelay();
      if (fresh) {
        chainsCache.data = fresh;
        chainsCache.fetchedAt = Date.now();
      }
    } catch {
      // Keep serving the stale list below, if any.
    } finally {
      chainsCache.inflight = null;
    }
    return chainsCache.data;
  })();
  return chainsCache.inflight;
}

async function fetchCurrenciesFromRelay(chainId) {
  const headers = { "Content-Type": "application/json" };
  if (process.env.RELAY_API_KEY) headers["x-api-key"] = process.env.RELAY_API_KEY;
  const res = await fetch(RELAY_CURRENCIES_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ chainIds: [chainId], limit: 100 }),
  });
  if (!res.ok) return null;
  let relay;
  try {
    relay = await res.json();
  } catch {
    return null;
  }
  if (!Array.isArray(relay)) return null;
  const seen = new Set();
  const currencies = [];
  for (const currency of relay) {
    const shaped = shapeCurrency(currency);
    if (shaped && !seen.has(shaped.address)) {
      seen.add(shaped.address);
      currencies.push(shaped);
    }
  }
  return currencies;
}

async function getCurrencies(chainId) {
  let entry = currenciesCache.get(chainId);
  if (!entry) {
    entry = { data: null, fetchedAt: 0, inflight: null };
    currenciesCache.set(chainId, entry);
  }
  if (cacheIsFresh(entry)) return entry.data;
  if (entry.inflight) return entry.inflight;
  entry.inflight = (async () => {
    try {
      const fresh = await fetchCurrenciesFromRelay(chainId);
      if (fresh !== null) {
        entry.data = fresh;
        entry.fetchedAt = Date.now();
      }
    } catch {
      // Keep serving the stale list below, if any.
    } finally {
      entry.inflight = null;
    }
    return entry.data;
  })();
  return entry.inflight;
}

function parseChainIdParam(raw) {
  if (typeof raw !== "string" || !/^[0-9]+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

function shouldTopUpGas(body, chainsData) {
  if (body.topupGas !== true) return false;
  if (!chainsData) return false;
  const origin = chainsData.rawById.get(body.originChainId);
  const destination = chainsData.rawById.get(body.destinationChainId);
  if (!origin || !destination) return false;
  if (origin.vmType !== "evm" || destination.vmType !== "evm") return false;
  const originCurrency = String(body.originCurrency).toLowerCase();
  const nativeAddress =
    origin.currency && typeof origin.currency.address === "string"
      ? origin.currency.address.toLowerCase()
      : "";
  if (nativeAddress && originCurrency === nativeAddress) return false;
  if (originCurrency === ZERO_ADDRESS) return false;
  return true;
}

function shapeQuote(relay, body) {
  const out = relay.details && relay.details.currencyOut;
  const currency = out && out.currency;
  return {
    requestId: relay.requestId,
    outputAmount: out ? out.amount : null,
    outputAmountFormatted: out ? out.amountFormatted : null,
    outputCurrency: (currency && currency.symbol) || body.destinationCurrency,
    feesUsd: sumFeesUsd(relay.fees),
    fees: feeBreakdown(relay.fees),
    steps: (relay.steps || []).map((step) => {
      const item = step.items && step.items[0];
      const d = item && item.data;
      return {
        id: step.id,
        action: step.action,
        description: step.description,
        tx:
          d && d.to && d.data
            ? {
                to: d.to,
                data: d.data,
                value: String(d.value ?? "0"),
                chainId: Number(d.chainId),
                ...(d.gas ? { gas: String(d.gas) } : {}),
                ...(d.maxFeePerGas
                  ? { maxFeePerGas: String(d.maxFeePerGas) }
                  : {}),
                ...(d.maxPriorityFeePerGas
                  ? { maxPriorityFeePerGas: String(d.maxPriorityFeePerGas) }
                  : {}),
              }
            : null,
      };
    }),
    timeEstimate: relay.details ? relay.details.timeEstimate : null,
  };
}

function shapeStatus(relay, requestId) {
  const hashes = [];
  const collect = (v) => {
    if (typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v)) hashes.push(v);
    if (Array.isArray(v)) v.forEach(collect);
  };
  collect(relay.txHashes);
  if (relay.details) {
    collect(relay.details.txHashes);
    collect(relay.details.destinationTxHash);
    collect(relay.details.destinationTxHashes);
    collect(relay.details.inTxHashes);
    collect(relay.details.outTxHashes);
  }
  return { requestId, status: relay.status || null, txHashes: [...new Set(hashes)] };
}

// Map one Relay /requests/v3 row to the app's history shape. The API
// nests most fields under `data` and names the id differently across
// versions, so every field is read defensively; a row without a
// requestId is dropped, never guessed.
function shapeRequest(row) {
  if (!row || typeof row !== "object") return null;
  const data = row.data && typeof row.data === "object" ? row.data : {};
  const pick = (...keys) => {
    for (const k of keys) {
      if (row[k] !== undefined && row[k] !== null) return row[k];
      if (data[k] !== undefined && data[k] !== null) return data[k];
    }
    return null;
  };
  const requestId = pick("requestId", "id");
  if (typeof requestId !== "string" || !REQUEST_ID_RE.test(requestId)) {
    return null;
  }
  const txHashes = [];
  const collect = (v) => {
    if (typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v)) txHashes.push(v);
    if (Array.isArray(v)) v.forEach(collect);
  };
  collect(pick("txHashes"));
  collect(data.txHashes);
  collect(data.outTxs);
  collect(data.inTxs);
  const entry = {
    requestId,
    status: pick("status") || "pending",
    user: pick("user") || "",
    recipient: pick("recipient") || "",
    originChainId: Number(pick("originChainId")) || 0,
    destinationChainId: Number(pick("destinationChainId")) || 0,
    originSymbol: pick("originCurrencySymbol", "originSymbol") || "",
    destinationSymbol: pick("destinationCurrencySymbol", "destinationSymbol") || "",
    amountIn: pick("amountInFormatted", "amountIn") || "",
    amountOut: pick("amountOutFormatted", "amountOut") || null,
    createdAt: pick("createdAt") || new Date().toISOString(),
    txHashes: [...new Set(txHashes)],
    source: "relay",
  };
  if (typeof entry.amountIn !== "string") entry.amountIn = String(entry.amountIn);
  if (entry.amountOut !== null && typeof entry.amountOut !== "string") {
    entry.amountOut = String(entry.amountOut);
  }
  return entry;
}

function sendJson(res, status, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Forward a call to the live Prime Way backend (development without a
// key). The upstream holds the same Prime Way App key, so attribution
// is identical; this path never carries a key of its own.
async function forwardUpstream(path, method, body) {
  const res = await fetch(`${UPSTREAM_API_BASE}${path}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: { "Content-Type": "application/json" },
    method,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { error: "upstream returned a non-JSON response" };
  }
  return { json, status: res.status };
}

async function handleChains(req, res) {
  const data = await getChains();
  if (!data) {
    sendJson(res, 502, { error: "could not reach Relay" });
    return;
  }
  sendJson(res, 200, { chains: data.chains });
}

async function handleCurrencies(req, res) {
  const url = new URL(req.url, "http://localhost");
  const chainId = parseChainIdParam(url.searchParams.get("chainId"));
  if (chainId === null) {
    sendJson(res, 400, { error: "chainId must be a positive integer chain id" });
    return;
  }
  const currencies = await getCurrencies(chainId);
  if (currencies === null) {
    sendJson(res, 502, { error: "could not reach Relay" });
    return;
  }
  sendJson(res, 200, { chainId, currencies });
}

async function handleQuote(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: "request body must be valid JSON" });
    return;
  }
  const problem = validateQuoteInput(body);
  if (problem) {
    sendJson(res, 400, { error: problem });
    return;
  }

  if (!HAS_KEY) {
    const upstream = await forwardUpstream("/quote", "POST", body).catch(() => null);
    if (!upstream) {
      sendJson(res, 502, { error: "could not reach Relay" });
      return;
    }
    sendJson(res, upstream.status, upstream.json);
    return;
  }

  let topUpGas = false;
  if (body.topupGas === true) {
    const chainsData = await getChains();
    topUpGas = shouldTopUpGas(body, chainsData);
  }

  let relayRes;
  try {
    relayRes = await fetch(RELAY_QUOTE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.RELAY_API_KEY,
      },
      body: JSON.stringify({
        user: body.user,
        recipient: body.recipient,
        originChainId: body.originChainId,
        destinationChainId: body.destinationChainId,
        originCurrency: body.originCurrency,
        destinationCurrency: body.destinationCurrency,
        amount: body.amount,
        tradeType: "EXACT_INPUT",
        referrer: REFERRER,
        ...(topUpGas ? { topupGas: true } : {}),
      }),
    });
  } catch {
    sendJson(res, 502, { error: "could not reach Relay" });
    return;
  }
  if (!relayRes.ok) {
    let detail = "";
    try {
      const errBody = await relayRes.json();
      if (errBody && typeof errBody.message === "string") detail = errBody.message;
    } catch {
      // Keep the status-only error below.
    }
    sendJson(res, 502, {
      error: detail ? `Relay quote failed: ${detail}` : "Relay quote failed",
      relayStatus: relayRes.status,
    });
    return;
  }
  const relay = await relayRes.json();
  sendJson(res, 200, shapeQuote(relay, body));
}

async function handleStatus(req, res) {
  const url = new URL(req.url, "http://localhost");
  const requestId = url.searchParams.get("requestId") || "";
  if (!REQUEST_ID_RE.test(requestId)) {
    sendJson(res, 400, { error: "requestId must be 0x followed by 64 hex characters" });
    return;
  }
  if (!HAS_KEY) {
    const upstream = await forwardUpstream(
      `/status?requestId=${encodeURIComponent(requestId)}`,
      "GET",
    ).catch(() => null);
    if (!upstream) {
      sendJson(res, 502, { error: "could not reach Relay" });
      return;
    }
    sendJson(res, upstream.status, upstream.json);
    return;
  }
  let relayRes;
  try {
    relayRes = await fetch(
      `${RELAY_STATUS_URL}?requestId=${encodeURIComponent(requestId)}`,
      { headers: { "x-api-key": process.env.RELAY_API_KEY } },
    );
  } catch {
    sendJson(res, 502, { error: "could not reach Relay" });
    return;
  }
  if (!relayRes.ok) {
    sendJson(res, 502, { error: "Relay status failed", relayStatus: relayRes.status });
    return;
  }
  const relay = await relayRes.json();
  sendJson(res, 200, shapeStatus(relay, requestId));
}

async function handleRequests(req, res) {
  const url = new URL(req.url, "http://localhost");
  const user = (url.searchParams.get("user") || "").toLowerCase();
  if (!ADDRESS_RE.test(user)) {
    sendJson(res, 400, { error: "user must be a wallet address" });
    return;
  }
  const limitRaw = Number(url.searchParams.get("limit") || 25);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 25;
  if (!HAS_KEY) {
    sendJson(res, 503, {
      error: "Relay history needs the server key; local records are used instead",
      entries: [],
    });
    return;
  }
  let relayRes;
  try {
    relayRes = await fetch(
      `${RELAY_REQUESTS_URL}?limit=${limit}&includePendingRequests=true&includeAuthenticatedData=true`,
      { headers: { "x-api-key": process.env.RELAY_API_KEY } },
    );
  } catch {
    sendJson(res, 502, { error: "could not reach Relay" });
    return;
  }
  if (!relayRes.ok) {
    sendJson(res, 502, { error: "Relay history failed", relayStatus: relayRes.status });
    return;
  }
  let relay;
  try {
    relay = await relayRes.json();
  } catch {
    sendJson(res, 502, { error: "Relay history failed" });
    return;
  }
  const rows = Array.isArray(relay)
    ? relay
    : Array.isArray(relay.requests)
      ? relay.requests
      : [];
  const entries = [];
  for (const row of rows) {
    const shaped = shapeRequest(row);
    if (!shaped) continue;
    if (
      shaped.user.toLowerCase() !== user &&
      shaped.recipient.toLowerCase() !== user
    ) {
      continue;
    }
    entries.push(shaped);
  }
  sendJson(res, 200, { entries: entries.slice(0, limit) });
}

const MIME = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function handleStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/" || pathname === "/bridge" || pathname === "/activity") {
    pathname = "/index.html";
  }
  const file = path.join(DIST_DIR, pathname);
  if (!file.startsWith(DIST_DIR)) {
    sendJson(res, 404, { error: "not found" });
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
    });
    res.end(data);
  });
}

function createServer() {
  return http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      });
      res.end();
      return;
    }
    if ((req.method === "GET" || req.method === "HEAD") && req.url === "/health") {
      sendJson(res, 200, { ok: true, key: HAS_KEY });
      return;
    }
    if (req.method === "GET" && req.url === "/chains") {
      handleChains(req, res).catch(() => {
        if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
      });
      return;
    }
    if (req.method === "GET" && req.url.startsWith("/currencies")) {
      handleCurrencies(req, res).catch(() => {
        if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
      });
      return;
    }
    if (req.method === "POST" && req.url === "/quote") {
      handleQuote(req, res).catch(() => {
        if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
      });
      return;
    }
    if (req.method === "GET" && req.url.startsWith("/status")) {
      handleStatus(req, res).catch(() => {
        if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
      });
      return;
    }
    if (req.method === "GET" && req.url.startsWith("/requests")) {
      handleRequests(req, res).catch(() => {
        if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
      });
      return;
    }
    if (req.method === "GET" && fs.existsSync(DIST_DIR)) {
      handleStatic(req, res);
      return;
    }
    sendJson(res, 404, { error: "not found" });
  });
}

function main() {
  if (IS_PROD && !HAS_KEY) {
    console.error(
      "Prime Way Web server cannot start in production: RELAY_API_KEY is not set. " +
        "Set RELAY_API_KEY to your Relay API key and start the service again. " +
        "The key never belongs in this repo.",
    );
    process.exit(1);
  }
  if (!HAS_KEY) {
    console.warn(
      "RELAY_API_KEY is not set: quotes and status forward to the live " +
        "Prime Way backend, and Relay history is unavailable. Set " +
        "RELAY_API_KEY to call Relay directly.",
    );
  }
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`Prime Way Web server listening on port ${PORT}`);
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  createServer,
  validateQuoteInput,
  shapeQuote,
  shapeStatus,
  shapeRequest,
  sumFeesUsd,
  feeBreakdown,
  shapeChain,
  shapeCurrency,
  parseChainIdParam,
  shouldTopUpGas,
  CACHE_TTL_MS,
};
