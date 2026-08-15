const REPLACEMENTS = [
  [/\bqnto\b/g, 'quanto'], [/\bqto\b/g, 'quanto'], [/\bqnt\b/g, 'quanto'], [/\bqunto\b/g, 'quanto'],
  [/\bqntos\b/g, 'quantos'], [/\bqntas\b/g, 'quantas'], [/\bq\b/g, 'que'],
  [/\bvc\b/g, 'voce'], [/\bvcs\b/g, 'voces'], [/\bcm\b/g, 'como'], [/\bcomu\b/g, 'como'],
  [/\bmsm\b/g, 'mesmo'], [/\bnd\b/g, 'nada'], [/\bn\b/g, 'nao'], [/\bpq\b/g, 'porque'], [/\bporq\b/g, 'porque'],
  [/\btbm\b/g, 'tambem'], [/\bblz\b/g, 'beleza'], [/\bta\b/g, 'esta'], [/\btah\b/g, 'esta'],
  [/\bto\b/g, 'estou'], [/\btou\b/g, 'estou'], [/\btenho q\b/g, 'tenho que'], [/\bpreciso q\b/g, 'preciso que'],
  [/\baprt\b/g, 'aporte'], [/\baprtar\b/g, 'aportar'], [/\baporta\b/g, 'aportar'],
  [/\beconomizr\b/g, 'economizar'], [/\beconomisar\b/g, 'economizar'], [/\beconomiza\b/g, 'economizar'],
  [/\bguarda\b/g, 'guardar'], [/\bguardr\b/g, 'guardar'], [/\bguadrar\b/g, 'guardar'], [/\bguadr\b/g, 'guardar'],
  [/\binvstir\b/g, 'investir'], [/\binvesti\b/g, 'investir'], [/\binvestirr\b/g, 'investir'],
  [/\baplica\b/g, 'aplicar'], [/\baplicacao\b/g, 'aplicacao'], [/\bresrva\b/g, 'reserva'], [/\breservaa\b/g, 'reserva'],
  [/\bfinanciera\b/g, 'financeira'], [/\bfinaceira\b/g, 'financeira'], [/\bfinaceiro\b/g, 'financeiro'],
  [/\borcameto\b/g, 'orcamento'], [/\borcamentoo\b/g, 'orcamento'], [/\bdespezas\b/g, 'despesas'], [/\bdespesaas\b/g, 'despesas'],
  [/\bcartaoo\b/g, 'cartao'], [/\bfaturaa\b/g, 'fatura'], [/\bcomprarrr\b/g, 'comprar'],
  [/\bparcerlar\b/g, 'parcelar'], [/\bparcerla\b/g, 'parcela'], [/\bparceladoo\b/g, 'parcelado'],
  [/\bquerro\b/g, 'quero'], [/\bqueroo\b/g, 'quero'], [/\bqro\b/g, 'quero'],
  [/\bobjtivo\b/g, 'objetivo'], [/\bmetaa\b/g, 'meta'],
  [/\brecebir\b/g, 'recebi'], [/\brecebiu\b/g, 'recebi'], [/\bganhei\b/g, 'recebi'],
  [/\bentrou\b/g, 'entrou'], [/\bpagaram\b/g, 'pagaram'],
  [/\bgasteii\b/g, 'gastei'], [/\btorrei\b/g, 'gastei'], [/\bpagueii\b/g, 'paguei'],
  [/\bsobra\b/g, 'sobrou'], [/\bsobrouu\b/g, 'sobrou'],
  [/\bdinherio\b/g, 'dinheiro'], [/\bsaldao\b/g, 'saldo'], [/\bsaldp\b/g, 'saldo'],
  [/\bcontaa\b/g, 'conta'], [/\bcontasb\b/g, 'contas'], [/\bdespess?as\b/g, 'despesas'],
  [/\bmesn?al\b/g, 'mensal'], [/\bfinancas\b/g, 'financas'], [/\bdisponivel\b/g, 'disponivel'], [/\bparcelas?\b/g, 'parcelas']
];

const DOMAIN_WORDS = [
  'quanto','qual','como','quando','guardar','poupar','economizar','juntar','aporte','aportar','investir','investimento','aplicar','aplicacao',
  'reserva','emergencia','orcamento','despesas','gastos','gastei','dinheiro','saldo','conta','contas','banco','disponivel','recebi','renda','salario',
  'receita','meta','objetivo','chegar','atingir','projecao','comprar','compra','parcelar','parcelado','parcela','cartao','fatura','limite',
  'pagar','receber','vencimento','compromissos','fluxo','diagnostico','financeira','financas','saude','analise','situacao','categoria','mes','mensal'
];

function distance(a,b){
  if(a===b) return 0;
  if(Math.abs(a.length-b.length)>1) return 2;
  const prev=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    const cur=[i];
    for(let j=1;j<=b.length;j++) cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
    for(let j=1;j<=b.length;j++) prev[j]=cur[j];
  }
  return prev[b.length];
}

function fuzzyDomainCorrection(value){
  return value.split(/(\s+)/).map(token=>{
    if(!/^[a-z]{4,}$/.test(token) || DOMAIN_WORDS.includes(token)) return token;
    let best=null;
    for(const word of DOMAIN_WORDS){
      if(Math.abs(word.length-token.length)>1) continue;
      const d=distance(token,word);
      if(d<=1 && (!best || d<best.d || (d===best.d && word.length===token.length))) best={word,d};
    }
    return best?.word ?? token;
  }).join('');
}

export function normalizeUserText(text) {
  let value = String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  for (const [pattern, replacement] of REPLACEMENTS) value = value.replace(pattern, replacement);
  value = fuzzyDomainCorrection(value);
  return value.replace(/\s+/g, ' ').trim();
}

export function autocorrectFinancialText(text) {
  const original = String(text ?? '');
  const normalized = normalizeUserText(original);
  const baseline = original.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  return { original, normalized, changed: normalized !== baseline };
}
