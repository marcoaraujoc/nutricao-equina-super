// src/modules/documentos/catalogo.ts
// Catálogos estáticos da Central de Documentos: categorias da biblioteca, tipos de
// bloco (com o estado inicial de cada um) e a biblioteca de variáveis.
//
// Ficam em módulo separado e SEM JSX de propósito: são dados, consumidos tanto pelo
// editor quanto pelo preview, pelo fluxo mobile e pela geração por IA.

import type {
  Bloco, CategoriaId, ConteudoBloco, EstiloBloco, GrupoVariavel, TipoBloco, Variavel,
} from './types';

// ─── Categorias ──────────────────────────────────────────────────────────────

export const CATEGORIAS: { id: CategoriaId; rotulo: string }[] = [
  { id: 'atendimento',     rotulo: 'Atendimento Clínico' },
  { id: 'receituarios',    rotulo: 'Receituários'        },
  { id: 'laudos',          rotulo: 'Laudos'              },
  { id: 'reproducao',      rotulo: 'Reprodução'          },
  { id: 'cirurgias',       rotulo: 'Cirurgias'           },
  { id: 'sanidade',        rotulo: 'Sanidade'            },
  { id: 'rebanho',         rotulo: 'Rebanho'             },
  { id: 'transporte',      rotulo: 'Transporte'          },
  { id: 'consentimentos',  rotulo: 'Consentimentos'      },
  { id: 'financeiro',      rotulo: 'Financeiro'          },
  { id: 'personalizados',  rotulo: 'Personalizados'      },
];

export const rotuloCategoria = (id: CategoriaId): string =>
  CATEGORIAS.find(c => c.id === id)?.rotulo ?? id;

// ─── Tipos de bloco ──────────────────────────────────────────────────────────

interface DefBloco {
  tipo:      TipoBloco;
  rotulo:    string;
  /** Agrupamento da paleta — evita uma lista de 18 itens sem hierarquia. */
  grupo:     'Estrutura' | 'Conteúdo' | 'Clínico' | 'Fecho';
  conteudo:  ConteudoBloco;
  estilo:    EstiloBloco;
}

/**
 * Estado inicial de cada bloco ao ser solto no editor.
 *
 * O bloco nasce PREENCHIDO com um exemplo plausível, não vazio: num fluxo de 30
 * segundos, ninguém para para digitar cabeçalho de tabela. O vet apaga o que não
 * serve, que é mais rápido do que criar do zero.
 */
export const BLOCOS: DefBloco[] = [
  { tipo: 'titulo',    rotulo: 'Título',    grupo: 'Estrutura',
    conteudo: { texto: 'TÍTULO DO DOCUMENTO' },
    estilo:   { tamanho: 20, peso: 'bold', alinhamento: 'center', espacamentoBase: 12 } },

  { tipo: 'subtitulo', rotulo: 'Subtítulo', grupo: 'Estrutura',
    conteudo: { texto: 'Subtítulo da seção' },
    estilo:   { tamanho: 15, peso: 'semibold', alinhamento: 'left', espacamentoTopo: 12, espacamentoBase: 6 } },

  { tipo: 'texto',     rotulo: 'Texto',     grupo: 'Conteúdo',
    conteudo: { texto: 'Digite aqui. Use {{animal.nome}} para inserir variáveis.' },
    estilo:   { tamanho: 12, alinhamento: 'justify', espacamentoBase: 8 } },

  { tipo: 'linha',     rotulo: 'Linha',     grupo: 'Estrutura',
    conteudo: {},
    estilo:   { espacamentoTopo: 8, espacamentoBase: 8 } },

  { tipo: 'imagem',    rotulo: 'Imagem',    grupo: 'Conteúdo',
    conteudo: { url: '', rotulo: 'Imagem do exame' },
    estilo:   { altura: 160, alinhamento: 'center', espacamentoBase: 8 } },

  { tipo: 'tabela',    rotulo: 'Tabela',    grupo: 'Conteúdo',
    conteudo: { colunas: ['Item', 'Descrição', 'Valor'],
                linhas:  [['', '', ''], ['', '', '']] },
    estilo:   { tamanho: 11, borda: 'completa', espacamentoBase: 10 } },

  { tipo: 'tabelaDinamica', rotulo: 'Tabela dinâmica', grupo: 'Conteúdo',
    conteudo: { fonteDados: 'consulta.itens', colunas: ['Descrição', 'Qtd', 'Valor'] },
    estilo:   { tamanho: 11, borda: 'inferior', espacamentoBase: 10 } },

  { tipo: 'checklist', rotulo: 'Checklist', grupo: 'Conteúdo',
    conteudo: { itens: ['Primeiro item', 'Segundo item'] },
    estilo:   { tamanho: 12, espacamentoBase: 8 } },

  { tipo: 'campoAuto', rotulo: 'Campo automático', grupo: 'Conteúdo',
    conteudo: { variavel: '{{animal.nome}}', rotulo: 'Animal' },
    estilo:   { tamanho: 12, espacamentoBase: 4 } },

  { tipo: 'medicamentos', rotulo: 'Medicamentos', grupo: 'Clínico',
    conteudo: { fonteDados: 'prescricao.medicamentos' },
    estilo:   { tamanho: 11, borda: 'inferior', espacamentoBase: 10 } },

  { tipo: 'vacinas',      rotulo: 'Vacinas',      grupo: 'Clínico',
    conteudo: { fonteDados: 'vacinas.aplicadas' },
    estilo:   { tamanho: 11, borda: 'inferior', espacamentoBase: 10 } },

  { tipo: 'procedimentos', rotulo: 'Procedimentos', grupo: 'Clínico',
    conteudo: { fonteDados: 'prescricao.procedimentos' },
    estilo:   { tamanho: 11, borda: 'inferior', espacamentoBase: 10 } },

  { tipo: 'exames',       rotulo: 'Exames',       grupo: 'Clínico',
    conteudo: { fonteDados: 'exames.resultados' },
    estilo:   { tamanho: 11, borda: 'inferior', espacamentoBase: 10 } },

  { tipo: 'linhaTempo',   rotulo: 'Linha do tempo', grupo: 'Clínico',
    conteudo: { fonteDados: 'historico.eventos' },
    estilo:   { tamanho: 11, espacamentoBase: 10 } },

  { tipo: 'observacoes',  rotulo: 'Observações',  grupo: 'Fecho',
    conteudo: { texto: '', rotulo: 'Observações' },
    estilo:   { tamanho: 12, borda: 'completa', espacamentoTopo: 10, espacamentoBase: 10, altura: 90 } },

  { tipo: 'assinatura',   rotulo: 'Assinatura',   grupo: 'Fecho',
    conteudo: { rotulo: 'Médico Veterinário', mostrarCrmv: true },
    estilo:   { alinhamento: 'center', espacamentoTopo: 30, altura: 60 } },

  { tipo: 'qrcode',       rotulo: 'QR Code',      grupo: 'Fecho',
    conteudo: { url: '{{sistema.urlValidacao}}', rotulo: 'Validar documento' },
    estilo:   { altura: 90, alinhamento: 'right', espacamentoTopo: 8 } },

  { tipo: 'rodape',       rotulo: 'Rodapé',       grupo: 'Fecho',
    conteudo: { texto: '{{veterinario.clinica}} · {{veterinario.telefone}}' },
    estilo:   { tamanho: 9, alinhamento: 'center', cor: '#9ca3af', espacamentoTopo: 16 } },
];

export const defBloco = (tipo: TipoBloco): DefBloco =>
  BLOCOS.find(b => b.tipo === tipo) ?? BLOCOS[0];

/** ids curtos e estáveis o bastante para chave de lista e histórico local. */
export const novoId = (): string =>
  `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function criarBloco(tipo: TipoBloco): Bloco {
  const def = defBloco(tipo);
  return {
    id:       novoId(),
    tipo,
    // Cópias PROFUNDAS do catálogo: sem isso, dois blocos "tabela" no mesmo
    // documento compartilhariam o array de linhas e editar um alteraria o outro.
    conteudo: JSON.parse(JSON.stringify(def.conteudo)) as ConteudoBloco,
    estilo:   { ...def.estilo },
    visivel:  true,
  };
}

// ─── Biblioteca de variáveis ─────────────────────────────────────────────────

export const GRUPOS_VARIAVEL: { id: GrupoVariavel; rotulo: string }[] = [
  { id: 'veterinario',  rotulo: 'Veterinário'  },
  { id: 'cliente',      rotulo: 'Cliente'      },
  { id: 'propriedade',  rotulo: 'Propriedade'  },
  { id: 'animal',       rotulo: 'Animal'       },
  { id: 'consulta',     rotulo: 'Consulta'     },
  { id: 'agenda',       rotulo: 'Agenda'       },
  { id: 'medicamentos', rotulo: 'Medicamentos' },
  { id: 'vacinas',      rotulo: 'Vacinas'      },
  { id: 'exames',       rotulo: 'Exames'       },
  { id: 'internacao',   rotulo: 'Internação'   },
  { id: 'reproducao',   rotulo: 'Reprodução'   },
  { id: 'financeiro',   rotulo: 'Financeiro'   },
  { id: 'sistema',      rotulo: 'Sistema'      },
];

const v = (chave: string, rotulo: string, exemplo: string, grupo: GrupoVariavel): Variavel =>
  ({ chave, rotulo, exemplo, grupo });

export const VARIAVEIS: Variavel[] = [
  v('veterinario.nome',      'Nome',             'Dra. Marina Sereno',        'veterinario'),
  v('veterinario.crmv',      'CRMV',             'CRMV-SP 12345',             'veterinario'),
  v('veterinario.clinica',   'Clínica',          'S2Vet Equinos',             'veterinario'),
  v('veterinario.telefone',  'Telefone',         '(11) 98765-4321',           'veterinario'),

  v('cliente.nome',          'Nome',             'Haras Boa Vista',           'cliente'),
  v('cliente.documento',     'CPF / CNPJ',       '12.345.678/0001-90',        'cliente'),
  v('cliente.telefone',      'Telefone',         '(11) 91234-5678',           'cliente'),
  v('cliente.email',         'E-mail',           'contato@haras.com.br',      'cliente'),

  v('propriedade.nome',      'Nome',             'Sociedade Hípica Brasileira', 'propriedade'),
  v('propriedade.endereco',  'Endereço',         'Rod. dos Bandeirantes, km 32', 'propriedade'),
  v('propriedade.municipio', 'Município / UF',   'Itu / SP',                  'propriedade'),
  v('propriedade.inscricao', 'Inscrição estadual', '123.456.789.000',         'propriedade'),

  v('animal.nome',           'Nome',             'Thor',                      'animal'),
  v('animal.idade',          'Idade',            '7 anos',                    'animal'),
  v('animal.raca',           'Raça',             'Mangalarga Marchador',      'animal'),
  v('animal.especie',        'Espécie',          'Equino',                    'animal'),
  v('animal.sexo',           'Sexo',             'Macho',                     'animal'),
  v('animal.pelagem',        'Pelagem',          'Castanho',                  'animal'),
  v('animal.peso',           'Peso',             '480 kg',                    'animal'),
  v('animal.resenha',        'Resenha',          'Estrela na fronte, calçado 3/4', 'animal'),
  v('animal.microchip',      'Microchip',        '985141000123456',           'animal'),
  v('animal.registro',       'Registro',         'ABCCMM 123456',             'animal'),

  v('consulta.data',         'Data',             '02/08/2026',                'consulta'),
  v('consulta.hora',         'Hora',             '09:30',                     'consulta'),
  v('consulta.motivo',       'Motivo',           'Claudicação anterior direita', 'consulta'),
  v('consulta.anamnese',     'Anamnese',         'Histórico de 3 semanas…',   'consulta'),
  v('consulta.diagnostico',  'Diagnóstico',      'Tendinite do flexor digital', 'consulta'),
  v('consulta.conduta',      'Conduta',          'Repouso 30 dias + crioterapia', 'consulta'),

  v('agenda.proximaVisita',  'Próxima visita',   '16/08/2026',                'agenda'),
  v('agenda.profissional',   'Profissional',     'Dra. Marina Sereno',        'agenda'),

  v('medicamentos.lista',    'Lista prescrita',  'Flunixin, Fenilbutazona',   'medicamentos'),
  v('medicamentos.posologia','Posologia',        '1x ao dia por 7 dias',      'medicamentos'),

  v('vacinas.ultima',        'Última aplicada',  'Influenza — 12/05/2026',    'vacinas'),
  v('vacinas.proximaDose',   'Próxima dose',     '12/11/2026',                'vacinas'),

  v('exames.solicitados',    'Solicitados',      'Hemograma, US tendão',      'exames'),
  v('exames.resultado',      'Resultado',        'Ver tabela anexa',          'exames'),

  v('internacao.entrada',    'Entrada',          '28/07/2026',                'internacao'),
  v('internacao.baia',       'Baia',             'B-12',                      'internacao'),

  v('reproducao.cobertura',  'Data da cobertura','10/06/2026',                'reproducao'),
  v('reproducao.dg',         'Diagnóstico gestação', 'Positivo — 32 dias',    'reproducao'),
  v('reproducao.previsaoParto', 'Previsão de parto', '15/05/2027',            'reproducao'),

  v('financeiro.valor',      'Valor',            'R$ 1.250,00',               'financeiro'),
  v('financeiro.vencimento', 'Vencimento',       '10/09/2026',                'financeiro'),
  v('financeiro.formaPagamento', 'Forma de pagamento', 'PIX',                 'financeiro'),

  v('sistema.dataEmissao',   'Data de emissão',  '02/08/2026',                'sistema'),
  v('sistema.numeroDocumento','Número',          'DOC-0042',                  'sistema'),
  v('sistema.urlValidacao',  'URL de validação', 's2vet.com.br/v/0042',       'sistema'),
];

/** Variáveis já resolvidas pelo backend (`GET /documentos/contexto/:animalId`). */
export type ContextoVariaveis = Record<string, string>;

/**
 * Substitui {{chave}} pelo valor da variável.
 *
 * DOIS MODOS, e a diferença importa:
 *
 * 1. COM `contexto` (paciente selecionado) — usa o valor REAL que o backend
 *    resolveu. Variável sem dado vira string VAZIA, nunca o exemplo: preencher a
 *    pelagem com "Castanho" porque o cadastro está em branco poria no papel uma
 *    afirmação que ninguém fez.
 * 2. SEM `contexto` (montando o modelo, sem paciente) — usa o campo `exemplo` do
 *    catálogo, para o vet ver a CARA da folha. Chave desconhecida vira `‹chave›` e
 *    não some, senão o texto perderia o espaço que vai ocupar no papel.
 *
 * ⚠️ O modo 1 é só EXIBIÇÃO. Quem resolve o que fica GRAVADO é sempre o backend, na
 * emissão — ver `lib/documentoVariaveis.js`.
 */
export function resolverVariaveis(texto: string, contexto?: ContextoVariaveis | null): string {
  if (!texto) return '';
  return texto.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_todo, chave: string) => {
    if (contexto) return contexto[chave] ?? '';
    const achada = VARIAVEIS.find(x => x.chave === chave);
    return achada ? achada.exemplo : `‹${chave}›`;
  });
}
