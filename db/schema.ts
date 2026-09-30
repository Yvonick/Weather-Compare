import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sharedComparisons = sqliteTable("shared_comparisons", {
  token: text("token").primaryKey(),
  settingsHash: text("settings_hash").notNull().unique(),
  query: text("query").notNull(),
  createdAt: integer("created_at").notNull()
});
