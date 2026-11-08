// src/cli.js
// #!/usr/bin/env node
import { accountManager } from './account-manager.js';
import { accountPool } from './account-pool.js';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function showMenu() {
  console.log('\n=== Gerenciador de Contas MiMo ===');
  console.log('1. Listar contas');
  console.log('2. Adicionar conta');
  console.log('3. Remover conta');
  console.log('4. Estatísticas');
  console.log('5. Sair');
  console.log('----------------------------------');
}

async function listAccounts() {
  const stats = accountManager.getStats();
  console.log('\n--- Contas Cadastradas ---');
  console.log(`Total: ${stats.totalAccounts}`);
  console.log(`Ativas: ${stats.activeAccounts}`);
  console.log(`Em cooldown: ${stats.cooldownAccounts}`);

  const accounts = accountManager.accounts;
  accounts.forEach((account, index) => {
    console.log(`${index + 1}. ${account.email} (ID: ${account.id})`);
  });
}

async function addAccount() {
  const email = await askQuestion('Email: ');
  const password = await askQuestion('Senha: ');
  const name = await askQuestion('Nome (opcional): ');

  try {
    accountManager.addAccount(email, password, name || null);
    console.log('✅ Conta adicionada com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao adicionar conta:', error.message);
  }
}

async function removeAccount() {
  const accounts = accountManager.accounts;
  if (accounts.length === 0) {
    console.log('❌ Nenhuma conta cadastrada');
    return;
  }

  await listAccounts();
  const id = await askQuestion('ID da conta a remover: ');

  try {
    accountManager.deactivateAccount(id);
    console.log('✅ Conta desativada com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao remover conta:', error.message);
  }
}

async function showStats() {
  const stats = accountManager.getStats();
  const poolStats = accountPool.getStats();

  console.log('\n--- Estatísticas ---');
  console.log(`Contas totais: ${stats.totalAccounts}`);
  console.log(`Contas ativas: ${stats.activeAccounts}`);
  console.log(`Sessões ativas: ${stats.activeSessions}`);
  console.log(`Pool atual: ${poolStats.poolSize}/${poolStats.maxSize}`);
  console.log(`Pending: ${poolStats.pending}`);
}

function askQuestion(question) {
  return new Promise(resolve => {
    rl.question(question, resolve);
  });
}

async function main() {
  showMenu();
  rl.on('line', async (input) => {
    switch (input.trim()) {
      case '1':
        await listAccounts();
        showMenu();
        break;
      case '2':
        await addAccount();
        showMenu();
        break;
      case '3':
        await removeAccount();
        showMenu();
        break;
      case '4':
        await showStats();
        showMenu();
        break;
      case '5':
        console.log('Saindo...');
        rl.close();
        process.exit(0);
      default:
        console.log('Opção inválida');
        showMenu();
    }
  });
}

main();