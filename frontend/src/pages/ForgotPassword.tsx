// src/pages/ForgotPassword.tsx
// "Esqueci minha senha": pede o e-mail e dispara o link de recuperação.
//
// FLUXO: enviar → mostra a confirmação → volta SOZINHO para a tela principal (login),
// que repete o aviso num banner (`?msg=reset_link_enviado`). Antes a tela parava num
// card com um link manual e o usuário ficava sem saber que já podia sair dali.
// O botão continua existindo para quem não quiser esperar.
//
// ⚠️ A mensagem é a MESMA quer o e-mail exista ou não — o backend responde 200 genérico
// de propósito (`respostaGenerica` em AuthController.forgotPassword). Confirmar "não
// existe conta com este e-mail" transformaria a tela num verificador de cadastro
// (enumeração de usuário). NÃO "melhorar" isso avisando que o e-mail não foi encontrado.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MailCheck } from 'lucide-react';
import InlineError from '../components/InlineError';

// Tempo até voltar ao login — suficiente para ler a confirmação sem prender a pessoa.
const MS_ATE_VOLTAR = 4000;

export default function ForgotPassword() {
  const [email, setEmail]     = useState('');
  const [loading, setLoading] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError]     = useState('');
  const navigate = useNavigate();

  // Volta para a tela principal assim que a confirmação aparece.
  useEffect(() => {
    if (!enviado) return;
    const t = setTimeout(() => navigate('/login?msg=reset_link_enviado'), MS_ATE_VOLTAR);
    return () => clearTimeout(t);
  }, [enviado, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim().toLowerCase() }),
      });

      if (res.ok) {
        setEnviado(true);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Não foi possível enviar o link de recuperação.');
      }
    } catch {
      setError('Não foi possível conectar ao servidor. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  if (enviado) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 w-full max-w-md text-center">
          <div className="inline-flex p-3 bg-emerald-50 rounded-2xl mb-4">
            <MailCheck className="text-emerald-600" size={28} />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Link enviado</h1>
          <p className="text-sm text-gray-600 mb-2">
            Se houver uma conta com <strong className="break-all">{email.trim().toLowerCase()}</strong>,
            enviamos um link para redefinir a senha.
          </p>
          <p className="text-sm text-gray-500 mb-6">
            Verifique a caixa de entrada e também a pasta de spam.
          </p>
          <p className="text-xs text-gray-400 mb-4">Voltando para o login...</p>
          <Link
            to="/login?msg=reset_link_enviado"
            className="inline-block bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-6 py-3 rounded-xl transition-colors"
          >
            Voltar para o Login agora
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 w-full max-w-md"
      >
        <h1 className="text-xl font-bold text-gray-900 text-center mb-2">Esqueci minha senha</h1>
        <p className="text-sm text-gray-600 text-center mb-6">
          Informe o seu e-mail e enviaremos um link para redefinir a senha.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(''); }}
              placeholder="seuemail@email.com"
              autoComplete="email"
              required
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <InlineError message={error} />

          <button
            type="submit"
            disabled={loading || !email.trim()}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors"
          >
            {loading ? 'Enviando link...' : 'Enviar link de recuperação'}
          </button>

          <p className="text-center text-sm text-gray-500 pt-1">
            Lembrou a senha?{' '}
            <Link to="/login" className="text-emerald-600 font-medium hover:underline">
              Voltar para o Login
            </Link>
          </p>
        </div>
      </form>
    </div>
  );
}
