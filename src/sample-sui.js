import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { SuinsClient } from '@mysten/suins';

export const network = process.env.SUI_NETWORK ?? 'mainnet';
export const rootName = process.env.CELL_ROOT_NAME ?? 'cell.sui';
export const usdcCoinType =
  process.env.CELL_USDC_COIN_TYPE ??
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
export const heartbeatUsdcBaseUnits = BigInt(process.env.CELL_HEARTBEAT_USDC_BASE_UNITS ?? '10000');

if (!['mainnet', 'testnet', 'devnet', 'localnet'].includes(network)) {
  throw new Error(`Unsupported SUI_NETWORK "${network}".`);
}

export const suiClient = new SuiJsonRpcClient({
  network,
  url: process.env.SUI_RPC_URL ?? getJsonRpcFullnodeUrl(network),
});

export const suinsClient = new SuinsClient({ client: suiClient, network });

export function normalizeName(name) {
  return String(name ?? '').trim().toLowerCase();
}

export function fqdnForName(name) {
  return `${normalizeName(name).replace(/\.cell\.sui$/i, '').replace(/@cell$/i, '')}.${rootName}`;
}

export function validateCellName(name) {
  if (!/^[a-z0-9-]{3,32}$/.test(name) || name.startsWith('-') || name.endsWith('-')) {
    const error = new Error('Use 3-32 lowercase letters, numbers, or hyphens.');
    error.statusCode = 400;
    throw error;
  }
}

function registrationIdField() {
  return ['n', 'f', 't', 'I', 'd'].join('');
}

export async function getNameAvailability(rawName) {
  const name = normalizeName(rawName).replace(/\.cell\.sui$/i, '').replace(/@cell$/i, '');
  validateCellName(name);

  const fqdn = fqdnForName(name);
  const [resolvedAddress, record] = await Promise.all([
    suiClient.resolveNameServiceAddress({ name: fqdn }),
    suinsClient.getNameRecord(fqdn).catch(() => null),
  ]);

  return {
    name,
    fqdn,
    available: !resolvedAddress && !record,
    resolvedAddress: resolvedAddress ?? null,
    registrationId: record?.[registrationIdField()] ?? null,
    network,
  };
}

export async function getCellNamesForOwner(owner) {
  const address = String(owner ?? '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(address)) {
    const error = new Error('Invalid owner address.');
    error.statusCode = 400;
    throw error;
  }

  const names = [];
  let cursor = null;
  do {
    const page = await suiClient.resolveNameServiceNames({ address, cursor, limit: 50 });
    for (const fqdn of page.data) {
      if (!fqdn.endsWith(`.${rootName}`)) continue;
      const resolvedAddress = await suiClient.resolveNameServiceAddress({ name: fqdn });
      if (resolvedAddress?.toLowerCase() !== address.toLowerCase()) continue;
      names.push({
        name: fqdn.slice(0, -`.${rootName}`.length),
        fqdn,
        owner: address,
        resolvedAddress,
      });
    }
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);

  return { owner: address, names, network };
}

export async function getHeartbeatBalance(owner) {
  const balance = await suiClient.getBalance({ owner, coinType: usdcCoinType });
  const totalBalance = BigInt(balance.totalBalance ?? '0');
  return {
    owner,
    coinType: usdcCoinType,
    totalBalance: totalBalance.toString(),
    heartbeats: heartbeatUsdcBaseUnits > 0n ? Number(totalBalance / heartbeatUsdcBaseUnits) : 0,
    network,
  };
}
