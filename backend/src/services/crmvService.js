// backend/src/services/crmvService.js
// Tenta consultar o CFMV — fallback gracioso se indisponível

// CFMV usa busca interativa via JavaScript — scraping não é viável.
// Validação é feita apenas por formato no frontend.
async function validarCRMV(crmv) {
  const [numero, uf] = (crmv ?? '').toUpperCase().split('/');
  if (!numero || !uf) return { valido: false, motivo: 'formato_invalido' };
  return { valido: null, motivo: 'cfmv_indisponivel' };
}

module.exports = { validarCRMV };