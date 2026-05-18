// frontend/src/services/audioQueueService.ts
// Fila de áudios pendentes de transcrição/processamento LLM
// Armazenada em IndexedDB — persiste entre reloads e sessões offline

export type ContextoAudio = 'evolucao' | 'prescricao' | 'exame' | 'fatura';
export type StatusFila    = 'pendente' | 'transcrevendo' | 'processando' | 'concluido' | 'erro';

export interface ItemFila {
  id:           string;        // uuid
  blob:         Blob;          // áudio gravado
  contexto:     ContextoAudio;
  animalId:     number;
  vetId:        number;
  criadoEm:     string;        // ISO string
  status:       StatusFila;
  textoTranscrito?: string;   // preenchido após Whisper
  acoesLLM?:    AcaoLLM[];    // preenchido após Groq
  erro?:        string;
}

export interface AcaoLLM {
  tipo:     'MEDICAMENTO' | 'PROCEDIMENTO' | 'EXAME' | 'ENCAMINHAMENTO';
  descricao: string;
  valor:    number;
}

// ─── IndexedDB setup ──────────────────────────────────────────────────────────

const DB_NAME    = 's2vet_audio_queue';
const DB_VERSION = 1;
const STORE_NAME = 'fila';

function abrirDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db    = (e.target as IDBOpenDBRequest).result;
      const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      store.createIndex('status',    'status',    { unique: false });
      store.createIndex('contexto',  'contexto',  { unique: false });
      store.createIndex('animalId',  'animalId',  { unique: false });
      store.createIndex('criadoEm',  'criadoEm',  { unique: false });
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function tx(
  db:        IDBDatabase,
  mode:      IDBTransactionMode,
): IDBObjectStore {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

// ─── API pública ──────────────────────────────────────────────────────────────

export async function adicionarNaFila(
  item: Omit<ItemFila, 'id' | 'criadoEm' | 'status'>,
): Promise<ItemFila> {
  const db      = await abrirDB();
  const novoItem: ItemFila = {
    ...item,
    id:       crypto.randomUUID(),
    criadoEm: new Date().toISOString(),
    status:   'pendente',
  };

  return new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite').add(novoItem);
    req.onsuccess = () => resolve(novoItem);
    req.onerror   = () => reject(req.error);
  });
}

export async function listarPendentes(): Promise<ItemFila[]> {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const index = tx(db, 'readonly').index('status');
    const req   = index.getAll(IDBKeyRange.only('pendente'));
    req.onsuccess = () => resolve(req.result as ItemFila[]);
    req.onerror   = () => reject(req.error);
  });
}

export async function listarTodos(): Promise<ItemFila[]> {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readonly').getAll();
    req.onsuccess = () => resolve(req.result as ItemFila[]);
    req.onerror   = () => reject(req.error);
  });
}

export async function contarPendentes(): Promise<number> {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const index = tx(db, 'readonly').index('status');
    const req   = index.count(IDBKeyRange.only('pendente'));
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export async function atualizarItem(
  id:      string,
  updates: Partial<ItemFila>,
): Promise<void> {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const store  = tx(db, 'readwrite');
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const item    = getReq.result as ItemFila;
      const updated = { ...item, ...updates };
      const putReq  = store.put(updated);
      putReq.onsuccess = () => resolve();
      putReq.onerror   = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function removerItem(id: string): Promise<void> {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite').delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

export async function limparConcluidos(): Promise<void> {
  const db   = await abrirDB();
  const todos = await listarTodos();
  const concluidos = todos.filter(i => i.status === 'concluido');

  await Promise.all(
    concluidos.map(
      (item) => new Promise<void>((resolve, reject) => {
        const req = tx(db, 'readwrite').delete(item.id);
        req.onsuccess = () => resolve();
        req.onerror   = () => reject(req.error);
      }),
    ),
  );
}