import { MemWal } from '@mysten-incubation/memwal';

const defaultServerUrl = 'https://relayer.memwal.ai';

export function memwalNamespace(fqdn) {
  return `cell:${String(fqdn ?? '').trim().toLowerCase() || 'sample'}`;
}

export function memwalConfig(fqdn = '') {
  const accountId = process.env.MEMWAL_ACCOUNT_ID;
  const privateKey = process.env.MEMWAL_PRIVATE_KEY;
  return {
    accountId: accountId || null,
    configured: Boolean(accountId && privateKey),
    namespace: memwalNamespace(fqdn),
    serverUrl: process.env.MEMWAL_SERVER_URL ?? defaultServerUrl,
  };
}

function createMemWal(fqdn) {
  const config = memwalConfig(fqdn);
  if (!config.configured) return null;
  return MemWal.create({
    accountId: config.accountId,
    key: process.env.MEMWAL_PRIVATE_KEY,
    namespace: config.namespace,
    serverUrl: config.serverUrl,
  });
}

export async function rememberCellGrowth({ fqdn, jsonl, generation = 0 }) {
  const memwal = createMemWal(fqdn);
  if (!memwal) {
    return {
      ok: false,
      skipped: true,
      reason: 'MEMWAL_ACCOUNT_ID and MEMWAL_PRIVATE_KEY are not configured.',
      namespace: memwalNamespace(fqdn),
    };
  }

  try {
    const text = [`CELL sample growth state for ${fqdn}`, `generation: ${generation}`, '', jsonl].join('\n');
    const result = await memwal.rememberAndWait(text, memwalNamespace(fqdn), {
      pollIntervalMs: 1500,
      timeoutMs: Number(process.env.MEMWAL_REMEMBER_TIMEOUT_MS ?? '120000'),
    });
    return {
      ok: true,
      blobId: result.blob_id,
      memoryId: result.id,
      namespace: result.namespace || memwalNamespace(fqdn),
      owner: result.owner || '',
    };
  } finally {
    memwal.destroy();
  }
}

export async function recallCellGrowth(fqdn) {
  const memwal = createMemWal(fqdn);
  if (!memwal) {
    return {
      ok: false,
      skipped: true,
      reason: 'MEMWAL_ACCOUNT_ID and MEMWAL_PRIVATE_KEY are not configured.',
      namespace: memwalNamespace(fqdn),
      results: [],
    };
  }

  try {
    const result = await memwal.recall({
      query: `latest CELL sample growth state for ${fqdn}`,
      topK: 10,
      namespace: memwalNamespace(fqdn),
    });
    return {
      ok: true,
      namespace: memwalNamespace(fqdn),
      results: result.results ?? [],
    };
  } finally {
    memwal.destroy();
  }
}
