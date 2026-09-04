// src/modules/documentos/types.ts
// Modelo de domínio da Central de Documentos.
//
// TEMPLATE  → modelo reutilizável (o que se edita)
// DOCUMENTO → instância gerada de um template, com as variáveis já resolvidas
// BLOCO     → unidade de composição do template (o editor é de BLOCOS, não de HTML)
// VERSÃO    → snapshot imutável dos blocos, para histórico
//
// Os quatro são independentes: alterar um template NÃO reescreve documentos já
// emitidos — o documento guarda o próprio conteúdo resolvido. É o que permite
// reimprimir daqui a dois anos exatamente o que o cliente recebeu.

export type EspecieAlvo = 'EQUINO' | 'BOVINO' | 'AMBOS';

export type StatusTemplate = 'RASCUNHO' | 'PUBLICADO' | 'ARQUIVADO';

/** As que nascem com o sistema e têm rótulo em `catalogo.ts#CATEGORIAS`. */
export type CategoriaPadrao =
  | 'atendimento' | 'receituarios' | 'laudos' | 'reproducao' | 'cirurgias'
  | 'sanidade' | 'rebanho' | 'transporte' | 'consentimentos' | 'financeiro'
  | 'personalizados';

/**
 * Categoria do modelo.
 *
 * 🔴 NÃO é mais uma lista fechada (2026-08-30): a clínica cria as suas na tela de
 * emissão, e a categoria nova é gravada como TEXTO na própria coluna
 * `tb_documento_templates.categoria` (VARCHAR(30)) — não há tabela de categorias, e
 * criar uma exigiria migration. Consequência: **a categoria existe enquanto houver um
 * documento nela**; a tela reúne as categorias varrendo os modelos.
 *
 * O `(string & {})` preserva o autocomplete das padrão sem fechar a porta para as
 * personalizadas — com `string` puro o editor deixaria de sugerir 'laudos' e amigas.
 */
export type CategoriaId = CategoriaPadrao | (string & {});

export type TipoBloco =
  | 'titulo' | 'subtitulo' | 'texto' | 'tabela' | 'tabelaDinamica'
  | 'imagem' | 'linha' | 'qrcode' | 'assinatura' | 'checklist'
  | 'campoAuto' | 'medicamentos' | 'vacinas' | 'procedimentos'
  | 'exames' | 'linhaTempo' | 'observacoes' | 'rodape'
  // Grupo de campos REPETÍVEL — o "+ Adicionar" da tela de emissão. Ver ./listas.ts:
  // é o que uma lacuna não consegue ser, porque o número de medicamentos de uma
  // receita não é propriedade do modelo, é de cada emissão.
  | 'listaCampos';

export type Alinhamento = 'left' | 'center' | 'right' | 'justify';
export type PesoFonte   = 'normal' | 'medium' | 'semibold' | 'bold';
export type Borda       = 'nenhuma' | 'inferior' | 'completa';

/** Propriedades visuais — todas OPCIONAIS: bloco sem estilo usa o padrão do tipo. */
export interface EstiloBloco {
  tamanho?:         number;      // px
  peso?:            PesoFonte;
  cor?:             string;      // hex
  alinhamento?:     Alinhamento;
  espacamentoTopo?: number;      // px
  espacamentoBase?: number;      // px
  borda?:           Borda;
  largura?:         number;      // % da folha
  altura?:          number;      // px (imagem, assinatura, QR)
  /**
   * Campos LADO A LADO na folha (hoje só `campoAuto`, e só o valor 2).
   *
   * Existe porque a identificação de um atestado tem 6 a 11 campos curtos ("Sexo:
   * Macho") e um por linha empurrava a assinatura para uma segunda página com a
   * primeira metade vazia. Ausente (ou 1) = comportamento de sempre, uma por linha.
   * Desenhado nos dois espelhos: `BlocoView.tsx` e `utils/DocumentoPrint.ts`.
   */
  colunas?:         number;
}

/**
 * Conteúdo do bloco. Um único formato para todos os tipos, com os campos que cada
 * um usa — em vez de uma união discriminada por tipo.
 *
 * POR QUÊ: o editor troca o tipo de um bloco no lugar (título → subtítulo) e as
 * propriedades comuns precisam sobreviver à troca. Com união estrita, cada troca
 * exigiria uma conversão e o texto digitado se perderia.
 */
export interface ConteudoBloco {
  texto?:      string;
  itens?:      string[];      // checklist
  colunas?:    string[];      // tabela (cabeçalho)
  linhas?:     string[][];    // tabela (corpo)
  fonteDados?: string;        // tabela dinâmica / listas clínicas: de onde vem a linha
  /**
   * Catálogo da EMPRESA que a primeira coluna da lista oferece num seletor
   * (`empresa.vacinas`). NÃO confundir com `fonteDados`: aquela PREENCHE linhas com o
   * que o paciente tem; esta só OFERECE o que existe no cadastro, e o que for
   * escolhido traz junto o que a clínica já sabe (fabricante, partida, validade).
   * Resolvido no backend — `lib/documentoListas.js#OPCOES`.
   */
  fonteOpcoes?: string;
  /**
   * Como a LISTA sai no papel: `'campos'` = um "Rótulo: valor" por dado, três por
   * linha, como os demais cards do documento; ausente = TABELA (o padrão).
   *
   * Existe porque um grupo de sete dados (a vacina) numa tabela A4 retrato dá ~25mm
   * por coluna — o nome comercial quebra em três linhas e a observação fica ilegível.
   * A conversão do emitido é feita no backend (`lib/documentoListas.js#linhaEmCampos`)
   * e espelhada aqui para a pré-visualização mostrar o que vai sair.
   */
  formato?: 'campos';
  url?:        string;        // imagem / QR
  variavel?:   string;        // campo automático: {{animal.nome}}
  rotulo?:     string;        // legenda do campo automático, papel da assinatura…
  mostrarCrmv?: boolean;      // assinatura
  /**
   * ASSINATURA — de quem é a identidade impressa sobre a linha.
   *
   * 🔴 Só a linha do VETERINÁRIO recebe a imagem da assinatura, o nome e o CRMV da
   * MARCA. Toda outra (responsável pelo animal, comprador, FARMACÊUTICO) sai como
   * linha EM BRANCO com o papel embaixo, para ser assinada à mão.
   * Sem isto, o receituário de controle especial saía com a assinatura escaneada do
   * veterinário sobre a linha do farmacêutico — documento falso, e nada acusaria.
   *
   * Ausente = compatibilidade com o que já está gravado: cai em `mostrarCrmv`, que
   * é `true` exatamente na linha do veterinário nos 12 modelos do CFMV e na regra
   * que o prompt de conversão sempre seguiu.
   */
  assinante?:  'VETERINARIO' | 'OUTRO';
}

export interface Bloco {
  id:        string;
  tipo:      TipoBloco;
  conteudo:  ConteudoBloco;
  estilo:    EstiloBloco;
  /** Expressão simples avaliada na geração. Vazio = sempre visível. */
  condicao?: string;
  /** Desligar sem excluir — o bloco some do preview e do PDF, mas fica no editor. */
  visivel:   boolean;
}

export interface VersaoTemplate {
  versao:    number;
  criadoEm:  string;
  autor:     string;
  nota:      string;
  blocos:    Bloco[];
}

export interface Template {
  id:            string;
  /**
   * `true` = modelo GLOBAL do sistema (os 12 anexos da Res. CFMV 1.321/2020).
   * A clínica LÊ mas não escreve: qualquer alteração vira uma CÓPIA dela
   * (copy-on-write no backend). A tela usa isto para oferecer "Personalizar" em vez
   * de "Editar" — ver `DocumentoTemplateController`.
   */
  global:        boolean;
  /** Identificador da norma de origem (`cfmv_01_atestado_sanitario`), quando houver. */
  chave:         string | null;
  nome:          string;
  descricao:     string;
  categoria:     CategoriaId;
  especie:       EspecieAlvo;
  tags:          string[];
  blocos:        Bloco[];
  favorito:      boolean;
  compartilhado: boolean;
  /** Soft delete — vai para a Lixeira, não some do banco. */
  excluido:      boolean;
  status:        StatusTemplate;
  autor:         string;
  usos:          number;
  criadoEm:      string;
  atualizadoEm:  string;
  versao:        number;
  versoes:       VersaoTemplate[];
}

/**
 * Documento EMITIDO: snapshot do template com as variáveis JÁ RESOLVIDAS.
 *
 * Espelha `DocumentoEmitidoController.serializar`. O snapshot é o ponto: editar o
 * modelo depois não reescreve o papel que o cliente já recebeu.
 */
export interface DocumentoEmitido {
  id:           string;
  templateId:   string | null;
  templateNome: string;
  numero:       number | null;
  /** `DOC-0042` — já formatado pelo backend; `null` em registro sem número. */
  numeroFmt:    string | null;
  titulo:       string;
  animalId:     number;
  animalNome:   string;
  clienteNome:  string;
  evolucaoId:   number | null;
  emitidoEm:    string;
  emitidoPor:   string;
  ativo:        boolean;
  canceladoMotivo: string | null;
  /** O que foi impresso, para reimpressão fiel. */
  blocos:       Bloco[];
  /** As variáveis usadas na resolução — auditoria de onde saiu cada valor. */
  contexto:     Record<string, string>;
  /**
   * O TIMBRE do dia da emissão: logo da clínica, imagem da assinatura, nome e CRMV
   * de quem assinou. Faz parte do snapshot como os blocos — reimprimir daqui a dois
   * anos tem de sair com a logo e a assinatura DAQUELE dia, não com as de hoje.
   *
   * `null` em documento emitido antes de o timbre passar a ser gravado: a folha sai
   * sem logo e com a linha de assinatura em branco. É o certo — desenhar ali a
   * assinatura de quem está logado agora seria falsificar o papel.
   */
  marca:        MarcaDocumentoEmitido | null;
}

/** Ver `DocumentoEmitido.marca`. Espelha a `MarcaFolha` do render. */
export interface MarcaDocumentoEmitido {
  logoUrl:       string | null;
  empresaNome:   string;
  assinaturaUrl: string | null;
  crmv:          string;
  assinanteNome: string;
}

/** Uma variável da biblioteca ({{animal.nome}} e amigas). */
export interface Variavel {
  chave:    string;   // 'animal.nome'
  rotulo:   string;   // 'Nome do animal'
  exemplo:  string;   // 'Thor'
  grupo:    GrupoVariavel;
}

export type GrupoVariavel =
  | 'veterinario' | 'cliente' | 'propriedade' | 'animal' | 'consulta'
  | 'agenda' | 'medicamentos' | 'vacinas' | 'exames' | 'internacao'
  | 'reproducao' | 'financeiro' | 'sistema';

/** Separadores do rodapé da Biblioteca (não são categorias de conteúdo). */
export type ColecaoId = 'favoritos' | 'recentes' | 'compartilhados' | 'lixeira';

export type FiltroBiblioteca =
  | { tipo: 'categoria'; id: CategoriaId | 'todos' }
  | { tipo: 'colecao';   id: ColecaoId };
