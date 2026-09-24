'use strict';

/**
 * 🔴 O MENU LATERAL NÃO CARREGA PACIENTE NA URL (2026-09-23).
 *
 * A §6 do CLAUDE.md manda, desde 2026-09-22, que Atendimento · Vacina · Resultado de
 * Exame · Plano de Dieta · Relatório Nutricional abram em MODO BUSCA, sem paciente
 * herdado — e as cinco telas cumprem a regra (`animalIdParam ?? ''`, sem auto-seleção).
 *
 * Quem a contrariava era o SIDEBAR: ele montava o destino como
 * `animalId ? '/dieta/${animalId}' : '/dieta'`, com `animalId = selectedAnimal?.id`.
 * A tela então recebia PELA URL exatamente o paciente que a regra mandava não herdar,
 * e abria o prontuário de alguém que ninguém pediu.
 *
 * 🔴 QUEBRA EM SILÊNCIO, e por isso o gate é ESTRUTURAL: nada falha, nada é registrado
 * — a tela simplesmente abre preenchida, com cara de conveniência. O defeito só aparece
 * quando alguém escreve no paciente errado, que é o custo que a regra existe para
 * evitar numa tela de escrita clínica.
 *
 * ⚠️ O que este gate NÃO impede: navegar para um paciente. Isso é papel do SELETOR de
 * cada tela, que navega e escreve no `SelectedAnimalContext`. O que não pode voltar é o
 * MENU decidir isso por quem clicou.
 */

const fs   = require('fs');
const path = require('path');

const SIDEBAR = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'components', 'Sidebar.tsx'),
  'utf8',
);

/** Comentário não é código — senão o gate aprova a própria nota que explica a regra. */
const semComentarios = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const CODIGO = semComentarios(SIDEBAR);

describe('nenhum destino do menu embute o paciente selecionado', () => {
  test('o `animalId` derivado de `selectedAnimal` não existe mais no componente', () => {
    expect(CODIGO).not.toMatch(/const animalId\s*=\s*selectedAnimal\?\.id/);
    // E o contexto não é mais desestruturado só para isso.
    expect(CODIGO).not.toMatch(/selectedAnimal/);
  });

  test('as cinco rotas da regra §6 são literais, sem id', () => {
    for (const rota of [
      "'/clinica/agenda'",            // Atendimento
      "'/clinica/vacina'",            // Vacina
      "'/exames?tipo=laboratorial'",  // Resultado de Exame
      "'/exames?tipo=imagem'",
      "'/dieta'",                     // Plano de Dieta
      "'/relatorio-nutricional'",     // Relatório Nutricional
    ]) {
      expect(CODIGO).toContain(rota);
    }
  });

  test('nenhum template de rota interpola um id de paciente', () => {
    // O padrão exato que foi removido: `animalId ? \`/x/${animalId}\` : '/x'`.
    expect(CODIGO).not.toMatch(/\$\{animalId\}/);
    expect(CODIGO).not.toMatch(/animalId \?\s*`/);
  });
});
