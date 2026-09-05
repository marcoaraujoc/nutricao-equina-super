// frontend/src/utils/print/assinaturaProfissional.ts
// Identidade de quem ASSINA um documento clínico impresso/PDF — nome, CRMV e a
// imagem da assinatura escaneada, sempre do vínculo com a EMPRESA ATIVA
// (`GET /users/:id/assinatura-profissional`, §36-f).
//
// POR QUÊ não sai do `marca` de `/documentos/contexto/:animalId`: aquele é o do
// USUÁRIO LOGADO, e o documento clínico é assinado por quem PRESCREVEU. Foi
// justamente "assinatura de um saindo na linha de outro" o que a sessão de
// 2026-09-02 corrigiu na Central de Documentos.
//
// ⚠️ A folha é montada de forma SÍNCRONA (`gerarHtml*` devolve string, e o
// `gerarHtml` de `compartilharPdf.ts` também). Por isso o carregamento é feito
// ANTES, e o resultado fica em cache de módulo: sem o cache, cada Imprimir /
// WhatsApp / E-mail pagaria um round-trip, e o do WhatsApp acontece dentro da
// janela de "user activation" do navegador (ver compartilharPdf.ts).
import api from '../../services/api';

export interface AssinaturaProfissional {
  nome:          string | null;
  crmv:          string | null;
  assinaturaUrl: string | null;
}

// Cache por usuário. Guarda a PROMESSA (não o valor): dois botões clicados no
// mesmo tick compartilham a mesma requisição, em vez de dispararem duas.
const cache = new Map<number, Promise<AssinaturaProfissional | null>>();

/**
 * Assinatura do profissional na empresa ativa. Devolve `null` quando não há
 * vínculo, quando não há empresa no contexto ou quando a chamada falha — nunca
 * lança: assinatura ausente faz a folha sair com a linha em branco para assinar
 * à mão, e isso jamais pode impedir a impressão.
 */
export function carregarAssinaturaProfissional(
  userId?: number | null,
): Promise<AssinaturaProfissional | null> {
  if (!userId) return Promise.resolve(null);

  const emCache = cache.get(userId);
  if (emCache) return emCache;

  const p = api.get(`/users/${userId}/assinatura-profissional`)
    // GET 403 resolve com `data: null` (interceptor de services/api.ts) — por
    // isso o encadeamento é todo com `?.`, nunca `res.data.dados`.
    .then(res => (res.data?.dados as AssinaturaProfissional | undefined) ?? null)
    .catch(() => null);

  cache.set(userId, p);
  return p;
}

/**
 * Esquece o que está em cache. Chamar depois de trocar a assinatura em
 * `/cadastro-pessoal` ou de trocar de empresa — o vínculo (e a assinatura) é
 * POR EMPRESA, então o valor da anterior não vale aqui.
 */
export function limparCacheAssinaturas(): void {
  cache.clear();
}
