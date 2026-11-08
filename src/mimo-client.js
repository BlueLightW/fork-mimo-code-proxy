import http from "node:http";
import { upstream, SERVER_AUTH } from "./config.js";
import { accountPool } from './account-pool.js';
import { config } from './config.js';

// Função para fazer requisições ao MiMo
export async function fetchMimo(response, requestData) {
  const { accountManager } = await import('./account-manager.js');
  const account = accountManager.accounts[0];
  if (!account) throw new Error('Nenhuma conta cadastrada');
  const session = await accountManager.getOrCreateSession(account);

  if (requestData.stream) {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    let queue = [];
    let resolver = null;
    await session.context.exposeFunction('__sendChunk', (chunk) => {
      queue.push(chunk);
      if (resolver) { resolver(); resolver = null; }
      return Promise.resolve();
    });

    // Ensure page is on chat
    if (!session.page.url().includes("aistudio.xiaomimimo.com")) {
      await session.page.goto("https://aistudio.xiaomimimo.com", { waitUntil: "domcontentloaded" });
      await session.page.waitForTimeout(1000);
    }
    const evalPromise = session.page.evaluate(async (body) => {
      try {
      // Ensure we are on chat page
      if (!window.location.href.includes("aistudio.xiaomimimo.com")) {
        window.location.href = "https://aistudio.xiaomimimo.com";
        await new Promise(r => setTimeout(r, 2000));
      }
      let ph = (document.cookie.match(/xiaomichatbot_ph="([^"]+)"/) || [])[1] || "";
      if (!ph) {
        const m = document.cookie.match(/xiaomichatbot_ph=([^;]+)/);
        if (m) ph = m[1];
      }
      if (!ph && window.location.search) {
        const m = window.location.search.match(/xiaomichatbot_ph=([^&]+)/);
        if (m) ph = m[1];
      }
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 120000); const res = await fetch('/open-apis/react/chat?xiaomichatbot_ph=' + encodeURIComponent(ph), { signal: controller.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-timeZone': Intl.DateTimeFormat().resolvedOptions().timeZone, 'Referer': 'https://aistudio.xiaomimimo.com/', 'Origin': 'https://aistudio.xiaomimimo.com', 'Accept': 'text/event-stream' },
        body: JSON.stringify({
        msgId: self.crypto.randomUUID(),
        conversationId: self.crypto.randomUUID(),
        query: (body.messages || []).filter(m => m.role === 'user').slice(-1)[0]?.content || '',
        isEditedQuery: false,
        modelConfig: {
          enableThinking: false,
          webSearchStatus: 'disabled',
          model: (() => {
          const m = (body.model || "").toLowerCase();
          if (m.includes("flash")) return "MiMo-V2.6-Flash";
          if (m.includes("v2.5")) return "MiMo-V2.5";
          return "MiMo-V2.6-Pro";
        })(),
          temperature: body.temperature ?? 0.8,
          topP: body.top_p ?? 0.95,
        },
        multiMedias: [],
      }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error("HTTP " + res.status + ": " + errText.slice(0, 200));
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const dataLine = raw.split('\n').find(l => l.startsWith('data:'));
          if (!dataLine) continue;
          try {
            const j = JSON.parse(dataLine.slice(5).trim());
            const content = j.reasoningContent || j.content || '';
            if (content) {
              await window.__sendChunk('data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\n');
            }
          } catch {}
        }
      }
      await window.__sendChunk('data: [DONE]\n\n');
      clearTimeout(timeout); await window.__sendChunk(null);
      } catch (e) {
        await window.__sendChunk('data: ' + JSON.stringify({ error: e.message }) + '\n\n');
        clearTimeout(timeout); await window.__sendChunk(null);
      }
    }, requestData);

    const streamTimeout = setTimeout(() => {
      if (!response.headersSent) {
        response.writeHead(504, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Stream timeout" }));
      } else {
        response.end();
      }
    }, 300000);

    try {
      while (true) {
        if (queue.length === 0) {
          await new Promise((r) => { resolver = r; });
        }
        const chunk = queue.shift();
        if (chunk === null) break;
        response.write(chunk);
      }
      await evalPromise;
      clearTimeout(streamTimeout);
      response.end();
    } catch (e) {
      clearTimeout(streamTimeout);
      if (!response.headersSent) {
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: e.message }));
      } else {
        response.end();
      }
    }
    return null;
  }

  // Ensure page is on chat
  if (!session.page.url().includes("aistudio.xiaomimimo.com")) {
    await session.page.goto("https://aistudio.xiaomimimo.com", { waitUntil: "domcontentloaded" });
    await session.page.waitForTimeout(1000);
  }
  const result = await session.page.evaluate(async (body) => {
    try {
    let ph = (document.cookie.match(/xiaomichatbot_ph="([^"]+)"/) || [])[1] || "";
      if (!ph) {
        const m = document.cookie.match(/xiaomichatbot_ph=([^;]+)/);
        if (m) ph = m[1];
      }
      if (!ph && window.location.search) {
        const m = window.location.search.match(/xiaomichatbot_ph=([^&]+)/);
        if (m) ph = m[1];
      }
    const res = await fetch('/open-apis/react/chat?xiaomichatbot_ph=' + encodeURIComponent(ph), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-timeZone': Intl.DateTimeFormat().resolvedOptions().timeZone, 'Referer': 'https://aistudio.xiaomimimo.com/', 'Origin': 'https://aistudio.xiaomimimo.com' },
      body: JSON.stringify({
        msgId: self.crypto.randomUUID(),
        conversationId: self.crypto.randomUUID(),
        query: (body.messages || []).filter(m => m.role === 'user').slice(-1)[0]?.content || '',
        isEditedQuery: false,
        modelConfig: {
          enableThinking: false,
          webSearchStatus: 'disabled',
          model: (() => {
          const m = (body.model || "").toLowerCase();
          if (m.includes("flash")) return "MiMo-V2.6-Flash";
          if (m.includes("v2.5")) return "MiMo-V2.5";
          return "MiMo-V2.6-Pro";
        })(),
          temperature: body.temperature ?? 0.8,
          topP: body.top_p ?? 0.95,
        },
        multiMedias: [],
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error('HTTP ' + res.status + ': ' + errText.slice(0, 200));
    }
    const text = await res.text();
      return { status: res.status, text };
    } catch (e) {
      return { status: 0, text: e.message };
    }
  }, requestData);

  if (result.status < 200 || result.status >= 300) {
    throw new Error('MiMo retornou erro: ' + result.status);
  }

  try {
    return JSON.parse(result.text);
  } catch {
    return result.text;
  }
}

export const agent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 10000,
  noDelay: true,
  maxSockets: 64,
  maxFreeSockets: 16,
});

/**
 * Constrói os cabeçalhos padrão para autenticação e envio de requisições ao servidor MiMo.
 * @param {Record<string, string>} [extra={}]
 * @returns {Record<string, string>}
 */
export function serverHeaders(extra = {}) {
  const h = { ...extra, host: upstream.host };
  if (SERVER_AUTH) h["authorization"] = SERVER_AUTH;
  return h;
}

/**
 * Envia uma requisição HTTP para o servidor MiMo upstream e retorna a resposta analisada.
 * @param {string} method
 * @param {string} path
 * @param {any} [body]
 * @param {Record<string, string>} [headers]
 * @returns {Promise<{status: number, json: any, raw: string}>}
 */
export function serverReq(method, path, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        method,
        hostname: upstream.hostname,
        port: upstream.port,
        path,
        agent,
        headers: serverHeaders({
          "content-type": "application/json",
          ...(data ? { "content-length": Buffer.byteLength(data) } : {}),
          ...headers,
        }),
        timeout: 120000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json;
          try {
            json = raw ? JSON.parse(raw) : null;
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, json, raw });
        });
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

/**
 * Abre uma conexão SSE com o endpoint `/event` do MiMo com suporte a reconexão automática (backoff).
 * @param {(evt: any) => void} onEvent
 * @param {(err: Error) => void} [onError]
 * @returns {{close: () => void}}
 */
export function openMiMoEvents(onEvent, onError) {
  let activeReq = null;
  let closed = false;
  let attempt = 0;
  let reconnectTimeout = null;

  function connect() {
    if (closed) return;

    activeReq = http.request(
      {
        method: "GET",
        hostname: upstream.hostname,
        port: upstream.port,
        path: "/event",
        agent,
        headers: serverHeaders({ accept: "text/event-stream" }),
        timeout: 0,
      },
      (res) => {
        attempt = 0; // Conectado com sucesso, reseta tentativas
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          buf += chunk;
          if (buf.length > 1_000_000) {
            res.destroy();
            handleFailure(new Error("SSE buffer overflow"));
            return;
          }
          let idx;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const raw = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const dataLine = raw
              .split("\n")
              .find((l) => l.startsWith("data:"));
            if (!dataLine) continue;
            try {
              onEvent(JSON.parse(dataLine.slice(5).trim()));
            } catch {
              // ignora linhas que não são JSON válido
            }
          }
        });
        res.on("end", () => handleFailure(new Error("event stream ended")));
        res.on("error", (e) => handleFailure(e));
      },
    );
    activeReq.on("error", (e) => handleFailure(e));
    activeReq.end();
  }

  function handleFailure(err) {
    if (closed) return;
    activeReq = null;
    attempt++;
    if (attempt > 5) {
      if (onError) onError(err);
      return;
    }
    // Backoff rápido: 100ms, 200ms, 400ms, 800ms, 1600ms
    const delay = 100 * Math.pow(2, attempt - 1);
    reconnectTimeout = setTimeout(connect, delay);
  }

  connect();

  return {
    close() {
      closed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (activeReq) activeReq.destroy();
    },
  };
}
