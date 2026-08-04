import axios from 'axios';

// Autenticação por cookie HttpOnly (s2vet_at / s2vet_rt): o navegador envia os
// cookies automaticamente com withCredentials — o token nunca é lido/armazenado
// por JavaScript (defesa contra roubo via XSS). Não há mais Authorization header
// nem token em storage no fluxo do navegador.
const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  // Contexto ativo do gestor (EmpresaContext) — backend valida o vínculo antes de usar.
  // CNPJ trabalha por empresa (x-empresa-id); CPF trabalha por equipe (x-equipe-id).
  const empresaId = localStorage.getItem('s2vet_empresa_id');
  if (empresaId) config.headers['x-empresa-id'] = empresaId;
  const equipeId = localStorage.getItem('s2vet_equipe_id');
  if (equipeId) config.headers['x-equipe-id'] = equipeId;
  return config;
});

// Fila para evitar múltiplos refreshes simultâneos
let isRefreshing = false;
let refreshQueue: Array<(ok: boolean) => void> = [];

function drainQueue(ok: boolean) {
  refreshQueue.forEach(cb => cb(ok));
  refreshQueue = [];
}

// Renova a sessão via cookie de refresh (HttpOnly). Não envia nem recebe token
// no corpo — o backend rotaciona os cookies. Retorna true se renovou.
async function tryRefresh(): Promise<boolean> {
  try {
    await axios.post('/api/auth/refresh', {}, {
      withCredentials: true,
      skipRefreshInterceptor: true,
    } as object);
    return true;
  } catch {
    return false;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const status = error.response?.status;
    const method = (error.config?.method ?? '').toLowerCase();

    // 403 = sem permissão — tratado silenciosamente pelo componente.
    // GETs retornam { data: null } resolvido; mutations rejeitam com flag tipada (sem log).
    if (status === 403) {
      if (method === 'get') {
        return Promise.resolve({
          data: null, status: 403, statusText: 'Forbidden',
          headers: error.response?.headers ?? {}, config: error.config, request: error.request,
        });
      }
      // A mensagem do backend PRECISA sobreviver: um 403 de regra de negócio
      // ("Só o gestor agenda para outro profissional") explica o que fazer, e a
      // genérica não. Antes o interceptor criava um Error nu, sem `response`, e todo
      // handler que lê `err.response.data.error` caía no fallback — a tela mostrava
      // "Erro ao reagendar" e o motivo real morria aqui.
      const msgBackend = (error.response?.data as { error?: string } | undefined)?.error;
      const permErr = new Error(msgBackend || 'Sem permissão para esta operação.');
      Object.assign(permErr, {
        isPermissionError: true,
        status: 403,
        response: error.response,   // handlers já existentes continuam funcionando
      });
      return Promise.reject(permErr);
    }

    if (status !== 401 || originalRequest?.skipRefreshInterceptor) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        refreshQueue.push((ok) => {
          if (ok) resolve(api(originalRequest));
          else    reject(error);
        });
      });
    }

    isRefreshing = true;
    const ok = await tryRefresh();
    isRefreshing = false;

    if (ok) {
      drainQueue(true);
      return api(originalRequest); // cookie renovado é enviado automaticamente
    }

    drainQueue(false);
    // HashRouter: a rota vive no fragmento. `'/login'` levava para um PATH de
    // servidor (o dev server responde index.html, o router acha o hash vazio e
    // acrescenta `#/login`) — resultado: `localhost:5173/login#/login`, com a rota
    // anterior e seus parâmetros perdidos no caminho. `'/#/login'` é a URL
    // canônica: mesmo path, então a troca de hash nem recarrega a página; vindo de
    // um path espúrio, recarrega e normaliza o endereço. Ver CLAUDE.md §14.
    window.location.href = '/#/login';
    return Promise.reject(error);
  }
);

export default api;
