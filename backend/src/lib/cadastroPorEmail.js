// backend/src/lib/cadastroPorEmail.js
//
// "QUEM É ESTE E-MAIL NESTA EMPRESA?" — fonte única do preenchimento automático dos
// cadastros de pessoa (Prestador, Fornecedor, Proprietário, Membro da equipe).
//
// O PROBLEMA QUE ISTO RESOLVE: o mesmo profissional/cliente já cadastrado na clínica
// era redigitado do zero a cada novo cadastro — e, quando o e-mail já existia, o
// gestor só descobria no SALVAR, com um 409 depois de preencher o formulário inteiro.
// Agora a tela pergunta ao SAIR do campo de e-mail e traz o que a EMPRESA já sabe.
//
// 🔴 MULTI-TENANT — as três regras que não podem ser afrouxadas:
//
// 1. O `users` é IDENTIDADE, nunca fonte de dado cadastral (CLAUDE.md §36). A busca
//    por e-mail ali serve só para descobrir o `id`; nome, telefone, documento e
//    endereço saem SEMPRE de `tb_usuario_empresa` — a linha DESTA empresa. Ler do
//    `users` devolveria o cadastro que OUTRA clínica digitou.
//
// 2. FAIL-CLOSED sem empresa no contexto: sem `req.empresaId` não existe "cadastro
//    desta empresa" a trazer, e a resposta é `encontrado: false`. Nunca cair no
//    vínculo mais recente nem em qualquer empresa do usuário.
//
// 3. O RLS é a última linha e está de pé: `tb_usuario_empresa`, `tb_prestadores`,
//    `tb_fornecedores` e `tb_proprietario_perfis` têm ENABLE + FORCE com a policy
//    fail-closed `app_plataforma() OR empresa_id = app_empresa_id()` (conferido ao
//    vivo em 2026-09-15). Ou seja: mesmo que este código esquecesse o filtro, o banco
//    devolveria zero linha. O filtro explícito por `empresaId` continua aqui como
//    defesa em profundidade e como declaração de intenção — não como o único gate.
//
// ⚠️ NUNCA usar `comEscopoPlataforma` neste caminho: ele levanta o filtro de tenant, e
// é exatamente ele que impede um e-mail cadastrado na clínica vizinha de vazar.
'use strict';

const prismaPadrao = require('./prisma').default;
const { normalizeEmail, findUserByEmail } = require('./email');

// Campos que a EMPRESA mantém sobre a pessoa e que fazem sentido em qualquer um dos
// cadastros. Subconjunto de CAMPOS_CADASTRO (lib/usuarioEmpresa.js) — remuneração,
// mensalista e dia de vencimento ficam de FORA de propósito: são o acordo comercial de
// UM papel (membro, cliente), e herdá-los num cadastro de outro papel afirmaria um
// combinado que ninguém fez.
const CAMPOS_PESSOA = [
  'fullName', 'phone', 'phone2', 'cpf', 'cnpj',
  'cep', 'endereco', 'complemento', 'bairro', 'cidade', 'estado',
];

const RESPOSTA_VAZIA = Object.freeze({ encontrado: false });

// Como o perfil é apresentado na faixa da tela ("já cadastrado(a) aqui como …").
// Sem rótulo conhecido, a tela cai num texto genérico — nunca no slug cru.
const ROTULO_PERFIL = {
  GESTOR:       'Gestor(a)',
  VETERINARIO:  'Veterinário(a)',
  ESTAGIARIO:   'Estagiário(a)',
  ENFERMEIRO:   'Enfermeiro(a)',
  SECRETARIA:   'Secretária(o)',
  FINANCEIRO:   'Financeiro',
  FORNECEDOR:   'Fornecedor',
  PRESTADOR:    'Prestador',
  PROPRIETARIO: 'Cliente',
};

function rotuloPerfil(perfil) {
  return ROTULO_PERFIL[perfil] ?? null;
}

/**
 * O cadastro que ESTA empresa mantém sobre a pessoa dona deste e-mail.
 *
 * Devolve `null` quando o e-mail não existe, quando não há empresa no contexto ou
 * quando a pessoa não tem vínculo NESTA empresa — os três casos são, para a tela, a
 * mesma coisa: "não temos cadastro dela aqui, preencha do zero". Distinguir os três na
 * resposta transformaria o campo num verificador de e-mails de outras clínicas.
 *
 * @returns {{ userId:number, perfil:string|null, rotuloPerfil:string|null, cadastro:object }|null}
 */
async function cadastroDaPessoaNaEmpresa(email, empresaId, client = prismaPadrao) {
  const emailNorm = normalizeEmail(email);
  if (!emailNorm || !empresaId) return null;

  // `users` só para resolver a identidade — nenhum campo dele é devolvido.
  const user = await findUserByEmail(client, emailNorm, { select: { id: true } });
  if (!user) return null;

  const vinculo = await client.usuarioEmpresa.findFirst({
    where: { userId: user.id, empresaId: Number(empresaId) },
  });
  if (!vinculo) return null;

  const cadastro = {};
  for (const campo of CAMPOS_PESSOA) {
    const v = vinculo[campo];
    // `null`/vazio aqui significa "vazio NESTA empresa" (§36) — não entra no pacote
    // para a tela não "preencher" um campo com vazio por cima do que a pessoa digitou.
    // ⚠️ Só com espaços TAMBÉM é vazio: mandá-lo faz a tela dar o campo por preenchido
    // (`preencherVazios` para de considerá-lo em branco) e o formulário sai com " ".
    if (v === null || v === undefined) continue;
    if (typeof v === 'string') {
      if (v.trim() === '') continue;
      cadastro[campo] = v;
      continue;
    }
    cadastro[campo] = v;
  }

  return {
    userId:       user.id,
    perfil:       vinculo.perfil ?? null,
    rotuloPerfil: rotuloPerfil(vinculo.perfil),
    cadastro,
  };
}

/**
 * Monta a resposta única das rotas `…/por-email`.
 *
 * `registro` (quando existe) é o cadastro DAQUELE tipo já gravado na empresa: a tela
 * CARREGA e passa a EDITAR, em vez de montar uma duplicata que o backend recusaria.
 * Ele VENCE o cadastro da pessoa — é o dado mais específico, e é o que a tela vai
 * gravar por cima se alguém salvar.
 */
function montarResposta({ registro = null, pessoa = null } = {}) {
  if (registro) {
    return {
      encontrado:   true,
      origem:       'CADASTRO',
      registro,
      perfil:       pessoa?.perfil       ?? null,
      rotuloPerfil: pessoa?.rotuloPerfil ?? null,
    };
  }
  if (pessoa && Object.keys(pessoa.cadastro).length > 0) {
    return {
      encontrado:   true,
      origem:       'PESSOA',
      cadastro:     pessoa.cadastro,
      perfil:       pessoa.perfil,
      rotuloPerfil: pessoa.rotuloPerfil,
    };
  }
  return { ...RESPOSTA_VAZIA };
}

module.exports = {
  CAMPOS_PESSOA,
  RESPOSTA_VAZIA,
  rotuloPerfil,
  cadastroDaPessoaNaEmpresa,
  montarResposta,
};
