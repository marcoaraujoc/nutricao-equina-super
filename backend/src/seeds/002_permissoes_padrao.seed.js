// backend/src/seeds/002_permissoes_padrao.seed.js
// =============================================================================
// Matriz de permissões padrão por cargo.
// Aplicada automaticamente quando um membro entra em uma equipe.
//
// Níveis: NENHUM < LEITURA < PROPRIO < EQUIPE < FULL
// SOCIO não tem entradas — tem bypass total (verificado no middleware).
// =============================================================================
'use strict';

const PERMISSOES_PADRAO = {

  // Veterinário — acesso completo às operações clínicas e nutricionais
  VETERINARIO: {
    // Animais
    'animais.ler':     'EQUIPE',
    'animais.criar':   'EQUIPE',
    'animais.editar':  'EQUIPE',
    'animais.deletar': 'PROPRIO',

    // Prontuário / Evoluções clínicas
    'atendimento.evolucoes.ler':     'EQUIPE',
    'atendimento.evolucoes.criar':   'PROPRIO',
    'atendimento.evolucoes.editar':  'PROPRIO',
    'atendimento.evolucoes.deletar': 'PROPRIO',

    // Prescrições
    'atendimento.prescricoes.ler':     'EQUIPE',
    'atendimento.prescricoes.criar':   'PROPRIO',
    'atendimento.prescricoes.editar':  'PROPRIO',
    'atendimento.prescricoes.deletar': 'PROPRIO',

    // Exames clínicos e nutricionais
    'atendimento.exames.ler':     'EQUIPE',
    'atendimento.exames.criar':   'PROPRIO',
    'atendimento.exames.editar':  'PROPRIO',
    'atendimento.exames.deletar': 'PROPRIO',

    // Nutrição
    'nutricao.dietas.ler':    'EQUIPE',
    'nutricao.dietas.criar':  'PROPRIO',
    'nutricao.dietas.editar': 'PROPRIO',

    // Relatórios nutricionais
    'nutricao.relatorios.ler':   'EQUIPE',
    'nutricao.relatorios.criar': 'PROPRIO',

    // Financeiro
    'financeiro.faturas.ler':    'PROPRIO',
    'financeiro.faturas.criar':  'PROPRIO',
    'financeiro.faturas.editar': 'PROPRIO',

    // Equipe (gestão de membros — só sócio pode)
    'equipe.membros.ler':    'LEITURA',
    'equipe.membros.editar': 'NENHUM',
  },

  // Estagiário — por padrão só leitura; sócio pode elevar via painel
  ESTAGIARIO: {
    // Animais
    'animais.ler':     'EQUIPE',
    'animais.criar':   'NENHUM',
    'animais.editar':  'NENHUM',
    'animais.deletar': 'NENHUM',

    // Prontuário / Evoluções — apenas leitura por padrão
    'atendimento.evolucoes.ler':     'EQUIPE',
    'atendimento.evolucoes.criar':   'NENHUM',
    'atendimento.evolucoes.editar':  'NENHUM',
    'atendimento.evolucoes.deletar': 'NENHUM',

    // Prescrições — apenas leitura
    'atendimento.prescricoes.ler':     'EQUIPE',
    'atendimento.prescricoes.criar':   'NENHUM',
    'atendimento.prescricoes.editar':  'NENHUM',
    'atendimento.prescricoes.deletar': 'NENHUM',

    // Exames
    'atendimento.exames.ler':     'EQUIPE',
    'atendimento.exames.criar':   'NENHUM',
    'atendimento.exames.editar':  'NENHUM',
    'atendimento.exames.deletar': 'NENHUM',

    // Nutrição
    'nutricao.dietas.ler':    'EQUIPE',
    'nutricao.dietas.criar':  'NENHUM',
    'nutricao.dietas.editar': 'NENHUM',

    // Relatórios
    'nutricao.relatorios.ler':   'EQUIPE',
    'nutricao.relatorios.criar': 'NENHUM',

    // Financeiro
    'financeiro.faturas.ler':    'NENHUM',
    'financeiro.faturas.criar':  'NENHUM',
    'financeiro.faturas.editar': 'NENHUM',

    // Equipe
    'equipe.membros.ler':    'LEITURA',
    'equipe.membros.editar': 'NENHUM',
  },
};

// Definição dos módulos do sistema — sincronizada com ModuloSistema na DB.
// Cada entrada vira um registro em tb_modulos_sistema.
const MODULOS_SISTEMA = [
  // Animais
  { slug: 'animais.ler',     modulo: 'animais', submodulo: 'animais',     acao: 'ler',     label: 'Animais — Visualizar',        ordemExib:  10 },
  { slug: 'animais.criar',   modulo: 'animais', submodulo: 'animais',     acao: 'criar',   label: 'Animais — Cadastrar',          ordemExib:  11 },
  { slug: 'animais.editar',  modulo: 'animais', submodulo: 'animais',     acao: 'editar',  label: 'Animais — Editar',             ordemExib:  12 },
  { slug: 'animais.deletar', modulo: 'animais', submodulo: 'animais',     acao: 'deletar', label: 'Animais — Excluir',            ordemExib:  13 },

  // Prontuário / Evoluções
  { slug: 'atendimento.evolucoes.ler',     modulo: 'atendimento', submodulo: 'evolucoes', acao: 'ler',     label: 'Prontuário — Visualizar', ordemExib: 20 },
  { slug: 'atendimento.evolucoes.criar',   modulo: 'atendimento', submodulo: 'evolucoes', acao: 'criar',   label: 'Prontuário — Inserir',    ordemExib: 21 },
  { slug: 'atendimento.evolucoes.editar',  modulo: 'atendimento', submodulo: 'evolucoes', acao: 'editar',  label: 'Prontuário — Editar',     ordemExib: 22 },
  { slug: 'atendimento.evolucoes.deletar', modulo: 'atendimento', submodulo: 'evolucoes', acao: 'deletar', label: 'Prontuário — Excluir',    ordemExib: 23 },

  // Prescrições
  { slug: 'atendimento.prescricoes.ler',     modulo: 'atendimento', submodulo: 'prescricoes', acao: 'ler',     label: 'Prescrições — Visualizar', ordemExib: 30 },
  { slug: 'atendimento.prescricoes.criar',   modulo: 'atendimento', submodulo: 'prescricoes', acao: 'criar',   label: 'Prescrições — Inserir',    ordemExib: 31 },
  { slug: 'atendimento.prescricoes.editar',  modulo: 'atendimento', submodulo: 'prescricoes', acao: 'editar',  label: 'Prescrições — Editar',     ordemExib: 32 },
  { slug: 'atendimento.prescricoes.deletar', modulo: 'atendimento', submodulo: 'prescricoes', acao: 'deletar', label: 'Prescrições — Excluir',    ordemExib: 33 },

  // Exames
  { slug: 'atendimento.exames.ler',     modulo: 'atendimento', submodulo: 'exames', acao: 'ler',     label: 'Exames — Visualizar', ordemExib: 40 },
  { slug: 'atendimento.exames.criar',   modulo: 'atendimento', submodulo: 'exames', acao: 'criar',   label: 'Exames — Inserir',    ordemExib: 41 },
  { slug: 'atendimento.exames.editar',  modulo: 'atendimento', submodulo: 'exames', acao: 'editar',  label: 'Exames — Editar',     ordemExib: 42 },
  { slug: 'atendimento.exames.deletar', modulo: 'atendimento', submodulo: 'exames', acao: 'deletar', label: 'Exames — Excluir',    ordemExib: 43 },

  // Nutrição — Dietas
  { slug: 'nutricao.dietas.ler',    modulo: 'nutricao', submodulo: 'dietas', acao: 'ler',    label: 'Dietas — Visualizar', ordemExib: 50 },
  { slug: 'nutricao.dietas.criar',  modulo: 'nutricao', submodulo: 'dietas', acao: 'criar',  label: 'Dietas — Criar',      ordemExib: 51 },
  { slug: 'nutricao.dietas.editar', modulo: 'nutricao', submodulo: 'dietas', acao: 'editar', label: 'Dietas — Editar',     ordemExib: 52 },

  // Nutrição — Relatórios
  { slug: 'nutricao.relatorios.ler',   modulo: 'nutricao', submodulo: 'relatorios', acao: 'ler',   label: 'Relatórios — Visualizar', ordemExib: 60 },
  { slug: 'nutricao.relatorios.criar', modulo: 'nutricao', submodulo: 'relatorios', acao: 'criar', label: 'Relatórios — Gerar',      ordemExib: 61 },

  // Financeiro
  { slug: 'financeiro.faturas.ler',    modulo: 'financeiro', submodulo: 'faturas', acao: 'ler',    label: 'Faturas — Visualizar', ordemExib: 70 },
  { slug: 'financeiro.faturas.criar',  modulo: 'financeiro', submodulo: 'faturas', acao: 'criar',  label: 'Faturas — Criar',      ordemExib: 71 },
  { slug: 'financeiro.faturas.editar', modulo: 'financeiro', submodulo: 'faturas', acao: 'editar', label: 'Faturas — Editar',     ordemExib: 72 },

  // Equipe
  { slug: 'equipe.membros.ler',    modulo: 'equipe', submodulo: 'membros', acao: 'ler',    label: 'Equipe — Visualizar',  ordemExib: 80 },
  { slug: 'equipe.membros.editar', modulo: 'equipe', submodulo: 'membros', acao: 'editar', label: 'Equipe — Gerenciar',   ordemExib: 81 },
];

module.exports = { PERMISSOES_PADRAO, MODULOS_SISTEMA };