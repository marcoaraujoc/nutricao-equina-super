// backend/src/__tests__/cadastroPorEmail.test.js
//
// PREENCHIMENTO AUTOMÁTICO DOS CADASTROS PELO E-MAIL (2026-09-15) — quatro telas
// (Prestador, Fornecedor, Proprietário, Incluir Membro) passaram a perguntar ao
// backend "esta clínica já conhece este e-mail?" e a trazer o cadastro.
//
// TUDO AQUI QUEBRA EM SILÊNCIO — não existe tela vermelha para nenhum destes casos:
//
//   1. VAZAMENTO ENTRE CLÍNICAS. Ler nome/telefone/endereço do `users` (em vez de
//      `tb_usuario_empresa`) devolveria o cadastro que OUTRA clínica digitou, e a tela
//      exibiria isso como se fosse dela. O sintoma é um formulário preenchido "certo" —
//      ninguém desconfia.
//   2. ROTA DEPOIS DE `/:id`. `GET /por-email` declarado abaixo de `GET /:id` faz o
//      Express ler "por-email" como id: a consulta responde 404/500 e o formulário
//      simplesmente nunca preenche. Armadilha 1 do CLAUDE.md.
//   3. ESCOPO DIVERGENTE. Se a busca por e-mail usar um recorte diferente do da
//      LISTAGEM, ela carrega para edição um cadastro que a lista não mostra — ou deixa
//      criar a duplicata de um que ela mostra.
//   4. `OR` ESPALHADO. As duas cláusulas do Proprietário devolvem `{ OR: [...] }`;
//      espalhá-las no mesmo objeto faz a segunda APAGAR a primeira — some o recorte
//      por empresa e o e-mail da clínica vizinha passa a ser encontrado.
//   5. ESCOPO DE PLATAFORMA. `comEscopoPlataforma` levanta o filtro de tenant. Num
//      caminho que busca por e-mail, é exatamente ele que impede o vazamento.

jest.mock('../lib/prisma', () => ({ default: {} }), { virtual: true });

const fs   = require('fs');
const path = require('path');

const {
  cadastroDaPessoaNaEmpresa, montarResposta, rotuloPerfil, CAMPOS_PESSOA,
} = require('../lib/cadastroPorEmail');

const raiz = path.resolve(__dirname, '../..');
const leia = rel => fs.readFileSync(path.join(raiz, rel), 'utf8');

// Varredura de código IGNORA COMENTÁRIO: sem isso o gate passa só porque o comentário
// que EXPLICA a regra cita as mesmas palavras — e um teste que se satisfaz com a
// própria documentação é um teste que se aprende a ignorar.
// (mesmo saneador de `externoNaoEhEquipe.test.js` — o `[^:]` poupa "http://")
const semComentarios = (txt) => txt
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

// Client falso: só o que a lib consulta.
function clienteFalso({ users = [], vinculos = [] } = {}) {
  const chamadas = { user: [], usuarioEmpresa: [] };
  return {
    chamadas,
    user: {
      findFirst: async (args) => {
        chamadas.user.push(args);
        const alvo = String(args?.where?.email?.equals ?? '').toLowerCase();
        return users.find(u => u.email.toLowerCase() === alvo) ?? null;
      },
    },
    usuarioEmpresa: {
      findFirst: async (args) => {
        chamadas.usuarioEmpresa.push(args);
        const { userId, empresaId } = args.where;
        return vinculos.find(v => v.userId === userId && v.empresaId === empresaId) ?? null;
      },
    },
  };
}

const VINCULO_42 = {
  userId: 7, empresaId: 42, perfil: 'VETERINARIO',
  fullName: 'Marina Sereno', phone: '11988887777', phone2: null,
  cpf: '12345678901', cnpj: null,
  cep: '01310100', endereco: 'Av. Paulista, 1000', complemento: null,
  bairro: 'Bela Vista', cidade: 'Sao Paulo', estado: 'SP',
};

describe('cadastroDaPessoaNaEmpresa — o cadastro é o DESTA empresa', () => {
  it('traz o cadastro do vínculo da empresa ativa', async () => {
    const c = clienteFalso({ users: [{ id: 7, email: 'marina@vet.com' }], vinculos: [VINCULO_42] });
    const r = await cadastroDaPessoaNaEmpresa('marina@vet.com', 42, c);
    expect(r.userId).toBe(7);
    expect(r.perfil).toBe('VETERINARIO');
    expect(r.rotuloPerfil).toBe('Veterinário(a)');
    expect(r.cadastro.fullName).toBe('Marina Sereno');
    expect(r.cadastro.cidade).toBe('Sao Paulo');
  });

  it('🔴 a MESMA pessoa em OUTRA empresa não é encontrada — cada clínica tem o seu cadastro', async () => {
    const c = clienteFalso({ users: [{ id: 7, email: 'marina@vet.com' }], vinculos: [VINCULO_42] });
    expect(await cadastroDaPessoaNaEmpresa('marina@vet.com', 58, c)).toBeNull();
  });

  it('🔴 FAIL-CLOSED sem empresa no contexto — não existe "cadastro desta empresa" a trazer', async () => {
    const c = clienteFalso({ users: [{ id: 7, email: 'marina@vet.com' }], vinculos: [VINCULO_42] });
    expect(await cadastroDaPessoaNaEmpresa('marina@vet.com', null, c)).toBeNull();
    expect(await cadastroDaPessoaNaEmpresa('marina@vet.com', undefined, c)).toBeNull();
    // Nem chega a consultar: sem empresa a pergunta não tem resposta possível.
    expect(c.chamadas.user).toHaveLength(0);
  });

  it('🔴 o `users` serve só para achar o ID — nenhum campo cadastral sai dele', async () => {
    const c = clienteFalso({
      // O `users` guarda o resíduo legado (o que a PRIMEIRA clínica digitou). Se ele
      // vazar para a resposta, a tela mostra o cadastro de outra empresa.
      users: [{ id: 7, email: 'marina@vet.com', fullName: 'NOME DA OUTRA CLINICA', phone: '000' }],
      vinculos: [VINCULO_42],
    });
    const r = await cadastroDaPessoaNaEmpresa('marina@vet.com', 42, c);
    expect(r.cadastro.fullName).toBe('Marina Sereno');
    expect(JSON.stringify(r.cadastro)).not.toContain('NOME DA OUTRA CLINICA');
    // O select do `users` pede só o id — não há como um campo cadastral escapar.
    expect(c.chamadas.user[0].select).toEqual({ id: true });
  });

  it('a busca por e-mail é case-insensitive (mesma regra do resto do sistema)', async () => {
    const c = clienteFalso({ users: [{ id: 7, email: 'marina@vet.com' }], vinculos: [VINCULO_42] });
    expect(await cadastroDaPessoaNaEmpresa('  MARINA@VET.COM ', 42, c)).not.toBeNull();
  });

  it('e-mail desconhecido e pessoa sem vínculo dão a MESMA resposta — nada de contar o que existe em outra clínica', async () => {
    const c = clienteFalso({ users: [{ id: 9, email: 'outro@vet.com' }], vinculos: [VINCULO_42] });
    expect(await cadastroDaPessoaNaEmpresa('naoexiste@vet.com', 42, c)).toBeNull();
    expect(await cadastroDaPessoaNaEmpresa('outro@vet.com', 42, c)).toBeNull();
  });

  it('🔴 campo VAZIO na empresa não entra no pacote — `null` aqui é "vazio AQUI", não "use o antigo"', async () => {
    const c = clienteFalso({
      users: [{ id: 7, email: 'marina@vet.com' }],
      vinculos: [{ ...VINCULO_42, phone: null, endereco: '', cidade: '   ' }],
    });
    const r = await cadastroDaPessoaNaEmpresa('marina@vet.com', 42, c);
    expect(r.cadastro).not.toHaveProperty('phone');
    expect(r.cadastro).not.toHaveProperty('endereco');
    // Espaço em branco também não: preencher a tela com " " é pior que não preencher.
    expect(r.cadastro).not.toHaveProperty('cidade');
  });

  it('remuneração e condição comercial NÃO vazam para outro cadastro', () => {
    // Salário do membro / mensalidade do cliente são o acordo de UM papel. Herdá-los
    // num cadastro de outro papel afirmaria um combinado que ninguém fez.
    for (const proibido of ['tipoPagamento', 'formaPagamento', 'valorPagamento',
                            'mensalista', 'valorAssistencia', 'diaVencimentoFatura', 'crmv']) {
      expect(CAMPOS_PESSOA).not.toContain(proibido);
    }
  });
});

describe('montarResposta — o que a tela faz com cada caso', () => {
  const pessoa = { userId: 7, perfil: 'VETERINARIO', rotuloPerfil: 'Veterinário(a)', cadastro: { fullName: 'Marina' } };

  it('o REGISTRO vence o cadastro da pessoa — é o dado mais específico', () => {
    const r = montarResposta({ registro: { id: 3, nome: 'Marina' }, pessoa });
    expect(r).toMatchObject({ encontrado: true, origem: 'CADASTRO' });
    expect(r.registro.id).toBe(3);
  });

  it('sem registro, devolve PESSOA para a tela preencher o vazio', () => {
    expect(montarResposta({ pessoa })).toMatchObject({ encontrado: true, origem: 'PESSOA' });
  });

  it('🔴 vínculo SEM nenhum campo preenchido é "não encontrado" — faixa sem preenchimento é ruído', () => {
    expect(montarResposta({ pessoa: { ...pessoa, cadastro: {} } })).toEqual({ encontrado: false });
    expect(montarResposta({})).toEqual({ encontrado: false });
  });

  it('perfil desconhecido não vira slug cru na tela', () => {
    expect(rotuloPerfil('PERFIL_QUE_NAO_EXISTE')).toBeNull();
    expect(rotuloPerfil('PRESTADOR')).toBe('Prestador');
  });
});

// ─── GATES ESTRUTURAIS ────────────────────────────────────────────────────────

describe('🔴 rota literal ANTES de /:id (armadilha 1)', () => {
  it.each([
    ['src/routes/prestadores.js'],
    ['src/routes/fornecedores.js'],
    ['src/routes/proprietarios.js'],
  ])('%s declara /por-email antes de /:id', (arquivo) => {
    const txt   = leia(arquivo);
    const iRota = txt.indexOf("'/por-email'");
    const iId   = txt.indexOf("'/:id'");
    expect(iRota).toBeGreaterThan(-1);
    expect(iId).toBeGreaterThan(-1);
    expect(iRota).toBeLessThan(iId);
  });

  it('a rota do membro vem antes de qualquer /:equipeId', () => {
    const txt = leia('src/routes/equipes.js');
    expect(txt.indexOf("'/cadastro-por-email'")).toBeGreaterThan(-1);
    expect(txt.indexOf("'/cadastro-por-email'")).toBeLessThan(txt.indexOf("'/:equipeId/"));
  });

  it('cada rota é gateada pelo `*.ler` do seu próprio módulo', () => {
    expect(leia('src/routes/prestadores.js')).toMatch(/'\/por-email'[^\n]*cadastro\.prestador\.ler/);
    expect(leia('src/routes/fornecedores.js')).toMatch(/'\/por-email'[^\n]*cadastro\.fornecedor\.ler/);
    expect(leia('src/routes/proprietarios.js')).toMatch(/'\/por-email'[^\n]*cadastro\.proprietario\.ler/);
  });
});

describe('🔴 o escopo da busca por e-mail é o MESMO da listagem', () => {
  it.each([
    ['src/controllers/PrestadorController.js'],
    ['src/controllers/FornecedorController.js'],
  ])('%s: listar e buscarPorEmail usam `escopoVisivel`', (arquivo) => {
    const txt = semComentarios(leia(arquivo));
    // Uma definição só, e as duas ações a consomem.
    expect(txt.match(/async function escopoVisivel\(/g)).toHaveLength(1);
    expect(txt.match(/await escopoVisivel\(req\)/g).length).toBeGreaterThanOrEqual(2);
    // E a busca não reescreve o recorte à mão.
    const i = txt.indexOf('buscarPorEmail:');
    const trecho = txt.slice(i, i + 2000);
    expect(trecho).toContain('escopoVisivel(req)');
    expect(trecho).not.toContain('empresaId: null');
  });

  it('🔴 Proprietário empilha as duas cláusulas em AND — spread APAGARIA o recorte por empresa', () => {
    const txt = semComentarios(leia('src/controllers/ProprietarioController.js'));
    const i = txt.indexOf('buscarPorEmail:');
    const trecho = txt.slice(i, i + 2500);
    expect(trecho).toContain('AND: [whereEhClienteDaEmpresa(req.empresaId)]');
    expect(trecho).toContain('where.AND.push(whereProprietarioNoEscopo(');
    // O erro que este gate existe para impedir: as duas espalhadas no mesmo objeto.
    expect(trecho).not.toMatch(/\.\.\.whereEhClienteDaEmpresa\([^)]*\),\s*\n\s*\.\.\.whereProprietarioNoEscopo/);
  });

  it('🔴 o Incluir Membro é gateado por GESTOR — a rota devolve CPF e endereço de terceiros', () => {
    const txt = semComentarios(leia('src/controllers/EquipeController.js'));
    const i = txt.indexOf('buscarCadastroPorEmail:');
    expect(i).toBeGreaterThan(-1);
    expect(txt.slice(i, i + 1200)).toContain('ehGestorNoContexto(req)');
  });
});

describe('🔴 nenhum caminho de busca por e-mail levanta o filtro de tenant', () => {
  it.each([
    ['src/lib/cadastroPorEmail.js'],
    ['src/controllers/PrestadorController.js'],
    ['src/controllers/FornecedorController.js'],
  ])('%s não usa comEscopoPlataforma', (arquivo) => {
    expect(semComentarios(leia(arquivo))).not.toContain('comEscopoPlataforma');
  });
});
