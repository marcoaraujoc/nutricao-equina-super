// src/components/Sidebar.tsx

import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSelectedAnimal } from '../contexts/SelectedAnimalContext';
import { useEmpresa } from '../contexts/EmpresaContext';
import { useMobileMenu } from '../contexts/MobileMenuContext';
import { useState } from 'react';
import {
  LayoutDashboard, User, Zap, ClipboardList,
  Wheat, TestTube, ChartBar, Carrot, Stethoscope,
  DollarSign, ChevronDown, X,
  Users, Users2, ShieldCheck, FlaskConical, Pill,
  ClipboardCheck, Activity, Utensils, FileBarChart,
  FileText, Syringe, Share2, Microscope, Scan,
  FolderOpen, UserCog, Truck, MapPin, CalendarClock,
  Sparkles, CalendarPlus, CalendarDays, Package, Settings, ScrollText,
  Bell, Gauge, ListChecks, Receipt,
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
type ActiveSection = 'geral' | 'agenda' | 'clinica' | 'nutricional' | 'admin' | 'estoque' | 'exames' | 'enfermagem' | 'cadastro' | 'mapa';

function detectSection(pathname: string): ActiveSection {
  if (pathname.startsWith('/mapa-atendimento'))       return 'mapa';
  if (pathname.startsWith('/agendamentos'))           return 'agenda';
  if (pathname.startsWith('/clinica'))               return 'clinica';
  if (pathname.startsWith('/execucao-prescricao'))   return 'enfermagem';
  if (pathname.startsWith('/estoque-vacina'))         return 'estoque';
  if (pathname.startsWith('/farmacia'))              return 'estoque';
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
    pathname.startsWith('/admin/vacinas') ||
    pathname.startsWith('/configuracao-alertas') ||
    pathname.startsWith('/monitoracao')
  ) return 'admin';
  return 'geral';
}

export default function Sidebar() {
  const { user }                      = useAuth();
  // Redirecionamento para /cadastro-pessoal quando incompleto é responsabilidade
  // do ProtectedRoute (fonte única — evita competir com o gate de troca de senha
  // obrigatória e causar loop de mount/unmount do Sidebar, que gerava tempestade
  // de requisições 429 nos hooks de polling abaixo).
  const { isNewUser, selectedAnimal, cadastroCompleto, isGestorEmpresa, empresaConfigurada } = useSelectedAnimal();
  const location                      = useLocation();
  const navigate                      = useNavigate();
  const pendentesCount                = useVetPendentes();
  const { opcoes: opcoesContexto, contextoAtivo, trocarContexto, marca } = useEmpresa();
  useVetSolicitacaoMonitor();
  useProprietarioNotificacoes();

  // Logomarca/nome da empresa ativa vêm do EmpresaContext (fonte única — header,
  // sidebar e rodapé mostram a mesma marca sem repetir o fetch).
  const { logoUrl, empresaNome } = marca;

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
  const podeVerEnfermagem      = podeExecutar('enfermagem.prescricao.ler');
  const podeVerDieta           = podeExecutar('nutricao.dietas.ler');
  const podeVerRelatorio       = podeExecutar('nutricao.relatorios.ler');
  const podeVerFaturas         = podeExecutar('financeiro.faturas.ler');
  const podeVerFarmacia        = podeExecutar('farmacia.estoque.ler');
  const podeVerEstoqueVacina   = isGestor || podeExecutar('vacina.estoque.ler');
  const podeVerMedicamentos    = podeExecutar('medicamentos.catalogo.ler');
  const podeVerProcedimentos   = podeExecutar('procedimentos.catalogo.ler');
  const podeVerCadProcedimentos = isAdmin || isGestor || podeExecutar('cadastro.procedimento.ler');
  const podeVerProprietarios   = isAdmin || isGestor || podeExecutar('cadastro.proprietario.ler');
  const podeVerTratadores      = isAdmin || isGestor || podeExecutar('cadastro.tratador.ler');
  const podeVerFornecedores    = isAdmin || isGestor || podeExecutar('cadastro.fornecedor.ler');
  const podeVerLocalizacoes    = isAdmin || isGestor || podeExecutar('cadastro.localizacao.ler');
  const podeVerEquipe          = isAdmin || isGestor || podeExecutar('equipe.membros.ler');
  const podeVerRelatorios      = isGestor || podeExecutar('relatorios.gerencial.ler');

  // temAcessoClinico: profissionais de saúde OU proprietário com ao menos 1 grant clínico
  const temAcessoClinico =
    ROLES_CLINICAS.includes(role) || ROLES_CLINICAS.includes(userTypeUpper) ||
    (isProprietario && (podeVerEvolucoes || podeVerPrescricoes || podeVerExames));

  const temAcessoAtendimento = podeVerEvolucoes || podeVerPrescricoes || podeVerExames || podeVerVacinas || podeVerEncaminhamentos;
  const temAcessoNutricional  = podeVerDieta || podeVerRelatorio || isAdmin;
  const podeVerAgendamentos    = podeExecutar('atendimento.agendamentos.ler');
  const podeVerOrcamento       = isGestor || podeExecutar('orcamento.orcamentos.ler');
  const temAlgumModulo        =
    podeVerAgendamentos                        ||
    podeVerOrcamento                           ||
    (temAcessoClinico && temAcessoAtendimento) ||
    (temAcessoClinico && podeVerPrescricoes)   ||
    podeVerFarmacia || podeVerEstoqueVacina    ||
    temAcessoNutricional                       ||
    podeVerFaturas                             ||
    podeVerRelatorios;

  // "Cadastro Pessoal" sempre disponível para profissionais (não-estagiário, não-proprietário).
  // Permite que VETs sem nenhuma outra permissão ainda acessem seu próprio perfil.
  const podVerCadastroPessoal = !isEstagiario && !isProprietario;

  // Bloqueio de módulos por cadastro incompleto — mensagem e destino variam conforme
  // o que falta preencher. GESTOR de empresa precisa de Cadastro Pessoal E Configurações
  // da empresa; demais perfis só de Cadastro Pessoal (proprietário tem sua própria regra).
  const faltaCadastroPessoal = !cadastroCompleto;
  const faltaConfigEmpresa   = isGestorEmpresa && !empresaConfigurada;
  const destinoBloqueio = faltaCadastroPessoal
    ? '/cadastro-pessoal'
    : faltaConfigEmpresa
      ? '/configuracoes'
      : '/animais';
  const mensagemBloqueio = isProprietario
    ? 'Complete seu Cadastro e cadastre seu primeiro animal para liberar os módulos.'
    : faltaCadastroPessoal && faltaConfigEmpresa
      ? 'Complete seu Cadastro Pessoal e a Configuração da Empresa para liberar os módulos.'
      : faltaConfigEmpresa
        ? 'Complete a Configuração da Empresa para liberar os módulos.'
        : 'Complete seu Cadastro Pessoal para liberar os módulos.';

  // Itens visíveis no accordion Cadastro e na seção Geral
  const temAlgumCadastroItem =
    (temAcessoClinico && podeVerAnimais) ||
    !temAcessoClinico ||           // proprietários: sempre mostra meus-animais
    podVerCadastroPessoal ||       // profissionais com ao menos 1 permissão ativa
    podeVerEquipe ||
    podeVerFornecedores ||
    podeVerLocalizacoes ||
    podeVerCadProcedimentos ||
    podeVerProprietarios ||
    podeVerTratadores;

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
  const isEstoqueSubActive     = (path: string) => activeSection === 'estoque'     && p.startsWith(path);
  const isAdminActive          = (path: string) => activeSection === 'admin' && p.startsWith(path);

  // ── Estados dos menus ─────────────────────────────────────────────────────
  // Só ADMINISTRAÇÃO continua sendo seção-contêiner: os cabeçalhos "Geral" e
  // "Módulos" saíram (2026-07-30) e os itens ficaram no nível raiz do menu.
  const [openAdministracao, setOpenAdministracao] = useState(() =>
    p.startsWith('/usuarios') ||
    p.startsWith('/equipe-manager') ||
    p.startsWith('/controle-acesso') ||
    p.startsWith('/ai-usage') ||
    p.startsWith('/medicamentos') ||
    p.startsWith('/procedimentos') ||
    p.startsWith('/admin/vacinas') ||
    p.startsWith('/configuracao-alertas') ||
    p.startsWith('/monitoracao'),
  );

  // Accordion de grupos: no máximo UM grupo expansível aberto por vez em todo o
  // sidebar. Abrir um fecha o anterior. Inicializa no grupo da rota ativa.
  const [openGroup, setOpenGroup] = useState<string | null>(() => {
    if (p.startsWith('/clinica'))                                    return 'atendimento';
    // Execução de Prescrição mora dentro de Atendimento (o grupo "Enfermagem" saiu)
    if (p.startsWith('/execucao-prescricao'))                        return 'atendimento';
    if (p.startsWith('/faturamento') || p.startsWith('/orcamento'))  return 'financeiro';
    if (p.startsWith('/estoque-vacina') || p.startsWith('/farmacia')) return 'estoque';
    if (p.startsWith('/exames'))                                     return 'exames';
    if (p.startsWith('/dieta') ||
        p.startsWith('/relatorio-nutricional') ||
        p.startsWith('/alimentos') ||
        p.startsWith('/nutrientes') ||
        p.startsWith('/composicao-alimentar'))                       return 'nutricional';
    if (p.startsWith('/cadastro/') || p === '/equipe')               return 'cadastro';
    if (p.startsWith('/relatorios'))                                 return 'relatorios';
    return null;
  });
  const toggleGroup = (key: string) => setOpenGroup(cur => (cur === key ? null : key));

  const { open: isMobileMenuOpen, setOpen: setIsMobileMenuOpen } = useMobileMenu();

  const toggle      = (s: React.Dispatch<React.SetStateAction<boolean>>) => s(v => !v);
  const closeMobile = () => setIsMobileMenuOpen(false);

  // Módulo "folha" (sem sub-itens: Orçamento, Agendamento, Dashboard, ...): ao navegar,
  // recolhe qualquer grupo expansível aberto (Cadastro, Estoque, Atendimento, ...) —
  // mantém só um contexto visível por vez no sidebar.
  const sairDosGrupos = () => { setOpenGroup(null); closeMobile(); };
  const irParaModulo  = (to: string) => { sairDosGrupos(); navigate(to); };

  // ── Renderizadores ────────────────────────────────────────────────────────
  const navLink = (to: string, icon: React.ReactNode, label: string, active: boolean) => (
    <Link to={to} onClick={sairDosGrupos}
      className={`flex items-center gap-3 px-5 py-3 rounded-3xl text-sm font-semibold transition-colors ${active ? CLS_MODULE_ACTIVE : CLS_MODULE_INACTIVE}`}>
      {icon} {label}
    </Link>
  );

  const navLinkBadge = (
    to: string, icon: React.ReactNode, label: string, active: boolean, badge: number,
  ) => (
    <Link to={to} onClick={sairDosGrupos}
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
      {/* O gatilho do menu mobile fica na barra superior sticky (App.tsx / MobileTopBar),
          não aqui — position:fixed se comporta mal no iOS Safari dentro do shell com
          scroll interno. Este componente cuida só do drawer e do backdrop. */}

      {/* Sidebar */}
      <div className={`
        fixed inset-y-0 left-0 z-50 w-72 bg-white border-r border-gray-200 shadow-sm
        flex flex-col overflow-hidden
        transition-transform duration-300 ease-in-out
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0 md:static md:flex
      `}>

        {/* Card da empresa do contexto ativo — SÓ a logomarca (Configurações),
            centralizada no eixo do sidebar, espelhando o logo do produto no header.
            O nome da empresa foi retirado: a própria arte já identifica a clínica.
            EXCEÇÃO: empresa sem logo cadastrada cai no nome — senão o card viraria um
            quadrado com uma letra, sem dizer em qual clínica o usuário está. */}
        <div className="relative px-4 py-5 border-b border-gray-200 flex flex-col items-center justify-center text-center flex-shrink-0 min-h-[6.5rem]">
          {logoUrl ? (
            // Só os limites da caixa são fixados — a logo do cliente pode ser deitada
            // (1200x551) ou em pé (750x1334), então a proporção precisa ser preservada
            // em vez de forçada num quadrado.
            <img src={logoUrl} alt={empresaNome ?? 'Logomarca da empresa'}
              className="max-h-20 max-w-[13rem] w-auto object-contain" />
          ) : (
            <h1 className="text-sm font-bold text-gray-900 leading-tight line-clamp-2">
              {empresaNome ?? 'Minha clínica'}
            </h1>
          )}
          {/* Absoluto para não desalinhar a coluna centralizada */}
          <button onClick={closeMobile}
            className="md:hidden absolute right-2 top-2 p-2 text-gray-500 hover:text-gray-700">
            <X size={24} />
          </button>
        </div>

        {/* Seletor de contexto ativo — só para gestor com mais de uma empresa/equipe.
            CNPJ = opção por empresa; CPF = opção por equipe da empresa pessoal.
            Sem rótulo acima ("Equipe ativa"/"Empresa ativa"): o próprio valor
            selecionado já diz em qual contexto o usuário está. */}
        {opcoesContexto.length > 1 && (
          <div className="px-4 py-3 border-b border-gray-200 flex-shrink-0">
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

        {/* Nav
            space-y-0.5 (e não space-y-4): Mapa, Cadastro, Agendamento, Atendimento…
            são itens do MESMO nível e precisam do mesmo respiro entre si. O antigo
            space-y-4 valia só entre os blocos filhos diretos do <nav>, então Mapa↔
            Cadastro e Cadastro↔Agendamento ficavam com 16px enquanto Agendamento↔
            Atendimento — que moram dentro do bloco de módulos — ficavam com 2px.
            Separação maior agora é aplicada pontualmente, onde é intencional
            (aviso de bloqueio e a seção Administração). */}
        <nav className="flex-1 min-h-0 px-3 py-4 space-y-0.5 overflow-y-auto">

          {/* Menu PLANO: sem os cabeçalhos "Geral"/"Módulos" — os itens ficam todos
              no mesmo nível, na ordem de uso do dia a dia (2026-07-30). */}

          {/* ── 1. Mapa de Atendimento ─────────────────────────────────────── */}
          {podeVerDashboard && (
            <div className="space-y-0.5">
              {navLink('/mapa-atendimento', <LayoutDashboard size={20} />, 'Mapa de Atendimento', isMapaActive)}
            </div>
          )}

          {/* ── 2. Cadastro ────────────────────────────────────────────────── */}
          {temAlgumCadastroItem && (
            <div>
              <button onClick={() => toggleGroup('cadastro')}
                className={`flex items-center justify-between w-full px-5 py-3 text-sm font-semibold rounded-3xl transition-colors ${
                  activeSection === 'cadastro' || p.startsWith('/cadastro-pessoal') ||
                  p.startsWith('/animais-vet') || p.startsWith('/meus-animais')
                    ? CLS_MODULE_ACTIVE : CLS_MODULE_INACTIVE
                }`}>
                <span className="flex items-center gap-3"><FolderOpen size={20} /> Cadastro</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${openGroup === 'cadastro' ? 'rotate-180' : ''}`} />
              </button>

              {openGroup === 'cadastro' && (
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

                  {podVerCadastroPessoal && subLink('/cadastro-pessoal', <User size={14} />, 'Pessoal', p.startsWith('/cadastro-pessoal'))}
                  {podeVerEquipe        && subLink('/equipe',                 <Users2 size={14} />,  'Equipe',        p === '/equipe')}
                  {podeVerFornecedores  && subLink('/cadastro/fornecedores',  <Truck size={14} />,   'Fornecedores',  p.startsWith('/cadastro/fornecedores'))}
                  {podeVerLocalizacoes  && subLink('/cadastro/localizacoes',  <MapPin size={14} />,  'Localizações',  p.startsWith('/cadastro/localizacoes'))}
                  {podeVerCadProcedimentos && subLink('/cadastro/procedimentos', <ListChecks size={14} />, 'Procedimentos', p.startsWith('/cadastro/procedimentos'))}
                  {podeVerProprietarios && subLink('/cadastro/proprietarios', <Users size={14} />,   'Proprietários', p.startsWith('/cadastro/proprietarios'))}
                  {podeVerTratadores    && subLink('/cadastro/tratadores',    <UserCog size={14} />, 'Tratadores',    p.startsWith('/cadastro/tratadores'))}
                </div>
              )}
            </div>
          )}

          {/* ── Módulos (sem cabeçalho) ────────────────────────────────────── */}
          {isNewUser ? (
            <button
              type="button"
              onClick={() => navigate(destinoBloqueio)}
              className="block w-[calc(100%-1.5rem)] mx-3 my-4 px-5 py-5 bg-amber-50 border border-amber-200 rounded-3xl text-amber-700 text-sm text-left hover:bg-amber-100 transition-colors cursor-pointer"
            >
              <strong>Funcionalidades bloqueadas</strong><br />
              <span className="underline underline-offset-2">{mensagemBloqueio}</span>
            </button>
          ) : temAlgumModulo ? (
            <div>
              {(
                <div className="space-y-0.5">

                  {/* ── 3. Agendamento ───────────────────────────────── */}
                  {podeVerAgendamentos && (
                    <button
                      onClick={() => irParaModulo('/agendamentos')}
                      className={`w-full flex items-center gap-3 px-5 py-3 rounded-3xl text-sm font-semibold transition-colors ${
                        p.startsWith('/agendamentos') ? CLS_MODULE_ACTIVE : CLS_MODULE_INACTIVE
                      }`}
                    >
                      <CalendarClock size={20} />
                      Agendamento
                    </button>
                  )}

                  {/* ── 4. Atendimento (Execução de Prescrição vive aqui) ──── */}
                  {temAcessoClinico && (temAcessoAtendimento || podeVerEnfermagem) && (
                    <div>
                      {moduleButton('Atendimento', <Stethoscope size={20} />, 'clinica', openGroup === 'atendimento', () => toggleGroup('atendimento'))}
                      {openGroup === 'atendimento' && (
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
                          {/* Antes num grupo "Enfermagem" à parte — o plantão é a
                              continuação do atendimento, não um módulo separado. */}
                          {podeVerEnfermagem && subLink('/execucao-prescricao', <ClipboardCheck size={14} />, 'Execução de Prescrição', p.startsWith('/execucao-prescricao'))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── 5. Resultado de Exame ──────────────────────────────── */}
                  {podeVerExames && (
                    <div>
                      {moduleButton('Resultado de Exame', <Microscope size={20} />, 'exames', openGroup === 'exames', () => toggleGroup('exames'))}
                      {openGroup === 'exames' && (
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

                  {/* ── 6. Nutricional ───────────────────────────────────── */}
                  {temAcessoNutricional && (
                    <div>
                      {moduleButton('Nutricional', <Carrot size={20} />, 'nutricional', openGroup === 'nutricional', () => toggleGroup('nutricional'))}
                      {openGroup === 'nutricional' && (
                        <div className="mt-1 pl-6 space-y-0.5">
                          {podeVerDieta && subLink(
                            animalId ? `/dieta/${animalId}` : '/dieta',
                            <Utensils size={14} />, 'Plano de Dieta',
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

                  {/* ── 7. Financeiro (Orçamento + Faturamento) ───────────── */}
                  {(podeVerFaturas || podeVerOrcamento) && (
                    <div>
                      <button onClick={() => toggleGroup('financeiro')}
                        className={`flex items-center justify-between w-full px-5 py-3 text-sm font-semibold rounded-3xl transition-colors ${
                          p.startsWith('/faturamento') || p.startsWith('/orcamento')
                            ? CLS_MODULE_ACTIVE : CLS_MODULE_INACTIVE
                        }`}>
                        <span className="flex items-center gap-3"><DollarSign size={20} /> Financeiro</span>
                        <ChevronDown className={`w-4 h-4 transition-transform ${openGroup === 'financeiro' ? 'rotate-180' : ''}`} />
                      </button>
                      {openGroup === 'financeiro' && (
                        <div className="mt-1 pl-6 space-y-0.5">
                          {/* Orçamento antecede o faturamento no fluxo — e é dele que
                              os itens OUTROS caem na fatura. */}
                          {podeVerOrcamento && subLink('/orcamento',   <Receipt    size={14} />, 'Orçamento',   p.startsWith('/orcamento'))}
                          {podeVerFaturas   && subLink('/faturamento', <DollarSign size={14} />, 'Faturamento', p.startsWith('/faturamento'))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── 8. Estoque ────────────────────────────────────────── */}
                  {(podeVerEstoqueVacina || podeVerFarmacia) && (
                    <div>
                      {moduleButton('Estoque', <Package size={20} />, 'estoque', openGroup === 'estoque', () => toggleGroup('estoque'))}
                      {openGroup === 'estoque' && (
                        <div className="mt-1 pl-6 space-y-0.5">
                          {podeVerEstoqueVacina && subLink('/estoque-vacina', <Syringe size={14} />, 'Vacina', isEstoqueSubActive('/estoque-vacina'))}
                          {podeVerFarmacia && subLink('/farmacia', <FlaskConical size={14} />, 'Farmácia', isEstoqueSubActive('/farmacia'))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── 9. Relatórios ────────────────────────────────────── */}
                  {podeVerRelatorios && (
                    <div>
                      <button onClick={() => toggleGroup('relatorios')}
                        className={`flex items-center justify-between w-full px-5 py-3 text-sm font-semibold rounded-3xl transition-colors ${
                          p.startsWith('/relatorios') ? CLS_MODULE_ACTIVE : CLS_MODULE_INACTIVE
                        }`}>
                        <span className="flex items-center gap-3"><ChartBar size={20} /> Relatórios</span>
                        <ChevronDown className={`w-4 h-4 transition-transform ${openGroup === 'relatorios' ? 'rotate-180' : ''}`} />
                      </button>
                      {openGroup === 'relatorios' && (
                        <div className="mt-1 pl-6 space-y-0.5">
                          {subLink('/relatorios',             <ChartBar size={16} />,      'Gestão',              p === '/relatorios')}
                          {subLink('/relatorios/financeiro',  <DollarSign size={16} />,    'Financeiro',          p.startsWith('/relatorios/financeiro'))}
                          {subLink('/relatorios/atendimento', <CalendarClock size={16} />, 'Atendimento',         p.startsWith('/relatorios/atendimento'))}
                          {subLink('/relatorios/cadastro',    <Users size={16} />,         'Pacientes & Clientes', p.startsWith('/relatorios/cadastro'))}
                          {subLink('/relatorios/farmacia',    <Package size={16} />,       'Farmácia & Estoque',  p.startsWith('/relatorios/farmacia'))}
                          {subLink('/relatorios/orcamentos',  <Receipt size={16} />,       'Orçamentos',          p.startsWith('/relatorios/orcamentos'))}
                        </div>
                      )}
                    </div>
                  )}

                </div>
              )}
            </div>
          ) : null}

          {/* ═══ ADMINISTRAÇÃO ═══════════════════════════════════════════════ */}
          {/* pt-4: separação DELIBERADA — é um cabeçalho de seção, não um item do menu */}
          {podeVerAdministracao && (
            <div className="pt-4">
              <button onClick={() => toggle(setOpenAdministracao)}
                className="flex items-center justify-between w-full px-5 py-2.5 text-xs font-bold text-gray-400 uppercase tracking-widest hover:bg-gray-50 rounded-3xl">
                <span className="flex items-center gap-2"><ShieldCheck size={14} /> Administração</span>
                <ChevronDown className={`w-4 h-4 transition-transform ${openAdministracao ? 'rotate-180' : ''}`} />
              </button>

              {openAdministracao && (
                <div className="mt-1 space-y-0.5 pl-4">
                  {/* Configurações e Auditoria vieram da antiga seção "Geral": são
                      administração da clínica, não do dia a dia clínico. */}
                  {isGestor && navLink('/configuracoes', <Settings size={20} />, 'Configurações', p.startsWith('/configuracoes'))}
                  {(isGestor || isAdmin) && navLink('/auditoria-geral', <ScrollText size={20} />, 'Auditoria', p.startsWith('/auditoria-geral'))}
                  {isAdmin && navLink('/configuracao-alertas', <Bell  size={20} />, 'Alertas',     isAdminActive('/configuracao-alertas'))}
                  {isAdmin && navLink('/monitoracao',          <Gauge size={20} />, 'Monitoração', isAdminActive('/monitoracao'))}
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

        {/* Sem rodapé de usuário: identidade, perfil e "Sair" vivem no menu do
            AppHeader (fonte única — evita dois lugares para a mesma ação). */}
      </div>

      {/* Backdrop mobile */}
      {isMobileMenuOpen && (
        <div onClick={closeMobile} className="md:hidden fixed inset-0 bg-black/50 z-40" />
      )}

    </>
  );
}