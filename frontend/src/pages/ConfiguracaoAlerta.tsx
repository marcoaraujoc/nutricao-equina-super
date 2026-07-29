// src/pages/ConfiguracaoAlerta.tsx
// Configuração dos alertas das tarefas agendadas (cron) — ADMIN.
// Lida ao vivo pelo cron (backend): destinatários, política de sucesso e liga/desliga.
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';
import { Bell, Loader2, Mail, Clock } from 'lucide-react';
import PageContainer from '../components/PageContainer';
import CardSegurancaAdmin from '../components/CardSegurancaAdmin';
import BotaoVoltar from '../components/BotaoVoltar';
import { useAuth } from '../contexts/AuthContext';
import { usePermissoes } from '../hooks/usePermissoes';
import InlineError from '../components/InlineError';

interface Agenda { chave: string; nome: string; expr: string; exprPadrao: string; ativo: boolean }

// Descrição amigável (best-effort) das expressões cron mais comuns do sistema.
function descreverCron(expr: string): string {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) return 'expressão personalizada';
  const [min, hora, dia, mes, dsem] = p;
  const todos = dia === '*' && mes === '*' && dsem === '*';
  if (min.startsWith('*/') && hora === '*' && todos) return `a cada ${min.slice(2)} min`;
  if (hora === '*' && todos && /^\d+$/.test(min))     return `a cada hora (min ${min})`;
  if (/^\d+$/.test(min) && /^\d+$/.test(hora) && todos)
    return `diariamente às ${hora.padStart(2, '0')}:${min.padStart(2, '0')}`;
  return 'expressão personalizada';
}

export default function ConfiguracaoAlerta() {
  const { user } = useAuth();
  const { isGestor } = usePermissoes();
  const isAdmin = isGestor || user?.userType === 'ADMIN'; // ADMIN ou GESTOR podem gerenciar
  // A configuração de SEGURANÇA é global da plataforma: só o ADMIN, nunca o GESTOR.
  // (O backend já exige authorize('ADMIN'); aqui é para nem exibir o seletor.)
  const isAdminPlataforma =
    user?.userType?.toUpperCase() === 'ADMIN' || user?.role?.toUpperCase() === 'ADMIN';
  const navigate = useNavigate();

  const [loading,  setLoading]  = useState(true);
  const [salvando, setSalvando] = useState(false);
  // Erro de ação exibido inline (substitui o toast de erro)
  const [erroInline, setErroInline] = useState<string | null>(null);

  const [emails,           setEmails]           = useState('');
  const [notificarSucesso, setNotificarSucesso] = useState(true);
  const [ativo,            setAtivo]            = useState(true);

  const [agendas,     setAgendas]     = useState<Agenda[]>([]);
  const [savingChave, setSavingChave] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const [cfg, ag] = await Promise.all([
        api.get('/monitoracao/config'),
        api.get('/monitoracao/agendas'),
      ]);
      const d = cfg.data?.dados;
      if (d) {
        setEmails(String(d.emails ?? '').split(',').filter(Boolean).join('\n'));
        setNotificarSucesso(d.notificarSucesso ?? true);
        setAtivo(d.ativo ?? true);
      }
      if (ag.data?.dados) setAgendas(ag.data.dados as Agenda[]);
    } catch {
      setErroInline('Erro ao carregar configuração de alertas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) { setLoading(false); return; }
    carregar();
  }, [isAdmin, carregar]);

  const handleSalvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    try {
      // aceita e-mails separados por linha, vírgula ou ponto-e-vírgula
      const lista = emails.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
      await api.put('/monitoracao/config', {
        emails: lista.join(','),
        notificarSucesso,
        ativo,
      });
      toast.success('Configuração de alertas salva!');
      navigate('/monitoracao');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErroInline(msg ?? 'Erro ao salvar configuração de alertas.');
    } finally {
      setSalvando(false);
    }
  };

  const atualizarAgenda = (chave: string, patch: Partial<Agenda>) =>
    setAgendas(prev => prev.map(a => a.chave === chave ? { ...a, ...patch } : a));

  const salvarAgenda = async (a: Agenda) => {
    setSavingChave(a.chave);
    try {
      const r = await api.put(`/monitoracao/agendas/${a.chave}`, { cronExpr: a.expr, ativo: a.ativo });
      if (r.data?.dados) atualizarAgenda(a.chave, { expr: r.data.dados.expr, ativo: r.data.dados.ativo });
      toast.success(`"${a.nome}" reagendada.`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErroInline(msg ?? 'Erro ao reagendar tarefa.');
    } finally {
      setSavingChave(null);
    }
  };

  if (!isAdmin) {
    return (
      <PageContainer maxWidth="3xl">
        <div className="text-center py-16">
          <h2 className="text-xl font-semibold text-gray-700">Acesso não autorizado</h2>
          <p className="text-gray-500 mt-2">Esta configuração é restrita ao administrador.</p>
        </div>
      </PageContainer>
    );
  }

  if (loading) {
    return (
      <PageContainer maxWidth="3xl">
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-emerald-600" size={32} /></div>
      </PageContainer>
    );
  }

  return (
    <PageContainer maxWidth="3xl">
      <InlineError message={erroInline} className="mb-4" />

      <BotaoVoltar className="mb-4" />

      <div className="flex items-center gap-2 mb-1">
        <Bell size={22} className="text-emerald-600" />
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Configuração</h1>
      </div>
      <p className="text-gray-500 mb-6 text-sm">Ajustes globais da plataforma — valem para todas as empresas.</p>

      {/* Segurança da plataforma — só ADMIN. Salva sozinho, fora do form de alertas. */}
      {isAdminPlataforma && (
        <div className="bg-white shadow rounded-3xl p-5 sm:p-8 mb-6">
          <CardSegurancaAdmin />
        </div>
      )}

      <h2 className="text-sm font-bold text-gray-800 mb-1">Alertas das tarefas agendadas</h2>
      <p className="text-gray-500 mb-3 text-xs">Enviados por e-mail (cron). Aplicado automaticamente na próxima execução.</p>

      <form onSubmit={handleSalvar} className="bg-white shadow rounded-3xl p-5 sm:p-8 space-y-6">

        {/* Ativo */}
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={ativo} onChange={e => setAtivo(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-emerald-600" />
          <span>
            <span className="block text-sm font-semibold text-gray-700">Enviar alertas por e-mail</span>
            <span className="block text-xs text-gray-400">Desligado, o sistema ainda registra as execuções na Monitoração, mas não envia e-mail.</span>
          </span>
        </label>

        {/* Notificar sucesso */}
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={notificarSucesso} onChange={e => setNotificarSucesso(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-emerald-600" disabled={!ativo} />
          <span>
            <span className={`block text-sm font-semibold ${ativo ? 'text-gray-700' : 'text-gray-400'}`}>Avisar também os sucessos relevantes</span>
            <span className="block text-xs text-gray-400">Desligado, só envia e-mail quando uma tarefa <strong>falha</strong>. Ligado, avisa também quando fez trabalho (ex.: N faturas fechadas).</span>
          </span>
        </label>

        {/* Destinatários */}
        <div>
          <label className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 mb-1">
            <Mail size={15} className="text-emerald-500" /> Destinatários
          </label>
          <textarea
            value={emails}
            onChange={e => setEmails(e.target.value)}
            placeholder={'admin@empresa.com\noutro@empresa.com'}
            rows={4}
            className="w-full border border-gray-300 rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
          />
          <p className="text-xs text-gray-400 mt-1">Um e-mail por linha (ou separados por vírgula). Em branco, usa os usuários ADMIN do sistema.</p>
        </div>

        <button type="submit" disabled={salvando}
          className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold rounded-2xl py-3 transition-colors">
          {salvando ? 'Salvando...' : 'Salvar'}
        </button>
      </form>

      {/* Agendamento das tarefas (horário) — reagendamento dinâmico */}
      <div className="mt-8">
        <div className="flex items-center gap-2 mb-1">
          <Clock size={18} className="text-emerald-600" />
          <h2 className="text-lg font-bold text-gray-900">Agendamento das tarefas</h2>
        </div>
        <p className="text-gray-500 mb-4 text-sm">
          Horário de cada tarefa em expressão cron (5 campos: <code className="text-xs bg-gray-100 px-1 rounded">min hora dia mês diaSemana</code>).
          Alterações são aplicadas ao vivo, sem reiniciar o backend.
        </p>

        <div className="bg-white shadow rounded-3xl divide-y divide-gray-50 overflow-hidden">
          {agendas.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8">Nenhuma tarefa registrada ainda (aguardando o backend iniciar as tarefas).</p>
          ) : agendas.map(a => (
            <div key={a.chave} className="p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-sm font-semibold text-gray-800">{a.nome}</span>
                <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer flex-shrink-0">
                  <input type="checkbox" checked={a.ativo} onChange={e => atualizarAgenda(a.chave, { ativo: e.target.checked })}
                    className="w-4 h-4 accent-emerald-600" />
                  Ativa
                </label>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <input
                  value={a.expr}
                  onChange={e => atualizarAgenda(a.chave, { expr: e.target.value })}
                  placeholder={a.exprPadrao}
                  className="flex-1 font-mono text-sm border border-gray-300 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button
                  onClick={() => salvarAgenda(a)}
                  disabled={savingChave === a.chave}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors flex-shrink-0">
                  {savingChave === a.chave ? 'Salvando...' : 'Aplicar'}
                </button>
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">
                {descreverCron(a.expr)}
                {a.expr !== a.exprPadrao && <span className="ml-1">· padrão: <span className="font-mono">{a.exprPadrao}</span></span>}
              </p>
            </div>
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
