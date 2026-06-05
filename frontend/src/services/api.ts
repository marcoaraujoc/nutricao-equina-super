import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Fila para evitar múltiplos refreshes simultâneos
let isRefreshing = false;
let refreshQueue: Array<(token: string | null) => void> = [];

function drainQueue(token: string | null) {
  refreshQueue.forEach(cb => cb(token));
  refreshQueue = [];
}

async function tryRefresh(): Promise<string | null> {
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) return null;

  try {
    const res = await axios.post('/api/auth/refresh', { refreshToken }, { skipRefreshInterceptor: true } as object);
    const { token, refreshToken: newRefresh } = res.data;
    localStorage.setItem('token', token);
    localStorage.setItem('refreshToken', newRefresh);
    return token;
  } catch {
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    return null;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const status = error.response?.status;
    const method = (error.config?.method ?? '').toLowerCase();

    // 403 em GET = sem permissão para visualizar — retorna dados nulos silenciosamente
    // O componente recebe lista vazia (null ?? []) e não exibe toast de erro
    if (status === 403 && method === 'get') {
      return Promise.resolve({
        data: null,
        status: 403,
        statusText: 'Forbidden',
        headers: error.response?.headers ?? {},
        config: error.config,
        request: error.request,
      });
    }

    if (status !== 401 || originalRequest?.skipRefreshInterceptor) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        refreshQueue.push((token) => {
          if (token) {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(api(originalRequest));
          } else {
            reject(error);
          }
        });
      });
    }

    isRefreshing = true;
    const newToken = await tryRefresh();
    isRefreshing = false;

    if (newToken) {
      drainQueue(newToken);
      originalRequest.headers.Authorization = `Bearer ${newToken}`;
      return api(originalRequest);
    }

    drainQueue(null);
    window.location.href = '/login';
    return Promise.reject(error);
  }
);

export default api;