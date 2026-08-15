const forbidden=/\b(?:BCB|Banco Central|IBGE|SIDRA|dataset|registros comportamentais|pontos de distribuição)\b/i;
const money=/R\$\s*[\d.,]+/g;
function hasNaN(text){return /\b(?:NaN|undefined|null)\b/i.test(text);}
export function validateResponse({answer='',context={}}){
 const errors=[];
 if(!answer.trim())errors.push('empty-response');
 if(hasNaN(answer))errors.push('invalid-number');
 if(forbidden.test(answer))errors.push('internal-source-leak');
 const analysis=context.analysis||{};
 const known=[analysis.income?.total,analysis.expenses?.total,analysis.cashflow?.planned,analysis.reserve?.current].filter(Number.isFinite).map(Number);
 for(const value of answer.match(money)||[]){const n=Number(value.replace(/R\$\s*/,'').replace(/\./g,'').replace(',','.'));if(Number.isFinite(n)&&n>0&&known.length&&n>1e9)errors.push('implausible-money');}
 return {valid:errors.length===0,errors};
}
export function repairResponse(answer,context){return String(answer||'').replace(/\b(?:BCB|Banco Central|IBGE|SIDRA|dataset|registros comportamentais|pontos de distribuição)\b[^.]*\.?/gi,'').replace(/\b(?:NaN|undefined|null)\b/gi,'não disponível').replace(/\s{2,}/g,' ').trim();}
