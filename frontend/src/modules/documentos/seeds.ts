// src/modules/documentos/seeds.ts
// Biblioteca inicial de modelos.
//
// Existe porque uma Central de Documentos vazia é inútil: o vet chega para emitir um
// atestado no curral e não vai montar um template do zero pelo celular. Estes seis
// cobrem o que mais sai em campo (equinos e bovinos) e servem de ponto de partida —
// duplicar e ajustar é o caminho mais rápido para o modelo próprio da clínica.

import { criarBloco } from './catalogo';
import type { Bloco, Template, TipoBloco } from './types';

/** Monta a lista de blocos aplicando ajustes pontuais sobre o padrão do catálogo. */
function blocos(defs: [TipoBloco, Partial<Bloco['conteudo']>?][]): Bloco[] {
  return defs.map(([tipo, conteudo]) => {
    const b = criarBloco(tipo);
    return conteudo ? { ...b, conteudo: { ...b.conteudo, ...conteudo } } : b;
  });
}

const AGORA = '2026-08-02T09:00:00.000Z';

function template(
  id: string,
  nome: string,
  descricao: string,
  categoria: Template['categoria'],
  especie: Template['especie'],
  tags: string[],
  usos: number,
  favorito: boolean,
  corpo: Bloco[],
): Template {
  return {
    id, nome, descricao, categoria, especie, tags, usos, favorito,
    blocos:        corpo,
    compartilhado: false,
    excluido:      false,
    status:        'PUBLICADO',
    autor:         'Equipe S2Vet',
    criadoEm:      AGORA,
    atualizadoEm:  AGORA,
    versao:        1,
    versoes:       [],
  };
}

export const TEMPLATES_INICIAIS: Template[] = [
  template(
    'tpl-atestado', 'Atestado de Saúde',
    'Atestado simples de sanidade para trânsito, evento ou venda.',
    'sanidade', 'AMBOS', ['atestado', 'trânsito', 'evento'], 128, true,
    blocos([
      ['titulo',    { texto: 'ATESTADO DE SAÚDE' }],
      ['texto',     { texto: 'Atesto, para os devidos fins, que o animal {{animal.nome}}, da espécie {{animal.especie}}, raça {{animal.raca}}, {{animal.sexo}}, com {{animal.idade}}, registro {{animal.registro}} e microchip {{animal.microchip}}, pertencente a {{cliente.nome}}, foi examinado nesta data e encontra-se clinicamente SADIO, sem sinais de doenças infectocontagiosas.' }],
      ['campoAuto', { variavel: '{{propriedade.nome}}', rotulo: 'Propriedade' }],
      ['campoAuto', { variavel: '{{consulta.data}}',    rotulo: 'Data do exame' }],
      ['linha'],
      ['assinatura'],
      ['qrcode'],
      ['rodape'],
    ]),
  ),

  template(
    'tpl-receita', 'Receituário Simples',
    'Prescrição de medicamentos com posologia, para uso comum.',
    'receituarios', 'AMBOS', ['receita', 'medicamento'], 341, true,
    blocos([
      ['titulo',       { texto: 'RECEITUÁRIO VETERINÁRIO' }],
      ['campoAuto',    { variavel: '{{cliente.nome}}',  rotulo: 'Proprietário' }],
      ['campoAuto',    { variavel: '{{animal.nome}}',   rotulo: 'Animal' }],
      ['campoAuto',    { variavel: '{{animal.peso}}',   rotulo: 'Peso' }],
      ['subtitulo',    { texto: 'Prescrição' }],
      ['medicamentos'],
      ['observacoes'],
      ['assinatura'],
      ['rodape'],
    ]),
  ),

  template(
    'tpl-locomotor', 'Exame Locomotor — Equinos',
    'Avaliação de claudicação com escala AAEP, flexões e bloqueios.',
    'laudos', 'EQUINO', ['claudicação', 'AAEP', 'locomotor'], 76, true,
    blocos([
      ['titulo',     { texto: 'LAUDO DE EXAME LOCOMOTOR' }],
      ['campoAuto',  { variavel: '{{animal.nome}}',      rotulo: 'Animal' }],
      ['campoAuto',  { variavel: '{{animal.resenha}}',   rotulo: 'Resenha' }],
      ['subtitulo',  { texto: 'Histórico' }],
      ['texto',      { texto: '{{consulta.anamnese}}' }],
      ['subtitulo',  { texto: 'Escala AAEP por membro' }],
      ['tabela',     { colunas: ['Membro', 'Grau (0-5)', 'Observação'],
                       linhas:  [['AD', '', ''], ['AE', '', ''], ['PD', '', ''], ['PE', '', '']] }],
      ['subtitulo',  { texto: 'Testes de flexão' }],
      ['tabela',     { colunas: ['Articulação', 'Resposta', 'Grau'],
                       linhas:  [['', '', ''], ['', '', '']] }],
      ['subtitulo',  { texto: 'Bloqueios anestésicos' }],
      ['tabela',     { colunas: ['Bloqueio', 'Horário', 'Melhora (%)'],
                       linhas:  [['', '', ''], ['', '', '']] }],
      ['subtitulo',  { texto: 'Conclusão' }],
      ['texto',      { texto: '{{consulta.diagnostico}}' }],
      ['assinatura'],
      ['rodape'],
    ]),
  ),

  template(
    'tpl-dg', 'Diagnóstico de Gestação',
    'Resultado de palpação/ultrassom com previsão de parto.',
    'reproducao', 'AMBOS', ['gestação', 'ultrassom', 'DG'], 92, false,
    blocos([
      ['titulo',    { texto: 'DIAGNÓSTICO DE GESTAÇÃO' }],
      ['campoAuto', { variavel: '{{animal.nome}}',              rotulo: 'Matriz' }],
      ['campoAuto', { variavel: '{{reproducao.cobertura}}',     rotulo: 'Cobertura' }],
      ['campoAuto', { variavel: '{{reproducao.dg}}',            rotulo: 'Resultado' }],
      ['campoAuto', { variavel: '{{reproducao.previsaoParto}}', rotulo: 'Previsão de parto' }],
      ['observacoes'],
      ['assinatura'],
    ]),
  ),

  template(
    'tpl-gta', 'Requisição de GTA',
    'Dados do lote para emissão de Guia de Trânsito Animal.',
    'transporte', 'BOVINO', ['GTA', 'trânsito', 'lote'], 54, false,
    blocos([
      ['titulo',     { texto: 'REQUISIÇÃO DE GTA' }],
      ['campoAuto',  { variavel: '{{propriedade.nome}}',      rotulo: 'Origem' }],
      ['campoAuto',  { variavel: '{{propriedade.inscricao}}', rotulo: 'Inscrição estadual' }],
      ['subtitulo',  { texto: 'Lote' }],
      ['tabela',     { colunas: ['Categoria', 'Quantidade', 'Idade média'],
                       linhas:  [['', '', ''], ['', '', '']] }],
      ['subtitulo',  { texto: 'Sanidade' }],
      ['checklist',  { itens: ['Vacinação de febre aftosa em dia',
                               'Brucelose — fêmeas vacinadas',
                               'Exame de tuberculose (quando exigido)'] }],
      ['assinatura'],
    ]),
  ),

  template(
    'tpl-consentimento', 'Termo de Consentimento Cirúrgico',
    'Autorização do proprietário para procedimento com anestesia.',
    'consentimentos', 'AMBOS', ['cirurgia', 'anestesia', 'termo'], 38, false,
    blocos([
      ['titulo',     { texto: 'TERMO DE CONSENTIMENTO' }],
      ['texto',      { texto: 'Eu, {{cliente.nome}}, portador do documento {{cliente.documento}}, na qualidade de proprietário do animal {{animal.nome}}, autorizo a realização do procedimento cirúrgico descrito abaixo, declarando ter sido informado dos riscos inerentes ao ato anestésico e cirúrgico.' }],
      ['subtitulo',  { texto: 'Procedimento' }],
      ['procedimentos'],
      ['subtitulo',  { texto: 'Riscos informados' }],
      ['checklist',  { itens: ['Riscos anestésicos', 'Complicações pós-operatórias', 'Necessidade de reintervenção'] }],
      ['assinatura', { rotulo: 'Proprietário', mostrarCrmv: false }],
      ['assinatura', { rotulo: 'Médico Veterinário', mostrarCrmv: true }],
    ]),
  ),
];
