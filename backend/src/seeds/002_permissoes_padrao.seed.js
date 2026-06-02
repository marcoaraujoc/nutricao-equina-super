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
    // Dashboard
    'dashboard.geral.ler':      'EQUIPE',
    'dashboard.geral.imprimir': 'EQUIPE',

    // Animais
    'animais.ler':      'EQUIPE',
    'animais.criar':    'EQUIPE',
    'animais.editar':   'EQUIPE',
    'animais.deletar':  'PROPRIO',
    'animais.imprimir': 'EQUIPE',

    // Prontuário / Evoluções clínicas
    'atendimento.evolucoes.ler':      'EQUIPE',
    'atendimento.evolucoes.criar':    'PROPRIO',
    'atendimento.evolucoes.editar':   'PROPRIO',
    'atendimento.evolucoes.deletar':  'PROPRIO',
    'atendimento.evolucoes.imprimir': 'EQUIPE',

    // Prescrições
    'atendimento.prescricoes.ler':      'EQUIPE',
    'atendimento.prescricoes.criar':    'PROPRIO',
    'atendimento.prescricoes.editar':   'PROPRIO',
    'atendimento.prescricoes.deletar':  'PROPRIO',
    'atendimento.prescricoes.imprimir': 'PROPRIO',

    // Exames clínicos e nutricionais
    'atendimento.exames.ler':      'EQUIPE',
    'atendimento.exames.criar':    'PROPRIO',
    'atendimento.exames.editar':   'PROPRIO',
    'atendimento.exames.deletar':  'PROPRIO',
    'atendimento.exames.imprimir': 'EQUIPE',

    // Nutrição — Dietas
    'nutricao.dietas.ler':      'EQUIPE',
    'nutricao.dietas.criar':    'PROPRIO',
    'nutricao.dietas.editar':   'PROPRIO',
    'nutricao.dietas.imprimir': 'EQUIPE',

    // Nutrição — Relatórios
    'nutricao.relatorios.ler':      'EQUIPE',
    'nutricao.relatorios.criar':    'PROPRIO',
    'nutricao.relatorios.imprimir': 'EQUIPE',

    // Financeiro
    'financeiro.faturas.ler':      'PROPRIO',
    'financeiro.faturas.criar':    'PROPRIO',
    'financeiro.faturas.editar':   'PROPRIO',
    'financeiro.faturas.imprimir': 'PROPRIO',

    // Equipe (gestão de membros — só sócio pode)
    'equipe.membros.ler':    'LEITURA',
    'equipe.membros.editar': 'NENHUM',

    // Farmácia — Estoque
    'farmacia.estoque.ler':      'EQUIPE',
    'farmacia.estoque.criar':    'PROPRIO',
    'farmacia.estoque.editar':   'PROPRIO',
    'farmacia.estoque.deletar':  'PROPRIO',
    'farmacia.estoque.imprimir': 'EQUIPE',

    // Farmácia — Movimentações
    'farmacia.movimentacoes.ler':      'EQUIPE',
    'farmacia.movimentacoes.criar':    'PROPRIO',
    'farmacia.movimentacoes.imprimir': 'EQUIPE',
  },

  // Estagiário — por padrão só leitura; sócio pode elevar via painel
  ESTAGIARIO: {
    // Dashboard
    'dashboard.geral.ler':      'LEITURA',
    'dashboard.geral.imprimir': 'NENHUM',

    // Animais
    'animais.ler':      'EQUIPE',
    'animais.criar':    'NENHUM',
    'animais.editar':   'NENHUM',
    'animais.deletar':  'NENHUM',
    'animais.imprimir': 'NENHUM',

    // Prontuário / Evoluções — apenas leitura por padrão
    'atendimento.evolucoes.ler':      'EQUIPE',
    'atendimento.evolucoes.criar':    'NENHUM',
    'atendimento.evolucoes.editar':   'NENHUM',
    'atendimento.evolucoes.deletar':  'NENHUM',
    'atendimento.evolucoes.imprimir': 'NENHUM',

    // Prescrições — apenas leitura
    'atendimento.prescricoes.ler':      'EQUIPE',
    'atendimento.prescricoes.criar':    'NENHUM',
    'atendimento.prescricoes.editar':   'NENHUM',
    'atendimento.prescricoes.deletar':  'NENHUM',
    'atendimento.prescricoes.imprimir': 'NENHUM',

    // Exames
    'atendimento.exames.ler':      'EQUIPE',
    'atendimento.exames.criar':    'NENHUM',
    'atendimento.exames.editar':   'NENHUM',
    'atendimento.exames.deletar':  'NENHUM',
    'atendimento.exames.imprimir': 'NENHUM',

    // Nutrição — Dietas
    'nutricao.dietas.ler':      'EQUIPE',
    'nutricao.dietas.criar':    'NENHUM',
    'nutricao.dietas.editar':   'NENHUM',
    'nutricao.dietas.imprimir': 'NENHUM',

    // Nutrição — Relatórios
    'nutricao.relatorios.ler':      'EQUIPE',
    'nutricao.relatorios.criar':    'NENHUM',
    'nutricao.relatorios.imprimir': 'NENHUM',

    // Financeiro
    'financeiro.faturas.ler':      'NENHUM',
    'financeiro.faturas.criar':    'NENHUM',
    'financeiro.faturas.editar':   'NENHUM',
    'financeiro.faturas.imprimir': 'NENHUM',

    // Equipe
    'equipe.membros.ler':    'LEITURA',
    'equipe.membros.editar': 'NENHUM',

    // Farmácia — Estoque
    'farmacia.estoque.ler':      'EQUIPE',
    'farmacia.estoque.criar':    'NENHUM',
    'farmacia.estoque.editar':   'NENHUM',
    'farmacia.estoque.deletar':  'NENHUM',
    'farmacia.estoque.imprimir': 'NENHUM',

    // Farmácia — Movimentações
    'farmacia.movimentacoes.ler':      'EQUIPE',
    'farmacia.movimentacoes.criar':    'NENHUM',
    'farmacia.movimentacoes.imprimir': 'NENHUM',
  },
};

// Definição dos módulos do sistema — sincronizada com ModuloSistema na DB.
// Cada entrada vira um registro em tb_modulos_sistema.
const MODULOS_SISTEMA = [
  // ── Dashboard ───────────────────────────────────────────────────────────────
  { slug: 'dashboard.geral.ler',      modulo: 'dashboard', submodulo: 'geral', acao: 'ler',      label: 'Dashboard — Visualizar',  ordemExib:  1 },
  { slug: 'dashboard.geral.imprimir', modulo: 'dashboard', submodulo: 'geral', acao: 'imprimir', label: 'Dashboard — Imprimir',    ordemExib:  2 },

  // ── Animais ─────────────────────────────────────────────────────────────────
  { slug: 'animais.ler',      modulo: 'animais', submodulo: 'animais', acao: 'ler',      label: 'Animais — Visualizar', ordemExib: 10 },
  { slug: 'animais.criar',    modulo: 'animais', submodulo: 'animais', acao: 'criar',    label: 'Animais — Cadastrar',  ordemExib: 11 },
  { slug: 'animais.editar',   modulo: 'animais', submodulo: 'animais', acao: 'editar',   label: 'Animais — Editar',     ordemExib: 12 },
  { slug: 'animais.deletar',  modulo: 'animais', submodulo: 'animais', acao: 'deletar',  label: 'Animais — Excluir',    ordemExib: 13 },
  { slug: 'animais.imprimir', modulo: 'animais', submodulo: 'animais', acao: 'imprimir', label: 'Animais — Imprimir',   ordemExib: 14 },

  // ── Prontuário / Evoluções ──────────────────────────────────────────────────
  { slug: 'atendimento.evolucoes.ler',      modulo: 'atendimento', submodulo: 'evolucoes', acao: 'ler',      label: 'Prontuário — Visualizar', ordemExib: 20 },
  { slug: 'atendimento.evolucoes.criar',    modulo: 'atendimento', submodulo: 'evolucoes', acao: 'criar',    label: 'Prontuário — Inserir',    ordemExib: 21 },
  { slug: 'atendimento.evolucoes.editar',   modulo: 'atendimento', submodulo: 'evolucoes', acao: 'editar',   label: 'Prontuário — Editar',     ordemExib: 22 },
  { slug: 'atendimento.evolucoes.deletar',  modulo: 'atendimento', submodulo: 'evolucoes', acao: 'deletar',  label: 'Prontuário — Excluir',    ordemExib: 23 },
  { slug: 'atendimento.evolucoes.imprimir', modulo: 'atendimento', submodulo: 'evolucoes', acao: 'imprimir', label: 'Prontuário — Imprimir',   ordemExib: 24 },

  // ── Prescrições ─────────────────────────────────────────────────────────────
  { slug: 'atendimento.prescricoes.ler',      modulo: 'atendimento', submodulo: 'prescricoes', acao: 'ler',      label: 'Prescrições — Visualizar', ordemExib: 30 },
  { slug: 'atendimento.prescricoes.criar',    modulo: 'atendimento', submodulo: 'prescricoes', acao: 'criar',    label: 'Prescrições — Inserir',    ordemExib: 31 },
  { slug: 'atendimento.prescricoes.editar',   modulo: 'atendimento', submodulo: 'prescricoes', acao: 'editar',   label: 'Prescrições — Editar',     ordemExib: 32 },
  { slug: 'atendimento.prescricoes.deletar',  modulo: 'atendimento', submodulo: 'prescricoes', acao: 'deletar',  label: 'Prescrições — Excluir',    ordemExib: 33 },
  { slug: 'atendimento.prescricoes.imprimir', modulo: 'atendimento', submodulo: 'prescricoes', acao: 'imprimir', label: 'Prescrições — Imprimir',   ordemExib: 34 },

  // ── Exames ──────────────────────────────────────────────────────────────────
  { slug: 'atendimento.exames.ler',      modulo: 'atendimento', submodulo: 'exames', acao: 'ler',      label: 'Exames — Visualizar', ordemExib: 40 },
  { slug: 'atendimento.exames.criar',    modulo: 'atendimento', submodulo: 'exames', acao: 'criar',    label: 'Exames — Inserir',    ordemExib: 41 },
  { slug: 'atendimento.exames.editar',   modulo: 'atendimento', submodulo: 'exames', acao: 'editar',   label: 'Exames — Editar',     ordemExib: 42 },
  { slug: 'atendimento.exames.deletar',  modulo: 'atendimento', submodulo: 'exames', acao: 'deletar',  label: 'Exames — Excluir',    ordemExib: 43 },
  { slug: 'atendimento.exames.imprimir', modulo: 'atendimento', submodulo: 'exames', acao: 'imprimir', label: 'Exames — Imprimir',   ordemExib: 44 },

  // ── Nutrição — Dietas ───────────────────────────────────────────────────────
  { slug: 'nutricao.dietas.ler',      modulo: 'nutricao', submodulo: 'dietas', acao: 'ler',      label: 'Dietas — Visualizar', ordemExib: 50 },
  { slug: 'nutricao.dietas.criar',    modulo: 'nutricao', submodulo: 'dietas', acao: 'criar',    label: 'Dietas — Criar',      ordemExib: 51 },
  { slug: 'nutricao.dietas.editar',   modulo: 'nutricao', submodulo: 'dietas', acao: 'editar',   label: 'Dietas — Editar',     ordemExib: 52 },
  { slug: 'nutricao.dietas.imprimir', modulo: 'nutricao', submodulo: 'dietas', acao: 'imprimir', label: 'Dietas — Imprimir',   ordemExib: 53 },

  // ── Nutrição — Relatórios ───────────────────────────────────────────────────
  { slug: 'nutricao.relatorios.ler',      modulo: 'nutricao', submodulo: 'relatorios', acao: 'ler',      label: 'Relatórios — Visualizar', ordemExib: 60 },
  { slug: 'nutricao.relatorios.criar',    modulo: 'nutricao', submodulo: 'relatorios', acao: 'criar',    label: 'Relatórios — Gerar',      ordemExib: 61 },
  { slug: 'nutricao.relatorios.imprimir', modulo: 'nutricao', submodulo: 'relatorios', acao: 'imprimir', label: 'Relatórios — Imprimir',   ordemExib: 62 },

  // ── Financeiro ──────────────────────────────────────────────────────────────
  { slug: 'financeiro.faturas.ler',      modulo: 'financeiro', submodulo: 'faturas', acao: 'ler',      label: 'Faturas — Visualizar', ordemExib: 70 },
  { slug: 'financeiro.faturas.criar',    modulo: 'financeiro', submodulo: 'faturas', acao: 'criar',    label: 'Faturas — Criar',      ordemExib: 71 },
  { slug: 'financeiro.faturas.editar',   modulo: 'financeiro', submodulo: 'faturas', acao: 'editar',   label: 'Faturas — Editar',     ordemExib: 72 },
  { slug: 'financeiro.faturas.imprimir', modulo: 'financeiro', submodulo: 'faturas', acao: 'imprimir', label: 'Faturas — Imprimir',   ordemExib: 73 },

  // ── Equipe ──────────────────────────────────────────────────────────────────
  { slug: 'equipe.membros.ler',    modulo: 'equipe', submodulo: 'membros', acao: 'ler',    label: 'Equipe — Visualizar', ordemExib: 80 },
  { slug: 'equipe.membros.editar', modulo: 'equipe', submodulo: 'membros', acao: 'editar', label: 'Equipe — Gerenciar',  ordemExib: 81 },

  // ── Farmácia — Estoque ──────────────────────────────────────────────────────
  { slug: 'farmacia.estoque.ler',      modulo: 'farmacia', submodulo: 'estoque', acao: 'ler',      label: 'Estoque — Visualizar', ordemExib: 85 },
  { slug: 'farmacia.estoque.criar',    modulo: 'farmacia', submodulo: 'estoque', acao: 'criar',    label: 'Estoque — Cadastrar',  ordemExib: 86 },
  { slug: 'farmacia.estoque.editar',   modulo: 'farmacia', submodulo: 'estoque', acao: 'editar',   label: 'Estoque — Editar',     ordemExib: 87 },
  { slug: 'farmacia.estoque.deletar',  modulo: 'farmacia', submodulo: 'estoque', acao: 'deletar',  label: 'Estoque — Excluir',    ordemExib: 88 },
  { slug: 'farmacia.estoque.imprimir', modulo: 'farmacia', submodulo: 'estoque', acao: 'imprimir', label: 'Estoque — Imprimir',   ordemExib: 89 },

  // ── Farmácia — Movimentações ────────────────────────────────────────────────
  { slug: 'farmacia.movimentacoes.ler',      modulo: 'farmacia', submodulo: 'movimentacoes', acao: 'ler',      label: 'Movimentações — Visualizar', ordemExib: 90 },
  { slug: 'farmacia.movimentacoes.criar',    modulo: 'farmacia', submodulo: 'movimentacoes', acao: 'criar',    label: 'Movimentações — Registrar',  ordemExib: 91 },
  { slug: 'farmacia.movimentacoes.imprimir', modulo: 'farmacia', submodulo: 'movimentacoes', acao: 'imprimir', label: 'Movimentações — Imprimir',   ordemExib: 92 },
];

module.exports = { PERMISSOES_PADRAO, MODULOS_SISTEMA };