// src/account-manager.js
import { accountDB } from './database.js';
import { config } from './config.js';
import { startMimoInstanceWithPlaywright } from './mimo-instance.js';

export class AccountManager {
  constructor() {
    this.accounts = [];
    this.activeSessions = new Map(); // accountId -> sessionInfo
    this.cooldowns = new Map(); // accountId -> timestamp
    this.loadAccounts();
  }

  // Carregar contas do banco
  loadAccounts() {
    const rows = accountDB.getAllAccounts.all();
    this.accounts = rows.map(row => ({
      id: row.id,
      email: row.email,
      password: row.password,
      name: row.name,
      lastUsedAt: row.last_used_at,
    }));
    console.log(`[AccountManager] Carregadas ${this.accounts.length} contas`);
  }

  // Adicionar uma nova conta
  addAccount(email, password, name = null) {
    const info = accountDB.addAccount.run({ email, password, name });
    this.loadAccounts(); // Recarrega a lista
    return info;
  }

  // Obter a próxima conta disponível (load balancing)
  getNextAccount() {
    if (!config.accounts.enabled || this.accounts.length === 0) {
      return null; // Retorna null se não houver contas
    }

    // Filtra contas que não estão em cooldown
    const now = Date.now();
    const availableAccounts = this.accounts.filter(account => {
      const cooldownEnd = this.cooldowns.get(account.id) || 0;
      return now >= cooldownEnd;
    });

    if (availableAccounts.length === 0) {
      return null; // Todas as contas estão em cooldown
    }

    // Ordena por último uso (menos recentemente usada primeiro)
    availableAccounts.sort((a, b) => a.lastUsedAt - b.lastUsedAt);

    // Retorna a conta menos recentemente usada
    const account = availableAccounts[0];

    // Atualiza o último uso
    accountDB.updateLastUsed.run({ id: account.id });
    account.lastUsedAt = Date.now();

    // Define cooldown
    this.cooldowns.set(account.id, now + config.accounts.cooldownMs);

    return account;
  }

  // Obter ou criar uma sessão ativa para uma conta
  async getOrCreateSession(account) {
    const existingSession = this.activeSessions.get(account.id);
    if (existingSession) {
      return existingSession;
    }

    const session = await startMimoInstanceWithPlaywright(account);
    if (!session) {
      throw new Error(`Falha ao iniciar sessão para a conta ${account.email}`);
    }

    this.activeSessions.set(account.id, session);
    return session;
  }

  releaseSession(sessionId) {
    for (const [accountId, session] of this.activeSessions.entries()) {
      if (session.sessionId === sessionId) {
        try { session.browser?.close(); } catch {}
        this.activeSessions.delete(accountId);
      }
    }
  }

  // Obter estatísticas
  getStats() {
    const now = Date.now();
    const activeAccounts = this.accounts.filter(a => {
      const cooldownEnd = this.cooldowns.get(a.id) || 0;
      return now >= cooldownEnd;
    });

    return {
      totalAccounts: this.accounts.length,
      activeAccounts: activeAccounts.length,
      cooldownAccounts: this.accounts.length - activeAccounts.length,
      activeSessions: accountDB.getAllActiveSessions.all().length,
    };
  }
}

// Instância global
export const accountManager = new AccountManager();