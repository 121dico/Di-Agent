'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROVIDER_KINDS = new Set(['anthropic', 'openai', 'openai-compatible']);
const PROVIDER_SOURCES = new Set(['builtin', 'models-dev', 'custom', 'user', 'workspace', 'ephemeral']);
const API_FORMATS = new Set(['anthropic-messages', 'openai-chat-completions', 'openai-responses']);

function pickProvider(providers, settings) {
  const domain = typeof settings.providerFamilyDomain === 'string'
    ? settings.providerFamilyDomain
    : '';
  const selected = settings.modelProviderFamilySelectedKeys
    && typeof settings.modelProviderFamilySelectedKeys === 'object'
    ? settings.modelProviderFamilySelectedKeys[domain]
    : '';
  const keys = Object.keys(providers);
  const selectedKey = keys.find((key) => selected === key || (selected && selected.endsWith(`:${key}`)));
  if (selectedKey && providers[selectedKey] && providers[selectedKey].enabled !== false) {
    return [selectedKey, providers[selectedKey]];
  }
  const enabledKey = keys.find((key) => providers[key] && providers[key].enabled !== false && (!domain || key.includes(domain)));
  if (enabledKey) return [enabledKey, providers[enabledKey]];
  return [null, null];
}

function pickModel(models, env) {
  const ids = Object.keys(models);
  const explicit = env.DI_AGENT_ZCODE_MODEL || env.AGENTHUB_ZCODE_MODEL; // [brand-compat]
  if (explicit && models[explicit]) return explicit;
  if (models['GLM-5.3']) return 'GLM-5.3';
  return ids
    .map((id, index) => ({ id, index, priority: Number(models[id]?.zcode?.priority) }))
    .sort((left, right) => {
      const leftPriority = Number.isFinite(left.priority) ? left.priority : Number.MAX_SAFE_INTEGER;
      const rightPriority = Number.isFinite(right.priority) ? right.priority : Number.MAX_SAFE_INTEGER;
      return leftPriority - rightPriority || left.index - right.index;
    })[0]?.id || null;
}

function mapModel(modelId, source) {
  const limit = source && typeof source.limit === 'object' ? source.limit : {};
  const inputModalities = Array.isArray(source?.modalities?.input) ? source.modalities.input : [];
  const model = {
    modelId,
    label: (typeof source?.name === 'string' && source.name.trim()) || modelId,
    supportsImages: inputModalities.includes('image'),
    supportsPdf: inputModalities.includes('pdf'),
    supportsTools: true,
  };
  if (Number.isSafeInteger(limit.context) && limit.context > 0) model.contextWindow = limit.context;
  if (Number.isSafeInteger(limit.output) && limit.output > 0) model.maxOutputTokens = limit.output;
  return model;
}

function buildLegacyRuntimeModel({ config, settings, env = process.env, now = Date.now() }) {
  const providers = config && config.provider && typeof config.provider === 'object'
    ? config.provider
    : {};
  const [providerId, legacyProvider] = pickProvider(providers, settings || {});
  if (!providerId || !legacyProvider) {
    throw new Error('ZCode Desktop 未找到已启用的模型 provider，请先在 ZCode 桌面端完成模型配置。');
  }
  const legacyModels = legacyProvider.models && typeof legacyProvider.models === 'object'
    ? legacyProvider.models
    : {};
  const modelId = pickModel(legacyModels, env);
  if (!modelId) {
    throw new Error(`ZCode Desktop provider "${providerId}" 没有可用模型，请先在桌面端选择模型。`);
  }
  const options = legacyProvider.options && typeof legacyProvider.options === 'object'
    ? legacyProvider.options
    : {};
  const kind = PROVIDER_KINDS.has(legacyProvider.kind) ? legacyProvider.kind : 'openai-compatible';
  const provider = {
    providerId,
    kind,
    label: (typeof legacyProvider.name === 'string' && legacyProvider.name.trim()) || providerId,
    source: PROVIDER_SOURCES.has(legacyProvider.source) ? legacyProvider.source : 'custom',
    models: Object.entries(legacyModels).map(([id, model]) => mapModel(id, model)),
  };
  const baseURL = options.baseURL || legacyProvider.baseURL;
  if (typeof baseURL === 'string' && baseURL.trim()) provider.baseURL = baseURL.trim();
  const apiFormat = options.apiFormat || legacyProvider.apiFormat;
  if (API_FORMATS.has(apiFormat)) provider.apiFormat = apiFormat;
  if (typeof options.apiKey === 'string' && options.apiKey) {
    provider.apiKey = { source: 'inline', value: options.apiKey };
  }
  if (typeof options.apiKeyRequired === 'boolean') provider.apiKeyRequired = options.apiKeyRequired;
  if (provider.apiKeyRequired && !provider.apiKey) {
    throw new Error(`ZCode Desktop provider "${providerId}" 缺少 API Key，请先在桌面端登录或填写密钥。`);
  }

  return {
    revision: `di-agent-legacy-${now}`,
    generatedAt: now,
    model: { providerId, modelId },
    provider,
  };
}

function loadZcodeRuntimeModel({
  fsImpl = fs,
  home = os.homedir(),
  pathJoin = path.join,
  env = process.env,
  now = Date.now(),
} = {}) {
  const nativeConfig = pathJoin(home, '.zcode', 'cli', 'config.json');
  if (fsImpl.existsSync(nativeConfig)) return null;
  const legacyConfig = pathJoin(home, '.zcode', 'v2', 'config.json');
  const legacySettings = pathJoin(home, '.zcode', 'v2', 'setting.json');
  if (!fsImpl.existsSync(legacyConfig) || !fsImpl.existsSync(legacySettings)) {
    throw new Error('ZCode Desktop 缺少 CLI/桌面模型配置，请先打开 ZCode 完成登录和模型选择。');
  }
  try {
    return buildLegacyRuntimeModel({
      config: JSON.parse(fsImpl.readFileSync(legacyConfig, 'utf8')),
      settings: JSON.parse(fsImpl.readFileSync(legacySettings, 'utf8')),
      env,
      now,
    });
  } catch (error) {
    if (/^ZCode Desktop/.test(error.message)) throw error;
    throw new Error(`ZCode Desktop 模型配置无法读取: ${error.message}`);
  }
}

function runtimeModelSecrets(runtimeModel) {
  const secret = runtimeModel?.provider?.apiKey?.source === 'inline'
    ? runtimeModel.provider.apiKey.value
    : '';
  return secret ? [secret] : [];
}

function redactSecrets(value, secrets) {
  let output = String(value || '');
  for (const secret of secrets || []) {
    if (secret) output = output.split(secret).join('[REDACTED]');
  }
  return output;
}

module.exports = {
  buildLegacyRuntimeModel,
  loadZcodeRuntimeModel,
  runtimeModelSecrets,
  redactSecrets,
};
