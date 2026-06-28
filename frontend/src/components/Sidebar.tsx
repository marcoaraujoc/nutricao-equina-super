// src/components/Sidebar.tsx

import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import { useEmpresa } from '../contexts/EmpresaContext';
import { useState } from 'react';
import {
  LayoutDashboard, User, Zap, ClipboardList,
  Wheat, TestTube, ChartBar, Carrot, Stethoscope,
  DollarSign, ChevronDown, LogOut, Menu, X,
  Users, Users2, ShieldCheck, FlaskConical, Pill,
  ClipboardCheck, Activity, Utensils, FileBarChart,
  FileText, Syringe, Share2, HeartPulse, Microscope, Scan,
  FolderOpen, UserCog, Truck, MapPin, Building2, CalendarClock,
  Sparkles, CalendarPlus, CalendarDays,
} from 'lucide-react';
import { useVetPendentes } from '../hooks/useVetPendentes';
import { useVetSolicitacaoMonitor } from '../hooks/useVetSolicitacaoMonitor';
import { useProprietarioNotificacoes } from '../hooks/useProprietarioNotificacoes';
import { usePermissoes } from '../hooks/usePermissoes';

// ─── Estilos ──────────────────────────────────────────────────────────────────
const CLS_MODULE_ACTIVE  = 'bg-emerald-50 text-emerald-600';
const CLS_MODULE_INACTIVE= 'text-gray-500 hover:bg-gray-50';

const ROLES_CLINICAS = ['ADMIN', 'VETERINARIO', 'ESTAGIARIO', 'FORNECEDOR'];

// ─── Detectar seção ativa ─────────────────────────────────────────────────────
type ActiveSection = 'geral' | 'agenda' | 'clinica' | 'nutricional' | 'admin' | 'farmacia' | 'vacina' | 'exames' | 'enfermagem' | 'cadastro' | 'mapa';

function detectSection(pathname: string): ActiveSection {
  if (pathname.startsWith('/mapa-atendimento'))       return 'mapa';
  if (pathname.startsWith('/agendamentos'))           return 'agenda';
  if (pathname.startsWith('/clinica'))               return 'clinica';
  if (pathname.startsWith('/execucao-prescricao'))   return 'enfermagem';
  if (pathname.startsWith('/estoque-vacina'))         return 'vacina';
  if (pathname.startsWith('/farmacia'))              return 'farmacia';
  if (pathname.startsWith('/exames'))                return 'exames';
  if (pathname.startsWith('/cadastro/') || pathname === '/equipe') return 'cadastro';
  if (pathname.startsWith('/animais-vet'))           return 'geral';
  if (pathname.startsWith('/dieta'))                 return 'nutricional';
  if (pathname.startsWith('/relatorio-nutricional')) return 'nutricional';
  if (pathname.startsWith('/alimentos'))             return 'nutricional';
  if (pathname.startsWith('/nutrientes'))            return 'nutricional';
  if (pathname.startsWith('/composicao-alimentar'))  return 'nutricional';
  if (
    pathname.startsWith('/usuarios') ||
    pathname.startsWith('/equipe-manager') ||
    pathname.startsWith('/controle-acesso') ||
    pathname.startsWith('/ai-usage') ||
    pathname.startsWith('/medicamentos') ||
    pathname.startsWith('/procedimentos') ||
    pathname.startsWith('/admin/vacinas')
  ) return 'admin';
  return 'geral';
}

export default function Sidebar() {
  const { user, logout }              = useAuth();
  const { isNewUser, selectedAnimal } = useSelectedAnimal();
  const location                      = useLocation();
  const navigate                      = useNavigate();
  const pendentesCount                = useVetPendentes();
  const { opcoes: opcoesContexto, contextoAtivo, trocarContexto } = useEmpresa();
  useVetSolicitacaoMonitor();
  useProprietarioNotificacoes();

  const role          = (user?.role      ?? user?.userType ?? '').toUpperCase();
  const userTypeUpper = (user?.userType  ?? '').toUpperCase();
  const isAdmin            = role === 'ADMIN';
  const isVet              = role === 'VETERINARIO' || userTypeUpper === 'VETERINARIO';
  const isProprietario     = userTypeUpper === 'PROPRIETARIO';

  // ── Permissões granulares ─────────────────────────────────────────────────────
  // ADMIN/GESTOR têm bypass total em podeExecutar.
  // PROPRIETARIO recebe permissões reais do backend (só o que o vet/empresa concedeu).
  const { podeExecutar, isGestor } = usePermissoes();

  const isEstagiario           = role === 'ESTAGIARIO' || userTypeUpper === 'ESTAGIARIO';
  const isVetOuSuperior        = isVet || isAdmin || isGestor;

  const podeVerAdministracao   = isAdmin || isGestor;
  // Mapa de Atendimento: visível para todos com permissão dashboard.geral.ler.
  const podeVerDashboard       = podeExecutar('dashboard.geral.ler');
  const podeVerAnimais         = podeExecutar('animais.ler');
  const podeVerExames          = podeExecutar('atendimento.exames.ler');
  const podeVerEvolucoes       = podeExecutar('atendimento.evolucoes.ler');
  const podeVerPrescricoes     = podeExecutar('atendimento.prescricoes.ler');
  const podeVerVacinas         = podeExecutar('atendimento.vacinas.ler');
  const podeVerEncaminhamentos = podeExecutar('atendimento.encaminhamentos.ler');
  const podeVerDieta           = podeExecutar('nutricao.dietas.ler');
  const podeVerRelatorio       = podeExecutar('nutricao.relatorios.ler');
  const podeVerFaturas         = podeExecutar('financeiro.faturas.ler');
  const podeVerFarmacia        = podeExecutar('farmacia.estoque.ler');
  const podeVerEstoqueVacina   = isGestor || podeExecutar('vacina.estoque.ler');
  const podeVerMedicamentos    = podeExecutar('medicamentos.catalogo.ler');
  const podeVerProcedimentos   = podeExecutar('procedimentos.catalogo.ler');
  const podeVerProprietarios   = isAdmin || isGestor || podeExecutar('cadastro.proprietario.ler');
  const podeVerTratadores      = isAdmin || isGestor || podeExecutar('cadastro.tratador.ler');
  const podeVerFornecedores    = isAdmin || isGestor || podeExecutar('cadastro.fornecedor.ler');
  const podeVerLocalizacoes    = isAdmin || isGestor || podeExecutar('cadastro.localizacao.ler');
  const podeVerEquipe          = isAdmin || isGestor || podeExecutar('equipe.membros.ler');

  // temAcessoClinico: profissionais de saúde OU proprietário com ao menos 1 grant clínico
  const temAcessoClinico =
    ROLES_CLINICAS.includes(role) || ROLES_CLINICAS.includes(userTypeUpper) ||
    (isProprietario && (podeVerEvolucoes || podeVerPrescricoes || podeVerExames));

  const temAcessoAtendimento = podeVerEvolucoes || podeVerPrescricoes || podeVerExames || podeVerVacinas || podeVerEncaminhamentos;
  const temAcessoNutricional  = podeVerDieta || podeVerRelatorio || isAdmin;
  const podeVerAgendamentos    = podeExecutar('atendimento.agendamentos.ler');
  const temAlgumModulo        =
    podeVerAgendamentos                        ||
    (temAcessoClinico && temAcessoAtendimento) ||
    (temAcessoClinico && podeVerPrescricoes)   ||
    podeVerFarmacia                            ||
    temAcessoNutricional                       ||
    podeVerFaturas;

  // "Cadastro Pessoal" sempre disponível para profissionais (não-estagiário, não-proprietário).
  // Permite que VETs sem nenhuma outra permissão ainda acessem seu próprio perfil.
  const podVerCadastroPessoal = !isEstagiario && !isProprietario;

  // Itens visíveis no accordion Cadastro e na seção Geral
  const temAlgumCadastroItem =
    (temAcessoClinico && podeVerAnimais) ||
    !temAcessoClinico ||           // proprietários: sempre mostra meus-animais
    podVerCadastroPessoal ||       // profissionais com ao menos 1 permissão ativa
    podeVerEquipe ||
    podeVerFornecedores ||
    podeVerLocalizacoes ||
    podeVerProprietarios ||
    podeVerTratadores;

  const temAlgumGeralItem = podeVerDashboard || temAlgumCadastroItem;
  const animalId         = selectedAnimal?.id;

  const activeSection = detectSection(location.pathname);
  const isMapaActive  = activeSection === 'mapa';
  const p             = location.pathname;
  const search        = location.search;

  // ── Helpers de active state ───────────────────────────────────────────────
  const isGeralActive = (path: string) => {
    if (activeSection !== 'geral') return false;
    if (path === '/') return p === '/';
    return p.startsWith(path);
  };
  const isModuleActive         = (mod: ActiveSection) => activeSection === mod;
  const isNutricionalSubActive = (path: string) => activeSection === 'nutricional' && p.startsWith(path);
  const isAdminActive          = (path: string) => activeSection === 'admin' && p.startsWith(path);

  // ── Estados dos menus ─────────────────────────────────────────────────────
  const [openGeral,         setOpenGeral]        = useState(true);
  const [openModulos,       setOpenModulos]       = useState(true);
  const [openClinica,       setOpenClinica]       = useState(() => p.startsWith('/clinica'));
  const [openEnfermagem,    setOpenEnfermagem]    = useState(() => p.startsWith('/execucao-prescricao'));
  const [openExames,        setOpenExames]        = useState(() => p.startsWith('/exames'));
  const [openNutricional,   setOpenNutricional]   = useState(() =>
    p.startsWith('/dieta') ||
    p.startsWith('/relatorio-nutricional') ||
    p.startsWith('/alimentos') ||
    p.startsWith('/nutrientes') ||
    p.startsWith('/composicao-alimentar'),
  );
  const [openCadastro,      setOpenCadastro]      = useState(() => p.startsWith('/cadastro/') || p === '/equipe');
  const [openAdministracao, setOpenAdministracao] = useState(() =>
    p.startsWith('/usuarios') ||
    p.startsWith('/equipe-manager') ||
    p.startsWith('/controle-acesso') ||
    p.startsWith('/ai-usage') ||
    p.startsWith('/medicamentos') ||
    p.startsWith('/procedimentos') ||
    p.startsWith('/admin/vacinas'),
  );
  const [openFinanceiro,    setOpenFinanceiro]    = useState(false);
  const [isMobileMenuOpen,  setIsMobileMenuOpen]  = useState(false);

  const toggle      = (s: React.Dispatch<React.SetStateAction<boolean>>) => s(v => !v);
  const closeMobile = () => setIsMobileMenuOpen(false);

  // ── Renderizadores ────────────────────────────────────────────────────────
  const navLink = (to: string, icon: React.ReactNode, label: string, active: boolean) => (
    <Link to={to} onClick={closeMobile}
      className={`flex items-center gap-3 px-5 py-3 rounded-3xl text-sm font-semibold transition-colors ${active ? CLS_MODULE_ACTIVE : CLS_MODULE_INACTIVE}`}>
      {icon} {label}
    </Link>
  );

  const navLinkBadge = (
    to: string, icon: React.ReactNode, label: string, active: boolean, badge: number,
  ) => (
    <Link to={to} onClick={closeMobile}
      className={`flex items-center gap-3 px-5 py-3 rounded-3xl text-sm font-semibold transition-colors ${active ? CLS_MODULE_ACTIVE : CLS_MODULE_INACTIVE}`}>
      {icon}
      <span className="flex-1">{label}</span>
      {badge > 0 && (
        <span className="bg-red-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] rounded-full flex items-center justify-center px-1 leading-none flex-shrink-0">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </Link>
  );

  const moduleButton = (
    label: string, icon: React.ReactNode, mod: ActiveSection, open: boolean, onToggle: () => void,
  ) => (
    <button onClick={onToggle}
      className={`flex items-center justify-between w-full px-5 py-3 text-sm font-semibold rounded-3xl transition-colors ${isModuleActive(mod) ? CLS_MODULE_ACTIVE : CLS_MODULE_INACTIVE}`}>
      <span className="flex items-center gap-3">{icon} {label}</span>
      <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
  );

  const subLink = (to: string, icon: React.ReactNode, label: string, active: boolean) => (
    <Link key={to} to={to} onClick={closeMobile}
      className={`flex items-center gap-3 px-5 py-2.5 rounded-2xl text-sm transition-colors ${active ? 'bg-emerald-100 text-emerald-700 font-medium' : 'text-gray-600 hover:bg-gray-100'}`}>
      {icon && <span className="flex-shrink-0">{icon}</span>}
      {label}
    </Link>
  );

  return (
    <>
      {/* Hamburguer mobile */}
      <button onClick={() => setIsMobileMenuOpen(true)}
        className="md:hidden fixed top-6 left-6 z-50 p-3 bg-white rounded-3xl shadow-lg border border-gray-200">
        <Menu size={28} />
      </button>

      {/* Sidebar */}
      <div className={`
        fixed inset-y-0 left-0 z-50 w-72 bg-white border-r border-gray-200 shadow-sm
        flex flex-col overflow-hidden
        transition-transform duration-300 ease-in-out
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0 md:static md:flex
      `}>

        {/* Header */}
        <div className="px-6 py-6 border-b border-gray-200 flex items-center gap-3 flex-shrink-0">
          <div className="w-10 h-10 bg-emerald-600 rounded-2xl flex items-center justify-center text-white text-2xl">🥕</div>
          <div>
            <h1 className="text-xl font-bold text-emerald-700">Nutrição Equina</h1>
            <p className="text-emerald-500 text-sm -mt-0.5">Super</p>
          </div>
          <button onClick={closeMobile} className="md:hidden ml-auto p-2 text-gray-500 hover:text-gray-700">
            <X size={28} />
          </button>
        </div>

        {/* Seletor de contexto ativo — só para gestor com mais de uma empresa/equipe.
            CNPJ = opção por empresa; CPF = opção por equipe da empresa pessoal */}
        {opcoesContexto.length > 1 && (
          <div className="px-4 py-3 border-b border-gray-200 flex-shrink-0">
            <span className="flex items-center gap-1.5 px-1 mb-1.5 text-[11px] font-bold text-gray-400 uppercase tracking-widest">
              <Building2 className="w-3.5 h-3.5" /> {contextoAtivo?.equipeId ? 'Equipe ativa' : 'Empresa ativa'}
            </span>
            <select
              value={contextoAtivo ? `${contextoAtivo.empresaId}:${contextoAtivo.equipeId ?? ''}` : ''}
              onChange={(e) => {
                const [empresaId, equipeId] = e.target.value.split(':');
                const opcao = opcoesContexto.find(
                  (o) => o.empresaId === Number(empresaId) && o.equipeId === (equipeId ? Number(equipeId) : null),
                );
                if (opcao) trocarContexto(opcao);
              }}
              className="w-full text-sm font-semibold text-gray-700 bg-gray-50 border border-gray-200 rounded-2xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
            >
              {opcoesContexto.map((o) => (
                <option key={`${o.empresaId}:${o.equipeId ?? ''}`} value={`${o.empresaId}:${o.equipeId ?? ''}`}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 min-h-0 px-3 py-4 space-y-4 overflow-y-auto">

          {/* ═══ GERAL ═══════════════════════════════════════════════════════ */}
          {temAlgumGeralItem && (
            <div>
              <button onClick={() => toggle(setOpenGeral)}
                className="flex items-center justify-between w-full px-5 py-2.5 text-xs font-bold text-gray-400 uppercase tracking-widest hover:bg-gray-50 rounded-3xl">
                Geral
                <ChevronDown className={`w-4 h-4 transition-transform ${openGeral ? 'rotate-180' : ''}`} />
              </button>

              {openGeral && (
                <div className="mt-1 space-y-0.5 pl-4">
                  {podeVerDashboard && navLink('/mapa-atendimento', <LayoutDashboard size={20} />, 'Mapa de Atendimento', isMapaActive)}

                  {/* ── Cadastro sub-accordion ─────────────────────────────── */}
                  {temAlgumCadastroItem && (
                    <div>
                      <button onClick={() => toggle(setOpenCadastro)}
                        className={`flex items-center justify-between w-full px-5 py-3 text-sm font-semibold rounded-3xl transition-colors ${
                          activeSection === 'cadastro' || p.startsWith('/cadastro-pessoal') ||
                          p.startsWith('/animais-vet') || p.startsWith('/meus-animais')
                            ? CLS_MODULE_ACTIVE : CLS_MODULE_INACTIVE
                        }`}>
                        <span className="flex items-center gap-3"><FolderOpen size={20} /> Cadastro</span>
                        <ChevronDown className={`w-4 h-4 transition-transform ${openCadastro ? 'rotate-180' : ''}`} />
                      </button>

                      {openCadastro && (
                        <div className="mt-1 pl-6 space-y-0.5">
                          {temAcessoClinico
                            ? (podeVerAnimais && (
                              <Link key="/animais-vet" to="/animais-vet" onClick={closeMobile}
                                className={`flex items-center gap-3 px-5 py-2.5 rounded-2xl text-sm transition-colors ${
                                  p.startsWith('/animais-vet') ? 'bg-emerald-100 text-emerald-700 font-medium' : 'text-gray-600 hover:bg-gray-100'
                                }`}>
                                <Zap size={14} className="flex-shrink-0" />
                                <span className="flex-1">Pacientes</span>
                                {isVet && pendentesCount > 0 && (
                                  <span className="bg-red-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] rounded-full flex items-center justify-center px-1 leading-none flex-shrink-0">
                                    {pendentesCount > 9 ? '9+' : pendentesCount}
                                  </span>
                                )}
                              </Link>
                            ))
                            : subLink('/meus-animais', <Zap size={14} />, 'Animais', p.startsWith('/meus-animais'))
                          }

                          {podVerCadastroPessoal && subLink('/cadastro-pessoal', <User size={14} />, 'Cadastro Pessoal', p.startsWith('/cadastro-pessoal'))}
                          {podeVerEquipe        && subLink('/equipe',                 <Users2 size={14} />,  'Equipe',        p === '/equipe')}
                          {podeVerFornecedores  && subLink('/cadastro/fornecedores',  <Truck size={14} />,   'Fornecedores',  p.startsWith('/cadastro/fornecedores'))}
                          {podeVerLocalizacoes  && subLink('/cadastro/localizacoes',  <MapPin size={14} />,  'Localizações',  p.startsWith('/cadastro/localizacoes'))}
                          {podeVerProprietarios && subLink('/cadastro/proprietarios', <Users size={14} />,   'Proprietários', p.startsWith('/cadastro/proprietarios'))}
                          {podeVerTratadores    && subLink('/cadastro/tratadores',    <UserCog size={14} />, 'Tratadores',    p.startsWith('/cadastro/tratadores'))}
                        </div>
                      )}
                    </div>
                  )}

                </div>
              )}
            </div>
          )}

          {/* ═══ MÓDULOS ═════════════════════════════════════════════════════ */}
          {isNewUser ? (
            <div className="mx-3 px-5 py-5 bg-amber-50 border border-amber-200 rounded-3xl text-amber-700 text-sm">
              <strong>Funcionalidades bloqueadas</strong><br />
              Complete seu Cadastro e cadastre seu primeiro animal para liberar os módulos.
            </div>
          ) : temAlgumModulo ? (
            <div>
              <button onClick={() => toggle(setOpenModulos)}
                className="flex items-center justify-between w-full px-5 py-2.5 text-xs font-bold text-gray-400 uppercase tracking-widest hover:bg-gray-50 rounded-3xl">
                Módulos
                <ChevronDown className={`w-4 h-4 transition-transform ${openModulos ? 'rotate-180' : ''}`} />
              </button>

              {openModulos && (
                <div className="mt-1 pl-4 space-y-0.5">

                  {/* ── Agendamento ──────────────────────────────────── */}
                  {podeVerAgendamentos && (
                    <button
                      onClick={() => { closeMobile(); navigate('/agendamentos'); }}
                      className={`w-full flex items-center gap-3 px-5 py-3 rounded-3xl text-sm font-semibold transition-colors ${
                        p.startsWith('/agendamentos') ? CLS_MODULE_ACTIVE : CLS_MODULE_INACTIVE
                      }`}
                    >
                      <CalendarClock size={20} />
                      Agendamento
                    </button>
                  )}

                  {/* ── Atendimento ──────────────────────────────────── */}
                  {temAcessoClinico && temAcessoAtendimento && (
                    <div>
                      {moduleButton('Atendimento', <Stethoscope size={20} />, 'clinica', openClinica, () => toggle(setOpenClinica))}
                      {openClinica && (
                        <div className="mt-1 pl-6 space-y-0.5">
                          {isVetOuSuperior && podeVerAgendamentos && subLink('/clinica/agenda', <CalendarDays size={14} />, 'Agenda', p.startsWith('/clinica/agenda'))}
                          {podeVerEvolucoes  && subLink(
                            animalId ? `/clinica/evolucao/${animalId}` : '/clinica/evolucao',
                            <FileText    size={14} />, 'Evolução',
                            p.startsWith('/clinica/evolucao'),
                          )}
                          {podeVerPrescricoes && subLink(
                            animalId ? `/clinica/prescricao/${animalId}` : '/clinica/prescricao',
                            <Pill        size={14} />, 'Prescrição',
                            p.startsWith('/clinica/prescricao'),
                          )}
                          {podeVerVacinas && subLink(
                            animalId ? `/clinica/vacina/${animalId}` : '/clinica/vacina',
                            <Syringe     size={14} />, 'Vacinas',
                            p.startsWith('/clinica/vacina'),
                          )}
                          {podeVerExames && subLink(
                            animalId ? `/clinica/exames/${animalId}` : '/clinica/exames',
                            <FlaskConical size={14} />, 'Pedido Exames',
                            p.startsWith('/clinica/exames'),
                          )}
                          {podeVerEncaminhamentos && subLink(
                            animalId ? `/clinica/encaminhamento/${animalId}` : '/clinica/encaminhamento',
                            <Share2      size={14} />, 'Encaminhamento',
                            p.startsWith('/clinica/encaminhamento'),
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Enfermagem ────────────────────────────────────── */}
                  {temAcessoClinico && podeVerPrescricoes && (
                    <div>
                      {moduleButton('Enfermagem', <HeartPulse size={20} />, 'enfermagem', openEnfermagem, () => toggle(setOpenEnfermagem))}
                      {openEnfermagem && (
                        <div className="mt-1 pl-6 space-y-0.5">
                          {subLink('/execucao-prescricao', <ClipboardCheck size={14} />, 'Execução de Prescrições', p.startsWith('/execucao-prescricao'))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Vacina ────────────────────────────────────────── */}
                  {podeVerEstoqueVacina && (
                    <Link
                      to="/estoque-vacina"
                      onClick={closeMobile}
                      className={`flex items-center gap-3 px-5 py-3 text-sm font-semibold rounded-3xl transition-colors ${
                        p.startsWith('/estoque-vacina') ? CLS_MODULE_ACTIVE : CLS_MODULE_INACTIVE
                      }`}
                    >
                      <Syringe size={20} />
                      Vacina
                    </Link>
                  )}

                  {/* ── Farmácia ──────────────────────────────────────── */}
                  {podeVerFarmacia && (
                    <Link
                      to="/farmacia"
                      onClick={closeMobile}
                      className={`flex items-center gap-3 px-5 py-3 text-sm font-semibold rounded-3xl transition-colors ${
                        p.startsWith('/farmacia') ? CLS_MODULE_ACTIVE : CLS_MODULE_INACTIVE
                      }`}
                    >
                      <FlaskConical size={20} />
                      Farmácia
                    </Link>
                  )}

                  {/* ── Nutricional ──────────────────────────────────────── */}
                  {temAcessoNutricional && (
                    <div>
                      {moduleButton('Nutricional', <Carrot size={20} />, 'nutricional', openNutricional, () => toggle(setOpenNutricional))}
                      {openNutricional && (
                        <div className="mt-1 pl-6 space-y-0.5">
                          {podeVerDieta && subLink(
                            animalId ? `/dieta/${animalId}` : '/dieta',
                            <Utensils size={14} />, 'Dieta',
                            isNutricionalSubActive('/dieta'),
                          )}
                          {podeVerRelatorio && subLink(
                            animalId ? `/relatorio-nutricional/${animalId}` : '/relatorio-nutricional',
                            <FileBarChart size={14} />, 'Relatório Nutricional',
                            isNutricionalSubActive('/relatorio-nutricional'),
                          )}
                          {isAdmin && subLink('/alimentos',            <Wheat    size={14} />, 'Alimentos',            isNutricionalSubActive('/alimentos'))}
                          {isAdmin && subLink('/nutrientes',           <TestTube size={14} />, 'Nutrientes',           isNutricionalSubActive('/nutrientes'))}
                          {isAdmin && subLink('/composicao-alimentar', <ChartBar size={14} />, 'Composição Alimentar', isNutricionalSubActive('/composicao-alimentar'))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Exames ───────────────────────────────────────────── */}
                  {podeVerExames && (
                    <div>
                      {moduleButton('Exames', <Microscope size={20} />, 'exames', openExames, () => toggle(setOpenExames))}
                      {openExames && (
                        <div className="mt-1 pl-6 space-y-0.5">
                          {subLink(
                            animalId ? `/exames/${animalId}?tipo=laboratorial` : '/exames?tipo=laboratorial',
                            <ClipboardList size={14} />, 'Laboratorial',
                            p.startsWith('/exames') && search.includes('tipo=laboratorial'),
                          )}
                          {subLink(
                            animalId ? `/exames/${animalId}?tipo=imagem` : '/exames?tipo=imagem',
                            <Scan size={14} />, 'Imagem',
                            p.startsWith('/exames') && search.includes('tipo=imagem'),
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Financeiro ───────────────────────────────────────── */}
                  {podeVerFaturas && (
                    <div>
                      <button onClick={() => toggle(setOpenFinanceiro)}
                        className="flex items-center justify-between w-full px-5 py-2.5 text-sm font-semibold text-gray-500 hover:bg-gray-50 rounded-3xl transition-colors">
                        <span className="flex items-center gap-3"><DollarSign size={20} /> Financeiro</span>
                        <ChevronDown className={`w-4 h-4 transition-transform ${openFinanceiro ? 'rotate-180' : ''}`} />
                      </button>
                      {openFinanceiro && (
                        <div className="mt-1 space-y-0.5">
                          <Link
                            to="/faturamento"
                            onClick={closeMobile}
                            className={`flex items-center gap-3 px-5 py-2 text-sm rounded-3xl transition-colors ${
                              location.pathname === '/faturamento'
                                ? 'bg-indigo-50 text-indigo-700 font-semibold'
                                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                            }`}>
                            <DollarSign size={16} /> Faturamento
                          </Link>
                        </div>
                      )}
                    </div>
                  )}

                </div>
              )}
            </div>
          ) : null}

          {/* ═══ ADMINISTRAÇÃO ═══════════════════════════════════════════════ */}
          {podeVerAdministracao && (
            <div>
              <button onClick={() => toggle(setOpenAdministracao)}
                className="flex items-center justify-between w-full px-5 py-2.5 text-xs font-bold text-gray-400 uppercase tracking-widest hover:bg-gray-50 rounded-3xl">
                <span className="flex items-center gap-2"><ShieldCheck size={14} /> Administração</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${openAdministracao ? 'rotate-180' : ''}`} />
              </button>

              {openAdministracao && (
                <div className="mt-1 space-y-0.5 pl-4">
                  {isAdmin && navLink('/medicamentos',    <Pill     size={20} />, 'Medicamentos',    isAdminActive('/medicamentos'))}
                  {isAdmin && navLink('/procedimentos',  <Activity size={20} />, 'Procedimentos',  isAdminActive('/procedimentos'))}
                  {isAdmin && navLink('/admin/vacinas',  <Syringe  size={20} />, 'Vacinas',        isAdminActive('/admin/vacinas'))}
                  {isAdmin && (
                    <>
                      {navLink('/usuarios',   <Users size={20} />, 'Usuários',         isAdminActive('/usuarios'))}
                      {navLink('/ai-usage',   <Users size={20} />, 'Monitoramento IA', isAdminActive('/ai-usage'))}
                    </>
                  )}
                  {navLink('/controle-acesso', <ShieldCheck size={20} />, 'Controle de Acesso', isAdminActive('/controle-acesso'))}
                </div>
              )}
            </div>
          )}

        </nav>

        {/* Footer */}
        {user && (
          <div className="border-t border-gray-200 p-3 flex-shrink-0">
            <div className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 rounded-2xl">
              <div className="w-8 h-8 bg-emerald-100 text-emerald-700 rounded-xl flex items-center justify-center font-bold text-sm flex-shrink-0">
                {user.fullName?.[0]?.toUpperCase() ?? 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{user.fullName}</p>
                <p className="text-xs text-gray-500 truncate">{user.email}</p>
              </div>
              {isAdmin && (
                <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full flex-shrink-0">ADMIN</span>
              )}
              {isGestor && !isAdmin && (
                <span className="text-[10px] font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full flex-shrink-0">GESTOR</span>
              )}
              {(role === 'VETERINARIO' || userTypeUpper === 'VETERINARIO') && !isAdmin && !isGestor && (
                <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full flex-shrink-0">VET</span>
              )}
              {role === 'ESTAGIARIO' && (
                <span className="text-[10px] font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full flex-shrink-0">EST</span>
              )}
            </div>
            <button onClick={logout}
              className="mt-2 flex items-center justify-center gap-2 w-full py-2.5 text-red-600 hover:bg-red-50 rounded-2xl text-sm font-medium transition-colors">
              <LogOut size={16} /> Sair
            </button>
          </div>
        )}
      </div>

      {/* Backdrop mobile */}
      {isMobileMenuOpen && (
        <div onClick={closeMobile} className="md:hidden fixed inset-0 bg-black/50 z-40" />
      )}

    </>
  );
}