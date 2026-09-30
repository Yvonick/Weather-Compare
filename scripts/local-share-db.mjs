import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Development only. Production schema changes are applied by Sites from drizzle/.
export function openLocalShareDatabase(root, filename) {
  if (!filename) {
    mkdirSync(join(root, ".local"), { recursive: true });
    filename = join(root, ".local", "shares.sqlite");
  }
  const sqlite = new DatabaseSync(filename);
  const journal = JSON.parse(readFileSync(join(root, "drizzle", "meta", "_journal.json"), "utf8"));
  const { user_version: applied } = sqlite.prepare("PRAGMA user_version").get();
  for (const entry of journal.entries.slice(applied)) {
    sqlite.exec("BEGIN");
    try {
      sqlite.exec(readFileSync(join(root, "drizzle", `${entry.tag}.sql`), "utf8"));
      sqlite.exec(`PRAGMA user_version = ${entry.idx + 1}`);
      sqlite.exec("COMMIT");
    } catch (error) { sqlite.exec("ROLLBACK"); sqlite.close(); throw error; }
  }
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return { bind: (...args) => ({
        run: async () => statement.run(...args),
        first: async () => statement.get(...args) ?? null
      }) };
    },
    close: () => sqlite.close()
  };
}
