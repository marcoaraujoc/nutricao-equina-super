// backend/src/__tests__/pacienteInativoFront.test.js
//
// PACIENTE INATIVO — O LADO DA TELA.
//
// 🔴 POR QUE ESTE ARQUIVO EXISTE, separado do `pacienteInativo.test.js`: aquele
// garante que o BACKEND recusa (guard em todo caminho de escrita). Este garante que
// a TELA não OFERECE o que o backend vai recusar.
//
// São problemas diferentes e o segundo é invisível: com o guard no lugar, o botão
// aparece, a pessoa clica, leva um 400 e conclui que "o sistema está com erro" — em
// vez de entender que o prontuário está congelado. É a armadilha 28-d do CLAUDE.md
// (botão que só falha depois do clique), e foi exatamente o que aconteceu em
// 2026-09-05: Alterar, Cancelar e Assumir continuavam visíveis no paciente inativo.
//
// A CAUSA, que é o que este teste tranca: `SubModuloEvolucao` RECALCULA os níveis de
// permissão por LINHA, a partir de `permissoes[...]` cru, em vez de usar
// `podeEditar`/`podeDeletar` do módulo — que são justamente onde o `!pacienteInativo`
// mora. Quem escrever um predicado novo naquele bloco cai no mesmo buraco.
//
// É varredura de CÓDIGO (o projeto não tem runner de componente React). Grosseira de
// propósito: o que ela precisa pegar é a AUSÊNCIA do gate, não a semântica dele.
'use strict';

const fs   = require('fs');
const path = require('path');

const TELAS = path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'pages');

function fonte(arquivo) {
  return fs.readFileSync(path.join(TELAS, arquivo), 'utf8');
}

/** Recorta um bloco pelo marcador de início até o fechamento indicado. */
function trecho(texto, de, ate) {
  const i = texto.indexOf(de);
  if (i < 0) return null;
  const f = texto.indexOf(ate, i + de.length);
  return texto.slice(i, f < 0 ? texto.length : f);
}

describe('PACIENTE INATIVO — a tela não oferece o que o backend recusa', () => {

  // As cinco telas clínicas. Todas recebem `pacienteInativo` do shell (ou, na Vacina,
  // resolvem por conta própria) e precisam levá-lo às permissões de ESCRITA.
  const MODULOS = [
    ['SubModuloEvolucao.tsx',       'atendimento.evolucoes'],
    ['SubModuloPrescricao.tsx',     'atendimento.prescricoes'],
    ['SubModuloExames.tsx',         'atendimento.exames'],
    ['SubModuloEncaminhamento.tsx', 'atendimento.encaminhamentos'],
    ['SubModuloVacina.tsx',         'atendimento.vacinas'],
  ];

  test.each(MODULOS)('%s gateia criar/editar/deletar por pacienteInativo', (arquivo) => {
    const src = fonte(arquivo);
    // Toda `const podeX = ...` de ESCRITA precisa do `!pacienteInativo`.
    // ⚠️ `podeImprimir`/`podeCompartilhar` ficam de FORA de propósito: imprimir e
    // enviar são SAÍDA de conteúdo, e "fica para visualização" quer dizer isso.
    const ESCRITA = /const\s+(podeCriar|podeEditar|podeFinalizar|podeDeletar)\s*=\s*([^;]+);/g;
    const achados = [...src.matchAll(ESCRITA)];
    expect(achados.length).toBeGreaterThan(0);
    for (const [, nome, expr] of achados) {
      expect(`${nome}: ${expr.replace(/\s+/g, ' ')}`).toContain('!pacienteInativo');
    }
  });

  test('🔴 EVOLUÇÃO: o nível recalculado POR LINHA respeita o paciente inativo', () => {
    // Este bloco é a exceção que causou o defeito: ele não passa por `podeEditar`
    // nem por `podeDeletar` — lê `permissoes[...]` direto. Sem o gate na ORIGEM
    // (o nível), todo predicado derivado dele escapa: `temNivelEditar`,
    // `podeEditarEsta`, `podeCancelarPropria` — e o próximo que alguém escrever.
    const bloco = trecho(fonte('SubModuloEvolucao.tsx'), 'const acoesDaEvolucao =', 'return (');
    expect(bloco).not.toBeNull();

    for (const nivel of ['nivelEditar', 'nivelDeletar']) {
      const linha = new RegExp(`const\\s+${nivel}\\s*=[\\s\\S]*?;`).exec(bloco);
      expect(linha).not.toBeNull();
      // O gate tem de estar na ATRIBUIÇÃO do nível, não espalhado nos consumidores.
      expect(linha[0]).toContain('pacienteInativo');
    }
  });

  test('🔴 EVOLUÇÃO: nenhum ramo com isGestor escapa do congelamento', () => {
    // `isGestor` NÃO é passe livre aqui: o gestor também é barrado pelo backend
    // (`bloquearSeAnimalInativo` responde 400 para ele igual). Reabrir uma evolução
    // FINALIZADA é ato de gestor e tinha o próprio ramo, fora de `podeEditarEsta`.
    const src = fonte('SubModuloEvolucao.tsx');
    const bloco = trecho(src, 'const acoesDaEvolucao =', '\n  };');
    expect(bloco).not.toBeNull();

    // Toda prop `visivel={...}` que mencione `isGestor` precisa mencionar também o
    // paciente inativo — direto, ou por um predicado que já o carrega.
    const visiveis = [...bloco.matchAll(/visivel=\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g)].map(m => m[1]);
    expect(visiveis.length).toBeGreaterThan(0);
    for (const expr of visiveis) {
      if (!expr.includes('isGestor')) continue;
      expect(expr.replace(/\s+/g, ' ')).toContain('pacienteInativo');
    }
  });

  test('🔴 o banner "Finalizar Atendimento" respeita o paciente inativo', () => {
    // Ele ficava de fora porque a permissão era resolvida no TOPO do componente,
    // antes de `animal` existir — então o botão aparecia no prontuário congelado e
    // o clique morria no 400 do backend.
    const src = fs.readFileSync(path.join(TELAS, 'Atendimento.tsx'), 'utf8');
    const m = /const\s+podeFinalizarEvolucao\s*=\s*([^;]+);/.exec(src);
    expect(m).not.toBeNull();
    expect(m[1]).toContain('!pacienteInativo');
    // E precisa ser declarado DEPOIS de `pacienteInativo`: em JS, ler um `const` do
    // mesmo escopo antes da declaração é ReferenceError — mas se alguém o mover para
    // um escopo externo, vira `undefined` silencioso e o gate vira enfeite.
    expect(src.indexOf('const pacienteInativo'))
      .toBeLessThan(src.indexOf('const podeFinalizarEvolucao'));
  });

  test('🔴 trocar de paciente REMONTA todos os submódulos', () => {
    // Sem o paciente na `key`, o React reaproveita a instância e o estado interno
    // vai junto: o texto da evolução em digitação, o item em edição, o formulário
    // aberto. O rascunho de um paciente aparecia no prontuário de outro — e um
    // Salvar distraído o gravaria lá.
    const src = fs.readFileSync(path.join(TELAS, 'Atendimento.tsx'), 'utf8');
    const SUBS = ['SubModuloEvolucao', 'SubModuloPrescricao', 'SubModuloExames', 'SubModuloEncaminhamento'];
    for (const sub of SUBS) {
      const i = src.indexOf('<' + sub);
      expect(i).toBeGreaterThan(-1);
      // Janela generosa: a `key` fica nas primeiras props, mas pode vir depois de um
      // bloco de comentário — foi o que aconteceu na Evolução, e uma janela apertada
      // reprova código CORRETO (falso positivo ensina a ignorar o gate).
      const bloco = src.slice(i, i + 1400);
      expect(`${sub}: ${bloco}`).toContain('effectiveAnimalId');
      expect(bloco).toMatch(/key=\{`/);
    }
  });

  test('🔴 o reset ao trocar de paciente ZERA o animal', () => {
    // Sem `setAnimal(null)`, a tela segue mostrando o paciente ANTERIOR até o fetch
    // responder — e nessa janela `pacienteInativo` é o estado do OUTRO.
    const src = fs.readFileSync(path.join(TELAS, 'Atendimento.tsx'), 'utf8');
    const i = src.indexOf('TROCOU DE PACIENTE = TELA NOVA');
    expect(i).toBeGreaterThan(-1);
    const efeito = src.slice(i, src.indexOf('}, [effectiveAnimalId]);', i));
    expect(efeito).toContain('setAnimal(null)');
  });

  test('IMPRIMIR continua liberado — saída de conteúdo não é escrita', () => {
    // Guarda a decisão de 2026-09-02 no sentido CONTRÁRIO: se alguém "consertar"
    // demais e gatear o imprimir, o paciente inativo deixa de poder ter uma via
    // impressa — e "fica para visualização" deixa de ser verdade.
    const src = fonte('SubModuloEvolucao.tsx');
    const m = /const\s+podeImprimir\s*=\s*([^;]+);/.exec(src);
    expect(m).not.toBeNull();
    expect(m[1]).not.toContain('pacienteInativo');
  });
});
