import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const ok = (label, value, extra='') => console.log(`${value ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);

const envPath = path.resolve(process.cwd(), '.env');
const servicePath = path.resolve(process.cwd(), process.env.GOOGLE_APPLICATION_CREDENTIALS || './service-account.json');
const modelPath = path.resolve(process.cwd(), process.env.P360_MODEL_PATH || './models/expense-net.json');

ok('.env', fs.existsSync(envPath));
ok('FIREBASE_PROJECT_ID', Boolean(process.env.FIREBASE_PROJECT_ID), process.env.FIREBASE_PROJECT_ID || 'ausente');
ok('service-account.json', fs.existsSync(servicePath), servicePath);
ok('P360', fs.existsSync(modelPath), modelPath);
ok('TELEGRAM_BOT_TOKEN', Boolean(process.env.TELEGRAM_BOT_TOKEN && !process.env.TELEGRAM_BOT_TOKEN.includes('COLOQUE')), process.env.TELEGRAM_BOT_TOKEN ? 'configurado' : 'ausente');
ok('TELEGRAM_BOT_USERNAME', Boolean(process.env.TELEGRAM_BOT_USERNAME), process.env.TELEGRAM_BOT_USERNAME || 'ausente');
ok('PORT', Boolean(process.env.PORT), process.env.PORT || '8787');

console.log('\nSe todos os itens obrigatorios estiverem com ✓, rode: npm run dev');
