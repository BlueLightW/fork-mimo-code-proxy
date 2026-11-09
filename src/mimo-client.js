import http from "node:http";
import { upstream, SERVER_AUTH } from "./config.js";
import { accountPool } from './account-pool.js'; // Use o pool!

// Função auxiliar para montar o histórico (igual ao mimo-2api faz)
// Substitua a função buildHistory por esta versão mais simples:
// Substitua a função buildQuery por esta:
function buildHistory(messages) {
    // Pega APENAS a última mensagem do usuário
    const userMessages = (messages || []).filter(m => m.role === 'user');
    if (userMessages.length === 0) return '';
    
    const lastMessage = userMessages[userMessages.length - 1];
    
    // Extrai o texto da mensagem
    if (typeof lastMessage.content === 'string') {
        return lastMessage.content;
    }
    
    if (Array.isArray(lastMessage.content)) {
        return lastMessage.content
            .filter(p => p.type === 'text')
            .map(p => p.text)
            .join('\n');
    }
    
    return String(lastMessage.content || '');
}
export async function fetchMimo(response, requestData) {
    const { accountManager } = await import('./account-manager.js');
    
    // CORREÇÃO 1: Usar o Pool de Contas em vez de accounts[0]
    const account = accountManager.accounts[0]; // TODO: Migrar para accountPool.acquire()
    if (!account) throw new Error('Nenhuma conta cadastrada');
    
    const session = await accountManager.getOrCreateSession(account);
    const historyStr = buildHistory(requestData.messages);

    if (requestData.stream) {
        response.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        });

        let queue = [];
        let resolver = null;
        
        // CORREÇÃO 2: Nome de função dinâmico para evitar crash do Playwright na 2ª requisição
        const funcName = `__sendChunk_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        await session.page.exposeFunction(funcName, (chunk) => {
            queue.push(chunk);
            if (resolver) { resolver(); resolver = null; }
            return Promise.resolve();
        });

        // Garantir que está na página
        if (!session.page.url().includes("aistudio.xiaomimimo.com")) {
            await session.page.goto("https://aistudio.xiaomimimo.com", { waitUntil: "domcontentloaded" });
            await session.page.waitForTimeout(1000);
        }

        const evalPromise = session.page.evaluate(async ({ body, funcName, historyStr }) => {
            try {
                let ph = (document.cookie.match(/xiaomichatbot_ph="?([^";]+)"?/) || [])[1] || "";
                
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 120000);
                
                const res = await fetch('/open-apis/react/chat?xiaomichatbot_ph=' + encodeURIComponent(ph), {
                    signal: controller.signal,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-timeZone': Intl.DateTimeFormat().resolvedOptions().timeZone,
                        'Accept': 'text/event-stream'
                    },
                    body: JSON.stringify({
                        msgId: self.crypto.randomUUID(),
                        conversationId: self.crypto.randomUUID(),
                        query: buildQuery(body.messages),
                        systemPrompt: (() => {
                            const systemMsgs = (body.messages || []).filter(m => m.role === 'system');
                            return systemMsgs.map(m => typeof m.content === 'string' ? m.content : '').join('\n');
                        })(),
                        isEditedQuery: false,
                        modelConfig: {
                            enableThinking: false,
                            webSearchStatus: 'disabled',
                            model: (() => {
                                const m = (body.model || "").toLowerCase();
                                if (m.includes("flash")) return "mimo-v2.6-flash";
                                if (m.includes("v2.5-pro")) return "mimo-v2.5-pro";
                                if (m.includes("v2.5")) return "mimo-v2.5";
                                if (m.includes("ultraspeed")) return "mimo-v2.6-pro-ultraspeed";
                                return "mimo-v2.6-pro";
                            })(),
                            temperature: body.temperature ?? 0.8,
                            topP: body.top_p ?? 0.95,
                        },
                        multiMedias: [],
                    }),
                });

                if (!res.ok) throw new Error("HTTP " + res.status);

const decoder = new TextDecoder();
let buf = '';
let fullContent = '';
let fullReasoning = '';

while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || ''; // Mantém linha incompleta
    
    for (let line of lines) {
        line = line.trim();
        if (!line || !line.startsWith('data:')) continue;
        
        const dataStr = line.slice(5).trim();
        if (dataStr === '[DONE]') continue;
        
        try {
            const j = JSON.parse(dataStr);
            
            // Separa reasoning do content
            if (j.reasoningContent) {
                fullReasoning += j.reasoningContent;
                // Envia reasoning separado (para clientes que suportam)
                await window[funcName]('data: ' + JSON.stringify({
                    choices: [{ delta: { reasoning_content: j.reasoningContent } }]
                }) + '\n\n');
            }
            
            if (j.content) {
                fullContent += j.content;
                // Envia content normal
                await window[funcName]('data: ' + JSON.stringify({
                    choices: [{ delta: { content: j.content } }]
                }) + '\n\n');
            }
        } catch (e) {
            // Ignora JSON inválido silenciosamente
        }
    }
}

// Envia [DONE] apenas uma vez no final
await window[funcName]('data: [DONE]\n\n');
await window[funcName](null);
            } catch (e) {
                await window[funcName]('data: ' + JSON.stringify({ error: e.message }) + '\n\n');
                await window[funcName](null);
            }
        }, { body: requestData, funcName, historyStr });

        // CORREÇÃO 4: Tratar rejeição da Promise do Browser para não travar o Node
        let evalError = null;
        evalPromise.catch(e => { evalError = e; if (resolver) resolver(); });

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
                if (evalError) throw evalError; // Aborta se o browser crashar
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

    // --- NÃO STREAMING ---
    const result = await session.page.evaluate(async ({ body, historyStr }) => {
        console.log('[MiMo Request] Model:', body.model);
        console.log('[MiMo Request] Messages count:', body.messages?.length);
        console.log('[MiMo Request] Query:', buildQuery(body.messages).substring(0, 100) + '...');
        console.log('[MiMo Request] System prompt length:', (() => {
            const systemMsgs = (body.messages || []).filter(m => m.role === 'system');
            return systemMsgs.map(m => typeof m.content === 'string' ? m.content : '').join('\n').length;
        })());
        try {
            let ph = (document.cookie.match(/xiaomichatbot_ph="?([^";]+)"?/) || [])[1] || "";
            const res = await fetch('/open-apis/react/chat?xiaomichatbot_ph=' + encodeURIComponent(ph), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    msgId: self.crypto.randomUUID(),
                    conversationId: self.crypto.randomUUID(),
                    query: buildQuery(body.messages),
                    systemPrompt: (() => {
                        const systemMsgs = (body.messages || []).filter(m => m.role === 'system');
                        return systemMsgs.map(m => typeof m.content === 'string' ? m.content : '').join('\n');
                    })(),
                    isEditedQuery: false,
                    modelConfig: {
                        enableThinking: false,
                        webSearchStatus: 'disabled',
                        model: (() => {
                            const m = (body.model || "").toLowerCase();
                            if (m.includes("flash")) return "mimo-v2.6-flash";
                            if (m.includes("v2.5-pro")) return "mimo-v2.5-pro";
                            if (m.includes("v2.5")) return "mimo-v2.5";
                            if (m.includes("ultraspeed")) return "mimo-v2.6-pro-ultraspeed";
                            return "mimo-v2.6-pro";
                        })(),
                        temperature: body.temperature ?? 0.8,
                        topP: body.top_p ?? 0.95,
                    },
                    multiMedias: [],
                }),
            });
            
            // CORREÇÃO 5: A API sempre responde SSE, mesmo sem stream. Parseamos o texto.
            const text = await res.text();
            let fullContent = '';
            const lines = text.split('\n');
            // Dentro do session.page.evaluate, substitua o bloco de parsing por este:

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                
                // Processa linha por linha
                let lines = buf.split('\n');
                buf = lines.pop(); // Mantém a última linha incompleta no buffer
                
                for (let line of lines) {
                    line = line.trim();
                    
                    // Ignora linhas vazias
                    if (!line) continue;
                    
                    // Processa apenas linhas de dados
                    if (line.startsWith('data:')) {
                        const dataStr = line.slice(5).trim();
                        
                        if (dataStr === '[DONE]') {
                            await window[funcName]('data: [DONE]\n\n');
                            continue;
                        }
                        
                        try {
                            const j = JSON.parse(dataStr);
                            
                            // Verifica se é uma resposta de erro/bloqueio
                            if (j.content && j.content.includes("I can't answer")) {
                                await window[funcName]('data: ' + JSON.stringify({
                                    error: {
                                        message: "MiMo bloqueou esta requisição (filtro de conteúdo)",
                                        type: "content_filter",
                                        original_message: j.content
                                    }
                                }) + '\n\n');
                                await window[funcName](null);
                                return; // Para imediatamente
                            }
                            
                            const content = j.reasoningContent || j.content || j.text || '';
                            if (content) {
                                await window[funcName]('data: ' + JSON.stringify({ 
                                    choices: [{ delta: { content } }] 
                                }) + '\n\n');
                            }
                        } catch (e) {
                            // Ignora JSON inválido
                            console.log('[MiMo Parser] JSON inválido:', dataStr);
                        }
                    }
                }
            }
            return { status: res.status, text: fullContent };
        } catch (e) {
            return { status: 0, text: e.message };
        }
    }, { body: requestData, historyStr });

    if (result.status < 200 || result.status >= 300) {
        throw new Error('MiMo retornou erro: ' + result.text);
    }
    return { choices: [{ message: { role: 'assistant', content: result.text } }] };
}
export const agent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 10000,
  noDelay: true,
  maxSockets: 64,
  maxFreeSockets: 16,
});
export function serverHeaders(extra = {}) {
  const h = { ...extra, host: upstream.host };
  if (SERVER_AUTH) h["authorization"] = SERVER_AUTH;
  return h;
}
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