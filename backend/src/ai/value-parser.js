import { normalizeUserText } from './text-normalizer.js';

const MONTHS = ['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const norm = s => normalizeUserText(s);

const NUMBER_WORDS = new Map([
  ['zero',0],['um',1],['uma',1],['dois',2],['duas',2],['tres',3],['quatro',4],['cinco',5],['seis',6],['sete',7],['oito',8],['nove',9],['dez',10],['onze',11],['doze',12],['treze',13],['quatorze',14],['quinze',15],['dezesseis',16],['dezessete',17],['dezoito',18],['dezenove',19],['vinte',20]
]);

export function normalizeMoney(value){
  if(typeof value==='number') return Number.isFinite(value)?value:0;
  let s=String(value??'').trim().replace(/\s/g,'').replace(/^r\$/i,'');
  if(!s)return 0;
  if(/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(s))s=s.replace(/\./g,'').replace(',','.');
  else if(/^\d+(?:,\d{1,2})?$/.test(s))s=s.replace(',','.');
  else if(/^\d+\.\d{3}$/.test(s))s=s.replace('.','');
  else if(!/^\d+(?:\.\d{1,2})?$/.test(s))return 0;
  const n=Number(s);return Number.isFinite(n)?n:0;
}

function wordNumber(raw){
  const s=norm(raw).trim();
  if(NUMBER_WORDS.has(s))return NUMBER_WORDS.get(s);
  const m=s.match(/^(vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa)(?: e (um|dois|tres|quatro|cinco|seis|sete|oito|nove))?$/);
  if(!m)return 0;
  const tens={vinte:20,trinta:30,quarenta:40,cinquenta:50,sessenta:60,setenta:70,oitenta:80,noventa:90};
  return tens[m[1]]+(m[2]?NUMBER_WORDS.get(m[2])||0:0);
}

function candidates(text){
  const raw=String(text||''),out=[];
  const re=/(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/gi;
  for(const m of raw.matchAll(re)){
    const token=m[1],start=m.index??0,end=start+m[0].length;
    const before=raw.slice(Math.max(0,start-32),start),after=raw.slice(end,end+32);
    if(/^\s*(?:x|vezes|parcelas?)\b/i.test(after))continue;
    if(/parcelado\s+em\s*$/i.test(before))continue;
    if(/^\d{4}$/.test(token)&&Number(token)>=1900&&Number(token)<=2100)continue;
    if(/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(raw.slice(Math.max(0,start-5),end+5)))continue;
    out.push({value:normalizeMoney(token),raw:token,index:start,before,after});
  }
  return out.filter(x=>x.value>0);
}

export function parseInstallments(text){
  const raw=norm(text);
  for(const pattern of [
    /\bparcelado\s+em\s*(\d{1,3})(?:\s*(?:x|vezes|parcelas?))?\b/,
    /(?:em|de|por)\s*(\d{1,3})\s*(?:x|vezes|parcelas?)\b/,
    /\b(\d{1,3})\s*x\b/,
    /\b(\d{1,3})\s*(?:vezes|parcelas?)\b/
  ]){
    const m=raw.match(pattern);if(m)return Math.max(1,Number(m[1]));
  }
  return 0;
}

export function parseMoney(text){
  const raw=norm(text),thousand=raw.match(/(\d+(?:[.,]\d+)?)\s*mil\b/i);
  if(thousand){const base=normalizeMoney(thousand[1]);if(base)return base*1000;}
  const wordThousand=raw.match(/\b(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|vinte)\s+mil\b/);
  if(wordThousand)return(wordNumber(wordThousand[1])||0)*1000;
  const list=candidates(raw);if(list.length){
    const explicit=list.find(x=>/r\$|reais?|real\b/i.test(raw.slice(Math.max(0,x.index-24),x.index+48)));
    const semantic=list.find(x=>/compr|gastar|gasto|custa|preco|valor|coloc|invest|salario|renda|meta|objetivo|receb|ganh|pag|aporte|chegar|atingir|sobrou|entrou|torrei|tenho|poss?o/.test(raw.slice(Math.max(0,x.index-34),x.index+52)));
    return(explicit||semantic||list[0])?.value||0;
  }
  const word=raw.match(/\b(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa)\b/);
  return word?wordNumber(word[1]):0;
}

export function parseFinancialValue(text){
  const total=parseMoney(text),installments=parseInstallments(text)||1;
  return{total,installments,installmentValue:total&&installments>1?total/installments:total,raw:String(text||'')};
}

export function parseGoal(text,currentDate=new Date()){
  const raw=norm(text);
  const goalSignal=/(preciso ter|quero ter|pretendo atingir|quero formar|meu objetivo|objetivo de|minha meta|meta de|quero chegar|quero atingir|quero juntar|vou economizar|pretendo guardar|quero guardar|preciso guardar|formar uma reserva|juntar dinheiro|chegar nos?\s*\d|atingir\s*r?\$?\s*\d)/.test(raw);
  const projectionSignal=/(quanto.*(guardar|poupar|economizar|aportar)|qual.*aporte|quanto falta.*(meta|objetivo)|quando.*(chegar|atingir|alcancar).*meta|projec[aã]o|projetar.*meta|em quanto tempo.*(chego|chegar|atingir)|quanto.*ate dezembro|aporte.*preciso|preciso.*aporte)/.test(raw);
  if(!goalSignal&&!projectionSignal)return null;
  const target=parseMoney(raw);if(!target)return null;
  const monthIndex=MONTHS.findIndex(m=>raw.includes(m));
  if(monthIndex<0)return{target,month:null,year:null,deadline:null};
  const explicitYear=raw.match(/\b(20\d{2})\b/),currentYear=currentDate.getFullYear(),currentMonth=currentDate.getMonth()+1;
  const year=explicitYear?Number(explicitYear[1]):monthIndex+1<currentMonth?currentYear+1:currentYear;
  return{target,month:monthIndex+1,year,deadline:`${year}-${String(monthIndex+1).padStart(2,'0')}`};
}

export function parseDateMonth(text,currentDate=new Date()){
  const raw=norm(text);
  const explicit=raw.match(/\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*(?:de\s*)?(20\d{2})\b/);
  if(explicit)return`${explicit[2]}-${String(MONTHS.indexOf(explicit[1])+1).padStart(2,'0')}`;
  const numeric=raw.match(/\b(20\d{2})[-/](\d{1,2})\b/);
  if(numeric)return`${numeric[1]}-${String(Number(numeric[2])).padStart(2,'0')}`;
  const monthOnly=MONTHS.findIndex(m=>raw.includes(m));
  if(monthOnly>=0)return`${currentDate.getFullYear()}-${String(monthOnly+1).padStart(2,'0')}`;
  if(/mes passado/.test(raw)){const d=new Date(currentDate.getFullYear(),currentDate.getMonth()-1,1);return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}
  if(/proximo mes|mes que vem/.test(raw)){const d=new Date(currentDate.getFullYear(),currentDate.getMonth()+1,1);return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}
  return null;
}
