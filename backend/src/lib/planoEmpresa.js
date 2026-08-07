// backend/src/lib/planoEmpresa.js
//
// LIMITE DE USUÁRIOS POR PLANO — fase 2 do multi-tenancy (docs/MULTI-TENANCY-PLANO.md §5.3).
//
// Fonte ÚNICA da conta de assentos. Existe porque o limite precisa ser verificado em
// QUATRO pontos de entrada diferentes (inclusão direta, convite, aceite do convite e
// religar o acesso de quem já é cadastrado) — e a regra escrita quatro vezes divergiria
// na primeira exceção.

const prisma = require('./prisma').default;

/** Erro de negócio: virou 409 no controller, com o código que o front reconhece. */
class LimitePlanoError extends Error {
  constructor(mensagem, dados) {
    super(mensagem);
    this.name = 'LimitePlanoError';
    this.code = 'LIMITE_USUARIOS_PLANO';
    this.dados = dados;
  }
}

/**
 * ASSENTO OCUPADO — quem conta para o limite do plano.
 *
 *   acesso_sistema = true   → quem não entra no sistema não ocupa licença
 *   ativo = true            → inativo na empresa não ocupa
 *   perfil <> 'PROPRIETARIO'→ D2: cliente com portal NÃO é usuário faturável.
 *                             (Haverá plano próprio para acesso de proprietário.)
 *
 * ⚠️ A conta é por EMPRESA. A mesma pessoa em duas clínicas ocupa um assento em cada —
 * é o que se está cobrando: uso da aplicação naquela clínica.
 */
const SQL_ASSENTOS = `
  SELECT COUNT(*)::int AS n
    FROM schs2vet.tb_usuario_empresa
   WHERE empresa_id = $1
     AND acesso_sistema = true
     AND ativo = true
     AND perfil <> 'PROPRIETARIO'`;

async function assentosOcupados(empresaId, client = prisma) {
  if (!empresaId) return 0;
  try {
    const rows = await client.$queryRawUnsafe(SQL_ASSENTOS, Number(empresaId));
    return rows?.[0]?.n ?? 0;
  } catch {
    return 0; // coluna ainda não migrada — não trava a inclusão de membro
  }
}

/**
 * Limite de assentos da empresa. Ordem: override da assinatura → limite do plano.
 *
 * ⚠️ **`null` significa ILIMITADO, e não zero.** Empresa sem assinatura também é
 * ilimitada — de propósito: as 12 empresas que já existem não têm plano atribuído, e
 * fazê-las cair em "zero assentos" trancaria todo mundo para fora no deploy. Cobrança
 * começa quando alguém atribuir um plano.
 */
async function limiteUsuarios(empresaId, client = prisma) {
  if (!empresaId) return null;
  try {
    const rows = await client.$queryRawUnsafe(
      `SELECT a.limite_usuarios_override AS override, p.limite_usuarios AS plano
         FROM schs2vet.tb_assinaturas_empresa a
         JOIN schs2vet.tb_planos p ON p.id = a.plano_id
        WHERE a.empresa_id = $1`,
      Number(empresaId),
    );
    const r = rows?.[0];
    if (!r) return null;                       // sem assinatura = sem limite
    return r.override ?? r.plano ?? null;      // override VENCE o plano
  } catch {
    return null; // tabelas ainda não migradas — não trava nada
  }
}

/** Retrato do consumo, para a tela e para a mensagem de erro. */
async function usoDeAssentos(empresaId, client = prisma) {
  const [limite, ocupados] = await Promise.all([
    limiteUsuarios(empresaId, client),
    assentosOcupados(empresaId, client),
  ]);
  return { limite, ocupados, ilimitado: limite == null, disponiveis: limite == null ? null : Math.max(limite - ocupados, 0) };
}

/**
 * Garante que cabe MAIS UM usuário com acesso na empresa. Lança `LimitePlanoError`
 * (→ 409) quando não cabe.
 *
 * ⚠️ Chamar **antes** de gravar, dentro da mesma transaction quando houver — senão o
 * membro é criado e só depois se descobre que não cabia.
 *
 * @param {number} empresaId
 * @param {object} opcoes
 * @param {boolean} opcoes.ocupaAssento  false quando o vínculo criado NÃO consome licença
 *                                       (proprietário, ou membro sem acesso ao sistema)
 * @param {number}  opcoes.jaOcupava     1 quando a pessoa JÁ ocupa assento nesta empresa
 *                                       (ex.: editar quem já tem acesso) — senão a
 *                                       edição de um membro existente seria contada como
 *                                       um assento novo e reprovaria com o plano cheio.
 */
async function garantirVagaDeUsuario(empresaId, { ocupaAssento = true, jaOcupava = 0, client = prisma } = {}) {
  if (!ocupaAssento) return;
  const limite = await limiteUsuarios(empresaId, client);
  if (limite == null) return;                        // ilimitado

  const ocupados = await assentosOcupados(empresaId, client);
  const depois   = ocupados - Number(jaOcupava || 0) + 1;
  if (depois <= limite) return;

  throw new LimitePlanoError(
    `O plano desta empresa permite ${limite} usuário${limite === 1 ? '' : 's'} com acesso ao sistema, ` +
    `e ${ocupados} já ${ocupados === 1 ? 'está em uso' : 'estão em uso'}. ` +
    'Altere o plano ou revogue o acesso de outro membro.',
    { limite, ocupados },
  );
}

/** true se este vínculo consome licença — espelha a definição de ASSENTO acima. */
const consomeAssento = ({ perfil, acessoSistema = true, ativo = true }) =>
  acessoSistema !== false && ativo !== false && perfil !== 'PROPRIETARIO';

module.exports = {
  LimitePlanoError,
  assentosOcupados,
  limiteUsuarios,
  usoDeAssentos,
  garantirVagaDeUsuario,
  consomeAssento,
};
