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

export type CategoriaId =
  | 'atendimento' | 'receituarios' | 'laudos' | 'reproducao' | 'cirurgias'
  | 'sanidade' | 'rebanho' | 'transporte' | 'consentimentos' | 'financeiro'
  | 'personalizados';

export type TipoBloco =
  | 'titulo' | 'subtitulo' | 'texto' | 'tabela' | 'tabelaDinamica'
  | 'imagem' | 'linha' | 'qrcode' | 'assinatura' | 'checklist'
  | 'campoAuto' | 'medicamentos' | 'vacinas' | 'procedimentos'
  | 'exames' | 'linhaTempo' | 'observacoes' | 'rodape';

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
  url?:        string;        // imagem / QR
  variavel?:   string;        // campo automático: {{animal.nome}}
  rotulo?:     string;        // legenda do campo automático, papel da assinatura…
  mostrarCrmv?: boolean;      // assinatura
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
