// Compatibilidade do frontend com bloqueadores que classificam /health como endpoint de monitoramento.
// O backend continua expondo /health para diagnóstico manual; o navegador usa /api/config
// para verificar disponibilidade sem acionar filtros de AdBlock/antitracking.
(() => {
  const nativeFetch = window.fetch.bind(window);

  window.fetch = (input, init) => {
    let url = typeof input === 'string' ? input : input?.url;

    if (url && /\/health(?:\?|$)/i.test(url)) {
      const replacementUrl = url.replace(/\/health(?=\?|$)/i, '/api/config');

      if (typeof input === 'string') {
        input = replacementUrl;
      } else if (input instanceof Request) {
        input = new Request(replacementUrl, input);
      } else if (input) {
        input = replacementUrl;
      }
    }

    return nativeFetch(input, init);
  };
})();
