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

  // Veterinário tem acesso completo a todas as operações clínicas e nutricionais
  VETERINARIO: {
    // Animais
    'animais.ler':     'EQUIPE',
    'animais.criar':   'EQUIPE',
    'animais.editar':  'EQUIPE',
    'animais.deletar': 'PROPRIO',

    // Prontuário / Evoluções clínicas
    'atendimento.evolucoes.ler':    'EQUIPE',
    'atendimento.evolucoes.criar':  'PROPRIO',
    'atendimento.evolucoes.editar': 'PROPRIO',

    // Exames clínicos e nutricionais
    'atendimento.exames.ler':    'EQUIPE',
    'atendimento.exames.criar':  'PROPRIO',
    'atendimento.exames.editar': 'PROPRIO',

    // Nutrição
    'nutricao.dietas.ler':    'EQUIPE',
    'nutricao.dietas.criar':  'PROPRIO',
    'nutricao.dietas.editar': 'PROPRIO',

    // Relatórios nutricionais
    'nutricao.relatorios.ler':    'EQUIPE',
    'nutricao.relatorios.criar':  'PROPRIO',

    // Financeiro
    'financeiro.faturas.ler':    'PROPRIO',
    'financeiro.faturas.criar':  'PROPRIO',
    'financeiro.faturas.editar': 'PROPRIO',

    // Equipe (gestão de membros — só sócio pode)
    'equipe.membros.ler':    'LEITURA',
    'equipe.membros.editar': 'NENHUM',
  },

  // Estagiário tem acesso limitado — só lê ou acessa seus próprios registros
  ESTAGIARIO: {
    // Animais
    'animais.ler':     'EQUIPE',
    'animais.criar':   'NENHUM',
    'animais.editar':  'NENHUM',
    'animais.deletar': 'NENHUM',

    // Prontuário / Evoluções
    'atendimento.evolucoes.ler':    'EQUIPE',
    'atendimento.evolucoes.criar':  'PROPRIO',
    'atendimento.evolucoes.editar': 'PROPRIO',

    // Exames
    'atendimento.exames.ler':    'EQUIPE',
    'atendimento.exames.criar':  'NENHUM',
    'atendimento.exames.editar': 'NENHUM',

    // Nutrição
    'nutricao.dietas.ler':    'EQUIPE',
    'nutricao.dietas.criar':  'NENHUM',
    'nutricao.dietas.editar': 'NENHUM',

    // Relatórios
    'nutricao.relatorios.ler':    'EQUIPE',
    'nutricao.relatorios.criar':  'NENHUM',

    // Financeiro
    'financeiro.faturas.ler':    'NENHUM',
    'financeiro.faturas.criar':  'NENHUM',
    'financeiro.faturas.editar': 'NENHUM',

    // Equipe
    'equipe.membros.ler':    'LEITURA',
    'equipe.membros.editar': 'NENHUM',
  },
};

module.exports = { PERMISSOES_PADRAO };