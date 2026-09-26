'use strict';

/**
 * 🔴 O PACIENTE ESCOLHIDO VALE DENTRO DO MÓDULO, NUNCA ENTRE MÓDULOS (2026-09-25).
 *
 * Escolher o Thor no Atendimento mantém o Thor em Agenda, Evolução, Prescrição, Exames
 * e Encaminhamento; ir ao Nutricional abre em BUSCA. Plano de Dieta e Relatório
 * Nutricional COMPARTILHAM a memória (são o mesmo módulo).
 *
 * Quebra em silêncio nos dois sentidos: dois módulos com a MESMA chave fazem o paciente
 * vazar de um para o outro; tela sem a memória perde o paciente ao trocar de aba (a aba
 * Agenda e o menu navegam SEM id).
 */

const fs   = require('fs');
const path = require('path');

const FRONT = path.join(__dirname, '..', '..', '..', 'frontend', 'src');
const ler = (rel) => fs.readFileSync(path.join(FRONT, rel), 'utf8');
const semComentarios = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const TELAS = [
  ['pages/Atendimento.tsx',          'atendimento'],
  ['pages/Vacina.tsx',               'vacina'],
  ['pages/Exames.tsx',               'exames'],
  ['pages/Dieta.tsx',                'nutricional'],
  ['pages/RelatorioNutricional.tsx', 'nutricional'],
];

describe('cada tela usa a memória do SEU módulo', () => {
  test.each(TELAS)('%s → módulo %s', (arquivo, modulo) => {
    const src = semComentarios(ler(arquivo));
    expect(src).toMatch(new RegExp(`usePacienteDoModulo\\('${modulo}'`));
    // O paciente da tela sai do hook — nunca do `selectedAnimal` global.
    expect(src).toMatch(/const \{ animalId: effectiveAnimalId/);
    expect(src).not.toMatch(/effectiveAnimalId\s*=\s*[^;]*selectedAnimal/);
  });

  test('módulos distintos não dividem a memória (só Dieta+Relatório compartilham)', () => {
    const porModulo = {};
    for (const [arq, mod] of TELAS) (porModulo[mod] ??= []).push(arq);
    expect(porModulo.nutricional).toHaveLength(2);
    expect(Object.keys(porModulo).sort()).toEqual(['atendimento', 'exames', 'nutricional', 'vacina']);
  });
});

describe('dentro do Atendimento o paciente não se perde', () => {
  const src = semComentarios(ler('pages/Atendimento.tsx'));

  test('escolher o paciente na aba Agenda (sem id na rota) vira o paciente do módulo', () => {
    const i = src.indexOf('const handleSelecionarAnimalFromAgenda');
    const bloco = src.slice(i, src.indexOf('}, [', i));
    expect(bloco).toContain('lembrarPaciente(');
  });

  test('paciente de outra empresa (403) é esquecido, não fica em laço de 403', () => {
    const i = src.indexOf('const carregarAnimal');
    const bloco = src.slice(i, src.indexOf('}, [', i));
    expect(bloco).toContain('esquecerPaciente()');
  });
});

describe('a memória morre com a sessão e com a empresa', () => {
  test('login, logout e troca de contexto limpam todos os módulos', () => {
    const auth = semComentarios(ler('contexts/AuthContext.tsx'));
    expect((auth.match(/esquecerPacientesDosModulos\(\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(semComentarios(ler('contexts/EmpresaContext.tsx'))).toContain('esquecerPacientesDosModulos()');
  });

  test('a memória é de ABA (sessionStorage), não permanente', () => {
    const hook = semComentarios(ler('hooks/usePacienteDoModulo.ts'));
    expect(hook).toContain('sessionStorage');
    expect(hook).not.toContain('localStorage');
  });
});
