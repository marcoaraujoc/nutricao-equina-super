// backend/src/__tests__/visibilidade.test.js
//
// EXCLUSÃO LÓGICA — a regra de 2026-08-06:
//   animal · proprietário · empresa  → somem por completo (nem como "inativo");
//   profissional · fornecedor · prestador → continuam aparecendo, marcados inativos.
//
// Estes testes travam a FORMA do `where`. Não substituem um teste de integração, mas
// pegam a regressão que realmente acontece: alguém reescreve um filtro e o paciente
// inativado volta a ocupar horário na agenda.

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });

const {
  ANIMAL_VISIVEL,
  filhoDeAnimalVisivel,
  proprietarioAtivoNaEmpresa,
  animalVisivelNaEmpresa,
} = require('../lib/visibilidade');

describe('exclusão lógica — o que some e o que fica', () => {

  test('ANIMAL_VISIVEL exige o animal ativo E o cliente ativo', () => {
    // O `ativo` do animal sozinho não basta: inativar o CLIENTE tem de sumir com os
    // animais dele. Era o furo — a fila do plantão só olhava `animal.ativo`.
    expect(ANIMAL_VISIVEL).toEqual({ ativo: true, user: { ativo: true } });
  });

  test('filho de animal invisível herda a regra pela relação', () => {
    expect(filhoDeAnimalVisivel()).toEqual({ animal: ANIMAL_VISIVEL });
  });

  test('a relação com o animal é configurável (nem todo modelo a chama de `animal`)', () => {
    expect(filhoDeAnimalVisivel('paciente')).toEqual({ paciente: ANIMAL_VISIVEL });
  });

  test('cliente inativado NUMA empresa continua visível NAS OUTRAS', () => {
    // §36: o cadastro do proprietário é POR EMPRESA. Inativar na clínica A não pode
    // apagá-lo da clínica B — por isso o filtro casa o perfil DAQUELA empresa.
    const w = proprietarioAtivoNaEmpresa(7);
    expect(w.user.ativo).toBe(true);
    const [semCadastro, comCadastroAtivo] = w.user.OR;
    expect(semCadastro).toEqual({ proprietarioPerfis: { none: { empresaId: 7 } } });
    expect(comCadastroAtivo).toEqual({
      proprietarioPerfis: { some: { empresaId: 7, ativo: true } },
    });
  });

  test('cliente LEGADO (sem cadastro na empresa) NÃO é escondido', () => {
    // O ramo `none` existe para isso: base antiga tem cliente sem `ProprietarioPerfil`.
    // Sem ele, o filtro esconderia todo mundo que nunca foi cadastrado por empresa —
    // e a tela de Pacientes nasceria vazia numa migração.
    const w = proprietarioAtivoNaEmpresa(7);
    expect(w.user.OR.some(r => r.proprietarioPerfis?.none)).toBe(true);
  });

  test('sem empresa no contexto NÃO se inventa filtro por empresa', () => {
    // ADMIN de plataforma não tem clínica de referência; chutar uma esconderia dado
    // legítimo. Cai no `ativo` global apenas.
    expect(proprietarioAtivoNaEmpresa(null)).toEqual({});
    expect(animalVisivelNaEmpresa(null)).toEqual(ANIMAL_VISIVEL);
    expect(animalVisivelNaEmpresa(undefined)).toEqual(ANIMAL_VISIVEL);
  });

  test('animalVisivelNaEmpresa soma o ativo do animal ao do cliente naquela empresa', () => {
    const w = animalVisivelNaEmpresa(7);
    expect(w.ativo).toBe(true);
    expect(w.user.ativo).toBe(true);
    expect(w.user.OR).toHaveLength(2);
  });

  test('PROFISSIONAL não entra na regra — o autor do registro continua visível', () => {
    // Esconder o autor apagaria a autoria de prontuário que segue válido ("quem
    // prescreveu isto?"). Nenhum filtro daqui pode mencionar membro/vínculo/vet.
    const serializado = JSON.stringify({
      ANIMAL_VISIVEL,
      filho: filhoDeAnimalVisivel(),
      porEmpresa: proprietarioAtivoNaEmpresa(7),
    });
    for (const proibido of ['membrosEquipe', 'usuarioEmpresa', 'veterinario', 'prestador', 'membro']) {
      expect(serializado).not.toContain(proibido);
    }
  });

  test('a regra NUNCA toca a tenancy — não existe empresaId nulo no filtro', () => {
    // Inativar responde "aparece?"; a tenancy responde "de quem é?". Era a confusão
    // entre as duas que gerava órfã: `removerDaEmpresa` zerava `empresaId` ao inativar.
    const serializado = JSON.stringify({
      ANIMAL_VISIVEL,
      porEmpresa: proprietarioAtivoNaEmpresa(7),
      naEmpresa: animalVisivelNaEmpresa(7),
    });
    expect(serializado).not.toContain('"empresaId":null');
  });
});
