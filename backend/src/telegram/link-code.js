import crypto from 'node:crypto';

const TOKEN=process.env.TELEGRAM_BOT_TOKEN||'';
const LINK_TTL_MS=10*60*1000;

export async function createTelegramLinkCode(db,uid){
  if(!TOKEN)throw new Error('TELEGRAM_BOT_TOKEN não configurado.');
  const code=`P360-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  await db.collection('telegramLinkCodes').doc(code).set({uid,createdAt:new Date(),expiresAt:Date.now()+LINK_TTL_MS});
  return {code,expiresInSeconds:LINK_TTL_MS/1000,botUsername:process.env.TELEGRAM_BOT_USERNAME||'Patrimonio360Bot'};
}
