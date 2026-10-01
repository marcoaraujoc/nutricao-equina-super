// Gate estrutural: TODO documento clínico que sai do sistema (Imprimir, PDF por
// WhatsApp e PDF por e-mail — os três usam o MESMO HTML) é montado pela FOLHA
// CLÍNICA única, `frontend/src/utils/print/FolhaClinica.ts` (2026-09-29).
//
// POR QUÊ um teste: o modo de quebrar esta regra é SILENCIOSO. Um gerador que volte
// a escrever o próprio cabeçalho continua imprimindo — só que sem o CRMV, sem o local
// da clínica ou sem a assinatura, e com o layout divergindo dos outros módulos. Nada
// falha; o papel só sai diferente.
const fs = require('fs');
const path = require('path');

const UTILS = path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'utils');

// Geradores de REGISTRO CLÍNICO (têm paciente e veterinário que assina).
// Fatura, orçamento, contas a pagar e recibo de prestador ficam de fora de propósito:
// são documentos administrativos, sem paciente nem assinatura de veterinário.
const GERADORES_CLINICOS = [
  'PrescricaoPrint.ts',      // prescrição E vacina
  'EvolucaoPrint.ts',
  'RelatorioAtendimento.ts', // o Imprimir da evolução
  'AtendimentoPrint.ts',
  'ExamePrint.ts',           // pedido de exame
  'ResultadoExamePrint.ts',
  'ExameCompraPrint.ts',
  'EncaminhamentoPrint.ts',
  'Dietaprint.ts',
];

// Ignora comentários: sem isso a varredura casa com o texto que EXPLICA a regra.
function semComentarios(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function ler(arquivo) {
  return semComentarios(fs.readFileSync(path.join(UTILS, arquivo), 'utf8'));
}

describe('Folha clínica única', () => {
  const folha = semComentarios(fs.readFileSync(path.join(UTILS, 'print', 'FolhaClinica.ts'), 'utf8'));

  test('a folha desenha as 7 partes, na ordem pedida', () => {
    const corpoPagina = folha.slice(folha.indexOf('function renderPagina'));
    const ordem = [
      'renderTopo(',            // 1-2: logo + veterinário (nome, CRMV, local)
      'renderAnimal(',          // 3: dados do animal
      'fc-titulo',              // 4: título
      'p.corpoHtml',            // 5: conteúdo do módulo
      'fc-data',                // 6: local e data da emissão
      'renderAssinaturas(',     // 7: assinatura
    ];
    const posicoes = ordem.map(t => corpoPagina.indexOf(t));
    posicoes.forEach(p => expect(p).toBeGreaterThanOrEqual(0));
    for (let i = 1; i < posicoes.length; i++) expect(posicoes[i]).toBeGreaterThan(posicoes[i - 1]);
  });

  test('o topo traz CRMV e o local da empresa', () => {
    expect(folha).toMatch(/fc-vet-crmv/);
    expect(folha).toMatch(/fc-vet-local/);
    expect(folha).toMatch(/\/equipes\/logo/);
  });

  test.each(GERADORES_CLINICOS)('%s monta o papel pela folha clínica', (arquivo) => {
    const src = ler(arquivo);
    expect(src).toMatch(/gerarHtmlFolhaClinica\(/);
    expect(src).toMatch(/prepararFolhaClinica\(/);
  });

  test.each(GERADORES_CLINICOS)('%s não escreve cabeçalho nem rodapé próprio', (arquivo) => {
    const src = ler(arquivo);
    expect(src).not.toMatch(/renderCabecalho\(/);
    expect(src).not.toMatch(/renderRodapeAssinatura\(/);
    expect(src).not.toMatch(/<!DOCTYPE html>/i);
  });
});
