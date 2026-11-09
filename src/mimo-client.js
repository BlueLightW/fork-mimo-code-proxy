import http from "node:http";
import { upstream, SERVER_AUTH } from "./config.js";
import { accountPool } from './account-pool.js';

function buildQuery(messages) {
    const userMessages = (messages || []).filter(m => m.role === 'user');
    if (userMessages.length === 0) return '';
    
    const lastMessage = userMessages[userMessages.length - 1];
    
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

function extractSystemPrompt(messages) {
    const systemMessages = (messages || []).filter(m => m.role === 'system');
    if (systemMessages.length === 0) return '';
    
    return systemMessages
        .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
        .join('\n\n');
}
export async function fetchMimo(response, requestData) {
    const { accountManager } = await import('./account-manager.js');
    
    const account = accountManager.accounts[0];
    if (!account) throw new Error('Nenhuma conta cadastrada');
    
    const session = await accountManager.getOrCreateSession(account);
    const queryStr = buildQuery(requestData.messages);

    if (requestData.stream) {
        response.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        });

        let queue = [];
        let resolver = null;
        
        const funcName = `__sendChunk_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        await session.page.exposeFunction(funcName, (chunk) => {
            queue.push(chunk);
            if (resolver) { resolver(); resolver = null; }
            return Promise.resolve();
        });

        if (!session.page.url().includes("aistudio.xiaomimimo.com")) {
            await session.page.goto("https://aistudio.xiaomimimo.com", { waitUntil: "domcontentloaded" });
            await session.page.waitForTimeout(1000);
        }

        const evalPromise = session.page.evaluate(async ({ body, funcName, queryStr }) => {
    try {
        let ph = (document.cookie.match(/xiaomichatbot_ph="?([^";]+)"?/) || [])[1] || "";
        
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000);
        
        // Extrai system prompt das mensagens
        const systemPrompt = (() => {
            const systemMessages = (body.messages || []).filter(m => m.role === 'system');
            return systemMessages
                .map(m => typeof m.content === 'string' ? m.content : '')
                .filter(s => s.length > 0)
                .join('\n\n');
        })();
        
        console.log('[MiMo Request] Model:', body.model);
        console.log('[MiMo Request] Query length:', queryStr.length);
        console.log('[MiMo Request] System prompt length:', systemPrompt.length);
        
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
                query: queryStr,
                systemPrompt: systemPrompt, // ← ADICIONADO
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

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let sentDone = false; // ← FLAG para evitar múltiplos [DONE]
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() || '';
            
            for (let line of lines) {
                line = line.trim();
                if (!line) continue;
                
                // Ignora linhas que não começam com 'data:'
                if (!line.startsWith('data:')) continue;
                
                const dataStr = line.slice(5).trim();
                
                // Para no primeiro [DONE]
                if (dataStr === '[DONE]') {
                    if (!sentDone) {
                        sentDone = true;
                        await window[funcName]('data: [DONE]\n\n');
                    }
                    break; // Sai do loop de linhas
                }
                
                try {
                    const j = JSON.parse(dataStr);
                    
                    // Filtra respostas de erro/bloqueio do MiMo
                    if (j.content && (
                        j.content.includes("I can't answer") ||
                        j.content.includes("网络中断") ||
                        j.content.includes("stream got cut off")
                    )) {
                        console.warn('[MiMo] Blocked response detected:', j.content.substring(0, 50));
                        continue; // Ignora esta linha
                    }
                    
                    if (j.reasoningContent) {
                        await window[funcName]('data: ' + JSON.stringify({
                            choices: [{ delta: { reasoning_content: j.reasoningContent } }]
                        }) + '\n\n');
                    }
                    
                    if (j.content) {
                        await window[funcName]('data: ' + JSON.stringify({
                            choices: [{ delta: { content: j.content } }]
                        }) + '\n\n');
                    }
                } catch (e) {
                    // Ignora JSON inválido silenciosamente
                }
            }
        }
        
        if (!sentDone) {
            await window[funcName]('data: [DONE]\n\n');
        }
        
        clearTimeout(timeout);
        await window[funcName](null);
    } catch (e) {
        console.error('[MiMo Error]', e.message);
        await window[funcName]('data: ' + JSON.stringify({
            error: { message: e.message, type: 'proxy_error' }
        }) + '\n\n');
        await window[funcName](null);
    }
}, { body: requestData, funcName, queryStr });
        let evalError = null;
        evalPromise.catch(e => { 
            evalError = e; 
            console.error('[Node] Browser evaluate error:', e.message);
            if (resolver) resolver(); 
        });

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
                if (evalError) throw evalError;
                const chunk = queue.shift();
                if (chunk === null) break;
                response.write(chunk);
            }
            await evalPromise;
            clearTimeout(streamTimeout);
            response.end();
        } catch (e) {
            console.error('[Node] Stream error:', e.message);
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
// --- NÃO STREAMING ---
const result = await session.page.evaluate(async ({ body, queryStr }) => {
    try {
        let ph = (document.cookie.match(/xiaomichatbot_ph="?([^";]+)"?/) || [])[1] || "";
        
        const systemPrompt = (() => {
            const systemMessages = (body.messages || []).filter(m => m.role === 'system');
            return systemMessages
                .map(m => typeof m.content === 'string' ? m.content : '')
                .filter(s => s.length > 0)
                .join('\n\n');
        })();
        
        const res = await fetch('/open-apis/react/chat?xiaomichatbot_ph=' + encodeURIComponent(ph), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                msgId: self.crypto.randomUUID(),
                conversationId: self.crypto.randomUUID(),
                query: queryStr,
                systemPrompt: systemPrompt, // ← ADICIONADO
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
        
        const text = await res.text();
        let fullContent = '';
        const lines = text.split('\n');
        
        for (let line of lines) {
            line = line.trim();
            if (line.startsWith('data:')) {
                const dataStr = line.slice(5).trim();
                if (dataStr === '[DONE]') continue;
                
                try {
                    const j = JSON.parse(dataStr);
                    if (j.content) fullContent += j.content;
                } catch {}
            }
        }
        
        return { status: res.status, text: fullContent };
    } catch (e) {
        return { status: 0, text: e.message };
    }
}, { body: requestData, queryStr });

    if (result.status < 200 || result.status >= 300) {
        throw new Error('MiMo retornou erro: ' + result.text);
    }
    
    return { 
        choices: [{ 
            message: { 
                role: 'assistant', 
                content: result.text 
            } 
        }] 
    };
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
                attempt = 0;
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
                            // ignora
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