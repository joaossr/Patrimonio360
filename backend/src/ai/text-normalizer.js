const REPLACEMENTS = [
  [/\bqnto\b/g, 'quanto'],
  [/\bqto\b/g, 'quanto'],
  [/\bqnt\b/g, 'quanto'],
  [/\bqunto\b/g, 'quanto'],
  [/\bqntos\b/g, 'quantos'],
  [/\bqntas\b/g, 'quantas'],
  [/\bq\b/g, 'que'],
  [/\bvc\b/g, 'voce'],
  [/\bvcs\b/g, 'voces'],
  [/\bcm\b/g, 'como'],
  [/\bcomu\b/g, 'como'],
  [/\bmsm\b/g, 'mesmo'],
  [/\bnd\b/g, 'nada'],
  [/\bnao\b/g, 'nao'],
  [/\bn\b/g, 'nao'],
  [/\bpq\b/g, 'porque'],
  [/\bporq\b/g, 'porque'],
  [/\btbm\b/g, 'tambem'],
  [/\btbm\b/g, 'tambem'],
  [/\bblz\b/g, 'beleza'],
  [/\bta\b/g, 'esta'],
  [/\btah\b/g, 'esta'],
  [/\bto\b/g, 'estou'],
  [/\btou\b/g, 'estou'],
  [/\btenho q\b/g, 'tenho que'],
  [/\bpreciso q\b/g, 'preciso que'],
  [/\bmes\b/g, 'mes'],
  [/\bproximo\b/g, 'proximo'],
  [/\baprt\b/g, 'aporte'],
  [/\baprtar\b/g, 'aportar'],
  [/\baporta\b/g, 'aportar'],
  [/\beconomizr\b/g, 'economizar'],
  [/\beconomisar\b/g, 'economizar'],
  [/\bguarda\b/g, 'guardar'],
  [/\bguardr\b/g, 'guardar'],
  [/\binvstir\b/g, 'investir'],
  [/\binvesti\b/g, 'investir'],
  [/\baplicar\b/g, 'aplicar'],
  [/\baplicacao\b/g, 'aplicacao'],
  [/\breserva\b/g, 'reserva'],
  [/\bresrva\b/g, 'reserva'],
  [/\bfinanciera\b/g, 'financeira'],
  [/\bfinaceira\b/g, 'financeira'],
  [/\borcamento\b/g, 'orcamento'],
  [/\borcameto\b/g, 'orcamento'],
  [/\bgastos\b/g, 'gastos'],
  [/\bgasto\b/g, 'gasto'],
  [/\bdespezas\b/g, 'despesas'],
  [/\bdespesa\b/g, 'despesa'],
  [/\bcartao\b/g, 'cartao'],
  [/\bfatura\b/g, 'fatura'],
  [/\bcompra\b/g, 'compra'],
  [/\bparcela?do\b/g, 'parcelado'],
  [/\bparcerla\b/g, 'parcela'],
  [/\bparcela\b/g, 'parcela'],
  [/\bqueroo\b/g, 'quero'],
  [/\bquerro\b/g, 'quero'],
  [/\bpretendo\b/g, 'pretendo'],
  [/\bobjetivo\b/g, 'objetivo'],
  [/\bmeta\b/g, 'meta']
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

  return value
    .replace(/\b(?:tipo|assim|meu|minha|mano|cara|ai|entao)\b\s*/g, match => match)
    .replace(/\s+/g, ' ')
    .trim();
}

export function autocorrectFinancialText(text) {
  const normalized = normalizeUserText(text);
  return {
    original: String(text ?? ''),
    normalized,
    changed: normalized !== String(text ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim()
  };
}
