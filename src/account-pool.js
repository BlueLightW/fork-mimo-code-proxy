// src/account-pool.js
import { accountManager } from './account-manager.js';
import { config } from './config.js';

export class AccountPool {
  constructor() {
    this.pool = []; // Lista de sessões ativas
    this.pending = new Map(); // accountId -> Promise de sessão
    this.maxSize = config.accounts.poolSize;
  }

  // Obter uma sessão do pool
  async getSession() {
    // Verifica se há sessões disponíveis no pool
    if (this.pool.length > 0) {
      const session = this.pool.shift();
      return session;
    }

    // Se o pool está cheio, espera uma sessão ser liberada
    if (this.pool.length >= this.maxSize) {
      // Aguarda até que uma sessão seja liberada
      await new Promise(resolve => {
        const checkInterval = setInterval(() => {
          if (this.pool.length > 0) {
            clearInterval(checkInterval);
            resolve(this.pool.shift());
          }
        }, 100);
      });
      return this.getSession(); // Recursivo
    }

    // Obtém a próxima conta disponível
    const account = accountManager.getNextAccount();
    if (!account) {
      throw new Error('Nenhuma conta disponível no momento');
    }

    // Evita requisições duplicadas para a mesma conta
    if (this.pending.has(account.id)) {
      return this.pending.get(account.id);
    }

    // Cria uma promise para a sessão
    const sessionPromise = accountManager.getOrCreateSession(account)
      .then(session => {
        this.pending.delete(account.id);
        return session;
      })
      .catch(error => {
        this.pending.delete(account.id);
        throw error;
      });

    this.pending.set(account.id, sessionPromise);
    return sessionPromise;
  }

  // Liberar uma sessão de volta para o pool
  releaseSession(session) {
    // Verifica se o pool já está cheio
    if (this.pool.length >= this.maxSize) {
      // Se estiver cheio, apenas liberamos a sessão (ela será recriada quando necessário)
      accountManager.releaseSession(session.id);
      return;
    }

    // Adiciona a sessão de volta ao pool
    this.pool.push(session);
  }

  // Obter estatísticas do pool
  getStats() {
    return {
      poolSize: this.pool.length,
      maxSize: this.maxSize,
      pending: this.pending.size,
    };
  }
}

// Instância global
export const accountPool = new AccountPool();