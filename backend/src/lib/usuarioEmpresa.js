// backend/src/lib/usuarioEmpresa.js
//
// PONTO ÚNICO de leitura/escrita do vínculo usuário × empresa (tb_usuario_empresa).
//
// Regra do modelo (2026-07-30): `users` guarda só a IDENTIDADE (e-mail, senha,
// refresh token, 2FA, role de plataforma, ativo global). O PERFIL do usuário na
// empresa e TODO o cadastro dele ali (nome, telefone, documento, endereço, CRMV,
// condição comercial de cliente) vivem nesta tabela, uma linha por (usuário, empresa).
//
// NUNCA leia nome/telefone/endereço/documento de um usuário direto do `users` numa
// tela de empresa — o `users` só tem o resíduo legado. Use `perfilDaEmpresa` /
// `aplicarVinculo` / `aplicarVinculoEmLista`, e para gravar use `salvarVinculo`.
'use strict';

const prisma = require('./prisma').default;
// `tb_usuario_empresa` passou a ter RLS por empresa (defesa em profundidade —
// dado pessoal + remuneração). As DUAS leituras "por user_id" desta lib
// (`podeAcessarSistema`, `empresasSemAcesso`) respondem perguntas que atravessam
// tenants por natureza ("este usuário tem acesso / está bloqueado em ALGUMA
// empresa?") e rodam FORA de um contexto de empresa (o login, antes do
// `authenticate`). Sob a policy por empresa elas voltariam vazio e trancariam o
// usuário para fora. `comEscopoPlataforma` levanta o filtro de tenant; o
// `WHERE user_id = $1` de cada query é o que mantém a leitura restrita a ESTE
// usuário — nunca a de terceiros.
const { comEscopoPlataforma } = require('./prismaTenant');

// Campos cadastrais que a empresa mantém sobre a pessoa. `null` aqui significa
// "vazio NESTA empresa" — nunca cai de volta no `users`.
const CAMPOS_CADASTRO = [
  'fullName', 'phone', 'phone2', 'cpf', 'cnpj',
  'cep', 'endereco', 'complemento', 'bairro', 'cidade', 'estado',
  'crmv', 'mensalista', 'valorAssistencia', 'frequenciaVisitas', 'diaVencimentoFatura',
];

const PERFIS_PROFISSIONAIS = ['GESTOR', 'VETERINARIO', 'ESTAGIARIO', 'ENFERMEIRO', 'SECRETARIA', 'FINANCEIRO', 'FORNECEDOR', 'PRESTADOR'];
const ehPerfilProfissional = (p) => PERFIS_PROFISSIONAIS.includes(p);

/**
 * A pessoa já é PROFISSIONAL nesta empresa? — perfil não-PROPRIETARIO em
 * tb_usuario_empresa OU dona da empresa (`Empresa.ownerId`).
 *
 * Existe porque o DONO nem sempre tem uma linha em tb_usuario_empresa (empresa
 * criada por caminho antigo, ou dono sem MembroEquipe ainda) — sem o segundo termo,
 * cadastrar o próprio dono como CLIENTE (ProprietarioController) não achava nenhum
 * vínculo profissional e sobrescrevia `perfil` para PROPRIETARIO, rebaixando-o na
 * própria empresa (caso real: dona da Patyvet perdeu o `perfil` GESTOR ao se
 * cadastrar como cliente dela mesma). SEMPRE checar isto antes de gravar
 * `perfil: 'PROPRIETARIO'` num vínculo existente.
 */
async function ehProfissionalNaEmpresa(userId, empresaId, client = prisma) {
  if (!userId || !empresaId) return false;
  const [vinculo, empresa] = await Promise.all([
    client.usuarioEmpresa.findUnique({
      where:  { userId_empresaId: { userId: Number(userId), empresaId: Number(empresaId) } },
      select: { perfil: true },
    }),
    client.empresa.findFirst({ where: { id: Number(empresaId), ownerId: Number(userId) }, select: { id: true } }),
  ]);
  if (empresa) return true;
  return !!(vinculo && vinculo.perfil !== 'PROPRIETARIO');
}

/** Vínculo do usuário na empresa (null quando ele não pertence a ela). */
async function perfilDaEmpresa(userId, empresaId, client = prisma) {
  if (!userId || !empresaId) return null;
  return client.usuarioEmpresa.findUnique({
    where: { userId_empresaId: { userId: Number(userId), empresaId: Number(empresaId) } },
  });
}

/** Todas as empresas a que o usuário pertence, com o perfil de cada uma. */
async function empresasDoUsuario(userId, client = prisma) {
  return client.usuarioEmpresa.findMany({
    where:   { userId: Number(userId) },
    include: { empresa: { select: { id: true, nome: true, cnpj: true } } },
    orderBy: { empresaId: 'asc' },
  });
}

/**
 * Sobrepõe no objeto de usuário os dados cadastrais DESTA empresa.
 * Havendo vínculo, ele é AUTORIDADE de todos os seus campos (null = vazio aqui).
 * Sem vínculo (ADMIN de plataforma, usuário fora de empresa), devolve como veio.
 */
async function aplicarVinculo(user, empresaId, client = prisma) {
  if (!user || !empresaId) return user;
  const v = await perfilDaEmpresa(user.id, empresaId, client);
  if (!v) return user;
  const out = { ...user };
  for (const campo of CAMPOS_CADASTRO) if (campo in v) out[campo] = v[campo];
  out.perfilEmpresa = v.perfil;
  out.ativoNaEmpresa = v.ativo;
  out.ativo = (user.ativo !== false) && v.ativo;
  return out;
}

/** Versão em lote — uma query só para a lista inteira. */
async function aplicarVinculoEmLista(users, empresaId, client = prisma) {
  if (!empresaId || !Array.isArray(users) || users.length === 0) return users;
  const ids = [...new Set(users.map(u => u?.id).filter(Boolean))];
  if (ids.length === 0) return users;
  const vinculos = await client.usuarioEmpresa.findMany({
    where: { empresaId: Number(empresaId), userId: { in: ids } },
  });
  const porUser = new Map(vinculos.map(v => [v.userId, v]));
  return users.map(u => {
    const v = porUser.get(u?.id);
    if (!v) return u;
    const out = { ...u };
    for (const campo of CAMPOS_CADASTRO) if (campo in v) out[campo] = v[campo];
    out.perfilEmpresa   = v.perfil;
    out.ativoNaEmpresa  = v.ativo;
    out.ativo = (u.ativo !== false) && v.ativo;
    return out;
  });
}

/** Idem, quando o usuário está sob uma chave de relação (ex.: membro.user). */
async function aplicarVinculoEmRelacao(itens, chave, empresaId, client = prisma) {
  if (!empresaId || !Array.isArray(itens) || itens.length === 0) return itens;
  const users = itens.map(i => i?.[chave]).filter(Boolean);
  const aplicados = await aplicarVinculoEmLista(users, empresaId, client);
  let i = 0;
  return itens.map(item => (item?.[chave] ? { ...item, [chave]: aplicados[i++] } : item));
}

/**
 * Cria/atualiza o vínculo. Só grava os campos ENVIADOS (undefined não apaga o que
 * já está lá) — o caller manda `null` quando quer limpar de verdade.
 */
async function salvarVinculo(client, userId, empresaId, { perfil, ...dados } = {}) {
  if (!userId || !empresaId) return null;
  const limpo = {};
  for (const campo of CAMPOS_CADASTRO) if (dados[campo] !== undefined) limpo[campo] = dados[campo];
  if (dados.ativo !== undefined) limpo.ativo = dados.ativo;

  return client.usuarioEmpresa.upsert({
    where:  { userId_empresaId: { userId: Number(userId), empresaId: Number(empresaId) } },
    create: { userId: Number(userId), empresaId: Number(empresaId), perfil: perfil ?? 'PROPRIETARIO', ...limpo },
    update: { ...(perfil ? { perfil } : {}), ...limpo },
  });
}

/** Troca só o perfil (ex.: gestor muda o cargo do membro). */
async function definirPerfil(client, userId, empresaId, perfil) {
  return salvarVinculo(client, userId, empresaId, { perfil });
}

/**
 * Garante o vínculo a partir de um MembroEquipe: resolve a EMPRESA pela equipe e
 * grava o perfil. TODO ponto que cria/altera `MembroEquipe` tem de chamar isto —
 * senão a pessoa fica na equipe sem linha em tb_usuario_empresa, o tipo dela naquela
 * empresa não é encontrado e a resolução cai no legado (foi o que aconteceu com o
 * GESTOR da própria empresa: `criarEmpresa` criava o membro e não o vínculo).
 */
async function vincularMembro(client, userId, equipeId, perfil) {
  if (!userId || !equipeId) return null;
  const equipe = await client.equipe.findUnique({
    where:  { id: Number(equipeId) },
    select: { empresaId: true },
  });
  if (!equipe?.empresaId) return null;
  return salvarVinculo(client, userId, equipe.empresaId, { perfil });
}

// ─── Remuneração e acesso ao sistema (migration 20260812000002) ───────────────
//
// Lidos/gravados por SQL CRU porque o client Prisma pode não conhecer as colunas
// ainda (no Windows o `generate` falha com o backend rodando) — mesmo padrão do
// `isConvidado`/`cadastroConfirmadoEm`. Passar campo desconhecido para o
// `usuarioEmpresa.upsert` derrubaria a INCLUSÃO DE MEMBRO inteira, então o extra
// vai num UPDATE à parte.

const TIPOS_PAGAMENTO  = ['SALARIO', 'COMISSAO'];
const FORMAS_PAGAMENTO = ['VALOR', 'PERCENTUAL'];

/**
 * As colunas novas já existem no banco?
 *
 * ⚠️ SQL cru para coluna inexistente DENTRO de uma transaction aborta a TRANSACTION
 * INTEIRA no Postgres (25P02) — e o `try/catch` em JS não desfaz isso: quem estoura
 * é o comando SEGUINTE, longe do culpado. Hoje estes helpers são chamados fora de
 * transaction, mas o guard impede que isso vire uma armadilha para o próximo caller.
 * `false` expira em 60s: rodar a migration com o backend no ar volta a funcionar
 * sem restart.
 */
let _temColunas = null;
let _temColunasEm = 0;
async function temColunasPagamento() {
  if (_temColunas === true) return true;
  if (_temColunas === false && Date.now() - _temColunasEm < 60_000) return false;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'schs2vet' AND table_name = 'tb_usuario_empresa'
          AND column_name = 'acesso_sistema' LIMIT 1`,
    );
    _temColunas = rows.length > 0;
  } catch { _temColunas = false; }
  _temColunasEm = Date.now();
  return _temColunas;
}

/**
 * Valida e normaliza a remuneração informada pelo gestor.
 * @returns {{ erro: string|null, dados: {tipoPagamento,formaPagamento,valorPagamento}|null }}
 */
function normalizarPagamento({ tipoPagamento, formaPagamento, valorPagamento } = {}) {
  const tipo  = String(tipoPagamento  ?? '').trim().toUpperCase();
  const forma = String(formaPagamento ?? '').trim().toUpperCase();

  if (!tipo)  return { erro: 'Informe o tipo de pagamento (salário ou comissão).', dados: null };
  if (!TIPOS_PAGAMENTO.includes(tipo)) return { erro: 'Tipo de pagamento inválido.', dados: null };
  if (!forma) return { erro: 'Informe se o valor do pagamento é em R$ ou em percentual.', dados: null };
  if (!FORMAS_PAGAMENTO.includes(forma)) return { erro: 'Forma do valor de pagamento inválida.', dados: null };

  // String vazia vira NaN aqui de propósito: campo em branco é ausência, não zero.
  const valor = valorPagamento === '' || valorPagamento === null || valorPagamento === undefined
    ? NaN
    : Number(valorPagamento);
  if (!Number.isFinite(valor))  return { erro: 'Informe o valor do pagamento.', dados: null };
  if (valor <= 0)               return { erro: 'O valor do pagamento deve ser maior que zero.', dados: null };
  if (forma === 'PERCENTUAL' && valor > 100) {
    return { erro: 'O percentual de pagamento não pode passar de 100%.', dados: null };
  }

  return { erro: null, dados: { tipoPagamento: tipo, formaPagamento: forma, valorPagamento: valor } };
}

/** Grava remuneração e/ou acesso. `undefined` não toca no valor já gravado. */
async function salvarPagamentoEAcesso(client, userId, empresaId, { tipoPagamento, formaPagamento, valorPagamento, acessoSistema } = {}) {
  if (!userId || !empresaId) return;
  const sets = [];
  const vals = [];
  const push = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (tipoPagamento  !== undefined) push('tipo_pagamento',  tipoPagamento);
  if (formaPagamento !== undefined) push('forma_pagamento', formaPagamento);
  if (valorPagamento !== undefined) push('valor_pagamento', valorPagamento);
  if (acessoSistema  !== undefined) push('acesso_sistema',  acessoSistema === true);
  if (sets.length === 0) return;
  if (!(await temColunasPagamento())) return;
  vals.push(Number(userId), Number(empresaId));
  try {
    await client.$executeRawUnsafe(
      `UPDATE schs2vet.tb_usuario_empresa SET ${sets.join(', ')}
        WHERE user_id = $${vals.length - 1} AND empresa_id = $${vals.length}`,
      ...vals,
    );
  } catch { /* colunas ainda não migradas */ }
}

/**
 * Liga/desliga o vínculo do profissional NAQUELA empresa (`tb_usuario_empresa.ativo`).
 *
 * 🔴 É o que substitui `User.ativo` na (in)ativação de membro (2026-09-04). `User.ativo`
 * é a identidade GLOBAL — mexer nele para tirar alguém de UMA clínica fechava o login
 * dela em TODAS, inclusive nas que ela gerencia (defeito relatado). Aqui o efeito fica
 * onde a decisão foi tomada: a empresa some do seletor (`empresasSemAcesso`) e o
 * contexto dela é recusado no `auth`, enquanto as demais seguem intactas.
 * ⚠️ NÃO toca `acesso_sistema`: são coisas diferentes — "não trabalha mais aqui" ×
 * "trabalha, mas sem login". Desligar as duas juntas impediria reativar só uma.
 */
async function definirAtivoNaEmpresa(client, userId, empresaId, ativo) {
  if (!userId || !empresaId) return false;
  try {
    const n = await client.$executeRawUnsafe(
      `UPDATE schs2vet.tb_usuario_empresa SET ativo = $1 WHERE user_id = $2 AND empresa_id = $3`,
      ativo === true, Number(userId), Number(empresaId),
    );
    return n > 0;
  } catch {
    return false; // coluna/linha ainda não existe — o caller cai no comportamento antigo
  }
}

/** Remuneração + acesso de vários usuários numa empresa: Map(userId → dados). */
async function lerPagamentoEAcesso(client, userIds, empresaId) {
  const ids = [...new Set((userIds ?? []).map(Number).filter(Number.isInteger))];
  const mapa = new Map();
  if (ids.length === 0 || !empresaId) return mapa;
  if (!(await temColunasPagamento())) return mapa;
  try {
    const ph = ids.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await client.$queryRawUnsafe(
      `SELECT user_id, tipo_pagamento, forma_pagamento, valor_pagamento, acesso_sistema
         FROM schs2vet.tb_usuario_empresa
        WHERE empresa_id = $${ids.length + 1} AND user_id IN (${ph})`,
      ...ids, Number(empresaId),
    );
    for (const r of rows) {
      mapa.set(r.user_id, {
        tipoPagamento:  r.tipo_pagamento,
        formaPagamento: r.forma_pagamento,
        valorPagamento: r.valor_pagamento,
        acessoSistema:  r.acesso_sistema !== false,
      });
    }
  } catch { /* colunas ainda não migradas */ }
  return mapa;
}

/** Anexa a remuneração/acesso ao usuário sob `chave` (ex.: membro.user). */
async function anexarPagamentoEmRelacao(itens, chave, empresaId, client = prisma) {
  if (!empresaId || !Array.isArray(itens) || itens.length === 0) return itens;
  const mapa = await lerPagamentoEAcesso(client, itens.map(i => i?.[chave]?.id), empresaId);
  return itens.map(item => {
    const u = item?.[chave];
    const d = u ? mapa.get(u.id) : null;
    return d ? { ...item, [chave]: { ...u, ...d } } : item;
  });
}

// ─── Foto da pessoa na empresa (migration 20260814000000) ─────────────────────
//
// Mesma justificativa de SQL cru da remuneração acima: coluna nova, client Prisma
// possivelmente desatualizado. `_temFoto` segue o mesmo cache com expiração de 60s.

let _temFoto = null;
let _temFotoEm = 0;
async function temColunaFoto() {
  if (_temFoto === true) return true;
  if (_temFoto === false && Date.now() - _temFotoEm < 60_000) return false;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'schs2vet' AND table_name = 'tb_usuario_empresa'
          AND column_name = 'foto_url' LIMIT 1`,
    );
    _temFoto = rows.length > 0;
  } catch { _temFoto = false; }
  _temFotoEm = Date.now();
  return _temFoto;
}

/** Foto do usuário nesta empresa. null = sem foto (ou coluna ainda não migrada). */
async function lerFoto(userId, empresaId, client = prisma) {
  if (!userId || !empresaId) return null;
  if (!(await temColunaFoto())) return null;
  try {
    const rows = await client.$queryRawUnsafe(
      'SELECT foto_url FROM schs2vet.tb_usuario_empresa WHERE user_id = $1 AND empresa_id = $2 LIMIT 1',
      Number(userId), Number(empresaId),
    );
    return rows?.[0]?.foto_url ?? null;
  } catch { return null; }
}

/**
 * Grava (ou apaga, com null) a foto. Devolve a URL ANTERIOR para o caller decidir
 * apagar o arquivo velho do storage — sem isso cada troca deixa um órfão em disco.
 */
async function salvarFoto(client, userId, empresaId, fotoUrl) {
  if (!userId || !empresaId) return null;
  if (!(await temColunaFoto())) return null;
  const anterior = await lerFoto(userId, empresaId, client);
  try {
    await client.$executeRawUnsafe(
      'UPDATE schs2vet.tb_usuario_empresa SET foto_url = $1 WHERE user_id = $2 AND empresa_id = $3',
      fotoUrl ?? null, Number(userId), Number(empresaId),
    );
  } catch { /* coluna ainda não migrada */ }
  return anterior;
}

/** Fotos de vários usuários numa empresa: Map(userId → url). */
async function lerFotos(client, userIds, empresaId) {
  const ids = [...new Set((userIds ?? []).map(Number).filter(Number.isInteger))];
  const mapa = new Map();
  if (ids.length === 0 || !empresaId) return mapa;
  if (!(await temColunaFoto())) return mapa;
  try {
    const ph = ids.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await client.$queryRawUnsafe(
      `SELECT user_id, foto_url FROM schs2vet.tb_usuario_empresa
        WHERE empresa_id = $${ids.length + 1} AND user_id IN (${ph})`,
      ...ids, Number(empresaId),
    );
    for (const r of rows) if (r.foto_url) mapa.set(r.user_id, r.foto_url);
  } catch { /* coluna ainda não migrada */ }
  return mapa;
}

/** Anexa `fotoUrl` ao usuário sob `chave` (ex.: membro.user). */
async function anexarFotoEmRelacao(itens, chave, empresaId, client = prisma) {
  if (!empresaId || !Array.isArray(itens) || itens.length === 0) return itens;
  const mapa = await lerFotos(client, itens.map(i => i?.[chave]?.id), empresaId);
  return itens.map(item => {
    const u = item?.[chave];
    if (!u) return item;
    return { ...item, [chave]: { ...u, fotoUrl: mapa.get(u.id) ?? null } };
  });
}

// ─── Assinatura do profissional (Central de Documentos) ──────────────────────
//
// Imagem da assinatura, POR EMPRESA (migration 20260918000000) — mesma razão da
// foto: o cadastro é da clínica, e trocar a assinatura numa não pode reescrever o
// cadastro da outra. É o que o bloco `assinatura` do documento renderiza sobre a
// linha, junto do nome e do CRMV (a coluna `crmv` desta mesma tabela).
//
// Mesmo SQL cru e mesmo guard de coluna da foto — pelo mesmo motivo: coluna nova,
// client Prisma possivelmente não regenerado (no Windows o `generate` falha com o
// backend rodando, §11).

let _temAssinatura = null;
let _temAssinaturaEm = 0;
async function temColunaAssinatura() {
  if (_temAssinatura === true) return true;
  if (_temAssinatura === false && Date.now() - _temAssinaturaEm < 60_000) return false;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'schs2vet' AND table_name = 'tb_usuario_empresa'
          AND column_name = 'assinatura_url' LIMIT 1`,
    );
    _temAssinatura = rows.length > 0;
  } catch { _temAssinatura = false; }
  _temAssinaturaEm = Date.now();
  return _temAssinatura;
}

/** Assinatura do usuário nesta empresa. null = sem assinatura (ou coluna não migrada). */
async function lerAssinatura(userId, empresaId, client = prisma) {
  if (!userId || !empresaId) return null;
  if (!(await temColunaAssinatura())) return null;
  try {
    const rows = await client.$queryRawUnsafe(
      'SELECT assinatura_url FROM schs2vet.tb_usuario_empresa WHERE user_id = $1 AND empresa_id = $2 LIMIT 1',
      Number(userId), Number(empresaId),
    );
    return rows?.[0]?.assinatura_url ?? null;
  } catch { return null; }
}

/**
 * Grava (ou apaga, com null) a assinatura. Devolve a URL ANTERIOR — o caller só
 * apaga o arquivo velho DEPOIS de o banco apontar para o novo; ao contrário, uma
 * falha na gravação deixaria o cadastro apontando para arquivo inexistente.
 */
async function salvarAssinatura(client, userId, empresaId, assinaturaUrl) {
  if (!userId || !empresaId) return null;
  if (!(await temColunaAssinatura())) return null;
  const anterior = await lerAssinatura(userId, empresaId, client);
  try {
    await client.$executeRawUnsafe(
      'UPDATE schs2vet.tb_usuario_empresa SET assinatura_url = $1 WHERE user_id = $2 AND empresa_id = $3',
      assinaturaUrl ?? null, Number(userId), Number(empresaId),
    );
  } catch { /* coluna ainda não migrada */ }
  return anterior;
}

/**
 * Empresa que NÃO deixa ninguém entrar: `status <> 'ATIVA'`.
 *
 * D3 do multi-tenancy (docs/MULTI-TENANCY-PLANO.md): empresa SUSPENSA (inadimplência) ou
 * CANCELADA **bloqueia o login de todos dela**. É por EMPRESA, não por pessoa: quem
 * também trabalha em outra clínica entra nela normalmente e só perde a suspensa no
 * seletor de contexto.
 *
 * ⚠️ Quem governa o ACESSO é `tb_empresas.status`. `tb_assinaturas_empresa.status`
 * descreve a situação COMERCIAL e não bloqueia nada sozinho — suspender é decisão
 * explícita, não efeito colateral de uma fatura em atraso.
 */
const EMPRESA_ATIVA_SQL = `COALESCE(e.status, 'ATIVA') = 'ATIVA'`;

/**
 * `tb_prestadores.user_id`/`acesso_sistema` já existem no banco? Mesmo guard e mesma
 * razão de `temColunasPagamento` (migration `20260822000000_prestador_pagamento_local_acesso`).
 */
let _temColunasPrestador = null;
let _temColunasPrestadorEm = 0;
async function temColunasPrestadorAcesso() {
  if (_temColunasPrestador === true) return true;
  if (_temColunasPrestador === false && Date.now() - _temColunasPrestadorEm < 60_000) return false;
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'schs2vet' AND table_name = 'tb_prestadores'
          AND column_name = 'user_id' LIMIT 1`,
    );
    _temColunasPrestador = rows.length > 0;
  } catch { _temColunasPrestador = false; }
  _temColunasPrestadorEm = Date.now();
  return _temColunasPrestador;
}

/**
 * O usuário pode entrar na aplicação?
 *
 * Regra: quem TEM vínculo precisa de ao menos UM que seja, ao mesmo tempo, **com
 * acesso liberado** E **numa empresa ATIVA**. Quem não tem vínculo nenhum (vet
 * autônomo, proprietário legado, ADMIN da plataforma) não é barrado — não há quem tenha
 * concedido ou negado nada a ele.
 *
 * O vínculo pode vir de `tb_usuario_empresa` (membro de equipe) OU de
 * `tb_prestadores.user_id` (Prestador com login mas SEM MembroEquipe — ver §3.2 do
 * plano "Prestador: pagamento/local/acesso"). Sem contar o segundo, o toggle "acesso
 * ao sistema" do Prestador seria decorativo: zero vínculo em `tb_usuario_empresa`
 * sempre libera por padrão (linha `r.total === 0` abaixo).
 */
async function podeAcessarSistema(userId, client = prisma) {
  if (!userId) return true;
  const [temEmpresa, temPrestador] = await Promise.all([temColunasPagamento(), temColunasPrestadorAcesso()]);
  if (!temEmpresa && !temPrestador) return true;
  try {
    const partes = [];
    // 🔴 `ue.ativo` ENTRA NA CONTA (2026-09-04). Inativar alguém numa empresa é ato
    // DAQUELA empresa e não pode fechar o login dele nas outras — era o defeito
    // relatado: o membro inativado numa clínica não conseguia mais entrar em lugar
    // nenhum, inclusive onde é GESTOR. Aqui basta UM vínculo bom para entrar; qual
    // empresa ele enxerga depois é decidido por `empresasSemAcesso`.
    if (temEmpresa) partes.push(`
      SELECT ue.acesso_sistema AND COALESCE(ue.ativo, true) AND ${EMPRESA_ATIVA_SQL} AS liberado
        FROM schs2vet.tb_usuario_empresa ue
        JOIN schs2vet.tb_empresas e ON e.id = ue.empresa_id
       WHERE ue.user_id = $1`);
    if (temPrestador) partes.push(`
      SELECT p.acesso_sistema AS liberado
        FROM schs2vet.tb_prestadores p
       WHERE p.user_id = $1`);
    const rows = await comEscopoPlataforma(() => client.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE liberado)::int AS liberados
         FROM (${partes.join(' UNION ALL ')}) vinculos`,
      Number(userId),
    ));
    const r = rows?.[0];
    if (!r || r.total === 0) return true;
    return r.liberados > 0;
  } catch {
    return true; // coluna ainda não migrada — não tranca ninguém para fora
  }
}

/**
 * Ids das empresas que somem do seletor de contexto deste usuário: aquelas em que ele
 * está **inativo** ou **sem acesso**, e as que estão suspensas/canceladas (D3).
 *
 * 🔴 É esta lista que faz a inativação ser POR EMPRESA de verdade (2026-09-04): quem foi
 * inativado numa clínica continua entrando no sistema pelas outras, mas aquela some do
 * seletor e o contexto dela é recusado no `auth` — ele não vê dado nenhum de lá.
 * ⚠️ O DONO nunca é escondido pelo chamador (ver `meusContextos`): trancar o gestor
 * para fora da própria empresa não teria como ser desfeito por ninguém.
 */
async function empresasSemAcesso(userId, client = prisma) {
  const bloqueadas = new Set();
  if (!userId) return bloqueadas;
  if (!(await temColunasPagamento())) return bloqueadas;
  try {
    const rows = await comEscopoPlataforma(() => client.$queryRawUnsafe(
      `SELECT ue.empresa_id
         FROM schs2vet.tb_usuario_empresa ue
         JOIN schs2vet.tb_empresas e ON e.id = ue.empresa_id
        WHERE ue.user_id = $1
          AND (ue.acesso_sistema = false
               OR COALESCE(ue.ativo, true) = false
               OR NOT (${EMPRESA_ATIVA_SQL}))`,
      Number(userId),
    ));
    for (const r of rows) bloqueadas.add(r.empresa_id);
  } catch { /* coluna ainda não migrada */ }
  return bloqueadas;
}

module.exports = {
  CAMPOS_CADASTRO,
  PERFIS_PROFISSIONAIS,
  TIPOS_PAGAMENTO,
  FORMAS_PAGAMENTO,
  normalizarPagamento,
  salvarPagamentoEAcesso,
  lerPagamentoEAcesso,
  anexarPagamentoEmRelacao,
  podeAcessarSistema,
  empresasSemAcesso,
  definirAtivoNaEmpresa,
  lerFoto,
  lerFotos,
  salvarFoto,
  anexarFotoEmRelacao,
  lerAssinatura,
  salvarAssinatura,
  ehPerfilProfissional,
  ehProfissionalNaEmpresa,
  perfilDaEmpresa,
  empresasDoUsuario,
  aplicarVinculo,
  aplicarVinculoEmLista,
  aplicarVinculoEmRelacao,
  salvarVinculo,
  definirPerfil,
  vincularMembro,
};
