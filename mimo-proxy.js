#!/usr/bin/env node
/**
 * MiMo Code Remote Proxy
 *
 * Expõe o servidor headless do MiMo Code (`mimo serve`) para uso remoto,
 * roteando TUI, Web UI, WebSocket e chamadas de API de qualquer lugar.
 *
 * Arquitetura:
 *   cliente remoto ──HTTP/WS (X-API-Key)──> este proxy
 *        ──HTTP/WS (auth Basic do MiMo)──> mimo serve (127.0.0.1:PORTA)
 */

import http from "node:http";
import { URL } from "node:url";
import {
  SERVER_URL,
  SERVER_PASSWORD,
  RAW,
  CORS_ORIGIN,
  upstream,
  SERVER_AUTH,
} from "./src/config.js";
import { isAuthorized } from "./src/auth.js";
import { openAIModels } from "./src/openai.js";
import { reverseProxy } from "./src/routes.js";

import { createServer } from 'node:http';
import { accountManager } from './src/account-manager.js';
import { accountPool } from './src/account-pool.js';
import { config } from './src/config.js';

const server = createServer(reverseProxy);

server.on('error', (err) => {
  console.error('[Server] Erro:', err);
});

const PORT = config.port;
server.listen(PORT, config.host, () => {
  console.log(`[Server] Proxy rodando em http://${config.host}:${PORT}`);

  // Abre o navegador para a primeira conta
  if (accountManager.accounts.length > 0) {
    accountManager.getOrCreateSession(accountManager.accounts[0]).catch(e => console.error(e));
  }

  // Loga estatísticas iniciais
  if (config.accounts.enabled) {
    const stats = accountManager.getStats();
    console.log(`[AccountManager] Contas carregadas: ${stats.totalAccounts}`);
    console.log(`[AccountPool] Pool inicializado (max: ${config.accounts.poolSize})`);
  } else {
    console.log('[AccountManager] Modo single-account ativo');
  }
});

// Tratamento de sinal para fechar gracefully
process.on('SIGTERM', () => {
  console.log('[Server] Recebido SIGTERM. Fechando...');
  server.close(() => {
    console.log('[Server] Servidor fechado');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[Server] Recebido SIGINT. Fechando...');
  server.close(() => {
    console.log('[Server] Servidor fechado');
    process.exit(0);
  });
});
// const server = http.createServer(async (clientReq, clientRes) => {
//   // CORS Headers
//   clientRes.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
//   clientRes.setHeader(
//     "Access-Control-Allow-Headers",
//     "Authorization, X-API-Key, Content-Type",
//   );
//   clientRes.setHeader(
//     "Access-Control-Allow-Methods",
//     "GET, POST, PUT, DELETE, OPTIONS, PATCH",
//   );
//   clientRes.setHeader("Access-Control-Max-Age", "86400");

//   if (clientReq.method === "OPTIONS") {
//     clientRes.writeHead(204);
//     clientRes.end();
//     return;
//   }

//   const url = new URL(clientReq.url, "http://x");
//   const path = url.pathname;

//   if (path === "/healthz") {
//     try {
//       const req = http.request({
//         method: "GET",
//         hostname: upstream.hostname,
//         port: upstream.port,
//         path: "/healthz",
//         timeout: 3000,
//         headers: SERVER_AUTH ? { authorization: SERVER_AUTH } : {},
//       });
//       const result = await new Promise((resolve, reject) => {
//         req.on("response", (res) => {
//           const chunks = [];
//           res.on("data", (c) => chunks.push(c));
//           res.on("end", () => resolve({ status: res.statusCode, ok: res.statusCode < 500 }));
//           res.on("error", reject);
//         });
//         req.on("error", reject);
//         req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
//         req.end();
//       });
//       clientRes.writeHead(result.ok ? 200 : 502, { "Content-Type": "application/json" });
//       clientRes.end(JSON.stringify({ ok: result.ok, upstream: SERVER_URL, upstreamStatus: result.status, ts: Date.now() }));
//     } catch (e) {
//       clientRes.writeHead(502, { "Content-Type": "application/json" });
//       clientRes.end(JSON.stringify({ ok: false, upstream: SERVER_URL, error: e.message, ts: Date.now() }));
//     }
//     return;
//   }

//   if (path === "/v1/models" && clientReq.method === "GET") {
//     if (!isAuthorized(clientReq)) {
//       clientRes.writeHead(401, { "Content-Type": "application/json" });
//       clientRes.end(JSON.stringify({ error: "Unauthorized" }));
//       return;
//     }
//     clientRes.writeHead(200, { "Content-Type": "application/json" });
//     clientRes.end(JSON.stringify(openAIModels()));
//     return;
//   }

//   if (path === "/v1/chat/completions" && clientReq.method === "POST") {
//     return handleChatCompletions(clientReq, clientRes);
//   }

//   if (!isAuthorized(clientReq)) {
//     clientRes.writeHead(401, { "Content-Type": "application/json" });
//     clientRes.end(JSON.stringify({ error: "Unauthorized" }));
//     return;
//   }
//   reverseProxy(clientReq, clientRes);
// });

// server.on("upgrade", (clientReq, clientSocket) => {
//   if (!isAuthorized(clientReq)) {
//     clientSocket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
//     clientSocket.destroy();
//     return;
//   }
//   const headers = { ...clientReq.headers, host: upstream.host };
//   if (SERVER_AUTH) headers["authorization"] = SERVER_AUTH;
//   const req = http.request({
//     method: clientReq.method,
//     hostname: upstream.hostname,
//     port: upstream.port,
//     path: clientReq.url,
//     headers,
//   });
//   req.on("upgrade", (res, socket, head) => {
//     clientSocket.write(
//       `HTTP/1.1 ${res.statusCode} ${res.statusMessage}\r\n` +
//         Object.entries(res.headers)
//           .map(([k, v]) => `${k}: ${v}`)
//           .join("\r\n") +
//         "\r\n\r\n",
//     );
//     if (head && head.length) socket.write(head);
//     socket.pipe(clientSocket);
//     clientSocket.pipe(socket);
//     socket.on("error", () => clientSocket.destroy());
//     clientSocket.on("error", () => socket.destroy());
//   });
//   req.on("error", () => clientSocket.destroy());
//   req.end();
// });

// server.on("error", (err) => {
//   if (err.code === "EADDRINUSE") {
//     console.error(`Erro: a porta ${PORT} já está em uso.`);
//     process.exit(1);
//   }
//   console.error("Erro no servidor proxy:", err.message);
//   process.exit(1);
// });

// server.listen(PORT, HOST, () => {
//   console.log(`MiMo remote proxy ouvindo em http://${HOST}:${PORT}`);
//   console.log(
//     `Encaminhando para ${SERVER_URL} (auth do MiMo: ${SERVER_PASSWORD ? "sim" : "não"})`,
//   );
//   console.log(`Rotas OpenAI: POST /v1/chat/completions, GET /v1/models`);
//   console.log(
//     RAW
//       ? `Modo: raw (LLM cru — ferramentas do MiMo desligadas; o cliente/Roo dirige as tools)`
//       : `Modo: agent (o MiMo executa as próprias ferramentas)`,
//   );
//   console.log(
//     REQUIRE_AUTH
//       ? `Auth do proxy: ativada (use o header 'X-API-Key: ${TOKEN.slice(0, 4)}...')`
//       : `Auth do proxy: DESATIVADA (MIMO_PROXY_REQUIRE_AUTH=false) — não exponha na internet`,
//   );
// });

// async function shutdown() {
//   console.log("\nDesligando...");
//   server.close(() => process.exit(0));
//   setTimeout(() => process.exit(1), 5000);
// }
// process.on("unhandledRejection", (reason) => {
//   console.error("Unhandled Promise Rejection:", reason);
// });

// process.on("uncaughtException", (err) => {
//   console.error("Uncaught Exception:", err.message || err);
//   process.exit(1);
// });

// process.on("SIGINT", shutdown);
// process.on("SIGTERM", shutdown);
