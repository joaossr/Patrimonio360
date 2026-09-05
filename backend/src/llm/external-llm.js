const GEMINI_BASE='https://generativelanguage.googleapis.com/v1beta';
const DEEPSEEK_BASE='https://api.deepseek.com';

// O provedor é controlado por uma única variável: P360_LLM_PROVIDER.
// Valores aceitos: deepseek ou gemini. DeepSeek é o padrão atual.
const provider=String(process.env.P360_LLM_PROVIDER||'deepseek').toLowerCase();
const enabled=String(process.env.P360_LLM_ENABLED||'true').toLowerCase()==='true';

function compact(value,max=18000){
  const text=JSON.stringify(value??{});
  return text.length>max?text.slice(0,max)+'…':text;
}

function systemPrompt(){
  return `Você é o Assistente Financeiro do Patrimônio 360.
Sua função é explicar e analisar dados financeiros do usuário de forma clara, prática e responsável.
REGRAS OBRIGATÓRIAS:
- Use somente os dados fornecidos no CONTEXTO FINANCEIRO. Nunca invente saldo, receita, despesa, investimento, meta ou percentual.
- Os cálculos presentes no contexto foram feitos pelo motor financeiro do Patrimônio 360 e são a fonte de verdade.
- Preserve valores, datas e percentuais exatamente como fornecidos quando mencioná-los.
- Se uma informação não estiver no contexto, diga que não há dados suficientes.
- Não diga que acessou banco, cartão ou conta externa; você só conhece os dados do Patrimônio 360.
- Não execute alterações nos dados. Simulações devem ser tratadas como hipotéticas.
- Para recomendações financeiras, explique o motivo e deixe claro quando for apenas uma sugestão.
- Responda em português do Brasil, de forma natural, direta e útil.
- Não mencione prompts, contexto interno, APIs, modelos ou provedores de IA.
- Não substitua orientação profissional para decisões financeiras relevantes.`;
}

function buildPrompt({question,analysis,risk,profile,insights,memory,financialContext,deterministicAnswer}){
  return `${systemPrompt()}

CONTEXTO FINANCEIRO OFICIAL:
${compact({analysis,risk,profile,insights,memory,financialContext},30000)}

RESPOSTA CALCULADA PELO MOTOR DO PATRIMÔNIO 360:
${compact(deterministicAnswer,8000)}

PERGUNTA DO USUÁRIO:
${String(question||'').slice(0,4000)}

Produza uma resposta útil para o usuário. Se a resposta calculada já responder corretamente à pergunta, preserve seus números e complemente apenas com explicação. Não invente dados.`;
}

async function callGemini(prompt){
  const key=process.env.GEMINI_API_KEY;
  if(!key) return null;
  const model=process.env.GEMINI_MODEL||'gemini-3.1-flash-lite';
  const response=await fetch(`${GEMINI_BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({systemInstruction:{parts:[{text:systemPrompt()}]},contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{temperature:0.2,maxOutputTokens:900}})
  });
  if(!response.ok){const detail=await response.text().catch(()=> '');throw new Error(`Gemini ${response.status}: ${detail.slice(0,300)}`);}
  const data=await response.json();
  return data?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('').trim()||null;
}

async function callDeepSeek(prompt){
  const key=process.env.DEEPSEEK_API_KEY;
  if(!key) return null;
  const model=process.env.DEEPSEEK_MODEL||'deepseek-v4-flash';
  const response=await fetch(`${DEEPSEEK_BASE}/chat/completions`,{
    method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},
    body:JSON.stringify({model,messages:[{role:'system',content:systemPrompt()},{role:'user',content:prompt}],thinking:{type:'disabled'},temperature:0.2,max_tokens:900})
  });
  if(!response.ok){const detail=await response.text().catch(()=> '');throw new Error(`DeepSeek ${response.status}: ${detail.slice(0,300)}`);}
  const data=await response.json();
  return data?.choices?.[0]?.message?.content?.trim()||null;
}

export function externalLLMStatus(){
  const configured=provider==='deepseek'?Boolean(process.env.DEEPSEEK_API_KEY):provider==='gemini'?Boolean(process.env.GEMINI_API_KEY):false;
  return {enabled,provider,configured,model:provider==='deepseek'?(process.env.DEEPSEEK_MODEL||'deepseek-v4-flash'):(process.env.GEMINI_MODEL||'gemini-3.1-flash-lite')};
}

export async function generateExternalResponse(args){
  if(!enabled)return null;
  if(provider!=='gemini'&&provider!=='deepseek')return null;
  const prompt=buildPrompt(args);
  try{
    return provider==='deepseek'?await callDeepSeek(prompt):await callGemini(prompt);
  }catch(error){
    console.warn(`P360 LLM (${provider}) indisponível; usando motor local:`,error.message);
    return null;
  }
}
