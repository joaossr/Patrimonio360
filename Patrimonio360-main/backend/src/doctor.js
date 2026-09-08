import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const ok=(label,value,extra='')=>console.log(`${value?'✓':'✗'} ${label}${extra?` — ${extra}`:''}`);
const envPath=path.resolve(process.cwd(),'.env');
const servicePath=path.resolve(process.cwd(),process.env.GOOGLE_APPLICATION_CREDENTIALS||'./service-account.json');
ok('.env',fs.existsSync(envPath));
ok('FIREBASE_PROJECT_ID',Boolean(process.env.FIREBASE_PROJECT_ID),process.env.FIREBASE_PROJECT_ID||'ausente');
ok('service-account.json',fs.existsSync(servicePath),servicePath);
ok('DEEPSEEK_API_KEY',Boolean(process.env.DEEPSEEK_API_KEY),process.env.DEEPSEEK_API_KEY?'configurado':'ausente');
ok('DEEPSEEK_MODEL',Boolean(process.env.DEEPSEEK_MODEL||'deepseek-v4-flash'),process.env.DEEPSEEK_MODEL||'deepseek-v4-flash');
ok('TELEGRAM_BOT_TOKEN',Boolean(process.env.TELEGRAM_BOT_TOKEN&& !process.env.TELEGRAM_BOT_TOKEN.includes('COLOQUE')),process.env.TELEGRAM_BOT_TOKEN?'configurado':'ausente');
ok('TELEGRAM_BOT_USERNAME',Boolean(process.env.TELEGRAM_BOT_USERNAME),process.env.TELEGRAM_BOT_USERNAME||'ausente');
ok('PORT',Boolean(process.env.PORT),process.env.PORT||'8787');
console.log('\nIA: somente DeepSeek. Nenhum modelo local é necessário para iniciar o backend.');
console.log('Se os itens obrigatórios estiverem com ✓, rode: npm run dev');
