import { expect, test, vi } from "vitest";
import { boardPhotoKey, readBoardPhoto, saveBoardPhoto } from "./personalBoardPhoto";

test("storage scope distinguishes both account and project, even with punctuation in IDs", () => {
  expect(boardPhotoKey("a", "p")).not.toBe(boardPhotoKey("b", "p"));
  expect(boardPhotoKey("a", "p")).not.toBe(boardPhotoKey("a", "q"));
  expect(boardPhotoKey("a:b", "c")).not.toBe(boardPhotoKey("a", "b:c"));
});

test("saving, replacing and removing a photo changes only its account/project record", async () => {
  const records = new Map<string, unknown>();
  vi.stubGlobal("indexedDB", {
    open: () => {
      const opening = { result: { close: vi.fn(), transaction: () => {
        const tx = { oncomplete: null as null | (() => void), onabort: null, objectStore: () => ({
          get: (key: string) => request(() => records.get(key)),
          put: (value: unknown, key: string) => request(() => { records.set(key, value); return key; }),
          delete: (key: string) => request(() => { records.delete(key); }),
        }) };
        function request(operation: () => unknown) {
          const req = { result: undefined as unknown, onsuccess: null as null | (() => void) };
          queueMicrotask(() => { req.result = operation(); req.onsuccess?.(); tx.oncomplete?.(); });
          return req;
        }
        return tx;
      } }, onsuccess: null as null | (() => void) };
      queueMicrotask(() => opening.onsuccess?.());
      return opening;
    },
  });
  const first = { blob: new Blob(["first"]), luma: 0.2 };
  const second = { blob: new Blob(["second"]), luma: 0.7 };
  try {
    await saveBoardPhoto("a", "p", first);
    expect(await readBoardPhoto("a", "p")).toEqual(first);
    expect(await readBoardPhoto("b", "p")).toBeNull();
    expect(await readBoardPhoto("a", "q")).toBeNull();
    await saveBoardPhoto("b", "p", second);
    await saveBoardPhoto("a", "p", second);
    expect(await readBoardPhoto("a", "p")).toEqual(second);
    await saveBoardPhoto("a", "p", null);
    expect(await readBoardPhoto("a", "p")).toBeNull();
    expect(await readBoardPhoto("b", "p")).toEqual(second);
  } finally { vi.unstubAllGlobals(); localStorage.clear(); }
});

test("unavailable local storage rejects without sending the photo to a server", async () => {
  vi.stubGlobal("indexedDB", undefined);
  try {
    await expect(readBoardPhoto("a", "p")).rejects.toThrow("storage-unavailable");
    await expect(saveBoardPhoto("a", "p", { blob: new Blob(["photo"]), luma: 0.5 })).rejects.toThrow("storage-unavailable");
    await expect(saveBoardPhoto("", "p", null)).rejects.toThrow("missing-photo-owner");
  } finally { vi.unstubAllGlobals(); }
});
