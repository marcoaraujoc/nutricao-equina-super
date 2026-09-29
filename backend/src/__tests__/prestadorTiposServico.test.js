// backend/src/__tests__/prestadorTiposServico.test.js
//
// O prestador passou a ter VÁRIOS tipos de serviço (2026-09-15), gravados como CSV
// na MESMA coluna `tipo_servico`. Três coisas quebram EM SILÊNCIO aqui:
//
//   1. O LIMITE DA COLUNA. Passar de 50 caracteres não dava erro de validação — dava
//      `22001 value too long` do Postgres, 500 na tela sem dizer o que houve. É a
//      mesma armadilha do status VARCHAR(20) registrada no CLAUDE.md. Some a
//      migration que alarga a coluna, e o quarto tipo escolhido derruba o salvar.
//   2. O FORMATO. Os leitores a jusante já fazem `tipoServico.split(',')`
//      (EncaminhamentoController, SubModuloEncaminhamento). Gravar com outro
//      separador não falha aqui: o serviço apenas some do filtro de encaminhamento.
//   3. A DUPLICIDADE. `normalizarTipos` compara a lista ORDENADA — "Ferrador,
//      Quiroprata" e "Quiroprata, Ferrador" são o MESMO cadastro. Perder isso deixa
//      o mesmo prestador entrar duas vezes no catálogo da clínica.
//
// 🔴 (2026-09-29) A ENTRADA deixou de ser texto digitado — o cadastro passou a exigir
// `especialidadeIds` do catálogo oficial `tb_especialidades` (via
// `resolverEspecialidadesPrestador`), e o CSV acima é DERIVADO dos nomes escolhidos.
// `sanearTiposServico`/`normalizarTipos`/`LIMITE_TIPO_SERVICO` CONTINUAM valendo tal
// como testado abaixo — só mudou de onde vem o texto que entra neles. O describe
// "gate estrutural" foi atualizado para a entrada nova; os demais não.

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });
jest.mock('../services/emailService', () => ({}), { virtual: true });

const fs   = require('fs');
const path = require('path');

const {
  sanearTiposServico, normalizarTipos, LIMITE_TIPO_SERVICO,
} = require('../controllers/PrestadorController');

const raiz = path.resolve(__dirname, '../../..');
const leia = rel => fs.readFileSync(path.join(raiz, rel), 'utf8');

describe('sanearTiposServico — CSV canônico', () => {
  it('devolve os tipos na ordem em que foram escolhidos', () => {
    expect(sanearTiposServico('Ferrador, Fisioterapeuta')).toBe('Ferrador, Fisioterapeuta');
  });

  it('🔴 separa por ", " — é o formato que os leitores a jusante já esperam', () => {
    expect(sanearTiposServico('Ferrador,Fisioterapeuta,Quiroprata')).toBe('Ferrador, Fisioterapeuta, Quiroprata');
    // Espelha o que EncaminhamentoController faz para montar o filtro de serviços.
    expect(sanearTiposServico('Ferrador,Fisioterapeuta').split(',').map(s => s.trim()))
      .toEqual(['Ferrador', 'Fisioterapeuta']);
  });

  it('descarta vazio, espaço em branco e vírgula solta', () => {
    expect(sanearTiposServico('Ferrador, , ,Quiroprata,')).toBe('Ferrador, Quiroprata');
    expect(sanearTiposServico('   ')).toBe('');
    expect(sanearTiposServico('')).toBe('');
    expect(sanearTiposServico(null)).toBe('');
    expect(sanearTiposServico(undefined)).toBe('');
  });

  it('🔴 remove repetido SEM olhar a caixa — dois chips iguais no mesmo cadastro', () => {
    expect(sanearTiposServico('Ferrador, ferrador, FERRADOR')).toBe('Ferrador');
  });

  it('preserva a grafia do PRIMEIRO — é o nome que está no catálogo da clínica', () => {
    expect(sanearTiposServico('Ferrador, ferrador')).toBe('Ferrador');
    expect(sanearTiposServico('ferrador, Ferrador')).toBe('ferrador');
  });

  it('um tipo só continua exatamente como era — cadastro antigo não muda', () => {
    expect(sanearTiposServico('Ferrador')).toBe('Ferrador');
    expect(sanearTiposServico('  Ferrador  ')).toBe('Ferrador');
  });
});

describe('normalizarTipos — duplicidade por LISTA, não por texto', () => {
  it('🔴 a ORDEM não distingue dois cadastros', () => {
    expect(normalizarTipos('Ferrador, Quiroprata')).toBe(normalizarTipos('Quiroprata, Ferrador'));
  });

  it('caixa e espaço também não distinguem', () => {
    expect(normalizarTipos('Ferrador,Quiroprata')).toBe(normalizarTipos('  ferrador ,  QUIROPRATA '));
  });

  it('lista diferente continua sendo prestador diferente', () => {
    expect(normalizarTipos('Ferrador')).not.toBe(normalizarTipos('Ferrador, Quiroprata'));
  });
});

describe('limite da coluna', () => {
  it('🔴 o teto do controller é o MESMO da coluna — 50 não comporta quatro atuações', () => {
    expect(LIMITE_TIPO_SERVICO).toBe(255);
    // Onde 50 estoura de verdade: três tipos cabem raspando (40), o QUARTO passa.
    expect(sanearTiposServico('Fisioterapeuta, Quiroprata, Radiologista').length).toBe(40);
    expect(sanearTiposServico('Fisioterapeuta, Quiroprata, Radiologista, Dermatologista').length)
      .toBeGreaterThan(50);
  });

  it('🔴 a migration ALARGA tb_prestadores e NÃO toca em tb_fornecedores', () => {
    const sql = leia('backend/prisma/migrations/20261010000000_prestador_tipos_servico/migration.sql');
    expect(sql).toMatch(/ALTER TABLE\s+"schs2vet"\."tb_prestadores"/);
    expect(sql).toMatch(/ALTER COLUMN\s+"tipo_servico"\s+TYPE VARCHAR\(255\)/);
    // Lá o campo é DERIVADO da 1ª especialidade, nunca uma lista digitada.
    expect(sql).not.toMatch(/ALTER TABLE[^;]*tb_fornecedores/);
    // Alargar é seguro; ESTREITAR ou apagar dado, não.
    expect(sql).not.toMatch(/\b(DROP|DELETE|UPDATE|TRUNCATE)\b/i);
  });

  it('🔴 o schema.prisma acompanha a coluna — divergir volta a estourar no banco', () => {
    const schema = leia('backend/prisma/schema.prisma');
    const modelo = schema.slice(schema.indexOf('model Prestador {'));
    const corpo  = modelo.slice(0, modelo.indexOf('\n}'));
    expect(corpo).toMatch(/tipoServico\s+String\s+@map\("tipo_servico"\)\s+@db\.VarChar\(255\)/);
  });
});

describe('gate estrutural — os elos que somem sem erro', () => {
  const controller = leia('backend/src/controllers/PrestadorController.js');
  const tela       = leia('frontend/src/pages/CadastroPrestador.tsx');

  it('🔴 criar e atualizar resolvem a especialidade pelo CATÁLOGO, nunca por texto cru', () => {
    expect(controller).toMatch(/const especResolvido = await resolverEspecialidadesPrestador\(especialidadeIds, empresaAlvo\)/);
    expect(controller).toMatch(/tipoServico: especResolvido\.tipoServico/);
    // O teto antigo (digitação livre) não pode voltar.
    expect(controller).not.toMatch(/máx\. 50 caracteres/);
    // A função que resolve o catálogo usa o helper de saneamento CSV nos nomes.
    expect(controller).toMatch(/sanearTiposServico\(especialidades\.map\(e => e\.nome\)\.join\(','\)\)/);
  });

  it('🔴 a duplicidade é conferida com o tipoServico DERIVADO do catálogo', () => {
    expect(controller).toMatch(/verificarDuplicidade\(\{ cpf, nome, tipoServico: especResolvido\.tipoServico/);
  });

  it('🔴 especialidadeIds ausente PRESERVA o vínculo gravado — PATCH parcial não apaga o cadastro', () => {
    expect(controller).toMatch(/especialidadeIds !== undefined/);
    expect(controller).toMatch(/especialidadeIdsResolvidos = null/); // null = não mexe no vínculo
    expect(controller).toMatch(/if \(especialidadeIdsResolvidos !== null\)/);
  });

  it('🔴 a tela usa o EspecialidadeSelector (catálogo oficial), não texto livre', () => {
    expect(tela).toMatch(/<EspecialidadeSelector/);
    expect(tela).not.toMatch(/TipoServicoMultiSelect/);
    // Carrega o vínculo gravado…
    expect(tela).toMatch(/especialidadeIds:\s*p\.especialidadeIds\s*\?\?\s*\[\]/);
    // …e devolve os ids, nunca texto montado à mão.
    expect(tela).toMatch(/especialidadeIds:\s*form\.especialidadeIds,/);
    // Sem esta validação, salvar sem nenhuma especialidade só falharia no backend.
    expect(tela).toMatch(/form\.especialidadeIds\.length === 0/);
  });

  it('🔴 o catálogo é carregado UMA vez — duas cópias divergiriam no que entra nele', () => {
    const seletor = leia('frontend/src/components/TipoServicoSelect.tsx');
    expect(seletor).toMatch(/function useCatalogoTipoServico/);
    // As duas formas (single e multi) consomem o MESMO hook.
    expect(seletor.match(/useCatalogoTipoServico\(categoria, defaults\)/g) || []).toHaveLength(2);
    // E há um só POST de criação de tipo em todo o arquivo.
    expect(seletor.match(/api\.post\('\/cadastro\/tipos-servico'/g) || []).toHaveLength(1);
  });
});
