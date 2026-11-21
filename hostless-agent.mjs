import { setTimeout as delay } from "node:timers/promises";

const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "content-range",
  "accept-ranges",
  "cache-control",
  "etag",
  "last-modified",
  "content-disposition",
  "expires",
  "vary"
];

export function startHostlessAgent(options = {}) {
  const port = Number(options.port || 18080);
  const relayUrl = String(options.relayUrl || "").replace(/\/+$/, "");
  const token = String(options.token || "").trim();
  const workers = Math.max(1, Math.min(8, Number(options.workers || 3)));
  const localBase = new URL(`http://127.0.0.1:${port}`);

  if (!relayUrl || !token) {
    console.warn("⚠️ Tunnel reverso Hostless desativado: configure HOSTLESS_CACHE_URL e HOSTLESS_AGENT_TOKEN.");
    return () => {};
  }

  const relayBase = new URL(relayUrl);
  const authorization = "Bearer " + token;
  let stopped = false;

  async function sendAgentResponse(job, status, headers, body) {
    const target = new URL("/agent/respond/" + encodeURIComponent(job.id), relayBase);
    const requestHeaders = {
      Authorization: authorization,
      "X-Upstream-Status": String(status),
      "X-Upstream-Headers": Buffer.from(JSON.stringify(headers || {})).toString("base64")
    };
    const init = { method: "POST", headers: requestHeaders };
    if (body !== undefined && body !== null) {
      init.body = body;
      if (typeof body !== "string" && !Buffer.isBuffer(body)) init.duplex = "half";
    }
    const response = await fetch(target, init);
    const message = await response.text().catch(() => "");
    if (!response.ok) {
      throw new Error(`Hostless respondeu HTTP ${response.status}${message ? ": " + message.slice(0, 120) : ""}`);
    }
  }

  async function executeJob(job) {
    if (!job || typeof job.id !== "string" || typeof job.path !== "string" ||
        !job.path.startsWith("/") || !["GET", "HEAD"].includes(job.method)) {
      throw new Error("Solicitação inválida recebida do Hostless.");
    }

    const localUrl = new URL(job.path, localBase);
    if (localUrl.origin !== localBase.origin) throw new Error("Destino local inválido.");

    const headers = {};
    for (const name of ["range", "if-range", "if-none-match", "if-modified-since", "accept", "user-agent"]) {
      const value = job.headers?.[name];
      if (typeof value === "string") headers[name] = value;
    }
    headers["x-forwarded-host"] = String(job.headers?.["x-forwarded-host"] || relayBase.host);
    headers["x-forwarded-proto"] = "https";
    headers["x-forwarded-prefix"] = "/iptv";

    let upstream;
    try {
      upstream = await fetch(localUrl, {
        method: job.method,
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(10 * 60 * 1000)
      });
    } catch (error) {
      await sendAgentResponse(job, 502, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
        "Falha no servidor Termux: " + error.message);
      return;
    }

    try {
      const responseHeaders = {};
      for (const name of FORWARDED_RESPONSE_HEADERS) {
        const value = upstream.headers.get(name);
        if (value) responseHeaders[name] = value;
      }
      await sendAgentResponse(job, upstream.status, responseHeaders, upstream.body);
    } catch (error) {
      await upstream.body?.cancel().catch(() => {});
      throw error;
    }
  }

  async function worker(index) {
    const pollUrl = new URL("/agent/poll", relayBase);
    while (!stopped) {
      try {
        const poll = await fetch(pollUrl, {
          headers: { Authorization: authorization },
          signal: AbortSignal.timeout(35_000),
          cache: "no-store"
        });
        if (poll.status === 204) continue;
        if (!poll.ok) {
          const message = await poll.text().catch(() => "");
          throw new Error(`poll HTTP ${poll.status}${message ? ": " + message.slice(0, 100) : ""}`);
        }
        const job = await poll.json();
        await executeJob(job);
      } catch (error) {
        if (!stopped) {
          console.warn(`⚠️ Tunnel Hostless worker ${index + 1}: ${error.message}`);
          await delay(2000);
        }
      }
    }
  }

  console.log(`📡 Tunnel reverso Hostless ativo: ${relayBase.origin}/iptv/playlist-hls.m3u8 (${workers} workers)`);
  for (let index = 0; index < workers; index += 1) void worker(index);

  return () => { stopped = true; };
}
