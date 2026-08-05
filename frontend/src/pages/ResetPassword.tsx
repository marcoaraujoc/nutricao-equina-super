// src/pages/ResetPassword.tsx
// Destino do link enviado por e-mail em "esqueci minha senha"
// (`${APP_URL}/#/reset-password?token=...`).
//
// É a MESMA tela de senha da aplicação: usa `FormularioNovaSenha`, o mesmo componente de
// `AlterarSenhaObrigatoria`. Antes esta página tinha vida própria — fundo escuro, emoji
// no lugar dos ícones, requisitos só revelados depois de o envio falhar —, e quem chegava
// pelo e-mail tinha a impressão de ter caído em outro sistema.
//
// SEGURANÇA — o que é compartilhado é a INTERFACE, nunca a credencial:
//   • a tela da aplicação grava com a SESSÃO ativa (PATCH /users/me/senha);
//   • esta grava com o TOKEN do link (POST /api/auth/reset-password).
// Não se pede a senha antiga aqui, e isso é correto: quem esqueceu não a tem. O que
// prova a identidade é o token — de uso único, com prazo, validado no backend contra
// `resetPasswordToken`/`resetPasswordExpires`. O backend ainda recusa senha já usada
// antes (histórico de senhas), e essa mensagem chega ao usuário pelo `erro` abaixo.
import { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import FormularioNovaSenha from '../components/FormularioNovaSenha';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate       = useNavigate();
  const token          = searchParams.get('token');

  const [salvando, setSalvando] = useState(false);
  const [sucesso, setSucesso]   = useState(false);
  const [erro, setErro]         = useState('');

  const handleSubmit = async (novaSenha: string) => {
    setSalvando(true);
    setErro('');

    try {
      const res = await fetch('/api/auth/reset-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token, newPassword: novaSenha }),
      });

      if (res.ok) {
        setSucesso(true);
        setTimeout(() => navigate('/login'), 2500);
      } else {
        const data = await res.json().catch(() => ({}));
        setErro(data.error || 'Não foi possível redefinir a senha. O link pode ter expirado.');
      }
    } catch {
      setErro('Não foi possível conectar ao servidor. Tente novamente.');
    } finally {
      setSalvando(false);
    }
  };

  // Link sem token (copiado pela metade, ou acesso direto à rota): avisa em vez de
  // exibir um formulário que só falharia no envio.
  if (!token) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 w-full max-w-md text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Link inválido</h1>
          <p className="text-sm text-gray-600 mb-6">
            Este endereço não contém um código de recuperação. Peça um novo link em
            &quot;Esqueci minha senha&quot;.
          </p>
          <Link
            to="/login"
            className="inline-block bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-6 py-3 rounded-xl transition-colors"
          >
            Voltar para o Login
          </Link>
        </div>
      </div>
    );
  }

  if (sucesso) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 w-full max-w-md text-center">
          <h1 className="text-xl font-bold text-emerald-600 mb-2">Senha alterada com sucesso!</h1>
          <p className="text-sm text-gray-600 mb-6">
            Já pode entrar com a senha nova. Estamos levando você para o login...
          </p>
          <Link
            to="/login"
            className="inline-block bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-6 py-3 rounded-xl transition-colors"
          >
            Ir para o Login agora
          </Link>
        </div>
      </div>
    );
  }

  return (
    <FormularioNovaSenha
      titulo="Redefinir senha"
      subtitulo="Recuperação por e-mail"
      descricao="Escolha a nova senha da sua conta S2Vet. Ela substitui a anterior imediatamente."
      textoBotao="Alterar senha"
      textoBotaoSalvando="Alterando senha..."
      salvando={salvando}
      erro={erro}
      onSubmit={handleSubmit}
      onAlterar={() => setErro('')}
      rodape={
        <p className="text-center text-sm text-gray-500 pt-1">
          <Link to="/login" className="text-emerald-600 font-medium hover:underline">
            Voltar para o Login
          </Link>
        </p>
      }
    />
  );
}
