'use strict';

/**
 * CARGO **PRESTADOR** — novo, ao lado de FORNECEDOR (2026-09-09).
 *
 * O pedido foi: "gere outro tipo além de fornecedor: prestador; nenhum dado precisa
 * ser alterado, deixe para as futuras inclusões". Isso cria uma armadilha específica,
 * e é ela que este arquivo guarda:
 *
 * 🔴 **UM CARGO NOVO QUE ALGUÉM PODE ESCOLHER, MAS QUE OS GATES NÃO CONHECEM, É PIOR
 * QUE NÃO TER O CARGO.** Toda a regra do profissional externo estava escrita como
 * `cargo === 'FORNECEDOR'` — escopo por designação, agenda própria, permissão por
 * membro, destino de encaminhamento. Esquecer QUALQUER uma dessas comparações faz o
 * PRESTADOR nascer com a base de pacientes INTEIRA da clínica (o oposto de
 * deny-by-default), e ninguém vê erro nenhum na tela.
 *
 * Por isso os testes abaixo são estruturais: eles varrem o CÓDIGO, não o resultado.
 * O modo de quebrar esta regra é escrever a comparação errada num arquivo novo, e o
 * sintoma é silencioso.
 */

// `lib/prisma` é TypeScript e o babel-jest deste projeto não tem preset de TS —
// `tipoContexto` o importa. `{ virtual: true }` pelo mesmo motivo dos demais testes:
// sem ele o jest RESOLVE o módulo antes de trocá-lo (falha só no run COMPLETO).
jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });

const fs   = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ler  = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

/**
 * Comentário NÃO é código. Sem isto a varredura acusaria os próprios comentários que
 * EXPLICAM a regra — e um gate que reprova a própria documentação é um gate que se
 * aprende a ignorar (mesma lição de `pacienteInativoFront` e `emailProvider`).
 */
const semComentarios = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// ---------------------------------------------------------------------------
describe('lib/cargosPrestador — a família do prestador externo', () => {
  const { CARGOS_PRESTADOR, ehCargoPrestador, membroEhPrestador, OR_CARGO_PRESTADOR } =
    require('../lib/cargosPrestador');

  it('reúne os DOIS cargos — o legado e o novo', () => {
    expect(CARGOS_PRESTADOR).toEqual(['FORNECEDOR', 'PRESTADOR']);
  });

  it('reconhece os dois e recusa o resto', () => {
    expect(ehCargoPrestador('FORNECEDOR')).toBe(true);
    expect(ehCargoPrestador('PRESTADOR')).toBe(true);
    for (const c of ['GESTOR', 'VETERINARIO', 'ESTAGIARIO', 'ENFERMEIRO', 'SECRETARIA',
                     'FINANCEIRO', 'PROPRIETARIO', 'ADMIN', null, undefined, '']) {
      expect(ehCargoPrestador(c)).toBe(false);
    }
  });

  // Multi-cargo: a restrição por designação não pode se PERDER porque a pessoa
  // acumulou outro papel — restrição não se dilui por acúmulo.
  it('membro multi-cargo entra na regra se QUALQUER cargo for da família', () => {
    expect(membroEhPrestador({ cargo: 'VETERINARIO', cargos: ['VETERINARIO', 'PRESTADOR'] })).toBe(true);
    expect(membroEhPrestador({ cargo: 'PRESTADOR',   cargos: [] })).toBe(true);
    expect(membroEhPrestador({ cargo: 'VETERINARIO', cargos: ['VETERINARIO'] })).toBe(false);
    expect(membroEhPrestador({})).toBe(false);
    expect(membroEhPrestador(null)).toBe(false);
  });

  it('o OR do Prisma cobre `cargo` e `cargos[]` dos dois', () => {
    expect(OR_CARGO_PRESTADOR).toEqual([
      { cargo: 'FORNECEDOR' }, { cargos: { has: 'FORNECEDOR' } },
      { cargo: 'PRESTADOR'  }, { cargos: { has: 'PRESTADOR'  } },
    ]);
  });
});

// ---------------------------------------------------------------------------
describe('o cargo novo é reconhecido pelas fontes de verdade', () => {
  it('CARGO_PARA_TIPO resolve PRESTADOR para o MESMO userType do irmão', () => {
    const { CARGO_PARA_TIPO } = require('../lib/tipoContexto');
    // 🔴 É ISTO que faz todo gate escrito contra `userType` valer para os dois sem
    // alteração nenhuma. Um userType próprio quebraria, de uma vez, `animalAccess`,
    // `animalScope` e os controllers clínicos.
    expect(CARGO_PARA_TIPO.PRESTADOR).toBe('FORNECEDOR');
    expect(CARGO_PARA_TIPO.FORNECEDOR).toBe('FORNECEDOR');
  });

  it('PERFIS_PROFISSIONAIS (tb_usuario_empresa) aceita PRESTADOR como perfil', () => {
    const src = semComentarios(ler('lib/usuarioEmpresa.js'));
    expect(src).toMatch(/PERFIS_PROFISSIONAIS\s*=\s*\[[^\]]*'PRESTADOR'/);
  });

  it('a matriz padrão do PRESTADOR existe e é IDÊNTICA à do FORNECEDOR', () => {
    const { PERMISSOES_PADRAO } = require('../seeds/002_permissoes_padrao.seed');
    expect(PERMISSOES_PADRAO.PRESTADOR).toBeDefined();
    // Não é preferência estética: duas listas escritas à mão divergiriam no primeiro
    // slug novo, e a divergência apareceria como "o mesmo prestador vê coisas
    // diferentes conforme o cargo que o gestor escolheu".
    expect(PERMISSOES_PADRAO.PRESTADOR).toEqual(PERMISSOES_PADRAO.FORNECEDOR);
  });

  it('PRESTADOR é perfil padrão de equipe (senão o cargo não pode ser escolhido)', () => {
    // A FK de `tb_matriz_perfis` aponta para `tb_perfis_equipe(equipeId, slug)`: sem a
    // linha do perfil, gravar a matriz do PRESTADOR falha e o cargo fica inutilizável.
    const src = semComentarios(ler('services/PermissaoService.js'));
    expect(src).toMatch(/slug: 'PRESTADOR'/);
  });
});

// ---------------------------------------------------------------------------
describe('🔴 GATE — nenhum gate de prestador pode olhar só FORNECEDOR', () => {
  // Arquivos onde uma comparação de CARGO decide escopo/permissão do profissional
  // externo. Deixar `=== 'FORNECEDOR'` solto em qualquer um deles devolve ao
  // PRESTADOR o acesso que a designação deveria limitar.
  const ARQUIVOS = [
    'lib/animalScope.js',
    'lib/animalAccess.js',
    'controllers/AgendamentoController.js',
    'controllers/EncaminhamentoController.js',
    'middlewares/permissao.middleware.js',
  ];

  it.each(ARQUIVOS)('%s não compara cargo com FORNECEDOR à mão', (rel) => {
    const src = semComentarios(ler(rel));
    // `userType === 'FORNECEDOR'` CONTINUA válido e é intencional: o userType do
    // PRESTADOR já é FORNECEDOR (ver CARGO_PARA_TIPO). O que não pode sobrar é a
    // comparação de CARGO.
    const suspeitas = src.match(/(?:membroCargo|cargo)\s*[=!]==?\s*'FORNECEDOR'/g) || [];
    expect(suspeitas).toEqual([]);
  });

  it.each(ARQUIVOS)('%s passa pela fonte única de cargos do prestador', (rel) => {
    const src = semComentarios(ler(rel));
    expect(src).toMatch(/require\(['"][./a-zA-Z]*cargosPrestador['"]\)/);
  });

  it('o where do encaminhamento usa o OR da família, não a lista escrita à mão', () => {
    const src = semComentarios(ler('controllers/EncaminhamentoController.js'));
    // Sem isto o PRESTADOR simplesmente não aparece no seletor de destino — e some
    // sem erro nenhum na tela, que é o pior modo de falhar.
    expect(src).toMatch(/\.\.\.OR_CARGO_PRESTADOR/);
    expect(src).not.toMatch(/\{\s*cargos:\s*\{\s*has:\s*'FORNECEDOR'\s*\}\s*\}/);
  });
});

// ---------------------------------------------------------------------------
describe('cada cargo amarra o login ao SEU cadastro', () => {
  const src = semComentarios(ler('controllers/EquipeController.js'));

  it('PRESTADOR grava em tb_prestadores, não em tb_fornecedores', () => {
    // Apontar os dois para `Fornecedor` faria o cargo novo existir só no rótulo —
    // exatamente o que a separação de 2026-09-09 veio desfazer.
    expect(src).toMatch(/cargo === 'PRESTADOR'/);
    expect(src).toMatch(/prisma\.prestador\.create/);
  });

  it('recusa reaproveitar cadastro/login já vinculado (userId é @unique)', () => {
    // Sem a checagem, a constraint estoura como erro de banco cru na tela.
    expect(src).toMatch(/prisma\.prestador\.findUnique\(\{ where: \{ userId/);
    expect(src).toMatch(/vinculado a outro cadastro de prestador/);
  });

  it('a inclusão direta aceita `prestadorId` no corpo', () => {
    expect(src).toMatch(/fornecedorId, prestadorId/);
  });
});

// ---------------------------------------------------------------------------
describe('migration do cargo PRESTADOR', () => {
  const SQL = fs.readFileSync(
    path.join(__dirname, '..', '..', 'prisma', 'migrations',
              '20260930000000_cargo_prestador', 'migration.sql'), 'utf8');

  // 🔴 Armadilha 42 do CLAUDE.md: as duas tabelas estão sob RLS com FORCE ROW LEVEL
  // SECURITY, que vale até para o dono do schema. Sem o carimbo, os INSERTs gravam
  // ZERO linha — com sucesso e sem aviso.
  it('carimba o escopo de plataforma ANTES de escrever', () => {
    expect(SQL).toMatch(/set_config\('app\.plataforma',\s*'on',\s*true\)/);
    expect(SQL.indexOf('INSERT INTO')).toBeGreaterThan(SQL.indexOf('set_config'));
  });

  it('cria o perfil e copia a matriz do FORNECEDOR daquela equipe', () => {
    expect(SQL).toMatch(/INSERT INTO "schs2vet"\."tb_perfis_equipe"/);
    expect(SQL).toMatch(/INSERT INTO "schs2vet"\."tb_matriz_perfis"/);
    expect(SQL).toMatch(/"perfilSlug" = 'FORNECEDOR'/);
    // `locked` é bloqueio do ADMIN da plataforma — perdê-lo na cópia devolveria ao
    // gestor o controle de um item que ele não pode alterar.
    expect(SQL).toMatch(/m\."locked"/);
  });

  it('é ADITIVA e IDEMPOTENTE — nenhum dado existente é alterado', () => {
    // O pedido foi textual: "nenhum dado precisa ser alterado, deixe para as futuras
    // inclusões". Um UPDATE aqui converteria membros já cadastrados sem ninguém pedir.
    // ⚠️ Sem tirar os comentários, a própria explicação da regra reprovaria o teste.
    const comandos = SQL.replace(/^\s*--.*$/gm, '');
    expect(comandos).not.toMatch(/\bUPDATE\b/i);
    expect(comandos).not.toMatch(/\bDELETE\b/i);
    expect((SQL.match(/NOT EXISTS/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});
