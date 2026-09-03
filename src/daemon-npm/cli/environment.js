'use strict';

const LEGACY_PREFIX = 'AGENTHUB_'; // [brand-compat] 旧 daemon 环境变量只读入口。

function readDiAgentEnvironment(env, suffix) {
  const canonicalKey = `DI_AGENT_${suffix}`;
  if (Object.prototype.hasOwnProperty.call(env, canonicalKey)) {
    return env[canonicalKey];
  }
  return env[`${LEGACY_PREFIX}${suffix}`];
}

module.exports = { readDiAgentEnvironment };
