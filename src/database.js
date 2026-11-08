// src/database.js
import Database from 'better-sqlite3';
import { config } from './config.js';
import path from 'path';
import fs from 'fs';

// Cria o diretório de dados se não existir
const dataDir = path.dirname(config.dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Inicializa o banco de dados
const db = new Database(config.dbPath);

// Cria a tabela de contas (se não existir)
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password TEXT,
    name TEXT,
    last_used_at INTEGER,
    is_active BOOLEAN DEFAULT 1,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    port INTEGER NOT NULL,
    process_pid INTEGER,
    is_active BOOLEAN DEFAULT 1,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id)
  );
`);

// Funções para gerenciar contas
export const accountDB = {
  // Adicionar uma nova conta
  addAccount: db.prepare(`
    INSERT INTO accounts (email, password, name)
    VALUES (@email, @password, @name)
  `),

  // Listar todas as contas
  getAllAccounts: db.prepare(`
    SELECT * FROM accounts WHERE is_active = 1 ORDER BY last_used_at ASC
  `),

  // Obter uma conta pelo ID
  getAccountById: db.prepare(`
    SELECT * FROM accounts WHERE id = @id
  `),

  // Atualizar o timestamp de último uso
  updateLastUsed: db.prepare(`
    UPDATE accounts SET last_used_at = strftime('%s', 'now') WHERE id = @id
  `),

  // Desativar uma conta
  deactivateAccount: db.prepare(`
    UPDATE accounts SET is_active = 0 WHERE id = @id
  `),

  // Adicionar uma sessão
  addSession: db.prepare(`
    INSERT INTO sessions (account_id, session_id, port, process_pid)
    VALUES (@account_id, @session_id, @port, @process_pid)
  `),

  // Obter sessão ativa por conta
  getActiveSession: db.prepare(`
    SELECT * FROM sessions WHERE account_id = @account_id AND is_active = 1 LIMIT 1
  `),

  // Desativar sessão
  deactivateSession: db.prepare(`
    UPDATE sessions SET is_active = 0 WHERE id = @id
  `),

  // Obter todas as sessões ativas
  getAllActiveSessions: db.prepare(`
    SELECT s.*, a.email FROM sessions s JOIN accounts a ON s.account_id = a.id
    WHERE s.is_active = 1
  `),

  // Fechar o banco
  close: () => db.close(),
};

export default db;