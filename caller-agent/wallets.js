// One-time setup: creates two throwaway Monad testnet wallets and saves their keys to .env.
// CALLER = the homeowner's AI agent (pays). BUSINESS = the plumber (receives).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const envPath = new URL('../.env', import.meta.url);
let env = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';

const lines = [];
for (const name of ['CALLER', 'BUSINESS']) {
  const keyName = `${name}_PRIVATE_KEY`;
  const existing = env.match(new RegExp(`^${keyName}=(.+)$`, 'm'));
  const key = existing ? existing[1].trim() : generatePrivateKey();
  if (!existing) env += `${env && !env.endsWith('\n') ? '\n' : ''}${keyName}=${key}\n`;
  const { address } = privateKeyToAccount(key);
  lines.push(`${name.padEnd(8)} ${address}${existing ? '  (already in .env)' : '  (new)'}`);
  if (name === 'BUSINESS' && !/^BUSINESS_ADDRESS=/m.test(env)) env += `BUSINESS_ADDRESS=${address}\n`;
}
writeFileSync(envPath, env);

console.log('Test wallets (Monad testnet, chain 10143). Keys are in .env; never use them for real money.\n');
console.log(lines.join('\n'));
console.log('\nFund them:');
console.log('  MON for gas, both addresses: https://faucet.monad.xyz');
console.log('  20 test USDC, CALLER address: https://faucet.circle.com  (network: Monad Testnet)');
