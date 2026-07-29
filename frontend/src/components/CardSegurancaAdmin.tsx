// src/components/CardSegurancaAdmin.tsx
// Configuração GLOBAL de segurança — exclusiva do ADMIN da plataforma.
// Fica dentro de Configurações, mas NÃO é configuração de empresa: o que se liga
// aqui vale para todos os tenants. Por isso salva sozinho (fora do form da
// empresa) e não depende do botão "Salvar" da página.

import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Loader2, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import InlineError from './InlineError';

interface ConfigSeguranca {
  mfaEmailAtivo:   boolean;
  atualizadoEm:    string | null;
  atualizadoPor:   string | null;
  /** MFA_EMAIL_ENABLED=false no .env — o kill-switch vence o toggle. */
  bloqueadoPorEnv: boolean;
}

export default function CardSegurancaAdmin() {
  const [config,     setConfig]     = useState<ConfigSeguranca | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando,   setSalvando]   = useState(false);
  const [erro,       setErro]       = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const res = await api.get('/seguranca/config');
      if (!res.data) return;
      setConfig(res.data.dados as ConfigSeguranca);
    } catch {
      setErro('Não foi possível carregar a configuração de segurança.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const alternar = async (ativo: boolean) => {
    setSalvando(true);
    setErro(null);
    try {
      const res = await api.put('/seguranca/config', { mfaEmailAtivo: ativo });
      setConfig(res.data?.dados ?? null);
      toast.success(
        ativo
          ? 'Verificação em duas etapas ativada para toda a plataforma.'
          : 'Verificação em duas etapas desativada.',
      );
    } catch (err) {
      const e = err as { isPermissionError?: boolean };
      if (!e.isPermissionError) setErro('Não foi possível salvar a configuração.');
    } finally {
      setSalvando(false);
    }
  };

  if (carregando) {
    return (
      <div className="border border-gray-200 rounded-2xl p-4 flex items-center gap-2 text-sm text-gray-400">
        <Loader2 size={15} className="animate-spin" /> Carregando segurança…
      </div>
    );
  }

  if (!config) return <InlineError message={erro} />;

  const ativo = config.mfaEmailAtivo;

  return (
    <div className="border border-gray-200 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck size={16} className="text-emerald-600" />
        <h2 className="text-sm font-bold text-gray-800">Segurança da plataforma</h2>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-900 text-white">ADMIN</span>
      </div>
      <p className="text-xs text-gray-400 mb-4">
        Vale para todas as empresas e usuários, não só para esta clínica.
      </p>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-800">Verificação em duas etapas (2FA) por e-mail</p>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
            Ao entrar com e-mail e senha, o usuário recebe um código de 6 dígitos no
            e-mail cadastrado e só acessa o sistema depois de informá-lo.
            O login com Google não é afetado.
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={ativo}
          aria-label="Verificação em duas etapas por e-mail"
          disabled={salvando || config.bloqueadoPorEnv}
          onClick={() => alternar(!ativo)}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
            ativo ? 'bg-emerald-600' : 'bg-gray-300'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              ativo ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg ${
          ativo ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
        }`}>
          {ativo ? 'Ativado' : 'Desativado'}
        </span>
        {salvando && <Loader2 size={13} className="animate-spin text-emerald-600" />}
        {config.atualizadoEm && (
          <span className="text-[11px] text-gray-400">
            Alterado em {new Date(config.atualizadoEm).toLocaleDateString('pt-BR')}
            {config.atualizadoPor ? ` por ${config.atualizadoPor}` : ''}
          </span>
        )}
      </div>

      {config.bloqueadoPorEnv && (
        <div className="mt-3 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          <AlertTriangle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700">
            O 2FA está desligado no servidor por <code className="font-mono">MFA_EMAIL_ENABLED=false</code>.
            Enquanto essa variável existir, este seletor não tem efeito.
          </p>
        </div>
      )}

      {ativo && !config.bloqueadoPorEnv && (
        <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
          Exige envio de e-mail funcionando. Se o SMTP cair, ninguém entra com senha —
          use <code className="font-mono">MFA_EMAIL_ENABLED=false</code> no servidor para desligar em emergência.
        </p>
      )}

      <InlineError message={erro} className="mt-3" />
    </div>
  );
}
