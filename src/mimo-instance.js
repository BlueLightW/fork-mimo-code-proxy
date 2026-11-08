// src/mimo-instance.js
import { exec } from 'child_process';
import { promisify } from 'util';
import { accountDB } from './database.js';
import { config } from './config.js';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);

// Cria o diretório de perfis se não existir
const profilesDir = path.join(path.dirname(config.dbPath), 'mimo-profiles');
if (!fs.existsSync(profilesDir)) {
  fs.mkdirSync(profilesDir, { recursive: true });
}

// Portas disponíveis para instâncias do `mimo serve`
let nextPort = 4096;

export async function startMimoInstance(account) {
  // Gera um ID de sessão único
  const sessionId = `mimo-session-${account.id}-${Date.now()}`;

  // Define a porta para esta instância
  const port = nextPort++;
  if (nextPort > 5000) nextPort = 4096; // Reutiliza portas

  // Caminho para o perfil desta conta
  const profilePath = path.join(profilesDir, `account-${account.id}`);

  // Comando para iniciar o `mimo serve` com autenticação
  // NOTA: O MiMo Code pode não ter opção de autenticação por linha de comando.
  // Se não tiver, você precisará usar automação com Playwright (veja alternativa abaixo)
  const command = `mimo serve --port ${port} --profile ${profilePath}`;

  console.log(`[MimoInstance] Iniciando instância para ${account.email} na porta ${port}`);

  try {
    // Inicia o processo
    const child = exec(command, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MIMO_EMAIL: account.email,
        MIMO_PASSWORD: account.password,
      },
    });

    // Aguarda um pouco para a instância subir
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Verifica se a instância está respondendo
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
      method: 'GET',
      timeout: 5000,
    });

    if (response.ok) {
      console.log(`[MimoInstance] Instância ${sessionId} pronta na porta ${port}`);
      return {
        sessionId,
        port,
        pid: child.pid,
        accountId: account.id,
        url: `http://127.0.0.1:${port}`,
      };
    } else {
      throw new Error('Instância não respondeu ao health check');
    }
  } catch (error) {
    console.error(`[MimoInstance] Falha ao iniciar instância: ${error.message}`);
    return null;
  }
}
async function checkMimoHealth(url) {
  try {
    const response = await fetch(`${url}/healthz`, { timeout: 5000 });
    return response.ok;
  } catch (error) {
    return false;
  }
}

import { chromium } from 'playwright';

// Alternativa: Se o `mimo serve` não aceita autenticação por linha de comando,
// você pode usar Playwright para fazer login automático:
export async function startMimoInstanceWithPlaywright(account) {
  const profilePath = path.join(profilesDir, `account-${account.id}`);
  if (!fs.existsSync(profilePath)) fs.mkdirSync(profilePath, { recursive: true });
  const sessionId = `mimo-session-${account.id}-${Date.now()}`;
  const context = await chromium.launchPersistentContext(profilePath, { headless: false });
  const page = context.pages()[0] || await context.newPage();

  // Faz login no MiMo Code
  await page.goto('https://aistudio.xiaomimimo.com');

  // Se já logado, pula login
  if (await page.locator('textarea[placeholder^="Ask me anything"]').isVisible().catch(() => false)) {
    return { sessionId, browser: context, context, page };
  }
  const tryNow = page.locator('button:has-text("Try Now")');
  if (await tryNow.isVisible().catch(() => false)) {
    await tryNow.click();
  }

  // Fecha popup inicial
  const closePopup = page.locator('svg.h-5.w-5.text-\\[var\\(--mimo-grey-06\\)\\]');
  if (await closePopup.isVisible().catch(() => false)) {
    await closePopup.click();
  }
  const signInBtn = page.locator('button.inline-flex.relative.justify-center:has-text("Sign in")');
  if (await signInBtn.isVisible().catch(() => false)) {
    await signInBtn.click();
  }

  // Preenche credenciais
  const accountInput = page.locator('input[name="account"]');
  if (await accountInput.isVisible().catch(() => false)) {
    await accountInput.fill(account.email);
  }
  const passwordInput = page.locator('input[name="password"]');
  if (await passwordInput.isVisible().catch(() => false)) {
    await passwordInput.fill(account.password);
  }

  // Aceita termos se aparecer
  const agreeBtn = page.locator('button:has-text("Agree")');
  if (await agreeBtn.isVisible().catch(() => false)) {
    await agreeBtn.click();
  }

  // Marca checkbox de termos (se existir)
  const checkbox = page.locator('input[type="checkbox"].ant-checkbox-input');
  if (await checkbox.isVisible().catch(() => false)) {
    await checkbox.check();
  }

  // Submete login
  const submitBtn = page.locator('button[type="submit"]:has-text("Sign in")');
  if (await submitBtn.isVisible().catch(() => false)) {
    await submitBtn.click();
  }

  // Aguarda código por email e botão do chat (login manual)
  await page.waitForSelector('textarea[placeholder^="Ask me anything"]', { timeout: 0 });

  // Extrair cookies ou token de autenticação
  const cookies = await context.cookies();

  return { sessionId, browser: context, context, page };
}