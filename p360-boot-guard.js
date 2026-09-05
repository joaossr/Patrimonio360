// Protege a inicialização contra JSON inválido deixado por versões antigas.
(function(){
  const original=Storage.prototype.getItem;
  Storage.prototype.getItem=function(key){
    const value=original.call(this,key);
    if(!value)return value;
    if(key==='p360-state-v6'||key==='pf-ai-profile'||key==='pf-ai-history'){
      try{JSON.parse(value);return value;}
      catch{console.warn(`[P360] Estado local inválido ignorado: ${key}`);return null;}
    }
    return value;
  };
})();
