// src/pages/Login.tsx
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { useAuth } from '../contexts/AuthContext';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import InlineError from '../components/InlineError';
import LinkMarcaS2Vet from '../components/LinkMarcaS2Vet';
import VitrineLogin, { FundoVitrineMobile } from '../components/login/VitrineLogin';
import Verificacao2FA from '../components/Verificacao2FA';
import type { DesafioMfa } from '../components/Verificacao2FA';

export default function Login() {
  const { login }  = useAuth();
  const navigate   = useNavigate();
  const location   = useLocation();

  const searchParams = new URLSearchParams(location.search);
  const returnUrl    = searchParams.get('returnUrl');
  const msg          = searchParams.get('msg');

  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [googleError,  setGoogleError]  = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // Desafio de 2FA pendente: com ele preenchido, a tela troca para o código.
  const [desafio2fa,   setDesafio2fa]   = useState<DesafioMfa | null>(null);

  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail,     setForgotEmail]     = useState('');
  const [forgotLoading,   setForgotLoading]   = useState(false);
  const [forgotSuccess,   setForgotSuccess]   = useState(false);
  const [forgotError,     setForgotError]     = useState('');

  // Destino pós-login. Profissional (vet, gestor, estagiário, fornecedor...) vai
  // DIRETO ao Painel Principal — antes passava por `/` (Dashboard), que só
  // redirecionava para lá quando reconhecia o perfil como clínico, deixando os
  // demais numa tela intermediária. O PROPRIETÁRIO mantém `/` (portal do cliente).
  // Cadastro pessoal pendente NAQUELA empresa continua sendo interceptado pelo
  // ProtectedRoute; já confirmado, não aparece mais e o login cai no painel.
  const redirecionarAposLogin = (u?: { userType?: string } | null) => {
    if (returnUrl) {
      navigate(decodeURIComponent(returnUrl), { replace: true });
      return;
    }
    const ehCliente = (u?.userType ?? '').toUpperCase() === 'PROPRIETARIO';
    navigate(ehCliente ? '/' : '/painel-principal', { replace: true });
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setGoogleError('');
    try {
      const res  = await fetch('/api/auth/login', {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (res.ok) {
        // Senha correta, mas ainda falta o segundo fator: nenhum cookie foi
        // emitido — a sessão só nasce após POST /auth/2fa/verificar.
        if (data.mfaRequerido) {
          setDesafio2fa({
            desafioId:       data.desafioId,
            emailMascarado:  data.emailMascarado,
            validadeMinutos: data.validadeMinutos ?? 10,
          });
          return;
        }
        // Backend já setou os cookies HttpOnly — carrega a identidade via /me
        const logado = await login();
        localStorage.removeItem('s2vet_ob');
        redirecionarAposLogin(logado);
      } else if (res.status === 503) {
        setError(data.error ?? 'Não foi possível enviar o código de verificação.');
      } else if (res.status === 429) {
        // Rate limit do /api/auth. Mostrar "usuário ou senha inválidos" aqui era uma
        // ARMADILHA: com a senha CERTA a tela acusava credencial errada, o usuário
        // tentava de novo e cada tentativa renovava o bloqueio.
        setError(data.mensagem ?? data.error
          ?? 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.');
      } else if (res.status >= 500) {
        setError('O servidor não conseguiu processar o login. Tente novamente em instantes.');
      } else {
        setError(data.error ?? data.mensagem ?? 'Usuário ou senha inválidos');
      }
    } catch {
      setError('Erro de conexão com o servidor');
    } finally {
      setLoading(false);
    }
  };

  const loginComGoogle = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setGoogleError('');
      try {
        const res  = await fetch('/api/auth/google', {
          method:      'POST',
          credentials: 'include',
          headers:     { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token: tokenResponse.access_token }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          const logado = await login();
          localStorage.removeItem('s2vet_ob');
          redirecionarAposLogin(logado);
        } else {
          setGoogleError(data.error || 'Erro no login Google');
        }
      } catch (err) {
        console.error('Erro ao processar login Google:', err);
        setGoogleError('Erro de conexão com o servidor.');
      }
    },
    onError: () => setGoogleError('Falha ao conectar com Google. Tente novamente.'),
    prompt: 'select_account',
    flow:   'implicit',
  });

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotLoading(true);
    setForgotError('');
    setForgotSuccess(false);
    try {
      await fetch('/api/auth/forgot-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: forgotEmail.trim().toLowerCase() }),
      });
      setForgotSuccess(true);
    } catch {
      setForgotSuccess(true);
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    /*
      LAYOUT (referencia: app.simples.vet/login + gravacao de 2026-08-29):

        >= lg  TELA CHEIA, margem de 0,5cm em volta — 30% para o login (esquerda)
               e 70% para as telas do produto correndo (direita). Nada rola a
               pagina: cada coluna se vira dentro da propria altura.
        <  lg  empilhado — formulario primeiro, vitrine abaixo (o modelo de
               mobile enviado e' exatamente essa coluna), com a pagina rolando.

      E o MESMO markup nos dois tamanhos, so' mudando a direcao do flex — nunca
      dois blocos irmaos com `hidden`/`lg:hidden`, que viram duas copias do
      formulario e divergem na primeira correcao.

      ⚠️ `lg:overflow-hidden` no wrapper + `lg:h-full` no miolo: e' o que prende
      tudo na viewport no desktop. No mobile continua `overflow-auto`, porque a
      vitrine empilhada deixa o conteudo mais alto que a tela.
    */
    <div className="relative h-full overflow-auto bg-white text-gray-900 lg:overflow-hidden">

      {/* MOBILE: a foto da vitrine vira PLANO DE FUNDO atrás do formulário, bem
          suave (2026-09-04). Antes ela ficava EMPILHADA abaixo do login e a página
          rolava; o pedido é uma TELA SÓ. `absolute` sobre o wrapper `relative`, e o
          conteúdo abaixo sobe com `relative` para ficar por cima. */}
      {!desafio2fa && <FundoVitrineMobile />}

      {/* Margem de 0,5cm em volta de TODA a pagina. Em `cm` mesmo (o Tailwind
          aceita a unidade no valor arbitrario): foi a medida pedida, e traduzi-la
          para px aqui perderia a intencao no primeiro ajuste de escala. */}
      {/* ⚠️ A margem da DIREITA e' o DOBRO das outras (1cm x 0,5cm), a pedido em
          2026-09-05: e' o lado em que a foto encosta na borda, e com a margem
          uniforme ela parecia colada na tela. So' no desktop — no mobile a foto e'
          plano de fundo e nao ha borda para respeitar. */}
      <div className="relative flex min-h-full flex-col gap-10 p-[0.5cm] lg:h-full lg:min-h-0 lg:flex-row lg:gap-8 lg:pr-[1cm]">

      {/* Coluna do LOGIN — TODO o espaco que a foto nao usa (2026-09-05).
          Era `lg:w-[30%]` fixo, com a foto centralizada nos 70% restantes: a sobra
          daquela coluna ficava ENTRE o formulario e a foto, e o login parecia
          deslocado para a esquerda (em janela baixa a sobra passava de 300px, porque
          a largura da foto e' calculada a partir da ALTURA). Agora a coluna da foto
          encolhe ate ela e esta aqui fica com o resto — o `mx-auto` do miolo entao
          centraliza o formulario exatamente no vao entre a borda da tela e a foto.
          ⚠️ `lg:min-w-[20rem]` e' o piso: sem ele, uma janela muito alta faria a
          foto (que cresce com a altura) espremer o formulario ate ele ficar
          inutilizavel. Com o piso, quem cede e' a foto — ela tem `lg:min-w-0` e
          encolhe pelo flex.
          🔴 `lg:max-w-[30rem]` e' o TETO, e existe pela proporcao (2026-09-05: "a
          foto precisa ser maior que a parte do login"). Sem ele a coluna do login
          engolia toda a sobra da linha e, em janela BAIXA — onde a foto encolhe,
          porque a largura dela vem da altura —, os dois lados chegavam a ficar do
          mesmo tamanho: ~860px de formulario ao lado de ~990px de foto. Com o teto,
          o formulario para em 480px e a foto continua sendo o dobro dele.
          O formulario em si tem `max-w-md` (28rem); os 30rem dao a folga lateral.
          (A faixa vazia que sobrava na direita foi resolvida do outro lado: a coluna
          da foto agora absorve todo o resto da linha — ver o bloco dela abaixo.)
          `overflow-y-auto` + `my-auto` no miolo: centraliza quando sobra altura e
          rola quando falta. `justify-center` no lugar do `my-auto` cortaria o topo
          do formulario em tela baixa, que e' o bug classico dessa combinacao. */}
      <div className="w-full lg:flex lg:min-w-[20rem] lg:max-w-[30rem] lg:flex-1 lg:flex-col lg:overflow-y-auto">
      <div className="mx-auto w-full max-w-md lg:my-auto">

        {/* A marca vem do banco por `GET /api/marca` — rota publica, que e' o que
            permite exibi-la aqui, antes de existir sessao. */}
        <div className="mb-8 flex justify-center">
          <LinkMarcaS2Vet />
        </div>

        {desafio2fa ? (
          <Verificacao2FA
            desafio={desafio2fa}
            onVerificado={async () => {
              const logado = await login();
              localStorage.removeItem('s2vet_ob');
              redirecionarAposLogin(logado);
            }}
            onCancelar={() => { setDesafio2fa(null); setPassword(''); }}
          />
        ) : (
        <>
        {/* Título REMOVIDO da tela a pedido (2026-08-29) — a marca logo acima já
            diz onde a pessoa está. Fica só para leitor de tela: `sr-only` não
            ocupa um pixel, e sem nenhum <h1> a página vira um formulário sem
            título para quem navega por cabeçalhos. */}
        <h1 className="sr-only">Entrar no S2Vet</h1>

        {/* Banner: link de recuperacao enviado (volta de "Esqueci minha senha").
            Repete a confirmacao que a tela anterior exibiu antes de redirecionar.
            Texto GENERICO ("se houver uma conta"): confirmar a existencia do
            e-mail permitiria enumerar usuarios. */}
        {msg === 'reset_link_enviado' && (
          <div className="mb-4 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0 text-emerald-600" />
            <span>
              Se houver uma conta com o e-mail informado, enviamos um link para
              redefinir a senha. Verifique a caixa de entrada e a pasta de spam.
            </span>
          </div>
        )}

        {msg === 'login_required_to_approve' && (
          <div className="mb-4 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0 text-emerald-600" />
            <span>
              Faça login com a sua conta de proprietário para autorizar ou
              recusar o vínculo veterinário. Após o login você será
              redirecionado automaticamente.
            </span>
          </div>
        )}

        {msg === 'vet_required' && (
          <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            <span>
              Este link de aprovação pertence a um veterinário específico.{' '}
              <strong>Faça login com a conta do veterinário</strong> para continuar.
            </span>
          </div>
        )}

        <form onSubmit={handleEmailLogin} className="space-y-4">
          <div>
            {/* Rotulos "Login:" / "Senha:" acima do campo, como na referencia. */}
            <label htmlFor="login-email" className="mb-1.5 block text-sm text-gray-700">Login:</label>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base placeholder:text-gray-400 focus:border-emerald-500 focus:outline-none"
              placeholder="Email"
              required
            />
          </div>
          <div>
            <label htmlFor="login-senha" className="mb-1.5 block text-sm text-gray-700">Senha:</label>
            <div className="relative">
              <input
                id="login-senha"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-3 pr-11 text-base placeholder:text-gray-400 focus:border-emerald-500 focus:outline-none"
                placeholder="Senha"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <InlineError message={error} className="mb-1" />

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-emerald-600 py-3.5 text-base font-semibold text-white transition-colors hover:bg-emerald-700 disabled:bg-gray-400"
          >
            {loading ? 'Entrando...' : 'Entrar no S2Vet'}
          </button>
        </form>

        <div className="mt-4 text-center">
          <button
            onClick={() => setShowForgotModal(true)}
            className="text-sm text-emerald-600 hover:underline"
          >
            Recupere sua senha
          </button>
        </div>

        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-gray-200" />
          <span className="text-sm text-gray-400">ou</span>
          <div className="h-px flex-1 bg-gray-200" />
        </div>

        <button
          type="button"
          onClick={() => loginComGoogle()}
          className="flex w-full items-center justify-center gap-3 rounded-full border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
        >
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Entrar com Google
        </button>

        <InlineError message={googleError} className="mt-3" />

        <div className="mt-8 text-sm leading-relaxed text-gray-700">
          <p className="font-medium">Deseja conhecer o S2Vet?</p>
          <Link to="/register" className="text-emerald-600 hover:underline">
            Crie sua conta e experimente grátis
          </Link>
          <br />
          {/* "nosso site" e' a propria pagina institucional publica ("/"),
              servida pelo RootGate a quem nao tem sessao. */}
          ou <Link to="/" className="text-emerald-600 hover:underline">visite nosso site</Link>
        </div>
        </>
        )}
      </div>
      </div>

      {/* Telas do produto — 70% da largura, SÓ no desktop (o componente já se
          esconde abaixo de `lg`; no mobile a mesma foto entra como plano de fundo,
          acima). Some tambem durante o 2FA: ali a unica coisa a fazer e' digitar o
          codigo.
          ⚠️ `min-w-0` e obrigatorio num filho de flex que contem imagem — sem ele
          a foto empurra a coluna e estoura o layout. */}
      {/* A coluna da FOTO fica com TODO o espaco que o formulario nao usa
          (2026-09-05). Era uma largura calculada a partir da altura da janela, e
          sobrava uma faixa vazia na borda direita sempre que a janela era baixa —
          a foto nao podia crescer para ocupa-la sem estourar a altura. Agora ela
          preenche a coluna e o excesso de proporcao e' resolvido por `object-cover`
          la dentro (ver VitrineLogin).
          ⚠️ `lg:min-w-0` e' obrigatorio num filho de flex que contem imagem: sem ele
          a largura intrinseca da foto (2000px) vira o piso e estoura a linha. */}
      {!desafio2fa && <VitrineLogin className="lg:min-w-0 lg:flex-1" />}

      </div>

      {/* MODAL — Esqueci minha senha */}
      {showForgotModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl px-6 py-8 sm:p-8 w-full max-w-md text-gray-900">
            <h2 className="text-xl sm:text-2xl font-bold text-center mb-2">
              Esqueci minha senha
            </h2>
            <p className="text-gray-500 text-sm text-center mb-6">
              Digite seu e-mail e enviaremos um link de recuperação.
            </p>
            <form onSubmit={handleForgotPassword}>
              <input
                type="email"
                value={forgotEmail}
                onChange={e => setForgotEmail(e.target.value)}
                placeholder="seuemail@email.com"
                className="w-full px-4 py-3 rounded-3xl border border-gray-300
                           focus:outline-none focus:border-emerald-500 text-sm"
                required
              />
              <InlineError message={forgotError} className="mt-3" />
              {forgotSuccess && (
                <p className="text-emerald-600 text-sm text-center mt-3">
                  Se o e-mail existir, será enviado um link de recuperação.
                </p>
              )}
              <button
                type="submit"
                disabled={forgotLoading}
                className="w-full mt-5 bg-emerald-600 hover:bg-emerald-700
                           text-white py-3 rounded-3xl text-base font-semibold"
              >
                {forgotLoading ? 'Enviando...' : 'Enviar e-mail'}
              </button>
            </form>
            <button
              onClick={() => setShowForgotModal(false)}
              className="mt-4 w-full text-gray-500 hover:text-gray-700 text-sm"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}