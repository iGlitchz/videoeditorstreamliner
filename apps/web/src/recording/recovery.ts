export type PendingChunk = { key: string; sessionId: string; streamId: string; index: number; blob: Blob; offsetMs: number; elapsedMs: number; projectId: string; startedAt?: string };
let opening: Promise<IDBDatabase> | undefined;
function open() {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('youtube-studio-capture', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('chunks', { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error ?? new Error('Browser recovery storage is unavailable'));
    req.onblocked = () => reject(new Error('Browser recovery storage is blocked by another open version of the studio. Close that tab and retry.'));
  }); return opening;
}
async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await open(); return new Promise<T>((resolve, reject) => { const tx = db.transaction('chunks', mode); const req = run(tx.objectStore('chunks')); tx.oncomplete = () => resolve(req.result); tx.onerror = () => reject(tx.error ?? req.error); tx.onabort = () => reject(tx.error ?? new Error('Browser storage transaction was aborted')); });
}
export const recovery = {
  save: (chunk: PendingChunk) => transaction('readwrite', (store) => store.put(chunk)),
  remove: (key: string) => transaction('readwrite', (store) => store.delete(key)),
  all: () => transaction<PendingChunk[]>('readonly', (store) => store.getAll()),
};
