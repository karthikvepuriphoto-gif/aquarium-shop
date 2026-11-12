import { openDB } from "idb";
import type { Snapshot } from "../engine";

export interface OutboxOp {
  id: string;
  action: string;
  payload: Record<string, unknown>;
}

export interface LocalBlob {
  snapshot: Snapshot;
  outbox: OutboxOp[];
  spreadsheetId?: string;
  folderId?: string;
  email?: string;
}

const DB_NAME = "aquarium-shop";

async function db() {
  return openDB(DB_NAME, 1, {
    upgrade(database) {
      database.createObjectStore("kv");
    },
  });
}

export async function loadBlob(key: string): Promise<LocalBlob | undefined> {
  const database = await db();
  return database.get("kv", key);
}

export async function saveBlob(key: string, blob: LocalBlob): Promise<void> {
  const database = await db();
  await database.put("kv", blob, key);
}
