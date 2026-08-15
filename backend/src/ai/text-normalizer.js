const REPLACEMENTS = [
  [/\bqnto\b/g, 'quanto'], [/\bqto\b/g, 'quanto'], [/\bqnt\b/g, 'quanto'], [/\bqunto\b/g, 'quanto'],
  [/\bqntos\b/g, 'quantos'], [/\bqntas\b/g, 'quantas'], [/\bq\b/g, 'que'],
  [/\bvc\b/g, 'voce'], [/\bvcs\b/g, 'voces'], [/\bcm\b/g, 'como'], [/\bcomu\b/g, 'como'],
  [/\bmsm\b/g, 'mesmo'], [/\bnd\b/g, 'nada'], [/\bn\b/g, 'nao'], [/\bpq\b/g, 'porque'], [/\bporq\b/g, 'porque'],
  [/\btbm\b/g, 'tambem'], [/\bblz\b/g, 'beleza'], [/\bta\b/g, 'esta'], [/\btah\b/g, 'esta'],
  [/\bto\b/g, 'estou'], [/\btou\b/g, 'estou'], [/\btenho q\b/g, 'tenho que'], [/\bpreciso q\b/g, 'preciso que'],
  [/\bproximo\b/g, 'proximo'], [/\baprt\b/g, 'aporte'], [/\baprtar\b/g, 'aportar'], [/\baporta\b/g, 'aportar'],
  [/\beconomizr\b/g, 'economizar'], [/\beconomisar\b/g, 'economizar'], [/\beconomiza\b/g, 'economizar'],
  [/\bguarda\b/g, 'guardar'], [/\bguardr\b/g, 'guardar'], [/\bguadrar\b/g, 'guardar'],
  [/\binvstir\b/g, 'investir'], [/\binvesti\b/g, 'investir'], [/\binvestirr\b/g, 'investir'],
  [/\baplica\b/g, 'aplicar'], [/\baplicacao\b/g, 'aplicacao'], [/\bresrva\b/g, 'reserva'], [/\breservaa\b/g, 'reserva'],
  [/\bfinanciera\b/g, 'financeira'], [/\bfinaceira\b/g, 'financeira'], [/\bfinaceiro\b/g, 'financeiro'],
  [/\borcameto\b/g, 'orcamento'], [/\borcamentoo\b/g, 'orcamento'], [/\bdespezas\b/g, 'despesas'], [/\bdespesaas\b/g, 'despesas'],
  [/\bcartaoo\b/g, 'cartao'], [/\bfaturaa\b/g, 'fatura'], [/\bcomprarrr\b/g, 'comprar'],
  [/\bparcerlar\b/g, 'parcelar'], [/\bparcerla\b/g, 'parcela'], [/\bparcela?do\b/g, 'parcelado'],
  [/\bquerro\b/g, 'quero'], [/\bqueroo\b/g, 'quero'], [/\bqro\b/g, 'quero'],
  [/\bpretendo\b/g, 'pretendo'], [/\bobjetivo\b/g, 'objetivo'], [/\bmeta\b/g, 'meta'],
  [/\brecebir\b/g, 'recebi'], [/\brecebiu\b/g, 'recebi'], [/\bganhei\b/g, 'recebi'],
  [/\bentrou\b/g, 'entrou'], [/\bpagaram\b/g, 'pagaram'], [/\bpagar\b/g, 'pagar'],
  [/\bgasteii\b/g, 'gastei'], [/\btorrei\b/g, 'gastei'], [/\bpagueii\b/g, 'paguei'],
  [/\bsobra\b/g, 'sobrou'], [/\bsobrouu\b/g, 'sobrou']
];

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

  return value.replace(/\s+/g, ' ').trim();
}

export function autocorrectFinancialText(text) {
  const original = String(text ?? '');
  const normalized = normalizeUserText(original);
  return {
    original,
    normalized,
    changed: normalized !== original.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim()
  };
}
