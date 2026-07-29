// src/components/Verificacao2FA.tsx
// Segundo passo do login: o usuário digita o código de 6 dígitos enviado ao
// e-mail cadastrado. A sessão só nasce quando este componente recebe 200 de
// POST /api/auth/2fa/verificar (o backend seta os cookies HttpOnly ali).

import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, Loader2, ArrowLeft, MailCheck } from 'lucide-react';
import InlineError from './InlineError';

export interface DesafioMfa {
  desafioId:       string;
  emailMascarado:  string;
  validadeMinutos: number;
}

interface Props {
  desafio:    DesafioMfa;
  /** Código aceito — o chamador carrega a identidade e redireciona. */
  onVerificado: () => Promise<void> | void;
  /** Voltar para o formulário de e-mail/senha. */
  onCancelar: () => void;
}

const TAMANHO = 6;
const ESPERA_REENVIO_S = 45;

export default function Verificacao2FA({ desafio, onVerificado, onCancelar }: Props) {
  const [codigo,    setCodigo]    = useState('');
  const [erro,      setErro]      = useState('');
  const [aviso,     setAviso]     = useState('');
  const [enviando,  setEnviando]  = useState(false);
  const [reenviando, setReenviando] = useState(false);
  const [espera,    setEspera]    = useState(ESPERA_REENVIO_S);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Contagem para liberar o reenvio (evita rajada de e-mails)
  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  const verificar = async (valor: string) => {
    setEnviando(true);
    setErro('');
    setAviso('');
    try {
      const res  = await fetch('/api/auth/2fa/verificar', {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ desafioId: desafio.desafioId, codigo: valor }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        await onVerificado();
        return;
      }

      // Desafio morto (expirado / tentativas / reenvios) → só refazendo o login
      if (['EXPIRADO', 'TENTATIVAS_EXCEDIDAS', 'REENVIOS_EXCEDIDOS'].includes(data.motivo)) {
        setErro(data.error ?? 'Código expirado. Faça o login novamente.');
        setCodigo('');
        return;
      }

      const restantes = typeof data.restantes === 'number' ? data.restantes : null;
      setErro(
        restantes !== null && restantes > 0
          ? `Código inválido. ${restantes} ${restantes === 1 ? 'tentativa restante' : 'tentativas restantes'}.`
          : (data.error ?? 'Código inválido.'),
      );
      setCodigo('');
      inputRef.current?.focus();
    } catch {
      setErro('Erro de conexão com o servidor');
    } finally {
      setEnviando(false);
    }
  };

  const onChangeCodigo = (v: string) => {
    const limpo = v.replace(/\D/g, '').slice(0, TAMANHO);
    setCodigo(limpo);
    // Verifica sozinho ao completar os 6 dígitos — evita um clique extra
    if (limpo.length === TAMANHO && !enviando) verificar(limpo);
  };

  const reenviar = async () => {
    setReenviando(true);
    setErro('');
    setAviso('');
    try {
      const res  = await fetch('/api/auth/2fa/reenviar', {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ desafioId: desafio.desafioId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setAviso('Enviamos um novo código.');
        setEspera(ESPERA_REENVIO_S);
        setCodigo('');
        inputRef.current?.focus();
      } else {
        setErro(data.error ?? 'Não foi possível reenviar o código.');
      }
    } catch {
      setErro('Erro de conexão com o servidor');
    } finally {
      setReenviando(false);
    }
  };

  return (
    <div className="w-full">
      <div className="flex flex-col items-center text-center mb-6">
        <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center mb-3">
          <ShieldCheck size={22} className="text-emerald-700" />
        </div>
        <h2 className="text-lg font-bold text-gray-900">Verificação em duas etapas</h2>
        <p className="text-sm text-gray-500 mt-1">
          Enviamos um código de {TAMANHO} dígitos para{' '}
          <span className="font-medium text-gray-700">{desafio.emailMascarado}</span>.
        </p>
      </div>

      <form
        onSubmit={e => { e.preventDefault(); if (codigo.length === TAMANHO) verificar(codigo); }}
        className="space-y-4"
      >
        <div>
          <label htmlFor="codigo2fa" className="block text-sm font-medium text-gray-700 mb-1">
            Código de verificação
          </label>
          <input
            id="codigo2fa"
            ref={inputRef}
            value={codigo}
            onChange={e => onChangeCodigo(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            disabled={enviando}
            className="w-full px-4 py-3 border border-gray-300 rounded-xl text-center text-2xl font-mono tracking-[0.5em] focus:ring-2 focus:ring-emerald-500 focus:border-transparent disabled:bg-gray-50"
          />
          <p className="text-xs text-gray-400 mt-1.5 text-center">
            O código expira em {desafio.validadeMinutos} minutos.
          </p>
        </div>

        <InlineError message={erro} />
        {aviso && (
          <p className="flex items-center gap-1.5 text-sm text-emerald-700">
            <MailCheck size={15} /> {aviso}
          </p>
        )}

        <button
          type="submit"
          disabled={enviando || codigo.length !== TAMANHO}
          className="w-full flex items-center justify-center gap-2 bg-emerald-700 text-white py-3 rounded-xl font-semibold hover:bg-emerald-800 disabled:opacity-50 transition-colors"
        >
          {enviando && <Loader2 size={16} className="animate-spin" />}
          {enviando ? 'Verificando...' : 'Confirmar'}
        </button>
      </form>

      <div className="flex items-center justify-between mt-5">
        <button
          type="button"
          onClick={onCancelar}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft size={14} /> Voltar
        </button>

        <button
          type="button"
          onClick={reenviar}
          disabled={reenviando || espera > 0}
          className="text-sm font-medium text-emerald-700 hover:text-emerald-800 disabled:text-gray-300"
        >
          {reenviando
            ? 'Reenviando...'
            : espera > 0 ? `Reenviar em ${espera}s` : 'Reenviar código'}
        </button>
      </div>

      <p className="text-xs text-gray-400 mt-6 text-center leading-relaxed">
        Não compartilhe este código. Ninguém do S2Vet vai pedi-lo por telefone,
        WhatsApp ou e-mail.
      </p>
    </div>
  );
}
