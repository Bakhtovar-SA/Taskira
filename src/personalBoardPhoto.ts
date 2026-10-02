import { useEffect, useState } from "react";

export type BoardPhoto = { blob: Blob; luma: number };
const DB = "taskira-personal-board-photos";
const STORE = "photos";
const CHANGED = "taskira:board-photo-changed";
export const boardPhotoKey = (userId: string, projectId: string) => JSON.stringify([userId, projectId]);

function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("storage-unavailable"));
    const opening = indexedDB.open(DB, 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore(STORE);
    opening.onerror = () => reject(opening.error);
    opening.onblocked = () => reject(new Error("storage-blocked"));
    opening.onsuccess = () => {
      const db = opening.result;
      db.onversionchange = () => db.close();
      try {
        const tx = db.transaction(STORE, mode);
        let result: T;
        tx.oncomplete = () => { db.close(); resolve(result); };
        tx.onabort = () => { db.close(); reject(tx.error ?? new Error("storage-aborted")); };
        const request = operation(tx.objectStore(STORE));
        request.onsuccess = () => { result = request.result; };
      } catch (error) { db.close(); reject(error); }
    };
  });
}

export async function readBoardPhoto(userId: string, projectId: string): Promise<BoardPhoto | null> {
  const value = await transaction<BoardPhoto | undefined>("readonly", store => store.get(boardPhotoKey(userId, projectId)));
  return value && value.blob instanceof Blob ? value : null;
}

export async function saveBoardPhoto(userId: string, projectId: string, photo: BoardPhoto | null): Promise<void> {
  if (!userId || !projectId) throw new Error("missing-photo-owner");
  const key = boardPhotoKey(userId, projectId);
  if (photo) await transaction("readwrite", store => store.put(photo, key));
  else await transaction("readwrite", store => store.delete(key));
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: key }));
  try { localStorage.setItem(CHANGED, JSON.stringify({ key, nonce: Math.random() })); } catch { /* tab sync is optional */ }
}

/** Blob URLs live only as long as the current board/account. Ignore late reads after switching. */
export function usePersonalBoardPhoto(userId: string, projectId: string) {
  const key = boardPhotoKey(userId, projectId);
  const [photo, setPhoto] = useState<{ key: string; url: string; luma: number } | null>(null);
  useEffect(() => {
    if (!userId || !projectId) return;
    let live = true;
    let revision = 0;
    let url: string | null = null;
    const read = async () => {
      const current = ++revision;
      const value = await readBoardPhoto(userId, projectId).catch(() => null);
      if (!live || current !== revision) return;
      if (url) URL.revokeObjectURL(url);
      url = value ? URL.createObjectURL(value.blob) : null;
      setPhoto(url && value ? { key, url, luma: value.luma } : null);
    };
    const changed = (event: Event) => { if ((event as CustomEvent<string>).detail === key) void read(); };
    const storage = (event: StorageEvent) => {
      if (event.key !== CHANGED || !event.newValue) return;
      try { if (JSON.parse(event.newValue).key === key) void read(); } catch { /* unrelated storage data */ }
    };
    void read();
    window.addEventListener(CHANGED, changed);
    window.addEventListener("storage", storage);
    return () => { live = false; window.removeEventListener(CHANGED, changed); window.removeEventListener("storage", storage); if (url) URL.revokeObjectURL(url); };
  }, [userId, projectId, key]);
  return photo?.key === key ? photo : null;
}
