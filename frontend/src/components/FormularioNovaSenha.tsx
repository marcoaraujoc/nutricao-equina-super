// src/components/FormularioNovaSenha.tsx
//
// Formulário de DEFINIÇÃO DE SENHA — fonte única de aparência e de regras.
//
// Usado por:
//   • AlterarSenhaObrigatoria  (dentro da aplicação, primeiro acesso / senha temporária)
//   • ResetPassword            (link do e-mail de "esqueci minha senha")
//
// POR QUÊ extrair: as duas telas faziam a mesma coisa com caras diferentes — a do e-mail
// usava emoji (🙈/👁️) no lugar dos ícones lucide, fundo escuro em vez do cinza da
// aplicação, e validava só no submit, então o usuário só descobria o requisito depois de
// errar. Quem chega pelo e-mail acha que caiu em outro sistema. Duas cópias também
// divergem na primeira correção (mesmo motivo de `LocalTrabalhoFields`).
//
// ⚠️ O que NÃO é compartilhado é a AUTENTICAÇÃO, e isso é deliberado:
//   • na aplicação  → sessão ativa   (PATCH /users/me/senha)
//   • no e-mail     → token do link  (POST /api/auth/reset-password)
// Quem esqueceu a senha não tem como informar a antiga; é o token, de uso único e com
// prazo, que prova a posse do e-mail. Por isso este componente só coleta e valida a
// senha — quem submete é a tela, com a credencial que tiver.
import { useState } from 'react';
import { KeyRound, Eye, EyeOff, Check, X } from 'lucide-react';
import InlineError from './InlineError';

// Regras espelhadas no backend (`resetPassword` exige no mínimo 8; aqui é mais estrito
// de propósito — o campo orienta o usuário antes de ele enviar).
export const REGRAS_SENHA = [
  { label: 'Mínimo 8 caracteres',             ok: (s: string) => s.length >= 8 },
  { label: 'Pelo menos uma letra maiúscula',  ok: (s: string) => /[A-Z]/.test(s) },
  { label: 'Pelo menos 1 número',             ok: (s: string) => /[0-9]/.test(s) },
  { label: 'Pelo menos 1 caractere especial', ok: (s: string) => /[^A-Za-z0-9]/.test(s) },
];

interface Props {
  titulo: string;
  subtitulo: string;
  /** Parágrafo explicativo acima dos campos. */
  descricao?: string;
  textoBotao: string;
  textoBotaoSalvando?: string;
  salvando?: boolean;
  /** Erro vindo do servidor (token expirado, senha reutilizada…). */
  erro?: string;
  /** Chamado com a senha já validada contra REGRAS_SENHA e a confirmação. */
  onSubmit: (novaSenha: string) => void;
  /** Limpa o erro do servidor quando o usuário volta a digitar. */
  onAlterar?: () => void;
  /** Conteúdo opcional abaixo do botão (ex.: link "Voltar para o Login"). */
  rodape?: React.ReactNode;
}

export default function FormularioNovaSenha({
  titulo,
  subtitulo,
  descricao,
  textoBotao,
  textoBotaoSalvando = 'Salvando...',
  salvando = false,
  erro = '',
  onSubmit,
  onAlterar,
  rodape,
}: Props) {
  const [novaSenha, setNovaSenha]               = useState('');
  const [confirmar, setConfirmar]               = useState('');
  const [mostrarNova, setMostrarNova]           = useState(false);
  const [mostrarConfirmar, setMostrarConfirmar] = useState(false);
  const [erroLocal, setErroLocal]               = useState('');

  const todasOk      = REGRAS_SENHA.every(r => r.ok(novaSenha));
  const senhasIguais = novaSenha === confirmar && confirmar.length > 0;
  const podeSubmeter = todasOk && senhasIguais;

  const aoDigitar = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setter(e.target.value);
    setErroLocal('');
    onAlterar?.();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!todasOk)      return setErroLocal('A senha não atende aos requisitos');
    if (!senhasIguais) return setErroLocal('As senhas não coincidem');
    onSubmit(novaSenha);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 w-full max-w-md">

        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-emerald-50 rounded-xl">
            <KeyRound className="text-emerald-600" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{titulo}</h1>
            <p className="text-sm text-gray-500">{subtitulo}</p>
          </div>
        </div>

        {descricao && <p className="text-sm text-gray-600 mb-6">{descricao}</p>}

        <div className="space-y-4">

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nova senha</label>
            <div className="relative">
              <input
                type={mostrarNova ? 'text' : 'password'}
                value={novaSenha}
                onChange={aoDigitar(setNovaSenha)}
                placeholder="Digite sua nova senha"
                autoComplete="new-password"
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="button"
                onClick={() => setMostrarNova(v => !v)}
                tabIndex={-1}
                aria-label={mostrarNova ? 'Ocultar senha' : 'Mostrar senha'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {mostrarNova ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirmar nova senha</label>
            <div className="relative">
              <input
                type={mostrarConfirmar ? 'text' : 'password'}
                value={confirmar}
                onChange={aoDigitar(setConfirmar)}
                placeholder="Repita a senha"
                autoComplete="new-password"
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="button"
                onClick={() => setMostrarConfirmar(v => !v)}
                tabIndex={-1}
                aria-label={mostrarConfirmar ? 'Ocultar senha' : 'Mostrar senha'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {mostrarConfirmar ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
            {confirmar.length > 0 && (
              <p className={`mt-1.5 text-xs flex items-center gap-1 ${senhasIguais ? 'text-emerald-600' : 'text-red-500'}`}>
                {senhasIguais ? <Check size={11} /> : <X size={11} />}
                {senhasIguais ? 'As senhas coincidem' : 'As senhas não coincidem'}
              </p>
            )}
          </div>

          {/* Checklist AO VIVO: o requisito aparece enquanto se digita, não depois de
              o envio falhar. */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
            <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Requisitos da senha</p>
            <ul className="space-y-1.5">
              {REGRAS_SENHA.map(r => {
                const ok       = novaSenha.length > 0 && r.ok(novaSenha);
                const falhando = novaSenha.length > 0 && !r.ok(novaSenha);
                return (
                  <li key={r.label} className={`flex items-center gap-2 text-xs font-medium ${
                    ok ? 'text-emerald-600' : falhando ? 'text-red-500' : 'text-gray-400'
                  }`}>
                    {ok
                      ? <Check size={13} className="flex-shrink-0" />
                      : <X size={13} className="flex-shrink-0" />}
                    {r.label}
                  </li>
                );
              })}
            </ul>
          </div>

          <InlineError message={erroLocal || erro} />

          <button
            type="submit"
            disabled={salvando || !podeSubmeter}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors"
          >
            {salvando ? textoBotaoSalvando : textoBotao}
          </button>

          {rodape}
        </div>
      </form>
    </div>
  );
}
