# DeepSeek — Patrimônio 360

A IA conversacional oficial desta versão é o **DeepSeek**.

- Provedor: DeepSeek
- Modelo padrão: `deepseek-v4-flash`
- Endpoint: `https://api.deepseek.com/chat/completions`
- Cálculos: Motor Financeiro determinístico
- Fallback local: não
- Outros provedores: não
- Chave no frontend: não

O frontend nunca acessa a chave do DeepSeek diretamente. Ele autentica o usuário com Firebase e chama o backend do Patrimônio 360.