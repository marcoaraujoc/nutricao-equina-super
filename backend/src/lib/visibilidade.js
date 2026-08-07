// backend/src/lib/visibilidade.js
//
// EXCLUSÃO LÓGICA — fonte ÚNICA da regra "este registro ainda aparece na aplicação?".
//
// ════════════════════════════════════════════════════════════════════════════
// A REGRA (decisão de produto, 2026-08-06)
// ════════════════════════════════════════════════════════════════════════════
//
// Nada é apagado do banco. O que muda é o que a aplicação MOSTRA, e isso depende
// de QUEM foi inativado:
//
//   ANIMAL · PROPRIETÁRIO · EMPRESA   → somem por completo. Não aparecem nem como
//     "inativo", e TUDO que pende deles some junto: evolução, prescrição, vacina,
//     exame, agendamento, fatura, histórico. São o SUJEITO do atendimento — sem eles
//     o registro filho não descreve nada que a clínica ainda precise ver.
//
//   PROFISSIONAL · FORNECEDOR · PRESTADOR → continuam aparecendo, marcados como
//     INATIVOS. São o AUTOR do registro: esconder o autor apagaria a autoria de
//     prontuário que continua válido ("quem prescreveu isto?" precisa ter resposta).
//     Por isso `MembroEquipe`/`UsuarioEmpresa` NÃO entram nos filtros deste arquivo.
//
// ⚠️ POR QUE ISSO PREVINE ÓRFÃO: enquanto o pai existir (apenas inativo), o filho
// nunca perde a referência. O `DELETE` físico é que produzia órfão — e produzia de
// duas formas, ambas medidas nesta base:
//   (a) `ON DELETE SET NULL` deixava o filho apontando para nada
//       (`tb_fatura_itens.animalId`, `tb_resenha_equino.animal_id`);
//   (b) coluna SOLTA, sem FK, nem era alcançada pelo CASCADE
//       (`tb_midia_arquivos.animal_id`, `AuditLog.animalId`).
//
// ⚠️ E POR QUE **NUNCA** ZERAR `empresaId` AO INATIVAR: era o outro gerador de
// órfão. `ProprietarioController.removerDaEmpresa` fazia
//     data: { ativo: false, empresaId: null, equipeId: null }
// — o animal saía da empresa e virava linha sem dono, exatamente o que trava o
// `NOT NULL` da fase 5. Inativar responde "aparece?"; a tenancy responde "de quem
// é?". São perguntas diferentes e a segunda não muda quando a primeira muda.
'use strict';

/**
 * Fragmento de `where` do ANIMAL visível.
 *
 * `user: { ativo: true }` é o proprietário: inativado o cliente, os animais dele
 * somem junto. É o `ativo` GLOBAL do login; o `ativo` POR EMPRESA vive em
 * `ProprietarioPerfil`/`UsuarioEmpresa` e é aplicado por `proprietarioAtivoNaEmpresa`,
 * porque exige o `empresaId` do contexto e nem todo caller o tem.
 */
const ANIMAL_VISIVEL = { ativo: true, user: { ativo: true } };

/**
 * O mesmo, para quem PENDE do animal (evolução, prescrição, vacina, exame,
 * encaminhamento, agendamento, item de fatura…).
 *
 * @param {string} campo nome da relação com o animal no modelo filho (default `animal`)
 */
function filhoDeAnimalVisivel(campo = 'animal') {
  return { [campo]: ANIMAL_VISIVEL };
}

/**
 * Recorte por empresa do cliente INATIVADO NAQUELA CLÍNICA (§36 do CLAUDE.md: o
 * cadastro do proprietário é POR EMPRESA). Some da empresa que o inativou e
 * continua visível nas outras.
 *
 * Devolve `{}` sem empresa no contexto — ADMIN de plataforma não tem clínica de
 * referência, e um filtro chutado ali esconderia dado legítimo.
 */
function proprietarioAtivoNaEmpresa(empresaId) {
  if (!empresaId) return {};
  return {
    user: {
      ativo: true,
      OR: [
        { proprietarioPerfis: { none: { empresaId: Number(empresaId) } } },  // sem cadastro aqui = legado, não esconde
        { proprietarioPerfis: { some: { empresaId: Number(empresaId), ativo: true } } },
      ],
    },
  };
}

/** Animal visível NO CONTEXTO: soma o `ativo` global e o da empresa ativa. */
function animalVisivelNaEmpresa(empresaId) {
  const porEmpresa = proprietarioAtivoNaEmpresa(empresaId);
  return porEmpresa.user
    ? { ativo: true, user: porEmpresa.user }
    : ANIMAL_VISIVEL;
}

module.exports = {
  ANIMAL_VISIVEL,
  filhoDeAnimalVisivel,
  proprietarioAtivoNaEmpresa,
  animalVisivelNaEmpresa,
};
