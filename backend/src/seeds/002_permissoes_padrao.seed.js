// backend/src/seeds/002_permissoes_padrao.seed.js
// =============================================================================
// Matriz de permissões padrão por cargo.
// Aplicada automaticamente quando um membro entra em uma equipe.
//
// Níveis: NENHUM < LEITURA < PROPRIO < EQUIPE < FULL
// GESTOR: todas as permissões FULL — ADMIN pode bloquear globalmente via MatrizPerfil.locked.
// =============================================================================
'use strict';

const PERMISSOES_PADRAO = {

  // Gestor — acesso total irrestrito a todos os módulos (incluindo catálogos admin-only)
  GESTOR: {
    'relatorios.gerencial.ler': 'FULL',
    'cadastro.proprietario.ler':     'FULL',
    'cadastro.proprietario.criar':   'FULL',
    'cadastro.proprietario.editar':  'FULL',
    'cadastro.proprietario.deletar': 'FULL',
    'cadastro.proprietario.ativar':  'FULL',
    'cadastro.tratador.ler':     'FULL',
    'cadastro.tratador.criar':   'FULL',
    'cadastro.tratador.editar':  'FULL',
    'cadastro.tratador.deletar': 'FULL',
    'cadastro.tratador.ativar':  'FULL',
    'cadastro.fornecedor.ler':     'FULL',
    'cadastro.fornecedor.criar':   'FULL',
    'cadastro.fornecedor.editar':  'FULL',
    'cadastro.fornecedor.deletar': 'FULL',
    'cadastro.fornecedor.ativar':  'FULL',
    'cadastro.localizacao.ler':    'FULL',
    'cadastro.localizacao.criar':  'FULL',
    'cadastro.localizacao.editar': 'FULL',
    'cadastro.localizacao.ativar': 'FULL',

    'dashboard.geral.ler':      'FULL',
    'dashboard.geral.imprimir': 'FULL',

    'animais.ler':         'FULL',
    'animais.criar':       'FULL',
    'animais.editar':      'FULL',
    'animais.deletar':     'FULL',
    'animais.imprimir':    'FULL',
    'animais.desvincular': 'FULL',
    'animais.resenha.editar': 'FULL',

    'atendimento.evolucoes.ler':        'FULL',
    'atendimento.evolucoes.criar':      'FULL',
    'atendimento.evolucoes.editar':     'FULL',
    'atendimento.evolucoes.deletar':    'FULL',
    'atendimento.evolucoes.imprimir':   'FULL',
    'atendimento.evolucoes.finalizar':  'FULL',

    'atendimento.prescricoes.ler':       'FULL',
    'atendimento.prescricoes.criar':     'FULL',
    'atendimento.prescricoes.editar':    'FULL',
    'atendimento.prescricoes.deletar':   'FULL',
    'atendimento.prescricoes.imprimir':  'FULL',
    'atendimento.prescricoes.finalizar': 'FULL',

    'atendimento.vacinas.ler':       'FULL',
    'atendimento.vacinas.criar':     'FULL',
    'atendimento.vacinas.editar':    'FULL',
    'atendimento.vacinas.deletar':   'FULL',
    'atendimento.vacinas.imprimir':  'FULL',
    'atendimento.vacinas.finalizar': 'FULL',

    'atendimento.encaminhamentos.ler':        'FULL',
    'atendimento.encaminhamentos.criar':      'FULL',
    'atendimento.encaminhamentos.editar':     'FULL',
    'atendimento.encaminhamentos.deletar':    'FULL',
    'atendimento.encaminhamentos.imprimir':   'FULL',
    'atendimento.encaminhamentos.finalizar':  'FULL',

    'atendimento.exames.ler':       'FULL',
    'atendimento.exames.criar':     'FULL',
    'atendimento.exames.editar':    'FULL',
    'atendimento.exames.deletar':   'FULL',
    'atendimento.exames.imprimir':  'FULL',
    'atendimento.exames.finalizar': 'FULL',

    'atendimento.agendamentos.ler':               'FULL',
    'atendimento.agendamentos.criar':             'FULL',
    'atendimento.agendamentos.editar':            'FULL',
    'atendimento.agendamentos.concluir':          'FULL',
    'atendimento.agendamentos.trocar_profissional': 'FULL',
    'atendimento.agendamentos.deletar':           'FULL',

    'agendamento.ler':                  'FULL',
    'agendamento.confirmar':            'FULL',
    'agendamento.reagendar':            'FULL',
    'agendamento.trocar_profissional':  'FULL',
    'agendamento.cancelar':             'FULL',

    'enfermagem.prescricao.ler':      'FULL',
    'enfermagem.prescricao.executar': 'FULL',
    'enfermagem.prescricao.imprimir': 'FULL',

    'exames.laboratorial.ler':    'FULL',
    'exames.laboratorial.criar':  'FULL',
    'exames.laboratorial.editar': 'FULL',
    'exames.laboratorial.deletar':'FULL',

    'exames.imagem.ler':    'FULL',
    'exames.imagem.criar':  'FULL',
    'exames.imagem.editar': 'FULL',
    'exames.imagem.deletar':'FULL',

    'nutricao.dietas.ler':          'FULL',
    'nutricao.dietas.criar':        'FULL',
    'nutricao.dietas.editar':       'FULL',
    'nutricao.dietas.imprimir':     'FULL',
    'nutricao.dietas.compartilhar': 'FULL',
    'nutricao.dietas.exportar':     'FULL',
    'nutricao.dietas.ativar':       'FULL',

    'nutricao.relatorios.ler':      'FULL',
    'nutricao.relatorios.criar':    'FULL',
    'nutricao.relatorios.imprimir': 'FULL',
    'nutricao.relatorios.exportar': 'FULL',

    'financeiro.faturas.ler':      'FULL',
    'financeiro.faturas.criar':    'FULL',
    'financeiro.faturas.editar':   'FULL',
    'financeiro.faturas.imprimir': 'FULL',
    'financeiro.faturas.whatsapp': 'FULL',
    'financeiro.faturas.exportar': 'FULL',
    'financeiro.faturas.fechar':   'FULL',
    'financeiro.faturas.lancar':   'FULL',

    'equipe.membros.ler':    'FULL',
    'equipe.membros.editar': 'FULL',

    'vacina.estoque.ler':      'FULL',
    'vacina.estoque.criar':    'FULL',
    'vacina.estoque.editar':   'FULL',
    'vacina.estoque.deletar':  'FULL',
    'vacina.estoque.imprimir': 'FULL',

    'farmacia.estoque.ler':      'FULL',
    'farmacia.estoque.criar':    'FULL',
    'farmacia.estoque.editar':   'FULL',
    'farmacia.estoque.ajustar':  'FULL',
    'farmacia.estoque.deletar':  'FULL',
    'farmacia.estoque.imprimir': 'FULL',

    'farmacia.movimentacoes.ler':      'FULL',
    'farmacia.movimentacoes.criar':    'FULL',
    'farmacia.movimentacoes.imprimir': 'FULL',

    'medicamentos.catalogo.ler':      'FULL',
    'medicamentos.catalogo.criar':    'FULL',
    'medicamentos.catalogo.editar':   'FULL',
    'medicamentos.catalogo.deletar':  'FULL',
    'medicamentos.catalogo.imprimir': 'FULL',

    'procedimentos.catalogo.ler':      'FULL',
    'procedimentos.catalogo.criar':    'FULL',
    'procedimentos.catalogo.editar':   'FULL',
    'procedimentos.catalogo.deletar':  'FULL',
    'procedimentos.catalogo.imprimir': 'FULL',
  },

  // Veterinário — acesso completo às operações clínicas e nutricionais
  VETERINARIO: {
    // Relatórios gerenciais — restrito a GESTOR/FINANCEIRO por padrão
    'relatorios.gerencial.ler': 'NENHUM',
    // Cadastro
    'cadastro.proprietario.ler':     'EQUIPE',
    'cadastro.proprietario.criar':   'PROPRIO',
    'cadastro.proprietario.editar':  'PROPRIO',
    'cadastro.proprietario.deletar': 'NENHUM',
    'cadastro.proprietario.ativar':  'PROPRIO',
    'cadastro.tratador.ler':     'EQUIPE',
    'cadastro.tratador.criar':   'PROPRIO',
    'cadastro.tratador.editar':  'PROPRIO',
    'cadastro.tratador.deletar': 'PROPRIO',
    'cadastro.tratador.ativar':  'PROPRIO',
    'cadastro.fornecedor.ler':     'EQUIPE',
    'cadastro.fornecedor.criar':   'PROPRIO',
    'cadastro.fornecedor.editar':  'PROPRIO',
    'cadastro.fornecedor.deletar': 'NENHUM',
    'cadastro.fornecedor.ativar':  'PROPRIO',
    'cadastro.localizacao.ler':    'LEITURA',
    'cadastro.localizacao.criar':  'LEITURA',
    'cadastro.localizacao.editar': 'PROPRIO',
    'cadastro.localizacao.ativar': 'PROPRIO',

    // Dashboard
    'dashboard.geral.ler':      'EQUIPE',
    'dashboard.geral.imprimir': 'EQUIPE',

    // Animais
    'animais.ler':         'EQUIPE',
    'animais.criar':       'EQUIPE',
    'animais.editar':      'EQUIPE',
    'animais.deletar':     'PROPRIO',
    'animais.imprimir':    'EQUIPE',
    'animais.desvincular': 'PROPRIO',
    'animais.resenha.editar': 'EQUIPE',

    // Prontuário / Evoluções clínicas
    'atendimento.evolucoes.ler':       'EQUIPE',
    'atendimento.evolucoes.criar':     'PROPRIO',
    'atendimento.evolucoes.editar':    'PROPRIO',
    'atendimento.evolucoes.deletar':   'PROPRIO',
    'atendimento.evolucoes.imprimir':  'EQUIPE',
    'atendimento.evolucoes.finalizar': 'NENHUM',

    // Prescrições
    'atendimento.prescricoes.ler':       'EQUIPE',
    'atendimento.prescricoes.criar':     'PROPRIO',
    'atendimento.prescricoes.editar':    'PROPRIO',
    'atendimento.prescricoes.deletar':   'PROPRIO',
    'atendimento.prescricoes.imprimir':  'PROPRIO',
    'atendimento.prescricoes.finalizar': 'NENHUM',

    // Vacinas
    'atendimento.vacinas.ler':       'EQUIPE',
    'atendimento.vacinas.criar':     'PROPRIO',
    'atendimento.vacinas.editar':    'PROPRIO',
    'atendimento.vacinas.deletar':   'PROPRIO',
    'atendimento.vacinas.imprimir':  'EQUIPE',
    'atendimento.vacinas.finalizar': 'NENHUM',

    // Encaminhamentos
    'atendimento.encaminhamentos.ler':        'EQUIPE',
    'atendimento.encaminhamentos.criar':      'PROPRIO',
    'atendimento.encaminhamentos.editar':     'PROPRIO',
    'atendimento.encaminhamentos.deletar':    'PROPRIO',
    'atendimento.encaminhamentos.imprimir':   'EQUIPE',
    'atendimento.encaminhamentos.finalizar':  'NENHUM',

    // Exames clínicos e nutricionais
    'atendimento.exames.ler':       'EQUIPE',
    'atendimento.exames.criar':     'PROPRIO',
    'atendimento.exames.editar':    'PROPRIO',
    'atendimento.exames.deletar':   'PROPRIO',
    'atendimento.exames.imprimir':  'EQUIPE',
    'atendimento.exames.finalizar': 'NENHUM',

    // Agendamentos (Agenda dentro de Atendimento)
    'atendimento.agendamentos.ler':               'EQUIPE',
    'atendimento.agendamentos.criar':             'PROPRIO',
    'atendimento.agendamentos.editar':            'PROPRIO',
    'atendimento.agendamentos.concluir':          'PROPRIO',
    'atendimento.agendamentos.trocar_profissional': 'PROPRIO',
    'atendimento.agendamentos.deletar':           'PROPRIO',

    // Agendamento (portal standalone)
    'agendamento.ler':                  'EQUIPE',
    'agendamento.confirmar':            'PROPRIO',
    'agendamento.reagendar':            'PROPRIO',
    'agendamento.trocar_profissional':  'PROPRIO',
    'agendamento.cancelar':             'PROPRIO',

    // Enfermagem — Execução de Prescrição
    'enfermagem.prescricao.ler':      'EQUIPE',
    'enfermagem.prescricao.executar': 'PROPRIO',
    'enfermagem.prescricao.imprimir': 'EQUIPE',

    // Exames — Laboratorial
    'exames.laboratorial.ler':     'EQUIPE',
    'exames.laboratorial.criar':   'PROPRIO',
    'exames.laboratorial.editar':  'PROPRIO',
    'exames.laboratorial.deletar': 'PROPRIO',

    // Exames — Imagem
    'exames.imagem.ler':     'EQUIPE',
    'exames.imagem.criar':   'PROPRIO',
    'exames.imagem.editar':  'PROPRIO',
    'exames.imagem.deletar': 'PROPRIO',

    // Nutrição — Dietas
    'nutricao.dietas.ler':          'EQUIPE',
    'nutricao.dietas.criar':        'PROPRIO',
    'nutricao.dietas.editar':       'PROPRIO',
    'nutricao.dietas.imprimir':     'EQUIPE',
    'nutricao.dietas.compartilhar': 'PROPRIO',
    'nutricao.dietas.exportar':     'PROPRIO',
    'nutricao.dietas.ativar':       'PROPRIO',

    // Nutrição — Relatórios
    'nutricao.relatorios.ler':      'EQUIPE',
    'nutricao.relatorios.criar':    'PROPRIO',
    'nutricao.relatorios.imprimir': 'EQUIPE',
    'nutricao.relatorios.exportar': 'PROPRIO',

    // Financeiro
    'financeiro.faturas.ler':      'PROPRIO',
    'financeiro.faturas.criar':    'PROPRIO',
    'financeiro.faturas.editar':   'PROPRIO',
    'financeiro.faturas.imprimir': 'PROPRIO',
    'financeiro.faturas.whatsapp': 'PROPRIO',
    'financeiro.faturas.exportar': 'PROPRIO',
    'financeiro.faturas.fechar':   'PROPRIO',
    'financeiro.faturas.lancar':   'PROPRIO',

    // Equipe (gestão de membros — só gestor pode)
    'equipe.membros.ler':    'LEITURA',
    'equipe.membros.editar': 'NENHUM',

    // Vacina — Estoque
    'vacina.estoque.ler':      'EQUIPE',
    'vacina.estoque.criar':    'PROPRIO',
    'vacina.estoque.editar':   'PROPRIO',
    'vacina.estoque.deletar':  'PROPRIO',
    'vacina.estoque.imprimir': 'EQUIPE',

    // Farmácia — Estoque
    'farmacia.estoque.ler':      'EQUIPE',
    'farmacia.estoque.criar':    'PROPRIO',
    'farmacia.estoque.editar':   'PROPRIO',
    'farmacia.estoque.ajustar':  'PROPRIO',
    'farmacia.estoque.deletar':  'PROPRIO',
    'farmacia.estoque.imprimir': 'EQUIPE',

    // Farmácia — Movimentações
    'farmacia.movimentacoes.ler':      'EQUIPE',
    'farmacia.movimentacoes.criar':    'PROPRIO',
    'farmacia.movimentacoes.imprimir': 'EQUIPE',

    // Medicamentos — gerenciado exclusivamente pelo ADMIN (catálogo global)
    'medicamentos.catalogo.ler':      'NENHUM',
    'medicamentos.catalogo.criar':    'NENHUM',
    'medicamentos.catalogo.editar':   'NENHUM',
    'medicamentos.catalogo.deletar':  'NENHUM',
    'medicamentos.catalogo.imprimir': 'NENHUM',

    // Procedimentos — gerenciado exclusivamente pelo ADMIN (catálogo global)
    'procedimentos.catalogo.ler':      'NENHUM',
    'procedimentos.catalogo.criar':    'NENHUM',
    'procedimentos.catalogo.editar':   'NENHUM',
    'procedimentos.catalogo.deletar':  'NENHUM',
    'procedimentos.catalogo.imprimir': 'NENHUM',
  },

  // Proprietário — leitura por padrão; criar/editar nutrição configuráveis pelo admin/gestor
  PROPRIETARIO: {
    'relatorios.gerencial.ler': 'NENHUM',
    'cadastro.proprietario.ler':     'NENHUM',
    'cadastro.proprietario.criar':   'NENHUM',
    'cadastro.proprietario.editar':  'NENHUM',
    'cadastro.proprietario.deletar': 'NENHUM',
    'cadastro.proprietario.ativar':  'NENHUM',
    'cadastro.tratador.ler':     'NENHUM',
    'cadastro.tratador.criar':   'NENHUM',
    'cadastro.tratador.editar':  'NENHUM',
    'cadastro.tratador.deletar': 'NENHUM',
    'cadastro.tratador.ativar':  'NENHUM',
    'cadastro.fornecedor.ler':     'NENHUM',
    'cadastro.fornecedor.criar':   'NENHUM',
    'cadastro.fornecedor.editar':  'NENHUM',
    'cadastro.fornecedor.deletar': 'NENHUM',
    'cadastro.fornecedor.ativar':  'NENHUM',
    'cadastro.localizacao.ler':    'NENHUM',
    'cadastro.localizacao.criar':  'NENHUM',
    'cadastro.localizacao.editar': 'NENHUM',
    'cadastro.localizacao.ativar': 'NENHUM',
    'cadastro.localizacao.editar': 'NENHUM',
    'cadastro.localizacao.ativar': 'NENHUM',

    'dashboard.geral.ler': 'LEITURA',
    'animais.ler':         'LEITURA',

    // Agendamentos — proprietário pode visualizar
    'atendimento.agendamentos.ler':               'LEITURA',
    'atendimento.agendamentos.criar':             'NENHUM',
    'atendimento.agendamentos.editar':            'NENHUM',
    'atendimento.agendamentos.concluir':          'NENHUM',
    'atendimento.agendamentos.trocar_profissional': 'NENHUM',
    'atendimento.agendamentos.deletar':           'NENHUM',

    'agendamento.ler':                  'LEITURA',
    'agendamento.confirmar':            'NENHUM',
    'agendamento.reagendar':            'NENHUM',
    'agendamento.trocar_profissional':  'NENHUM',
    'agendamento.cancelar':             'NENHUM',

    // Nutrição — desabilitado por padrão; admin/gestor pode habilitar por equipe
    'nutricao.dietas.ler':          'NENHUM',
    'nutricao.dietas.criar':        'NENHUM',
    'nutricao.dietas.editar':       'NENHUM',
    'nutricao.dietas.imprimir':     'NENHUM',
    'nutricao.dietas.compartilhar': 'NENHUM',
    'nutricao.dietas.exportar':     'NENHUM',
    'nutricao.dietas.ativar':       'NENHUM',

    'nutricao.relatorios.ler':      'NENHUM',
    'nutricao.relatorios.criar':    'NENHUM',
    'nutricao.relatorios.imprimir': 'NENHUM',
    'nutricao.relatorios.exportar': 'NENHUM',
  },

  // Fornecedor de serviços — acesso configurável pelo gestor; finalizar apenas itens próprios
  FORNECEDOR: {
    'relatorios.gerencial.ler': 'NENHUM',
    'cadastro.proprietario.ler':     'NENHUM',
    'cadastro.proprietario.criar':   'NENHUM',
    'cadastro.proprietario.editar':  'NENHUM',
    'cadastro.proprietario.deletar': 'NENHUM',
    'cadastro.proprietario.ativar':  'NENHUM',
    'cadastro.tratador.ler':     'NENHUM',
    'cadastro.tratador.criar':   'NENHUM',
    'cadastro.tratador.editar':  'NENHUM',
    'cadastro.tratador.deletar': 'NENHUM',
    'cadastro.tratador.ativar':  'NENHUM',
    'cadastro.fornecedor.ler':     'NENHUM',
    'cadastro.fornecedor.criar':   'NENHUM',
    'cadastro.fornecedor.editar':  'NENHUM',
    'cadastro.fornecedor.deletar': 'NENHUM',
    'cadastro.fornecedor.ativar':  'NENHUM',
    'cadastro.localizacao.ler':    'NENHUM',
    'cadastro.localizacao.criar':  'NENHUM',
    'cadastro.localizacao.editar': 'NENHUM',
    'cadastro.localizacao.ativar': 'NENHUM',

    'dashboard.geral.ler':      'LEITURA',
    'dashboard.geral.imprimir': 'NENHUM',

    'animais.ler':         'EQUIPE',
    'animais.criar':       'NENHUM',
    'animais.editar':      'NENHUM',
    'animais.deletar':     'NENHUM',
    'animais.imprimir':    'NENHUM',
    'animais.desvincular': 'NENHUM',

    // Finalizar apenas itens criados pelo próprio fornecedor (PROPRIO); gestor tem bypass total
    'atendimento.evolucoes.ler':       'EQUIPE',
    'atendimento.evolucoes.criar':     'PROPRIO',
    'atendimento.evolucoes.editar':    'PROPRIO',
    'atendimento.evolucoes.deletar':   'NENHUM',
    'atendimento.evolucoes.imprimir':  'EQUIPE',
    'atendimento.evolucoes.finalizar': 'PROPRIO',

    'atendimento.prescricoes.ler':       'EQUIPE',
    'atendimento.prescricoes.criar':     'PROPRIO',
    'atendimento.prescricoes.editar':    'PROPRIO',
    'atendimento.prescricoes.deletar':   'NENHUM',
    'atendimento.prescricoes.imprimir':  'EQUIPE',
    'atendimento.prescricoes.finalizar': 'PROPRIO',

    'atendimento.vacinas.ler':       'EQUIPE',
    'atendimento.vacinas.criar':     'PROPRIO',
    'atendimento.vacinas.editar':    'PROPRIO',
    'atendimento.vacinas.deletar':   'NENHUM',
    'atendimento.vacinas.imprimir':  'EQUIPE',
    'atendimento.vacinas.finalizar': 'PROPRIO',

    'atendimento.encaminhamentos.ler':        'EQUIPE',
    'atendimento.encaminhamentos.criar':      'PROPRIO',
    'atendimento.encaminhamentos.editar':     'PROPRIO',
    'atendimento.encaminhamentos.deletar':    'NENHUM',
    'atendimento.encaminhamentos.imprimir':   'EQUIPE',
    'atendimento.encaminhamentos.finalizar':  'PROPRIO',

    'atendimento.exames.ler':       'EQUIPE',
    'atendimento.exames.criar':     'PROPRIO',
    'atendimento.exames.editar':    'PROPRIO',
    'atendimento.exames.deletar':   'NENHUM',
    'atendimento.exames.imprimir':  'EQUIPE',
    'atendimento.exames.finalizar': 'PROPRIO',

    'atendimento.agendamentos.ler':               'NENHUM',
    'atendimento.agendamentos.criar':             'NENHUM',
    'atendimento.agendamentos.editar':            'NENHUM',
    'atendimento.agendamentos.concluir':          'NENHUM',
    'atendimento.agendamentos.trocar_profissional': 'NENHUM',
    'atendimento.agendamentos.deletar':           'NENHUM',

    'agendamento.ler':                  'NENHUM',
    'agendamento.confirmar':            'NENHUM',
    'agendamento.reagendar':            'NENHUM',
    'agendamento.trocar_profissional':  'NENHUM',
    'agendamento.cancelar':             'NENHUM',

    'enfermagem.prescricao.ler':      'NENHUM',
    'enfermagem.prescricao.executar': 'NENHUM',
    'enfermagem.prescricao.imprimir': 'NENHUM',

    // Espelha atendimento.exames.* do FORNECEDOR — o controle por tipo de exame
    // (exames.laboratorial/imagem) complementa; o gestor pode restringir por tipo.
    'exames.laboratorial.ler':     'EQUIPE',
    'exames.laboratorial.criar':   'PROPRIO',
    'exames.laboratorial.editar':  'PROPRIO',
    'exames.laboratorial.deletar': 'NENHUM',

    'exames.imagem.ler':     'EQUIPE',
    'exames.imagem.criar':   'PROPRIO',
    'exames.imagem.editar':  'PROPRIO',
    'exames.imagem.deletar': 'NENHUM',

    'nutricao.dietas.ler':          'NENHUM',
    'nutricao.dietas.criar':        'NENHUM',
    'nutricao.dietas.editar':       'NENHUM',
    'nutricao.dietas.imprimir':     'NENHUM',
    'nutricao.dietas.compartilhar': 'NENHUM',
    'nutricao.dietas.exportar':     'NENHUM',
    'nutricao.dietas.ativar':       'NENHUM',

    'nutricao.relatorios.ler':      'NENHUM',
    'nutricao.relatorios.criar':    'NENHUM',
    'nutricao.relatorios.imprimir': 'NENHUM',
    'nutricao.relatorios.exportar': 'NENHUM',

    'financeiro.faturas.ler':      'NENHUM',
    'financeiro.faturas.criar':    'NENHUM',
    'financeiro.faturas.editar':   'NENHUM',
    'financeiro.faturas.imprimir': 'NENHUM',
    'financeiro.faturas.whatsapp': 'NENHUM',
    'financeiro.faturas.exportar': 'NENHUM',
    'financeiro.faturas.fechar':   'NENHUM',
    'financeiro.faturas.lancar':   'NENHUM',

    'equipe.membros.ler':    'NENHUM',
    'equipe.membros.editar': 'NENHUM',

    'vacina.estoque.ler':      'NENHUM',
    'vacina.estoque.criar':    'NENHUM',
    'vacina.estoque.editar':   'NENHUM',
    'vacina.estoque.deletar':  'NENHUM',
    'vacina.estoque.imprimir': 'NENHUM',

    'farmacia.estoque.ler':      'NENHUM',
    'farmacia.estoque.criar':    'NENHUM',
    'farmacia.estoque.editar':   'NENHUM',
    'farmacia.estoque.ajustar':  'NENHUM',
    'farmacia.estoque.deletar':  'NENHUM',
    'farmacia.estoque.imprimir': 'NENHUM',

    'farmacia.movimentacoes.ler':      'NENHUM',
    'farmacia.movimentacoes.criar':    'NENHUM',
    'farmacia.movimentacoes.imprimir': 'NENHUM',

    'medicamentos.catalogo.ler':      'NENHUM',
    'medicamentos.catalogo.criar':    'NENHUM',
    'medicamentos.catalogo.editar':   'NENHUM',
    'medicamentos.catalogo.deletar':  'NENHUM',
    'medicamentos.catalogo.imprimir': 'NENHUM',

    'procedimentos.catalogo.ler':      'NENHUM',
    'procedimentos.catalogo.criar':    'NENHUM',
    'procedimentos.catalogo.editar':   'NENHUM',
    'procedimentos.catalogo.deletar':  'NENHUM',
    'procedimentos.catalogo.imprimir': 'NENHUM',
  },

  // Estagiário — por padrão só leitura; gestor pode elevar via painel
  ESTAGIARIO: {
    'relatorios.gerencial.ler': 'NENHUM',
    // Cadastro
    'cadastro.proprietario.ler':     'EQUIPE',
    'cadastro.proprietario.criar':   'NENHUM',
    'cadastro.proprietario.editar':  'NENHUM',
    'cadastro.proprietario.deletar': 'NENHUM',
    'cadastro.proprietario.ativar':  'NENHUM',
    'cadastro.tratador.ler':     'EQUIPE',
    'cadastro.tratador.criar':   'NENHUM',
    'cadastro.tratador.editar':  'NENHUM',
    'cadastro.tratador.deletar': 'NENHUM',
    'cadastro.tratador.ativar':  'NENHUM',
    'cadastro.fornecedor.ler':     'EQUIPE',
    'cadastro.fornecedor.criar':   'NENHUM',
    'cadastro.fornecedor.editar':  'NENHUM',
    'cadastro.fornecedor.deletar': 'NENHUM',
    'cadastro.fornecedor.ativar':  'NENHUM',
    'cadastro.localizacao.ler':    'LEITURA',
    'cadastro.localizacao.criar':  'NENHUM',
    'cadastro.localizacao.editar': 'NENHUM',
    'cadastro.localizacao.ativar': 'NENHUM',

    // Dashboard
    'dashboard.geral.ler':      'LEITURA',
    'dashboard.geral.imprimir': 'NENHUM',

    // Animais
    'animais.ler':         'EQUIPE',
    'animais.criar':       'NENHUM',
    'animais.editar':      'NENHUM',
    'animais.deletar':     'NENHUM',
    'animais.imprimir':    'NENHUM',
    'animais.desvincular': 'NENHUM',

    // Prontuário / Evoluções — apenas leitura por padrão
    'atendimento.evolucoes.ler':       'EQUIPE',
    'atendimento.evolucoes.criar':     'NENHUM',
    'atendimento.evolucoes.editar':    'NENHUM',
    'atendimento.evolucoes.deletar':   'NENHUM',
    'atendimento.evolucoes.imprimir':  'NENHUM',
    'atendimento.evolucoes.finalizar': 'NENHUM',

    // Prescrições — apenas leitura
    'atendimento.prescricoes.ler':       'EQUIPE',
    'atendimento.prescricoes.criar':     'NENHUM',
    'atendimento.prescricoes.editar':    'NENHUM',
    'atendimento.prescricoes.deletar':   'NENHUM',
    'atendimento.prescricoes.imprimir':  'NENHUM',
    'atendimento.prescricoes.finalizar': 'NENHUM',

    // Vacinas — apenas leitura
    'atendimento.vacinas.ler':       'EQUIPE',
    'atendimento.vacinas.criar':     'NENHUM',
    'atendimento.vacinas.editar':    'NENHUM',
    'atendimento.vacinas.deletar':   'NENHUM',
    'atendimento.vacinas.imprimir':  'NENHUM',
    'atendimento.vacinas.finalizar': 'NENHUM',

    // Encaminhamentos — apenas leitura
    'atendimento.encaminhamentos.ler':        'EQUIPE',
    'atendimento.encaminhamentos.criar':      'NENHUM',
    'atendimento.encaminhamentos.editar':     'NENHUM',
    'atendimento.encaminhamentos.deletar':    'NENHUM',
    'atendimento.encaminhamentos.imprimir':   'NENHUM',
    'atendimento.encaminhamentos.finalizar':  'NENHUM',

    // Exames
    'atendimento.exames.ler':       'EQUIPE',
    'atendimento.exames.criar':     'NENHUM',
    'atendimento.exames.editar':    'NENHUM',
    'atendimento.exames.deletar':   'NENHUM',
    'atendimento.exames.imprimir':  'NENHUM',
    'atendimento.exames.finalizar': 'NENHUM',

    // Agendamentos (Agenda dentro de Atendimento)
    'atendimento.agendamentos.ler':               'EQUIPE',
    'atendimento.agendamentos.criar':             'EQUIPE',
    'atendimento.agendamentos.editar':            'PROPRIO',
    'atendimento.agendamentos.concluir':          'PROPRIO',
    'atendimento.agendamentos.trocar_profissional': 'NENHUM',
    'atendimento.agendamentos.deletar':           'NENHUM',

    // Agendamento (portal standalone)
    'agendamento.ler':                  'EQUIPE',
    'agendamento.confirmar':            'EQUIPE',
    'agendamento.reagendar':            'PROPRIO',
    'agendamento.trocar_profissional':  'NENHUM',
    'agendamento.cancelar':             'NENHUM',

    // Enfermagem — execução permitida para estagiários (técnicos)
    'enfermagem.prescricao.ler':      'EQUIPE',
    'enfermagem.prescricao.executar': 'EQUIPE',
    'enfermagem.prescricao.imprimir': 'EQUIPE',

    // Exames — Laboratorial
    'exames.laboratorial.ler':     'EQUIPE',
    'exames.laboratorial.criar':   'NENHUM',
    'exames.laboratorial.editar':  'NENHUM',
    'exames.laboratorial.deletar': 'NENHUM',

    // Exames — Imagem
    'exames.imagem.ler':     'EQUIPE',
    'exames.imagem.criar':   'NENHUM',
    'exames.imagem.editar':  'NENHUM',
    'exames.imagem.deletar': 'NENHUM',

    // Nutrição — Dietas
    'nutricao.dietas.ler':          'EQUIPE',
    'nutricao.dietas.criar':        'NENHUM',
    'nutricao.dietas.editar':       'NENHUM',
    'nutricao.dietas.imprimir':     'NENHUM',
    'nutricao.dietas.compartilhar': 'NENHUM',
    'nutricao.dietas.exportar':     'NENHUM',
    'nutricao.dietas.ativar':       'NENHUM',

    // Nutrição — Relatórios
    'nutricao.relatorios.ler':      'EQUIPE',
    'nutricao.relatorios.criar':    'NENHUM',
    'nutricao.relatorios.imprimir': 'NENHUM',
    'nutricao.relatorios.exportar': 'NENHUM',

    // Financeiro
    'financeiro.faturas.ler':      'NENHUM',
    'financeiro.faturas.criar':    'NENHUM',
    'financeiro.faturas.editar':   'NENHUM',
    'financeiro.faturas.imprimir': 'NENHUM',
    'financeiro.faturas.whatsapp': 'NENHUM',
    'financeiro.faturas.exportar': 'NENHUM',
    'financeiro.faturas.fechar':   'NENHUM',
    'financeiro.faturas.lancar':   'NENHUM',

    // Equipe
    'equipe.membros.ler':    'LEITURA',
    'equipe.membros.editar': 'NENHUM',

    // Vacina — Estoque (Estagiário pode visualizar)
    'vacina.estoque.ler':      'EQUIPE',
    'vacina.estoque.criar':    'NENHUM',
    'vacina.estoque.editar':   'NENHUM',
    'vacina.estoque.deletar':  'NENHUM',
    'vacina.estoque.imprimir': 'NENHUM',

    // Farmácia — Estoque
    'farmacia.estoque.ler':      'EQUIPE',
    'farmacia.estoque.criar':    'NENHUM',
    'farmacia.estoque.editar':   'NENHUM',
    'farmacia.estoque.ajustar':  'NENHUM',
    'farmacia.estoque.deletar':  'NENHUM',
    'farmacia.estoque.imprimir': 'NENHUM',

    // Farmácia — Movimentações
    'farmacia.movimentacoes.ler':      'EQUIPE',
    'farmacia.movimentacoes.criar':    'NENHUM',
    'farmacia.movimentacoes.imprimir': 'NENHUM',

    // Medicamentos — gerenciado exclusivamente pelo ADMIN (catálogo global)
    'medicamentos.catalogo.ler':      'NENHUM',
    'medicamentos.catalogo.criar':    'NENHUM',
    'medicamentos.catalogo.editar':   'NENHUM',
    'medicamentos.catalogo.deletar':  'NENHUM',
    'medicamentos.catalogo.imprimir': 'NENHUM',

    // Procedimentos — gerenciado exclusivamente pelo ADMIN (catálogo global)
    'procedimentos.catalogo.ler':      'NENHUM',
    'procedimentos.catalogo.criar':    'NENHUM',
    'procedimentos.catalogo.editar':   'NENHUM',
    'procedimentos.catalogo.deletar':  'NENHUM',
    'procedimentos.catalogo.imprimir': 'NENHUM',
  },

  // Secretaria — recepção, agendamentos, cadastros e financeiro básico
  SECRETARIA: {
    'relatorios.gerencial.ler': 'NENHUM',
    'cadastro.proprietario.ler':     'EQUIPE',
    'cadastro.proprietario.criar':   'PROPRIO',
    'cadastro.proprietario.editar':  'PROPRIO',
    'cadastro.proprietario.deletar': 'NENHUM',
    'cadastro.proprietario.ativar':  'PROPRIO',
    'cadastro.tratador.ler':     'EQUIPE',
    'cadastro.tratador.criar':   'PROPRIO',
    'cadastro.tratador.editar':  'PROPRIO',
    'cadastro.tratador.deletar': 'NENHUM',
    'cadastro.tratador.ativar':  'PROPRIO',
    'cadastro.fornecedor.ler':     'EQUIPE',
    'cadastro.fornecedor.criar':   'NENHUM',
    'cadastro.fornecedor.editar':  'NENHUM',
    'cadastro.fornecedor.deletar': 'NENHUM',
    'cadastro.fornecedor.ativar':  'NENHUM',
    'cadastro.localizacao.ler':    'LEITURA',
    'cadastro.localizacao.criar':  'NENHUM',
    'cadastro.localizacao.editar': 'PROPRIO',
    'cadastro.localizacao.ativar': 'PROPRIO',

    'dashboard.geral.ler':      'LEITURA',
    'dashboard.geral.imprimir': 'NENHUM',

    'animais.ler':         'EQUIPE',
    'animais.criar':       'NENHUM',
    'animais.editar':      'NENHUM',
    'animais.deletar':     'NENHUM',
    'animais.imprimir':    'EQUIPE',
    'animais.desvincular': 'NENHUM',

    'atendimento.evolucoes.ler':       'EQUIPE',
    'atendimento.evolucoes.criar':     'NENHUM',
    'atendimento.evolucoes.editar':    'NENHUM',
    'atendimento.evolucoes.deletar':   'NENHUM',
    'atendimento.evolucoes.imprimir':  'EQUIPE',
    'atendimento.evolucoes.finalizar': 'NENHUM',

    'atendimento.prescricoes.ler':       'EQUIPE',
    'atendimento.prescricoes.criar':     'NENHUM',
    'atendimento.prescricoes.editar':    'NENHUM',
    'atendimento.prescricoes.deletar':   'NENHUM',
    'atendimento.prescricoes.imprimir':  'EQUIPE',
    'atendimento.prescricoes.finalizar': 'NENHUM',

    'atendimento.vacinas.ler':       'EQUIPE',
    'atendimento.vacinas.criar':     'NENHUM',
    'atendimento.vacinas.editar':    'NENHUM',
    'atendimento.vacinas.deletar':   'NENHUM',
    'atendimento.vacinas.imprimir':  'EQUIPE',
    'atendimento.vacinas.finalizar': 'NENHUM',

    'atendimento.encaminhamentos.ler':        'EQUIPE',
    'atendimento.encaminhamentos.criar':      'NENHUM',
    'atendimento.encaminhamentos.editar':     'NENHUM',
    'atendimento.encaminhamentos.deletar':    'NENHUM',
    'atendimento.encaminhamentos.imprimir':   'NENHUM',
    'atendimento.encaminhamentos.finalizar':  'NENHUM',

    'atendimento.exames.ler':       'EQUIPE',
    'atendimento.exames.criar':     'NENHUM',
    'atendimento.exames.editar':    'NENHUM',
    'atendimento.exames.deletar':   'NENHUM',
    'atendimento.exames.imprimir':  'NENHUM',
    'atendimento.exames.finalizar': 'NENHUM',

    'atendimento.agendamentos.ler':               'EQUIPE',
    'atendimento.agendamentos.criar':             'EQUIPE',
    'atendimento.agendamentos.editar':            'EQUIPE',
    'atendimento.agendamentos.concluir':          'EQUIPE',
    'atendimento.agendamentos.trocar_profissional': 'EQUIPE',
    'atendimento.agendamentos.deletar':           'PROPRIO',

    'agendamento.ler':                  'EQUIPE',
    'agendamento.confirmar':            'EQUIPE',
    'agendamento.reagendar':            'EQUIPE',
    'agendamento.trocar_profissional':  'EQUIPE',
    'agendamento.cancelar':             'PROPRIO',

    'enfermagem.prescricao.ler':      'EQUIPE',
    'enfermagem.prescricao.executar': 'NENHUM',
    'enfermagem.prescricao.imprimir': 'EQUIPE',

    'exames.laboratorial.ler':     'EQUIPE',
    'exames.laboratorial.criar':   'NENHUM',
    'exames.laboratorial.editar':  'NENHUM',
    'exames.laboratorial.deletar': 'NENHUM',

    'exames.imagem.ler':     'EQUIPE',
    'exames.imagem.criar':   'NENHUM',
    'exames.imagem.editar':  'NENHUM',
    'exames.imagem.deletar': 'NENHUM',

    'nutricao.dietas.ler':          'NENHUM',
    'nutricao.dietas.criar':        'NENHUM',
    'nutricao.dietas.editar':       'NENHUM',
    'nutricao.dietas.imprimir':     'NENHUM',
    'nutricao.dietas.compartilhar': 'NENHUM',
    'nutricao.dietas.exportar':     'NENHUM',
    'nutricao.dietas.ativar':       'NENHUM',

    'nutricao.relatorios.ler':      'NENHUM',
    'nutricao.relatorios.criar':    'NENHUM',
    'nutricao.relatorios.imprimir': 'NENHUM',
    'nutricao.relatorios.exportar': 'NENHUM',

    'financeiro.faturas.ler':      'EQUIPE',
    'financeiro.faturas.criar':    'EQUIPE',
    'financeiro.faturas.editar':   'EQUIPE',
    'financeiro.faturas.imprimir': 'EQUIPE',
    'financeiro.faturas.whatsapp': 'EQUIPE',
    'financeiro.faturas.exportar': 'EQUIPE',
    'financeiro.faturas.fechar':   'PROPRIO',
    'financeiro.faturas.lancar':   'PROPRIO',

    'equipe.membros.ler':    'LEITURA',
    'equipe.membros.editar': 'NENHUM',

    'vacina.estoque.ler':      'EQUIPE',
    'vacina.estoque.criar':    'NENHUM',
    'vacina.estoque.editar':   'NENHUM',
    'vacina.estoque.deletar':  'NENHUM',
    'vacina.estoque.imprimir': 'NENHUM',

    'farmacia.estoque.ler':      'NENHUM',
    'farmacia.estoque.criar':    'NENHUM',
    'farmacia.estoque.editar':   'NENHUM',
    'farmacia.estoque.ajustar':  'NENHUM',
    'farmacia.estoque.deletar':  'NENHUM',
    'farmacia.estoque.imprimir': 'NENHUM',

    'farmacia.movimentacoes.ler':      'NENHUM',
    'farmacia.movimentacoes.criar':    'NENHUM',
    'farmacia.movimentacoes.imprimir': 'NENHUM',

    'medicamentos.catalogo.ler':      'NENHUM',
    'medicamentos.catalogo.criar':    'NENHUM',
    'medicamentos.catalogo.editar':   'NENHUM',
    'medicamentos.catalogo.deletar':  'NENHUM',
    'medicamentos.catalogo.imprimir': 'NENHUM',

    'procedimentos.catalogo.ler':      'NENHUM',
    'procedimentos.catalogo.criar':    'NENHUM',
    'procedimentos.catalogo.editar':   'NENHUM',
    'procedimentos.catalogo.deletar':  'NENHUM',
    'procedimentos.catalogo.imprimir': 'NENHUM',
  },

  // Financeiro — acesso ao módulo financeiro e visualização de clientes
  FINANCEIRO: {
    // Relatórios gerenciais — indicadores financeiros e operacionais da empresa
    'relatorios.gerencial.ler': 'EQUIPE',
    'cadastro.proprietario.ler':     'EQUIPE',
    'cadastro.proprietario.criar':   'NENHUM',
    'cadastro.proprietario.editar':  'NENHUM',
    'cadastro.proprietario.deletar': 'NENHUM',
    'cadastro.proprietario.ativar':  'NENHUM',
    'cadastro.tratador.ler':     'NENHUM',
    'cadastro.tratador.criar':   'NENHUM',
    'cadastro.tratador.editar':  'NENHUM',
    'cadastro.tratador.deletar': 'NENHUM',
    'cadastro.tratador.ativar':  'NENHUM',
    'cadastro.fornecedor.ler':     'NENHUM',
    'cadastro.fornecedor.criar':   'NENHUM',
    'cadastro.fornecedor.editar':  'NENHUM',
    'cadastro.fornecedor.deletar': 'NENHUM',
    'cadastro.fornecedor.ativar':  'NENHUM',
    'cadastro.localizacao.ler':    'NENHUM',
    'cadastro.localizacao.criar':  'NENHUM',
    'cadastro.localizacao.editar': 'NENHUM',
    'cadastro.localizacao.ativar': 'NENHUM',

    'dashboard.geral.ler':      'LEITURA',
    'dashboard.geral.imprimir': 'NENHUM',

    'animais.ler':         'LEITURA',
    'animais.criar':       'NENHUM',
    'animais.editar':      'NENHUM',
    'animais.deletar':     'NENHUM',
    'animais.imprimir':    'NENHUM',
    'animais.desvincular': 'NENHUM',

    'atendimento.evolucoes.ler':       'NENHUM',
    'atendimento.evolucoes.criar':     'NENHUM',
    'atendimento.evolucoes.editar':    'NENHUM',
    'atendimento.evolucoes.deletar':   'NENHUM',
    'atendimento.evolucoes.imprimir':  'NENHUM',
    'atendimento.evolucoes.finalizar': 'NENHUM',

    'atendimento.prescricoes.ler':       'NENHUM',
    'atendimento.prescricoes.criar':     'NENHUM',
    'atendimento.prescricoes.editar':    'NENHUM',
    'atendimento.prescricoes.deletar':   'NENHUM',
    'atendimento.prescricoes.imprimir':  'NENHUM',
    'atendimento.prescricoes.finalizar': 'NENHUM',

    'atendimento.vacinas.ler':       'NENHUM',
    'atendimento.vacinas.criar':     'NENHUM',
    'atendimento.vacinas.editar':    'NENHUM',
    'atendimento.vacinas.deletar':   'NENHUM',
    'atendimento.vacinas.imprimir':  'NENHUM',
    'atendimento.vacinas.finalizar': 'NENHUM',

    'atendimento.encaminhamentos.ler':        'NENHUM',
    'atendimento.encaminhamentos.criar':      'NENHUM',
    'atendimento.encaminhamentos.editar':     'NENHUM',
    'atendimento.encaminhamentos.deletar':    'NENHUM',
    'atendimento.encaminhamentos.imprimir':   'NENHUM',
    'atendimento.encaminhamentos.finalizar':  'NENHUM',

    'atendimento.exames.ler':       'NENHUM',
    'atendimento.exames.criar':     'NENHUM',
    'atendimento.exames.editar':    'NENHUM',
    'atendimento.exames.deletar':   'NENHUM',
    'atendimento.exames.imprimir':  'NENHUM',
    'atendimento.exames.finalizar': 'NENHUM',

    'atendimento.agendamentos.ler':               'LEITURA',
    'atendimento.agendamentos.criar':             'NENHUM',
    'atendimento.agendamentos.editar':            'NENHUM',
    'atendimento.agendamentos.concluir':          'NENHUM',
    'atendimento.agendamentos.trocar_profissional': 'NENHUM',
    'atendimento.agendamentos.deletar':           'NENHUM',

    'agendamento.ler':                  'LEITURA',
    'agendamento.confirmar':            'NENHUM',
    'agendamento.reagendar':            'NENHUM',
    'agendamento.trocar_profissional':  'NENHUM',
    'agendamento.cancelar':             'NENHUM',

    'enfermagem.prescricao.ler':      'NENHUM',
    'enfermagem.prescricao.executar': 'NENHUM',
    'enfermagem.prescricao.imprimir': 'NENHUM',

    'exames.laboratorial.ler':     'NENHUM',
    'exames.laboratorial.criar':   'NENHUM',
    'exames.laboratorial.editar':  'NENHUM',
    'exames.laboratorial.deletar': 'NENHUM',

    'exames.imagem.ler':     'NENHUM',
    'exames.imagem.criar':   'NENHUM',
    'exames.imagem.editar':  'NENHUM',
    'exames.imagem.deletar': 'NENHUM',

    'nutricao.dietas.ler':          'NENHUM',
    'nutricao.dietas.criar':        'NENHUM',
    'nutricao.dietas.editar':       'NENHUM',
    'nutricao.dietas.imprimir':     'NENHUM',
    'nutricao.dietas.compartilhar': 'NENHUM',
    'nutricao.dietas.exportar':     'NENHUM',
    'nutricao.dietas.ativar':       'NENHUM',

    'nutricao.relatorios.ler':      'NENHUM',
    'nutricao.relatorios.criar':    'NENHUM',
    'nutricao.relatorios.imprimir': 'NENHUM',
    'nutricao.relatorios.exportar': 'NENHUM',

    'financeiro.faturas.ler':      'EQUIPE',
    'financeiro.faturas.criar':    'EQUIPE',
    'financeiro.faturas.editar':   'EQUIPE',
    'financeiro.faturas.imprimir': 'EQUIPE',
    'financeiro.faturas.whatsapp': 'EQUIPE',
    'financeiro.faturas.exportar': 'EQUIPE',
    'financeiro.faturas.fechar':   'EQUIPE',
    'financeiro.faturas.lancar':   'EQUIPE',

    'equipe.membros.ler':    'LEITURA',
    'equipe.membros.editar': 'NENHUM',

    'vacina.estoque.ler':      'NENHUM',
    'vacina.estoque.criar':    'NENHUM',
    'vacina.estoque.editar':   'NENHUM',
    'vacina.estoque.deletar':  'NENHUM',
    'vacina.estoque.imprimir': 'NENHUM',

    'farmacia.estoque.ler':      'NENHUM',
    'farmacia.estoque.criar':    'NENHUM',
    'farmacia.estoque.editar':   'NENHUM',
    'farmacia.estoque.ajustar':  'NENHUM',
    'farmacia.estoque.deletar':  'NENHUM',
    'farmacia.estoque.imprimir': 'NENHUM',

    'farmacia.movimentacoes.ler':      'NENHUM',
    'farmacia.movimentacoes.criar':    'NENHUM',
    'farmacia.movimentacoes.imprimir': 'NENHUM',

    'medicamentos.catalogo.ler':      'NENHUM',
    'medicamentos.catalogo.criar':    'NENHUM',
    'medicamentos.catalogo.editar':   'NENHUM',
    'medicamentos.catalogo.deletar':  'NENHUM',
    'medicamentos.catalogo.imprimir': 'NENHUM',

    'procedimentos.catalogo.ler':      'NENHUM',
    'procedimentos.catalogo.criar':    'NENHUM',
    'procedimentos.catalogo.editar':   'NENHUM',
    'procedimentos.catalogo.deletar':  'NENHUM',
    'procedimentos.catalogo.imprimir': 'NENHUM',
  },

  // Enfermeiro — execução de prescrições, vacinas, evoluções e cuidados diretos
  ENFERMEIRO: {
    'relatorios.gerencial.ler': 'NENHUM',
    'cadastro.proprietario.ler':     'EQUIPE',
    'cadastro.proprietario.criar':   'NENHUM',
    'cadastro.proprietario.editar':  'NENHUM',
    'cadastro.proprietario.deletar': 'NENHUM',
    'cadastro.proprietario.ativar':  'NENHUM',
    'cadastro.tratador.ler':     'EQUIPE',
    'cadastro.tratador.criar':   'NENHUM',
    'cadastro.tratador.editar':  'NENHUM',
    'cadastro.tratador.deletar': 'NENHUM',
    'cadastro.tratador.ativar':  'NENHUM',
    'cadastro.fornecedor.ler':     'NENHUM',
    'cadastro.fornecedor.criar':   'NENHUM',
    'cadastro.fornecedor.editar':  'NENHUM',
    'cadastro.fornecedor.deletar': 'NENHUM',
    'cadastro.fornecedor.ativar':  'NENHUM',
    'cadastro.localizacao.ler':    'LEITURA',
    'cadastro.localizacao.criar':  'NENHUM',
    'cadastro.localizacao.editar': 'NENHUM',
    'cadastro.localizacao.ativar': 'NENHUM',

    'dashboard.geral.ler':      'LEITURA',
    'dashboard.geral.imprimir': 'NENHUM',

    'animais.ler':         'EQUIPE',
    'animais.criar':       'NENHUM',
    'animais.editar':      'NENHUM',
    'animais.deletar':     'NENHUM',
    'animais.imprimir':    'EQUIPE',
    'animais.desvincular': 'NENHUM',

    'atendimento.evolucoes.ler':       'EQUIPE',
    'atendimento.evolucoes.criar':     'PROPRIO',
    'atendimento.evolucoes.editar':    'PROPRIO',
    'atendimento.evolucoes.deletar':   'NENHUM',
    'atendimento.evolucoes.imprimir':  'EQUIPE',
    'atendimento.evolucoes.finalizar': 'NENHUM',

    'atendimento.prescricoes.ler':       'EQUIPE',
    'atendimento.prescricoes.criar':     'NENHUM',
    'atendimento.prescricoes.editar':    'NENHUM',
    'atendimento.prescricoes.deletar':   'NENHUM',
    'atendimento.prescricoes.imprimir':  'EQUIPE',
    'atendimento.prescricoes.finalizar': 'NENHUM',

    'atendimento.vacinas.ler':       'EQUIPE',
    'atendimento.vacinas.criar':     'PROPRIO',
    'atendimento.vacinas.editar':    'PROPRIO',
    'atendimento.vacinas.deletar':   'NENHUM',
    'atendimento.vacinas.imprimir':  'EQUIPE',
    'atendimento.vacinas.finalizar': 'NENHUM',

    'atendimento.encaminhamentos.ler':        'EQUIPE',
    'atendimento.encaminhamentos.criar':      'NENHUM',
    'atendimento.encaminhamentos.editar':     'NENHUM',
    'atendimento.encaminhamentos.deletar':    'NENHUM',
    'atendimento.encaminhamentos.imprimir':   'NENHUM',
    'atendimento.encaminhamentos.finalizar':  'NENHUM',

    'atendimento.exames.ler':       'EQUIPE',
    'atendimento.exames.criar':     'PROPRIO',
    'atendimento.exames.editar':    'PROPRIO',
    'atendimento.exames.deletar':   'NENHUM',
    'atendimento.exames.imprimir':  'EQUIPE',
    'atendimento.exames.finalizar': 'NENHUM',

    'atendimento.agendamentos.ler':               'EQUIPE',
    'atendimento.agendamentos.criar':             'NENHUM',
    'atendimento.agendamentos.editar':            'NENHUM',
    'atendimento.agendamentos.concluir':          'NENHUM',
    'atendimento.agendamentos.trocar_profissional': 'NENHUM',
    'atendimento.agendamentos.deletar':           'NENHUM',

    'agendamento.ler':                  'LEITURA',
    'agendamento.confirmar':            'NENHUM',
    'agendamento.reagendar':            'NENHUM',
    'agendamento.trocar_profissional':  'NENHUM',
    'agendamento.cancelar':             'NENHUM',

    'enfermagem.prescricao.ler':      'EQUIPE',
    'enfermagem.prescricao.executar': 'EQUIPE',
    'enfermagem.prescricao.imprimir': 'EQUIPE',

    'exames.laboratorial.ler':     'EQUIPE',
    'exames.laboratorial.criar':   'PROPRIO',
    'exames.laboratorial.editar':  'PROPRIO',
    'exames.laboratorial.deletar': 'NENHUM',

    'exames.imagem.ler':     'EQUIPE',
    'exames.imagem.criar':   'PROPRIO',
    'exames.imagem.editar':  'PROPRIO',
    'exames.imagem.deletar': 'NENHUM',

    'nutricao.dietas.ler':          'EQUIPE',
    'nutricao.dietas.criar':        'NENHUM',
    'nutricao.dietas.editar':       'NENHUM',
    'nutricao.dietas.imprimir':     'EQUIPE',
    'nutricao.dietas.compartilhar': 'NENHUM',
    'nutricao.dietas.exportar':     'NENHUM',
    'nutricao.dietas.ativar':       'NENHUM',

    'nutricao.relatorios.ler':      'EQUIPE',
    'nutricao.relatorios.criar':    'NENHUM',
    'nutricao.relatorios.imprimir': 'EQUIPE',
    'nutricao.relatorios.exportar': 'NENHUM',

    'financeiro.faturas.ler':      'NENHUM',
    'financeiro.faturas.criar':    'NENHUM',
    'financeiro.faturas.editar':   'NENHUM',
    'financeiro.faturas.imprimir': 'NENHUM',
    'financeiro.faturas.whatsapp': 'NENHUM',
    'financeiro.faturas.exportar': 'NENHUM',
    'financeiro.faturas.fechar':   'NENHUM',
    'financeiro.faturas.lancar':   'NENHUM',

    'equipe.membros.ler':    'LEITURA',
    'equipe.membros.editar': 'NENHUM',

    'vacina.estoque.ler':      'EQUIPE',
    'vacina.estoque.criar':    'PROPRIO',
    'vacina.estoque.editar':   'PROPRIO',
    'vacina.estoque.deletar':  'NENHUM',
    'vacina.estoque.imprimir': 'EQUIPE',

    'farmacia.estoque.ler':      'EQUIPE',
    'farmacia.estoque.criar':    'PROPRIO',
    'farmacia.estoque.editar':   'PROPRIO',
    'farmacia.estoque.ajustar':  'PROPRIO',
    'farmacia.estoque.deletar':  'NENHUM',
    'farmacia.estoque.imprimir': 'EQUIPE',

    'farmacia.movimentacoes.ler':      'EQUIPE',
    'farmacia.movimentacoes.criar':    'PROPRIO',
    'farmacia.movimentacoes.imprimir': 'EQUIPE',

    'medicamentos.catalogo.ler':      'NENHUM',
    'medicamentos.catalogo.criar':    'NENHUM',
    'medicamentos.catalogo.editar':   'NENHUM',
    'medicamentos.catalogo.deletar':  'NENHUM',
    'medicamentos.catalogo.imprimir': 'NENHUM',

    'procedimentos.catalogo.ler':      'NENHUM',
    'procedimentos.catalogo.criar':    'NENHUM',
    'procedimentos.catalogo.editar':   'NENHUM',
    'procedimentos.catalogo.deletar':  'NENHUM',
    'procedimentos.catalogo.imprimir': 'NENHUM',
  },
};

// Definição dos módulos do sistema — sincronizada com ModuloSistema na DB.
// Cada entrada vira um registro em tb_modulos_sistema.
const MODULOS_SISTEMA = [
  // ── Cadastro — Proprietário ──────────────────────────────────────────────────
  { slug: 'cadastro.proprietario.ler',     modulo: 'cadastro', submodulo: 'proprietario', acao: 'ler',     label: 'Proprietários — Visualizar',    ordemExib:  5 },
  { slug: 'cadastro.proprietario.criar',   modulo: 'cadastro', submodulo: 'proprietario', acao: 'criar',   label: 'Proprietários — Cadastrar',     ordemExib:  6 },
  { slug: 'cadastro.proprietario.editar',  modulo: 'cadastro', submodulo: 'proprietario', acao: 'editar',  label: 'Proprietários — Editar',        ordemExib:  7 },
  { slug: 'cadastro.proprietario.deletar', modulo: 'cadastro', submodulo: 'proprietario', acao: 'deletar', label: 'Proprietários — Excluir',       ordemExib:  8 },
  { slug: 'cadastro.proprietario.ativar',  modulo: 'cadastro', submodulo: 'proprietario', acao: 'ativar',  label: 'Proprietários — Ativar/Inativar', ordemExib: 8.5 },

  // ── Cadastro — Tratador ──────────────────────────────────────────────────────
  { slug: 'cadastro.tratador.ler',     modulo: 'cadastro', submodulo: 'tratador', acao: 'ler',     label: 'Tratadores — Visualizar',    ordemExib:  9 },
  { slug: 'cadastro.tratador.criar',   modulo: 'cadastro', submodulo: 'tratador', acao: 'criar',   label: 'Tratadores — Cadastrar',     ordemExib: 10 },
  { slug: 'cadastro.tratador.editar',  modulo: 'cadastro', submodulo: 'tratador', acao: 'editar',  label: 'Tratadores — Editar',        ordemExib: 11 },
  { slug: 'cadastro.tratador.deletar', modulo: 'cadastro', submodulo: 'tratador', acao: 'deletar', label: 'Tratadores — Excluir',       ordemExib: 12 },
  { slug: 'cadastro.tratador.ativar',  modulo: 'cadastro', submodulo: 'tratador', acao: 'ativar',  label: 'Tratadores — Ativar/Inativar', ordemExib: 12.5 },

  // ── Cadastro — Fornecedor ────────────────────────────────────────────────────
  { slug: 'cadastro.fornecedor.ler',     modulo: 'cadastro', submodulo: 'fornecedor', acao: 'ler',     label: 'Fornecedores — Visualizar',    ordemExib: 13 },
  { slug: 'cadastro.fornecedor.criar',   modulo: 'cadastro', submodulo: 'fornecedor', acao: 'criar',   label: 'Fornecedores — Cadastrar',     ordemExib: 14 },
  { slug: 'cadastro.fornecedor.editar',  modulo: 'cadastro', submodulo: 'fornecedor', acao: 'editar',  label: 'Fornecedores — Editar',        ordemExib: 15 },
  { slug: 'cadastro.fornecedor.deletar', modulo: 'cadastro', submodulo: 'fornecedor', acao: 'deletar', label: 'Fornecedores — Excluir',       ordemExib: 16 },
  { slug: 'cadastro.fornecedor.ativar',  modulo: 'cadastro', submodulo: 'fornecedor', acao: 'ativar',  label: 'Fornecedores — Ativar/Inativar', ordemExib: 16.5 },

  // ── Cadastro — Localização de Animal ────────────────────────────────────────
  // Tabela global (não por empresa). Edição/inativação restritas ao ADMIN (enforced no controller).
  { slug: 'cadastro.localizacao.ler',    modulo: 'cadastro', submodulo: 'localizacao', acao: 'ler',    label: 'Localização — Visualizar',    ordemExib: 17 },
  { slug: 'cadastro.localizacao.criar',  modulo: 'cadastro', submodulo: 'localizacao', acao: 'criar',  label: 'Localização — Cadastrar',     ordemExib: 18 },
  { slug: 'cadastro.localizacao.editar', modulo: 'cadastro', submodulo: 'localizacao', acao: 'editar', label: 'Localização — Editar',        ordemExib: 18.5 },
  { slug: 'cadastro.localizacao.ativar', modulo: 'cadastro', submodulo: 'localizacao', acao: 'ativar', label: 'Localização — Ativar/Inativar', ordemExib: 18.7 },

  // ── Dashboard ───────────────────────────────────────────────────────────────
  { slug: 'dashboard.geral.ler',      modulo: 'dashboard', submodulo: 'geral', acao: 'ler',      label: 'Dashboard — Visualizar',  ordemExib:  1 },
  { slug: 'dashboard.geral.imprimir', modulo: 'dashboard', submodulo: 'geral', acao: 'imprimir', label: 'Dashboard — Imprimir',    ordemExib:  2 },

  // ── Animais ─────────────────────────────────────────────────────────────────
  { slug: 'animais.ler',         modulo: 'animais', submodulo: 'animais', acao: 'ler',         label: 'Animais — Visualizar',    ordemExib: 10 },
  { slug: 'animais.criar',       modulo: 'animais', submodulo: 'animais', acao: 'criar',       label: 'Animais — Cadastrar',     ordemExib: 11 },
  { slug: 'animais.editar',      modulo: 'animais', submodulo: 'animais', acao: 'editar',      label: 'Animais — Editar',        ordemExib: 12 },
  { slug: 'animais.deletar',     modulo: 'animais', submodulo: 'animais', acao: 'deletar',     label: 'Animais — Excluir',       ordemExib: 13 },
  { slug: 'animais.imprimir',    modulo: 'animais', submodulo: 'animais', acao: 'imprimir',    label: 'Animais — Imprimir',      ordemExib: 14 },
  { slug: 'animais.desvincular', modulo: 'animais', submodulo: 'animais', acao: 'desvincular', label: 'Animais — Desvincular Vet', ordemExib: 15 },
  { slug: 'animais.resenha.editar', modulo: 'animais', submodulo: 'resenha', acao: 'editar', label: 'Resenha — Editar', ordemExib: 15.5 },

  // ── Prontuário / Evoluções ──────────────────────────────────────────────────
  { slug: 'atendimento.evolucoes.ler',       modulo: 'atendimento', submodulo: 'evolucoes', acao: 'ler',       label: 'Evolução — Visualizar', ordemExib: 20 },
  { slug: 'atendimento.evolucoes.criar',     modulo: 'atendimento', submodulo: 'evolucoes', acao: 'criar',     label: 'Evolução — Inserir',    ordemExib: 21 },
  { slug: 'atendimento.evolucoes.editar',    modulo: 'atendimento', submodulo: 'evolucoes', acao: 'editar',    label: 'Evolução — Editar',     ordemExib: 22 },
  { slug: 'atendimento.evolucoes.deletar',   modulo: 'atendimento', submodulo: 'evolucoes', acao: 'deletar',   label: 'Evolução — Excluir',    ordemExib: 23 },
  { slug: 'atendimento.evolucoes.imprimir',  modulo: 'atendimento', submodulo: 'evolucoes', acao: 'imprimir',  label: 'Evolução — Imprimir',   ordemExib: 24 },
  { slug: 'atendimento.evolucoes.finalizar', modulo: 'atendimento', submodulo: 'evolucoes', acao: 'finalizar', label: 'Evolução — Finalizar',  ordemExib: 25 },

  // ── Prescrições ─────────────────────────────────────────────────────────────
  { slug: 'atendimento.prescricoes.ler',       modulo: 'atendimento', submodulo: 'prescricoes', acao: 'ler',       label: 'Prescrições — Visualizar', ordemExib: 30 },
  { slug: 'atendimento.prescricoes.criar',     modulo: 'atendimento', submodulo: 'prescricoes', acao: 'criar',     label: 'Prescrições — Inserir',    ordemExib: 31 },
  { slug: 'atendimento.prescricoes.editar',    modulo: 'atendimento', submodulo: 'prescricoes', acao: 'editar',    label: 'Prescrições — Editar',     ordemExib: 32 },
  { slug: 'atendimento.prescricoes.deletar',   modulo: 'atendimento', submodulo: 'prescricoes', acao: 'deletar',   label: 'Prescrições — Excluir',    ordemExib: 33 },
  { slug: 'atendimento.prescricoes.imprimir',  modulo: 'atendimento', submodulo: 'prescricoes', acao: 'imprimir',  label: 'Prescrições — Imprimir',   ordemExib: 34 },
  { slug: 'atendimento.prescricoes.finalizar', modulo: 'atendimento', submodulo: 'prescricoes', acao: 'finalizar', label: 'Prescrições — Finalizar',  ordemExib: 35 },

  // ── Vacinas ──────────────────────────────────────────────────────────────────
  { slug: 'atendimento.vacinas.ler',       modulo: 'atendimento', submodulo: 'vacinas', acao: 'ler',       label: 'Vacinas — Visualizar', ordemExib: 36 },
  { slug: 'atendimento.vacinas.criar',     modulo: 'atendimento', submodulo: 'vacinas', acao: 'criar',     label: 'Vacinas — Inserir',    ordemExib: 37 },
  { slug: 'atendimento.vacinas.editar',    modulo: 'atendimento', submodulo: 'vacinas', acao: 'editar',    label: 'Vacinas — Editar',     ordemExib: 38 },
  { slug: 'atendimento.vacinas.deletar',   modulo: 'atendimento', submodulo: 'vacinas', acao: 'deletar',   label: 'Vacinas — Excluir',    ordemExib: 39 },
  { slug: 'atendimento.vacinas.imprimir',  modulo: 'atendimento', submodulo: 'vacinas', acao: 'imprimir',  label: 'Vacinas — Imprimir',   ordemExib: 39.2 },
  { slug: 'atendimento.vacinas.finalizar', modulo: 'atendimento', submodulo: 'vacinas', acao: 'finalizar', label: 'Vacinas — Finalizar',  ordemExib: 39.4 },

  // ── Encaminhamentos ──────────────────────────────────────────────────────────
  { slug: 'atendimento.encaminhamentos.ler',       modulo: 'atendimento', submodulo: 'encaminhamentos', acao: 'ler',       label: 'Encaminhamentos — Visualizar', ordemExib: 39.5 },
  { slug: 'atendimento.encaminhamentos.criar',     modulo: 'atendimento', submodulo: 'encaminhamentos', acao: 'criar',     label: 'Encaminhamentos — Inserir',    ordemExib: 39.6 },
  { slug: 'atendimento.encaminhamentos.editar',    modulo: 'atendimento', submodulo: 'encaminhamentos', acao: 'editar',    label: 'Encaminhamentos — Editar',     ordemExib: 39.7 },
  { slug: 'atendimento.encaminhamentos.deletar',   modulo: 'atendimento', submodulo: 'encaminhamentos', acao: 'deletar',   label: 'Encaminhamentos — Excluir',    ordemExib: 39.8 },
  { slug: 'atendimento.encaminhamentos.imprimir',  modulo: 'atendimento', submodulo: 'encaminhamentos', acao: 'imprimir',  label: 'Encaminhamentos — Imprimir',   ordemExib: 39.9 },
  { slug: 'atendimento.encaminhamentos.finalizar', modulo: 'atendimento', submodulo: 'encaminhamentos', acao: 'finalizar', label: 'Encaminhamentos — Finalizar',  ordemExib: 39.95 },

  // ── Agendamento — Portal standalone (/agendamentos) ─────────────────────────
  { slug: 'agendamento.ler',                   modulo: 'agendamento', submodulo: 'agendamento', acao: 'ler',                  label: 'Agendamento — Visualizar',        ordemExib: 39.80 },
  { slug: 'agendamento.confirmar',             modulo: 'agendamento', submodulo: 'agendamento', acao: 'confirmar',            label: 'Agendamento — Confirmar',         ordemExib: 39.81 },
  { slug: 'agendamento.reagendar',             modulo: 'agendamento', submodulo: 'agendamento', acao: 'reagendar',            label: 'Agendamento — Reagendar',         ordemExib: 39.82 },
  { slug: 'agendamento.trocar_profissional',   modulo: 'agendamento', submodulo: 'agendamento', acao: 'trocar_profissional',  label: 'Agendamento — Trocar Profissional', ordemExib: 39.83 },
  { slug: 'agendamento.cancelar',              modulo: 'agendamento', submodulo: 'agendamento', acao: 'cancelar',             label: 'Agendamento — Cancelar',          ordemExib: 39.84 },

  // ── Agenda — dentro de Atendimento (/clinica/agenda) ─────────────────────────
  { slug: 'atendimento.agendamentos.ler',               modulo: 'atendimento', submodulo: 'agendamentos', acao: 'ler',                  label: 'Agenda — Visualizar',         ordemExib: 39.91 },
  { slug: 'atendimento.agendamentos.criar',             modulo: 'atendimento', submodulo: 'agendamentos', acao: 'criar',                label: 'Agenda — Inserir',            ordemExib: 39.92 },
  { slug: 'atendimento.agendamentos.editar',            modulo: 'atendimento', submodulo: 'agendamentos', acao: 'editar',               label: 'Agenda — Editar',             ordemExib: 39.93 },
  { slug: 'atendimento.agendamentos.concluir',          modulo: 'atendimento', submodulo: 'agendamentos', acao: 'concluir',             label: 'Agenda — Concluir',           ordemExib: 39.935 },
  { slug: 'atendimento.agendamentos.trocar_profissional', modulo: 'atendimento', submodulo: 'agendamentos', acao: 'trocar_profissional', label: 'Agenda — Trocar Profissional', ordemExib: 39.94 },
  { slug: 'atendimento.agendamentos.deletar',           modulo: 'atendimento', submodulo: 'agendamentos', acao: 'deletar',              label: 'Agenda — Cancelar',           ordemExib: 39.95 },

  // ── Exames (clínicos/nutricionais) ───────────────────────────────────────────
  { slug: 'atendimento.exames.ler',       modulo: 'atendimento', submodulo: 'exames', acao: 'ler',       label: 'Exames — Visualizar', ordemExib: 40 },
  { slug: 'atendimento.exames.criar',     modulo: 'atendimento', submodulo: 'exames', acao: 'criar',     label: 'Exames — Inserir',    ordemExib: 41 },
  { slug: 'atendimento.exames.editar',    modulo: 'atendimento', submodulo: 'exames', acao: 'editar',    label: 'Exames — Editar',     ordemExib: 42 },
  { slug: 'atendimento.exames.deletar',   modulo: 'atendimento', submodulo: 'exames', acao: 'deletar',   label: 'Exames — Excluir',    ordemExib: 43 },
  { slug: 'atendimento.exames.imprimir',  modulo: 'atendimento', submodulo: 'exames', acao: 'imprimir',  label: 'Exames — Imprimir',   ordemExib: 44 },
  { slug: 'atendimento.exames.finalizar', modulo: 'atendimento', submodulo: 'exames', acao: 'finalizar', label: 'Exames — Finalizar',  ordemExib: 44.2 },

  // ── Enfermagem — Execução de Prescrição ─────────────────────────────────────
  { slug: 'enfermagem.prescricao.ler',      modulo: 'enfermagem', submodulo: 'prescricao', acao: 'ler',      label: 'Enfermagem — Visualizar', ordemExib: 45 },
  { slug: 'enfermagem.prescricao.executar', modulo: 'enfermagem', submodulo: 'prescricao', acao: 'executar', label: 'Enfermagem — Executar',   ordemExib: 46 },
  { slug: 'enfermagem.prescricao.imprimir', modulo: 'enfermagem', submodulo: 'prescricao', acao: 'imprimir', label: 'Enfermagem — Imprimir',   ordemExib: 47 },

  // ── Exames — Laboratorial ───────────────────────────────────────────────────
  { slug: 'exames.laboratorial.ler',     modulo: 'exames', submodulo: 'laboratorial', acao: 'ler',     label: 'Laboratorial — Visualizar', ordemExib: 48 },
  { slug: 'exames.laboratorial.criar',   modulo: 'exames', submodulo: 'laboratorial', acao: 'criar',   label: 'Laboratorial — Inserir',    ordemExib: 48.2 },
  { slug: 'exames.laboratorial.editar',  modulo: 'exames', submodulo: 'laboratorial', acao: 'editar',  label: 'Laboratorial — Editar',     ordemExib: 48.4 },
  { slug: 'exames.laboratorial.deletar', modulo: 'exames', submodulo: 'laboratorial', acao: 'deletar', label: 'Laboratorial — Excluir',    ordemExib: 48.6 },

  // ── Exames — Imagem ─────────────────────────────────────────────────────────
  { slug: 'exames.imagem.ler',     modulo: 'exames', submodulo: 'imagem', acao: 'ler',     label: 'Imagem — Visualizar', ordemExib: 49 },
  { slug: 'exames.imagem.criar',   modulo: 'exames', submodulo: 'imagem', acao: 'criar',   label: 'Imagem — Inserir',    ordemExib: 49.2 },
  { slug: 'exames.imagem.editar',  modulo: 'exames', submodulo: 'imagem', acao: 'editar',  label: 'Imagem — Editar',     ordemExib: 49.4 },
  { slug: 'exames.imagem.deletar', modulo: 'exames', submodulo: 'imagem', acao: 'deletar', label: 'Imagem — Excluir',    ordemExib: 49.6 },

  // ── Nutrição — Dietas ───────────────────────────────────────────────────────
  { slug: 'nutricao.dietas.ler',          modulo: 'nutricao', submodulo: 'dietas', acao: 'ler',          label: 'Dietas — Visualizar',    ordemExib: 50 },
  { slug: 'nutricao.dietas.criar',        modulo: 'nutricao', submodulo: 'dietas', acao: 'criar',        label: 'Dietas — Criar',         ordemExib: 51 },
  { slug: 'nutricao.dietas.editar',       modulo: 'nutricao', submodulo: 'dietas', acao: 'editar',       label: 'Dietas — Editar',        ordemExib: 52 },
  { slug: 'nutricao.dietas.imprimir',     modulo: 'nutricao', submodulo: 'dietas', acao: 'imprimir',     label: 'Dietas — Imprimir',      ordemExib: 53 },
  { slug: 'nutricao.dietas.compartilhar', modulo: 'nutricao', submodulo: 'dietas', acao: 'compartilhar', label: 'Dietas — Compartilhar',  ordemExib: 53.2 },
  { slug: 'nutricao.dietas.exportar',     modulo: 'nutricao', submodulo: 'dietas', acao: 'exportar',     label: 'Dietas — Exportar',      ordemExib: 53.4 },
  { slug: 'nutricao.dietas.ativar',       modulo: 'nutricao', submodulo: 'dietas', acao: 'ativar',       label: 'Dietas — Ativar/Inativar', ordemExib: 53.6 },

  // ── Nutrição — Relatórios ───────────────────────────────────────────────────
  { slug: 'nutricao.relatorios.ler',      modulo: 'nutricao', submodulo: 'relatorios', acao: 'ler',      label: 'Relatórios — Visualizar', ordemExib: 60 },
  { slug: 'nutricao.relatorios.criar',    modulo: 'nutricao', submodulo: 'relatorios', acao: 'criar',    label: 'Relatórios — Gerar',      ordemExib: 61 },
  { slug: 'nutricao.relatorios.imprimir', modulo: 'nutricao', submodulo: 'relatorios', acao: 'imprimir', label: 'Relatórios — Imprimir',   ordemExib: 62 },
  { slug: 'nutricao.relatorios.exportar', modulo: 'nutricao', submodulo: 'relatorios', acao: 'exportar', label: 'Relatórios — Exportar',   ordemExib: 63 },

  // ── Financeiro ──────────────────────────────────────────────────────────────
  { slug: 'financeiro.faturas.ler',      modulo: 'financeiro', submodulo: 'faturas', acao: 'ler',      label: 'Faturas — Visualizar',       ordemExib: 70 },
  { slug: 'financeiro.faturas.criar',    modulo: 'financeiro', submodulo: 'faturas', acao: 'criar',    label: 'Faturas — Criar',            ordemExib: 71 },
  { slug: 'financeiro.faturas.editar',   modulo: 'financeiro', submodulo: 'faturas', acao: 'editar',   label: 'Faturas — Editar',           ordemExib: 72 },
  { slug: 'financeiro.faturas.imprimir', modulo: 'financeiro', submodulo: 'faturas', acao: 'imprimir', label: 'Faturas — Imprimir',         ordemExib: 73 },
  { slug: 'financeiro.faturas.whatsapp', modulo: 'financeiro', submodulo: 'faturas', acao: 'whatsapp', label: 'Faturas — WhatsApp',         ordemExib: 73.2 },
  { slug: 'financeiro.faturas.exportar', modulo: 'financeiro', submodulo: 'faturas', acao: 'exportar', label: 'Faturas — Exportar',         ordemExib: 73.4 },
  { slug: 'financeiro.faturas.fechar',   modulo: 'financeiro', submodulo: 'faturas', acao: 'fechar',   label: 'Faturas — Fechar Fatura',    ordemExib: 73.6 },
  { slug: 'financeiro.faturas.lancar',   modulo: 'financeiro', submodulo: 'faturas', acao: 'lancar',   label: 'Faturas — Lançar Cobrança',  ordemExib: 73.8 },

  // ── Equipe ──────────────────────────────────────────────────────────────────
  { slug: 'equipe.membros.ler',    modulo: 'equipe', submodulo: 'membros', acao: 'ler',    label: 'Equipe — Visualizar', ordemExib: 80 },
  { slug: 'equipe.membros.editar', modulo: 'equipe', submodulo: 'membros', acao: 'editar', label: 'Equipe — Gerenciar',  ordemExib: 81 },

  // ── Vacina — Estoque ────────────────────────────────────────────────────────
  { slug: 'vacina.estoque.ler',      modulo: 'vacina', submodulo: 'estoque', acao: 'ler',      label: 'Vacina Estoque — Visualizar', ordemExib: 82 },
  { slug: 'vacina.estoque.criar',    modulo: 'vacina', submodulo: 'estoque', acao: 'criar',    label: 'Vacina Estoque — Cadastrar',  ordemExib: 83 },
  { slug: 'vacina.estoque.editar',   modulo: 'vacina', submodulo: 'estoque', acao: 'editar',   label: 'Vacina Estoque — Editar',     ordemExib: 83.5 },
  { slug: 'vacina.estoque.deletar',  modulo: 'vacina', submodulo: 'estoque', acao: 'deletar',  label: 'Vacina Estoque — Excluir',    ordemExib: 84 },
  { slug: 'vacina.estoque.imprimir', modulo: 'vacina', submodulo: 'estoque', acao: 'imprimir', label: 'Vacina Estoque — Imprimir',   ordemExib: 84.5 },

  // ── Farmácia — Estoque ──────────────────────────────────────────────────────
  { slug: 'farmacia.estoque.ler',      modulo: 'farmacia', submodulo: 'estoque', acao: 'ler',      label: 'Estoque — Visualizar', ordemExib: 85 },
  { slug: 'farmacia.estoque.criar',    modulo: 'farmacia', submodulo: 'estoque', acao: 'criar',    label: 'Estoque — Cadastrar',  ordemExib: 86 },
  { slug: 'farmacia.estoque.editar',   modulo: 'farmacia', submodulo: 'estoque', acao: 'editar',   label: 'Estoque — Editar',     ordemExib: 87 },
  { slug: 'farmacia.estoque.ajustar',  modulo: 'farmacia', submodulo: 'estoque', acao: 'ajustar',  label: 'Estoque — Ajustar',    ordemExib: 87.5 },
  { slug: 'farmacia.estoque.deletar',  modulo: 'farmacia', submodulo: 'estoque', acao: 'deletar',  label: 'Estoque — Excluir',    ordemExib: 88 },
  { slug: 'farmacia.estoque.imprimir', modulo: 'farmacia', submodulo: 'estoque', acao: 'imprimir', label: 'Estoque — Imprimir',   ordemExib: 89 },

  // ── Farmácia — Movimentações ────────────────────────────────────────────────
  { slug: 'farmacia.movimentacoes.ler',      modulo: 'farmacia', submodulo: 'movimentacoes', acao: 'ler',      label: 'Movimentações — Visualizar', ordemExib: 90 },
  { slug: 'farmacia.movimentacoes.criar',    modulo: 'farmacia', submodulo: 'movimentacoes', acao: 'criar',    label: 'Movimentações — Registrar',  ordemExib: 91 },
  { slug: 'farmacia.movimentacoes.imprimir', modulo: 'farmacia', submodulo: 'movimentacoes', acao: 'imprimir', label: 'Movimentações — Imprimir',   ordemExib: 92 },

  // ── Medicamentos — Catálogo ─────────────────────────────────────────────────
  { slug: 'medicamentos.catalogo.ler',      modulo: 'medicamentos', submodulo: 'catalogo', acao: 'ler',      label: 'Medicamentos — Visualizar', ordemExib: 95 },
  { slug: 'medicamentos.catalogo.criar',    modulo: 'medicamentos', submodulo: 'catalogo', acao: 'criar',    label: 'Medicamentos — Cadastrar',  ordemExib: 96 },
  { slug: 'medicamentos.catalogo.editar',   modulo: 'medicamentos', submodulo: 'catalogo', acao: 'editar',   label: 'Medicamentos — Editar',     ordemExib: 97 },
  { slug: 'medicamentos.catalogo.deletar',  modulo: 'medicamentos', submodulo: 'catalogo', acao: 'deletar',  label: 'Medicamentos — Excluir',    ordemExib: 98 },
  { slug: 'medicamentos.catalogo.imprimir', modulo: 'medicamentos', submodulo: 'catalogo', acao: 'imprimir', label: 'Medicamentos — Imprimir',   ordemExib: 99 },

  // ── Procedimentos — Catálogo ────────────────────────────────────────────────
  { slug: 'procedimentos.catalogo.ler',      modulo: 'procedimentos', submodulo: 'catalogo', acao: 'ler',      label: 'Procedimentos — Visualizar', ordemExib: 100 },
  { slug: 'procedimentos.catalogo.criar',    modulo: 'procedimentos', submodulo: 'catalogo', acao: 'criar',    label: 'Procedimentos — Cadastrar',  ordemExib: 101 },
  { slug: 'procedimentos.catalogo.editar',   modulo: 'procedimentos', submodulo: 'catalogo', acao: 'editar',   label: 'Procedimentos — Editar',     ordemExib: 102 },
  { slug: 'procedimentos.catalogo.deletar',  modulo: 'procedimentos', submodulo: 'catalogo', acao: 'deletar',  label: 'Procedimentos — Excluir',    ordemExib: 103 },
  { slug: 'procedimentos.catalogo.imprimir', modulo: 'procedimentos', submodulo: 'catalogo', acao: 'imprimir', label: 'Procedimentos — Imprimir',   ordemExib: 104 },

  // ── Relatórios — Gerencial ──────────────────────────────────────────────────
  { slug: 'relatorios.gerencial.ler', modulo: 'relatorios', submodulo: 'gerencial', acao: 'ler', label: 'Relatórios — Visualizar', ordemExib: 105 },
];

module.exports = { PERMISSOES_PADRAO, MODULOS_SISTEMA };