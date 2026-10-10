// frontend/src/services/trechosTranscricaoStore.ts
//
// Trechos de áudio do ditado da evolução, guardados NO APARELHO (IndexedDB) até
// virarem texto. É o que impede a perda do que foi dito quando a internet cai: cada
// trecho é gravado aqui ENQUANTO é falado (a cada segundo), e só sai daqui depois que
// o texto dele entrou no campo da evolução.
//
// ⚠️ O áudio vai como ArrayBuffer + mime, nunca como Blob: Safari antigo não guarda
// Blob em IndexedDB, e a falha seria só na hora de ler — com o áudio já perdido.
// ⚠️ Sem IndexedDB (aba privada antiga, cota estourada) o store cai para a MEMÓRIA:
// o ditado continua funcionando, só não sobrevive a recarregar a página.

export type StatusTrecho = 'gravando' | 'pendente' | 'concluido' | 'erro';

export interface Trecho {
  id:         string;
  /** Formulário dono do trecho: `ev:<userId>:<animalId>:<novo|evolucaoId>`. */
  chave:      string;
  /** Instância do gravador que o criou — distingue o trecho em gravação AGORA do
   *  trecho órfão de uma sessão interrompida (página recarregada, aba fechada). */
  sessao:     string;
  /** Ordem de fala: instante do início do trecho + sequência na sessão. */
  ordem:      number;
  seq:        number;
  dados:      ArrayBuffer;
  mime:       string;
  status:     StatusTrecho;
  /** Transcrição pronta mas ainda não entregue ao formulário (ele estava fechado). */
  texto?:     string;
  erro?:      string;
  /** Falhas do SERVIDOR (5xx/429). Falha de rede não conta — é só esperar a conexão. */
  tentativas: number;
  criadoEm:   number;
}

const DB_NAME    = 's2vet_trechos_transcricao';
const DB_VERSION = 1;
const STORE      = 'trechos';

let dbPromise: Promise<IDBDatabase> | null = null;
let semIndexedDb = false;
const memoria = new Map<string, Trecho>();

function abrirDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('chave', 'chave', { unique: false });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
      } catch (err) { reject(err); }
    });
    dbPromise.catch(() => { semIndexedDb = true; });
  }
  return dbPromise;
}

async function comStore<T>(
  modo: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, modo);
    const req = op(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(tx.error);
  });
}

/** Roda no IndexedDB; se ele não existir/falhar, na memória. */
async function executar<T>(idb: () => Promise<T>, mem: () => T): Promise<T> {
  if (!semIndexedDb) {
    try { return await idb(); }
    catch { semIndexedDb = true; }
  }
  return mem();
}

export function salvarTrecho(t: Trecho): Promise<void> {
  return executar(
    async () => { await comStore('readwrite', s => s.put(t)); },
    () => { memoria.set(t.id, t); },
  );
}

export function listarTrechos(chave: string): Promise<Trecho[]> {
  const ordenar = (lista: Trecho[]) =>
    lista.sort((a, b) => a.ordem - b.ordem || a.seq - b.seq);
  return executar(
    async () => ordenar(((await comStore('readonly', s => s.index('chave').getAll(chave))) ?? []) as Trecho[]),
    () => ordenar([...memoria.values()].filter(t => t.chave === chave)),
  );
}

/**
 * Atualiza o trecho SÓ se ele ainda existir. Leitura e escrita na MESMA transação:
 * uma transcrição que volta depois de o trecho ter sido descartado (formulário
 * zerado) não pode ressuscitá-lo.
 */
export function atualizarTrechoSeExistir(id: string, parcial: Partial<Trecho>): Promise<boolean> {
  return executar(
    async () => {
      const db = await abrirDB();
      return new Promise<boolean>((resolve, reject) => {
        const tx    = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        let achou   = false;
        const get   = store.get(id);
        get.onsuccess = () => {
          if (!get.result) return;
          achou = true;
          store.put({ ...(get.result as Trecho), ...parcial });
        };
        tx.oncomplete = () => resolve(achou);
        tx.onerror    = () => reject(tx.error);
        tx.onabort    = () => reject(tx.error);
      });
    },
    () => {
      const atual = memoria.get(id);
      if (!atual) return false;
      memoria.set(id, { ...atual, ...parcial });
      return true;
    },
  );
}

export function removerTrecho(id: string): Promise<void> {
  return executar(
    async () => { await comStore('readwrite', s => s.delete(id)); },
    () => { memoria.delete(id); },
  );
}

/** Descarta todo o áudio de um formulário (zerado, salvo ou descartado pela pessoa). */
export async function descartarTrechos(chave: string): Promise<void> {
  const lista = await listarTrechos(chave).catch(() => [] as Trecho[]);
  await Promise.all(lista.map(t => removerTrecho(t.id).catch(() => {})));
}

/** Trecho esquecido há mais de `dias` (paciente nunca mais aberto) não fica para sempre no aparelho. */
export async function limparTrechosAntigos(dias = 14): Promise<void> {
  const limite = Date.now() - dias * 24 * 60 * 60 * 1000;
  const antigos = await executar(
    async () => (((await comStore('readonly', s => s.getAll())) ?? []) as Trecho[])
      .filter(t => t.criadoEm < limite),
    () => [...memoria.values()].filter(t => t.criadoEm < limite),
  ).catch(() => [] as Trecho[]);
  await Promise.all(antigos.map(t => removerTrecho(t.id).catch(() => {})));
}
