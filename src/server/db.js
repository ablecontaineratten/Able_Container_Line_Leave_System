// Small wrappers around the D1 binding (env.DB)

export const stmt = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);

export async function all(env, sql, ...args) {
  const res = await stmt(env, sql, ...args).all();
  return res.results || [];
}

export const first = (env, sql, ...args) => stmt(env, sql, ...args).first();

export const run = (env, sql, ...args) => stmt(env, sql, ...args).run();

export const batch = (env, list) => {
  const statements = list.filter(Boolean);           // skip "nothing to do" (null) entries
  return statements.length ? env.DB.batch(statements) : Promise.resolve([]);
};

// "?, ?, ?" for an IN (...) list
export const marks = (list) => list.map(() => '?').join(', ');
