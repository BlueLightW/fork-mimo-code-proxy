import http from "node:http";
import { upstream, SERVER_AUTH } from "./config.js";
import { accountPool } from './account-pool.js'; // Use o pool!

// Função auxiliar para montar o histórico (igual ao mimo-2api faz)
function buildHistory(messages) {
    return (messages || []).map(m => {
        const role = m.role.toUpperCase();
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return `${role}: ${content}`;
    }).join('\n');
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
                        query: historyStr, // ENVIA O HISTÓRICO COMPLETO
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
                
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buf += decoder.decode(value, { stream: true });
                    
                    // CORREÇÃO 3: Parser de SSE linha-a-linha (Robusto)
                    let lines = buf.split('\n');
                    buf = lines.pop(); // Mantém a última linha incompleta no buffer
                    
                    for (let line of lines) {
                        line = line.trim();
                        if (line.startsWith('data:')) {
                            const dataStr = line.slice(5).trim();
                            if (dataStr === '[DONE]') continue;
                            try {
                                const j = JSON.parse(dataStr);
                                const content = j.reasoningContent || j.content || j.text || '';
                                if (content) {
                                    await window[funcName]('data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\n');
                                }
                            } catch {}
                        }
                    }
                }
                await window[funcName]('data: [DONE]\n\n');
                clearTimeout(timeout);
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
        try {
            let ph = (document.cookie.match(/xiaomichatbot_ph="?([^";]+)"?/) || [])[1] || "";
            const res = await fetch('/open-apis/react/chat?xiaomichatbot_ph=' + encodeURIComponent(ph), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    msgId: self.crypto.randomUUID(),
                    conversationId: self.crypto.randomUUID(),
                    query: historyStr,
                    isEditedQuery: false,
                    modelConfig: {
                    enableThinking: false,
                    webSearchStatus: 'disabled',
                    model: (() => {
                        const m = (body.model || "").toLowerCase();
                        if (m.includes("flash")) return "mimo-v2.6-flash";      // ✅ Correto
                        if (m.includes("v2.5-pro")) return "mimo-v2.5-pro";     // ✅ Correto
                        if (m.includes("v2.5")) return "mimo-v2.5";             // ✅ Correto
                        if (m.includes("ultraspeed")) return "mimo-v2.6-pro-ultraspeed"; // ✅ Correto
                        return "mimo-v2.6-pro";                                  // ✅ Correto
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
            for (let line of lines) {
                line = line.trim();
                if (line.startsWith('data:')) {
                    try {
                        const j = JSON.parse(line.slice(5).trim());
                        if (j.content) fullContent += j.content;
                        if (j.reasoningContent) fullContent += j.reasoningContent;
                    } catch {}
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
