// Monad testnet payments: USDC transfers between the caller-agent wallet and the business wallet.
import { createPublicClient, createWalletClient, defineChain, erc20Abi, formatUnits, formatEther, http, parseUnits, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [process.env.MONAD_RPC || 'https://testnet-rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'MonadVision', url: 'https://testnet.monadvision.com' } },
  testnet: true,
});

export const NETWORK = 'eip155:10143';
export const USDC = process.env.USDC_ADDRESS || '0x534b2f3A21130d7a60830c2Df862319e593943A3';
export const explorerTx = (hash) => `https://testnet.monadvision.com/tx/${hash}`;

const pub = createPublicClient({ chain: monadTestnet, transport: http(), pollingInterval: 250 });

function account(envName) {
  const key = process.env[envName];
  if (!key) return null;
  return privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
}

export const wallets = {
  caller: account('CALLER_PRIVATE_KEY'),
  business: account('BUSINESS_PRIVATE_KEY'),
};

export const configured = () => Boolean(wallets.caller && wallets.business);

export async function balances() {
  const out = { chainId: monadTestnet.id, configured: configured() };
  try { out.latestBlock = Number(await pub.getBlockNumber()); } catch (e) { out.rpcError = e.shortMessage || e.message; }
  for (const [name, acct] of Object.entries(wallets)) {
    if (!acct) { out[name] = null; continue; }
    const row = { address: acct.address };
    try {
      const [mon, usdc] = await Promise.all([
        pub.getBalance({ address: acct.address }),
        pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [acct.address] }),
      ]);
      row.mon = Number(formatEther(mon));
      row.usdc = Number(formatUnits(usdc, 6));
    } catch (e) { row.error = e.shortMessage || e.message; }
    out[name] = row;
  }
  return out;
}

// Sends `amountUsd` USDC from one of our wallets to `to`. Falls back to a tiny MON transfer
// when the wallet has no USDC, so the demo still shows a real on-chain transaction.
export async function pay({ from = 'caller', to, amountUsd, purpose = 'payment' }) {
  const acct = wallets[from];
  if (!acct) throw new Error(`No private key configured for the ${from} wallet. Run "npm run wallets".`);
  const wallet = createWalletClient({ account: acct, chain: monadTestnet, transport: http() });
  const amount = parseUnits(Number(amountUsd).toFixed(6), 6);
  const t0 = Date.now();

  let asset = 'USDC';
  let note;
  let hash;
  const usdcBalance = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [acct.address] });
  if (usdcBalance >= amount) {
    hash = await wallet.writeContract({ address: USDC, abi: erc20Abi, functionName: 'transfer', args: [to, amount], gas: 150000n });
  } else {
    asset = 'MON';
    note = `Not enough test USDC in the ${from} wallet, so this sent 0.001 MON instead.`;
    hash = await wallet.sendTransaction({ to, value: parseEther('0.001'), gas: 60000n });
  }
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 15000 });
  if (receipt.status !== 'success') throw new Error(`Transaction ${hash} reverted`);
  return {
    purpose, hash, explorerUrl: explorerTx(hash), blockNumber: Number(receipt.blockNumber),
    settledMs: Date.now() - t0, from: acct.address, to, amountUsd: Number(amountUsd),
    asset, network: NETWORK, ...(note ? { note } : {}),
  };
}

// Throws a plain-English error when a wallet can't pay for gas, instead of an RPC error.
export async function requireGas(name) {
  const acct = wallets[name];
  const mon = await pub.getBalance({ address: acct.address });
  if (mon < parseEther('0.01')) throw new Error(`The ${name} wallet has no test MON for gas yet. Fund ${acct.address} at faucet.monad.xyz.`);
}

export async function usdcBalanceOf(name) {
  const acct = wallets[name];
  if (!acct) return 0;
  const raw = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [acct.address] });
  return Number(formatUnits(raw, 6));
}
