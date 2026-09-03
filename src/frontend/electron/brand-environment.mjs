const LEGACY_PREFIX = 'AGENTHUB_'; // [brand-compat] 旧桌面环境变量只读入口。
const CANONICAL_PREFIX = 'DI_AGENT_';

export function readDiAgentEnvironment(env, suffix) {
  const canonicalKey = `${CANONICAL_PREFIX}${suffix}`;
  if (Object.hasOwn(env, canonicalKey)) {
    return env[canonicalKey];
  }
  return env[`${LEGACY_PREFIX}${suffix}`];
}

/** 子进程只接收 canonical 名称，避免继续传播旧环境变量。 */
export function canonicalizeDiAgentEnvironment(env) {
  const canonical = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith(LEGACY_PREFIX)) {
      const canonicalKey = `${CANONICAL_PREFIX}${key.slice(LEGACY_PREFIX.length)}`;
      if (!Object.hasOwn(env, canonicalKey)) {
        canonical[canonicalKey] = value;
      }
      continue;
    }
    canonical[key] = value;
  }
  return canonical;
}
