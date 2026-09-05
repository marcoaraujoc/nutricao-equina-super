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
  FileText, Syringe, Microscope, Scan,
  FolderOpen, UserCog, Truck, MapPin, CalendarClock,
  Package, UserPlus, ScrollText, Building2,
  Bell, Gauge, ListChecks, Receipt, Layers, HardHat, FileDown,
} from 'lucide-react';
import { usePermissoes } from '../hooks/usePermissoes';

// ─── Estilos ──────────────────────────────────────────────────────────────────
const CLS_MODULE_ACTIVE  = 'bg-emerald-50 text-emerald-600';
const CLS_MODULE_INACTIVE= 'text-gray-500 hover:bg-gray-50';

const ROLES_CLINICAS = ['ADMIN', 'VETERINARIO', 'ESTAGIARIO', 'FORNECEDOR'];

// Rotas que pertencem à seção ADMINISTRAÇÃO. Fonte ÚNICA: a mesma lista decide a seção
// ativa (`detectSection`) e se o accordion nasce aberto. Eram duas cópias idênticas —
// item novo entrava numa e não na outra, e o accordion fechava sozinho na rota nova.
// Configurações, Empresa e Auditoria ficam FORA de propósito: são de gestor, e o estado
// ativo delas é resolvido direto por `p.startsWith`, sem depender da seção.
const ROTAS_ADMIN = [
  '/admin/empresas',
  '/admin/vacinas',
  '/ai-usage',
  '/configuracao-alertas',
  '/controle-acesso',
  '/equipe-manager',
  '/medicamentos',
  '/monitoracao',
  '/planos',
  '/procedimentos',
  '/usuarios',
];
const ehRotaAdmin = (pathname: string) => ROTAS_ADMIN.some(r => pathname.startsWith(r));

// ─── Detectar seção ativa ─────────────────────────────────────────────────────
/**
 * 🔴 MAPA DE ATENDIMENTO ESCONDIDO DO MENU (a pedido, 2026-09-05) — desligado, NÃO
 * removido. A rota `/mapa-atendimento`, a tela (`pages/MapaAtendimento.tsx`), o
 * controller e a permissão `dashboard.geral.ler` continuam montados e funcionando:
 * chega-se a ela pela URL, como ao editor de modelos de documento (§12, 30/08).
 * ⚠️ Para voltar a exibir, basta `true` aqui — nenhuma outra linha precisa mudar.
 * ⚠️ Não apagar o item nem o gate `podeVerDashboard` enquanto isto for `false`: é o
 * que mantém a volta em uma palavra em vez de uma reconstrução.
 */
const MOSTRAR_MAPA_ATENDIMENTO = false;

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
  if (ehRotaAdmin(pathname)) return 'admin';
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
  const { marca } = useEmpresa();
  // ⚠️ Os TRÊS hooks de polling de VÍNCULO saíram na fase 3 do multi-tenancy:
  // `useVetSolicitacaoMonitor`, `useProprietarioNotificacoes` e `useVetPendentes`
  // observavam solicitações de vínculo/desvínculo, que não existem mais. O acesso ao
  // paciente vem da EMPRESA — não há o que pedir nem o que aprovar, logo não há
  // pendência a contar. Com isso o badge de "Pacientes" e o sino do header saíram junto.

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
  // Medicamentos/Procedimentos (catálogo GLOBAL): os links abaixo são ADMIN-only
  // por decisão — a rota (`requireAdmin` em routes/medicamentos.js) só aceita o
  // ADMIN da plataforma para criar/editar/excluir. Os slugs `medicamentos.catalogo.*`/
  // `procedimentos.catalogo.*` da matriz não controlam o acesso a esta tela (o
  // gestor pode até "conceder" o slug a alguém, sem efeito nenhum aqui).
  const podeVerCadProcedimentos = isAdmin || isGestor || podeExecutar('cadastro.procedimento.ler');
  const podeVerProprietarios   = isAdmin || isGestor || podeExecutar('cadastro.proprietario.ler');
  const podeVerTratadores      = isAdmin || isGestor || podeExecutar('cadastro.tratador.ler');
  const podeVerFornecedores    = isAdmin || isGestor || podeExecutar('cadastro.fornecedor.ler');
  const podeVerPrestadores     = isAdmin || isGestor || podeExecutar('cadastro.prestador.ler');
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
  // o que falta preencher. GESTOR de empresa precisa de Cadastro Pessoal E Cadastro da
  // Empresa; demais perfis só de Cadastro Pessoal (proprietário tem sua própria regra).
  const faltaCadastroPessoal = !cadastroCompleto;
  const faltaConfigEmpresa   = isGestorEmpresa && !empresaConfigurada;
  const destinoBloqueio = faltaCadastroPessoal
    ? '/cadastro-pessoal'
    : faltaConfigEmpresa
      ? '/cadastro/empresa'
      : '/animais';
  const mensagemBloqueio = isProprietario
    ? 'Complete seu Cadastro e cadastre seu primeiro animal para liberar os módulos.'
    : faltaCadastroPessoal && faltaConfigEmpresa
      ? 'Complete seu Cadastro Pessoal e o Cadastro da Empresa para liberar os módulos.'
      : faltaConfigEmpresa
        ? 'Complete o Cadastro da Empresa para liberar os módulos.'
        : 'Complete seu Cadastro Pessoal para liberar os módulos.';

  // Itens visíveis no accordion Cadastro e na seção Geral
  const temAlgumCadastroItem =
    (temAcessoClinico && podeVerAnimais) ||
    !temAcessoClinico ||           // proprietários: sempre mostra meus-animais
    podVerCadastroPessoal ||       // profissionais com ao menos 1 permissão ativa
    podeVerEquipe ||
    podeVerFornecedores ||
    podeVerPrestadores ||
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
  const isModuleActive         = (mod: ActiveSection) => activeSection === mod;
  const isNutricionalSubActive = (path: string) => activeSection === 'nutricional' && p.startsWith(path);
  const isEstoqueSubActive     = (path: string) => activeSection === 'estoque'     && p.startsWith(path);
  const isAdminActive          = (path: string) => activeSection === 'admin' && p.startsWith(path);

  // ── Estados dos menus ─────────────────────────────────────────────────────
  // Só ADMINISTRAÇÃO continua sendo seção-contêiner: os cabeçalhos "Geral" e
  // "Módulos" saíram (2026-07-30) e os itens ficaram no nível raiz do menu.
  const [openAdministracao, setOpenAdministracao] = useState(() => ehRotaAdmin(p));

  // Accordion de grupos: no máximo UM grupo expansível aberto por vez em todo o
  // sidebar. Abrir um fecha o anterior. Inicializa no grupo da rota ativa.
  const [openGroup, setOpenGroup] = useState<string | null>(() => {
    // Atendimento, Vacina e Execução de Prescrição são módulos FOLHA (link direto,
    // sem sub-itens) — não abrem grupo nenhum.
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

          {/* ── 1. Painel Principal ────────────────────────────────────────── */}
          {/* Exclusivo do perfil VETERINÁRIO. `isVet` já resolve pelo tipo do
              CONTEXTO ATIVO (o backend o deriva do cargo do vínculo), então quem é
              veterinária nesta clínica vê o item, e quem é estagiária aqui não —
              mesmo sendo vet na outra. Sem `isVetOuSuperior`: o item foi pedido para
              o veterinário, e o gestor tem o Mapa de Atendimento logo abaixo. */}
          {isVet && (
            <div className="space-y-0.5">
              {navLink('/painel-principal', <Stethoscope size={20} />, 'Painel Principal', p.startsWith('/painel-principal'))}
            </div>
          )}

          {/* ── 2. Mapa de Atendimento ─── ESCONDIDO (ver MOSTRAR_MAPA_ATENDIMENTO) ─ */}
          {MOSTRAR_MAPA_ATENDIMENTO && podeVerDashboard && (
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
                  {podVerCadastroPessoal && subLink('/cadastro-pessoal', <User size={14} />, 'Pessoal', p.startsWith('/cadastro-pessoal'))}

                  {temAcessoClinico
                    ? (podeVerAnimais && (
                      <Link key="/animais-vet" to="/animais-vet" onClick={closeMobile}
                        className={`flex items-center gap-3 px-5 py-2.5 rounded-2xl text-sm transition-colors ${
                          p.startsWith('/animais-vet') ? 'bg-emerald-100 text-emerald-700 font-medium' : 'text-gray-600 hover:bg-gray-100'
                        }`}>
                        <Zap size={14} className="flex-shrink-0" />
                        <span className="flex-1">Pacientes</span>
                      </Link>
                    ))
                    : subLink('/meus-animais', <Zap size={14} />, 'Animais', p.startsWith('/meus-animais'))
                  }

                  {podeVerEquipe        && subLink('/equipe',                 <Users2 size={14} />,  'Equipe',        p === '/equipe')}
                  {podeVerFornecedores  && subLink('/cadastro/fornecedores',  <Truck size={14} />,   'Fornecedores',  p.startsWith('/cadastro/fornecedores'))}
                  {podeVerPrestadores   && subLink('/cadastro/prestadores',   <HardHat size={14} />, 'Prestadores',   p.startsWith('/cadastro/prestadores'))}
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

                  {/* ── 4. Atendimento ─────────────────────────────────────
                      Deixou de ser accordion: é um LINK DIRETO para a Agenda do
                      profissional. Evolução, Prescrição, Pedido de Exames e
                      Encaminhamento continuam alcançáveis — são as ABAS de dentro da
                      própria tela (SubMenuClinico), então tê-los também aqui era o
                      mesmo menu em dois lugares.
                      O `!startsWith('/clinica/vacina')` no ativo não é detalhe: a rota
                      da Vacina também começa com `/clinica` e, sem o recorte, os dois
                      itens acendiam juntos. */}
                  {temAcessoClinico && temAcessoAtendimento && (
                    <button
                      onClick={() => irParaModulo('/clinica/agenda')}
                      className={`w-full flex items-center gap-3 px-5 py-3 rounded-3xl text-sm font-semibold transition-colors ${
                        p.startsWith('/clinica') && !p.startsWith('/clinica/vacina')
                          ? CLS_MODULE_ACTIVE : CLS_MODULE_INACTIVE
                      }`}
                    >
                      <Stethoscope size={20} />
                      Atendimento
                    </button>
                  )}

                  {/* ── 4b. Vacina ─────────────────────────────────────────
                      Tela apartada (não é mais aba do Atendimento), então precisa da
                      própria entrada: sem ela não haveria como registrar vacina nova. */}
                  {temAcessoClinico && podeVerVacinas && (
                    <button
                      onClick={() => irParaModulo(animalId ? `/clinica/vacina/${animalId}` : '/clinica/vacina')}
                      className={`w-full flex items-center gap-3 px-5 py-3 rounded-3xl text-sm font-semibold transition-colors ${
                        p.startsWith('/clinica/vacina') ? CLS_MODULE_ACTIVE : CLS_MODULE_INACTIVE
                      }`}
                    >
                      <Syringe size={20} />
                      Vacina
                    </button>
                  )}

                  {/* ── 4c. Execução de Prescrição (plantão) ───────────────
                      Subiu para o primeiro nível junto com a Vacina: é a tela onde o
                      ENFERMEIRO trabalha, e escondê-la dentro de outro módulo a
                      deixava sem porta de entrada para o perfil que mais a usa. */}
                  {temAcessoClinico && podeVerEnfermagem && (
                    <button
                      onClick={() => irParaModulo('/execucao-prescricao')}
                      className={`w-full flex items-center gap-3 px-5 py-3 rounded-3xl text-sm font-semibold transition-colors ${
                        p.startsWith('/execucao-prescricao') ? CLS_MODULE_ACTIVE : CLS_MODULE_INACTIVE
                      }`}
                    >
                      <ClipboardCheck size={20} />
                      Execução de Prescrição
                    </button>
                  )}

                  {/* ── 4d. Central de Documentos ─────────────────────────
                      Módulo folha: a tela já tem a própria biblioteca de modelos
                      (categorias, favoritos, recentes), então repetir isso aqui como
                      accordion seria o mesmo menu duas vezes. */}
                  {temAcessoClinico && (
                    <button
                      onClick={() => irParaModulo('/documentos')}
                      className={`w-full flex items-center gap-3 px-5 py-3 rounded-3xl text-sm font-semibold transition-colors ${
                        p.startsWith('/documentos') ? CLS_MODULE_ACTIVE : CLS_MODULE_INACTIVE
                      }`}
                    >
                      <FileText size={20} />
                      Documentos
                    </button>
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
                  {/* Auditoria veio da antiga seção "Geral": é administração da clínica,
                      não do dia a dia clínico. */}
                  {/* ORDEM ALFABÉTICA CRESCENTE pelo RÓTULO, independente do perfil que
                      enxerga cada item — a seção mistura itens de gestor e de ADMIN, e
                      agrupá-los por perfil fazia a lista mudar de ordem conforme quem
                      entrava. Item novo entra na posição alfabética, não no fim. */}
                  {isAdmin && navLink('/configuracao-alertas', <Bell size={20} />, 'Alertas', isAdminActive('/configuracao-alertas'))}
                  {(isGestor || isAdmin) && navLink('/auditoria-geral', <ScrollText size={20} />, 'Auditoria', p.startsWith('/auditoria-geral'))}
                  {/* Tela ÚNICA do Gestor (2026-08-17): identidade da empresa (nome,
                      CNPJ/CPF, razão social, endereço, espécies) + preferências
                      operacionais (logo, fechamento, expediente, WhatsApp) — antes eram
                      dois itens de menu ("Empresa" e "Configurações"), viraram um só.
                      O ADMIN não tem entrada própria aqui de propósito (2026-08-16): o
                      backend aceita o ADMIN em `/cadastro/empresa`, mas quem cria o
                      tenant é "Criação de Gestor", e quem acompanha a carteira é
                      "Empresas" — sem duplicar rota no menu do ADMIN. */}
                  {isGestor && navLink('/cadastro/empresa', <Building2 size={20} />, 'Cadastro da Empresa', p.startsWith('/cadastro/empresa'))}
                  {navLink('/controle-acesso', <ShieldCheck size={20} />, 'Controle de Acesso', isAdminActive('/controle-acesso'))}
                  {/* "Criação de Gestor" (ADMIN, cria só o gestor — dados básicos + plano;
                      a empresa nasce em branco) × "Empresas" (ADMIN, acompanha a carteira:
                      visualiza, inativa/reativa e troca o plano de qualquer empresa). A
                      identidade de CADA empresa é o próprio gestor quem completa, em
                      "Cadastro da Empresa" (acima). */}
                  {isAdmin && navLink('/admin/criacao-gestor', <UserPlus size={20} />, 'Criação de Gestor', isAdminActive('/admin/criacao-gestor'))}
                  {isAdmin && navLink('/admin/empresas', <Building2 size={20} />, 'Empresas', isAdminActive('/admin/empresas'))}
                  {/* Exportação de prontuário — GESTOR exporta os PRÓPRIOS pacientes (RLS
                      já escopa a lista); ADMIN alcança conforme o contexto ativo dele. */}
                  {(isGestor || isAdmin) && navLink('/admin/exportacao', <FileDown size={20} />, 'Exportação', isAdminActive('/admin/exportacao'))}
                  {isAdmin && navLink('/medicamentos', <Pill size={20} />, 'Medicamentos', isAdminActive('/medicamentos'))}
                  {isAdmin && navLink('/monitoracao', <Gauge size={20} />, 'Monitoração', isAdminActive('/monitoracao'))}
                  {isAdmin && navLink('/ai-usage', <Users size={20} />, 'Monitoramento IA', isAdminActive('/ai-usage'))}
                  {isAdmin && navLink('/planos', <Layers size={20} />, 'Planos', isAdminActive('/planos'))}
                  {isAdmin && navLink('/procedimentos', <Activity size={20} />, 'Procedimentos', isAdminActive('/procedimentos'))}
                  {isAdmin && navLink('/usuarios', <Users size={20} />, 'Usuários', isAdminActive('/usuarios'))}
                  {isAdmin && navLink('/admin/vacinas', <Syringe size={20} />, 'Vacinas', isAdminActive('/admin/vacinas'))}
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