import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Grep-style checks over the files this sprint adds. They stand in for the
 * "no service role", "no send path" and "only the caller's scoped client" rules
 * a reviewer would otherwise check by hand.
 */

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

function walk(dir: string): string[] {
  return readdirSync(path.join(root, dir)).flatMap((name) => {
    const rel = path.join(dir, name);
    return statSync(path.join(root, rel)).isDirectory() ? walk(rel) : [rel];
  });
}

const NEW_FILES = [
  ...walk("src/lib/files"),
  ...walk("src/components/files"),
  ...walk("src/app/dashboard/files"),
];

/** The server-side files that touch storage or the table. */
const SERVER_FILES = [...walk("src/lib/files"), ...walk("src/app/dashboard/files")];

describe("the new files", () => {
  it("lists the files this sprint adds", () => {
    expect(NEW_FILES.length).toBeGreaterThanOrEqual(11);
  });

  it("never use the service-role client or key", () => {
    for (const file of [...NEW_FILES, "src/app/dashboard/leads/[id]/page.tsx", "src/app/dashboard/matters/[id]/page.tsx"]) {
      const src = read(file);
      expect(src, file).not.toMatch(/getAdminClient\(/);
      expect(src, file).not.toContain("@/lib/db/admin");
      expect(src, file).not.toMatch(/service[_-]?role/i);
      expect(src, file).not.toContain("SUPABASE_SERVICE_ROLE");
    }
  });

  it("reach storage only through the caller's scoped client, and only the client-files bucket", () => {
    for (const file of SERVER_FILES) {
      const src = read(file);
      for (const m of src.matchAll(/\.from\((["'`])([^"'`]+)\1\)\s*(?:\.|\n)/g)) {
        // supabase.from("table") for tables; storage buckets are named through FILES_BUCKET only.
        expect(m[2], file).toMatch(/^crm_/);
      }
      expect(src, file).not.toMatch(/storage\s*\.from\((["'`])/); // never a literal bucket name here
      expect(src, file).not.toContain("matter-documents");
      expect(src, file).not.toContain("voice-notes");
    }
    const rules = read("src/lib/files/rules.ts");
    expect(rules.match(/FILES_BUCKET = "client-files"/g)).toHaveLength(1);
    // Every storage call in the actions and the route is on FILES_BUCKET via the scoped client.
    for (const file of ["src/app/dashboard/files/actions.ts", "src/app/dashboard/files/[id]/download/route.ts"]) {
      const src = read(file);
      const calls = src.match(/storage\s*\.from\(/g) ?? [];
      const bucketed = src.match(/storage\s*\.from\(FILES_BUCKET\)|storage\s*\n\s*\.from\(FILES_BUCKET\)/g) ?? [];
      expect(calls.length, file).toBeGreaterThan(0);
      expect(bucketed.length, file).toBe(calls.length);
      expect(src, file).toContain("getScopedClient");
    }
  });

  it("send nothing, queue nothing and build no client-facing link", () => {
    for (const file of NEW_FILES) {
      const src = read(file);
      expect(src, file).not.toMatch(/sendMail|resend|notify\(|\/queue|@\/lib\/queue|approval/i);
      expect(src, file).not.toMatch(/dangerouslySetInnerHTML/);
    }
  });

  it("carry no schema or SQL text", () => {
    for (const file of NEW_FILES) {
      expect(read(file), file).not.toMatch(/\b(create table|alter table|create policy|insert into|drop table)\b/i);
    }
  });

  it("have no TODO, coming-soon or lorem text", () => {
    for (const file of NEW_FILES) expect(read(file), file).not.toMatch(/TODO|coming soon|lorem/i);
  });
});

describe("what this sprint leaves alone", () => {
  it("adds no dangerouslySetInnerHTML anywhere in src", () => {
    for (const file of walk("src")) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      if (/dangerouslySetInnerHTML/.test(read(file))) {
        // Pre-existing uses are allowed; none of this sprint's files has one (checked above).
        expect(NEW_FILES).not.toContain(file);
      }
    }
  });

  it("hand-adds the types with a note that codegen replaces them", () => {
    const types = read("src/lib/db/types.ts");
    expect(types).toContain("HAND-ADDED for lectual 0097");
    expect(types).toMatch(/replaces this block/);
    expect(read("src/lib/matters/activity.ts")).toMatch(/ACTIVITY_TYPES_0097[\s\S]{0,40}file_uploaded|0097[\s\S]*next codegen run/);
  });

  it("documents the feature in AGENTS.md", () => {
    const agents = read("AGENTS.md");
    expect(agents).toContain("## Documents & files (lectual 0097)");
    expect(agents).toContain("client-files");
    expect(agents).toMatch(/extension/i);
  });
});
