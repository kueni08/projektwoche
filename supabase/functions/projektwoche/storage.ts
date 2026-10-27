// Adapter for the existing, tested request handler. Database access stays in the Edge Function.
export function database(url: string, secret: string) {
  async function call(path: string, method = "GET", body?: unknown) {
    const response = await fetch(url + "/rest/v1/" + path, {
      method,
      headers: {
        apikey: secret,
        Authorization: "Bearer " + secret,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw Error(`Database request failed: ${response.status}`);
    const raw = await response.text();
    return raw ? JSON.parse(raw) : null;
  }
  return {
    prepare(sql: string) {
      let args: unknown[] = [];
      return {
        bind(...values: unknown[]) { args = values; return this; },
        async first() {
          if (sql.startsWith("SELECT revision,payload FROM planning")) {
            const rows = await call("project_planning?select=revision,payload&id=eq.1&limit=1");
            const row = rows?.[0];
            return row ? { revision: Number(row.revision), payload: JSON.stringify(row.payload) } : null;
          }
          throw Error("Unsupported database read");
        },
        async run() {
          if (sql.startsWith("INSERT OR IGNORE INTO planning")) {
            await call("rpc/project_planning_init", "POST", { p_payload: JSON.parse(String(args[0])) });
            return { meta: { changes: 0 } };
          }
          if (sql.startsWith("UPDATE planning SET payload")) {
            const changed = await call("rpc/project_planning_cas", "POST", { p_expected: args[1], p_payload: JSON.parse(String(args[0])) });
            return { meta: { changes: changed ? 1 : 0 } };
          }
          throw Error("Unsupported database write");
        },
      };
    },
  };
}
