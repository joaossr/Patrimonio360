// Gera chaves de acesso direto do computador (usa o service-account.json do backend).
// Uso: node scripts/gerar-chaves.js <quantidade> <dias (0 = sem vencimento)> "<rótulo>"
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createLicenseService } from '../src/license.js';

const [count = '1', days = '30', ...labelParts] = process.argv.slice(2);
const credentialPath = path.resolve(process.cwd(), process.env.GOOGLE_APPLICATION_CREDENTIALS || './service-account.json');
if (!fs.existsSync(credentialPath)) {
  console.error(`Credencial não encontrada em ${credentialPath}. Baixe o service-account.json do Firebase (Configurações do projeto → Contas de serviço).`);
  process.exit(1);
}
initializeApp({ credential: cert(JSON.parse(fs.readFileSync(credentialPath, 'utf8'))), projectId: process.env.FIREBASE_PROJECT_ID || 'patrimonio360-e4190' });
const service = createLicenseService({ db: getFirestore(), auth: getAuth() });
const result = await service.createKeys({ count: Number(count), days: Number(days), label: labelParts.join(' '), by: 'script-local' });
console.log(`\n${result.keys.length} chave(s) · validade: ${result.days ? result.days + ' dias' : 'sem vencimento'}${result.label ? ' · ' + result.label : ''}\n`);
result.keys.forEach(k => console.log(k));
console.log('\nGuarde as chaves agora: o texto não fica salvo em lugar nenhum.');
