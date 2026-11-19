const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_INDEX = new Map(Array.from(BASE58_ALPHABET).map((ch, idx) => [ch, idx]));

function envValue(name, fallback = '') {
  try {
    if (globalThis.Netlify && Netlify.env && typeof Netlify.env.get === 'function') {
      const value = Netlify.env.get(name);
      if (value) return value;
    }
  } catch (_) {}
  return process.env[name] || fallback;
}

export function solanaEnv(name, fallback = '') {
  return envValue(name, fallback);
}

export function base58ToBytes(value) {
  const text = String(value || '').trim();
  if (!text) return new Uint8Array();
  const bytes = [0];
  for (const ch of text) {
    const n = BASE58_INDEX.get(ch);
    if (n == null) throw new Error('Invalid base58 character');
    let carry = n;
    for (let i = 0; i < bytes.length; i++) {
      const x = bytes[i] * 58 + carry;
      bytes[i] = x & 0xff;
      carry = x >> 8;
    }
    while (carry) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let i = 0; i < text.length - 1 && text[i] === '1'; i++) bytes.push(0);
  return new Uint8Array(bytes.reverse());
}

export function bytesToBase58(input) {
  const bytes = Array.from(input || []);
  if (!bytes.length) return '';
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      const x = digits[i] * 256 + carry;
      digits[i] = x % 58;
      carry = Math.floor(x / 58);
    }
    while (carry) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = '';
  for (let i = 0; i < bytes.length - 1 && bytes[i] === 0; i++) out += '1';
  for (let i = digits.length - 1; i >= 0; i--) out += BASE58_ALPHABET[digits[i]];
  return out;
}

export function isSolanaPublicKey(value) {
  try {
    return base58ToBytes(value).length === 32;
  } catch (_) {
    return false;
  }
}

export function formatAtomicAmount(amount, decimals) {
  const scale = Math.max(0, Math.min(18, Number(decimals) || 0));
  let text = String(amount || '0').replace(/[^0-9]/g, '') || '0';
  if (scale === 0) return text;
  if (text.length <= scale) text = text.padStart(scale + 1, '0');
  const whole = text.slice(0, -scale) || '0';
  const frac = text.slice(-scale).replace(/0+$/g, '');
  return frac ? whole + '.' + frac : whole;
}

function addAtomic(a, b) {
  return (BigInt(a || '0') + BigInt(b || '0')).toString();
}

export async function solanaRpc(method, params) {
  const rpcUrl = solanaEnv('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'tinyworld-' + Date.now().toString(36),
        method,
        params,
      }),
      signal: controller.signal,
    });
    const payload = await res.json();
    if (!res.ok || payload.error) {
      const message = payload && payload.error && payload.error.message
        ? payload.error.message
        : 'Solana RPC request failed';
      throw new Error(message);
    }
    return payload.result;
  } finally {
    clearTimeout(timer);
  }
}

export async function tokenSummaryForOwner(ownerAddress, mintAddress) {
  if (!mintAddress || !isSolanaPublicKey(mintAddress)) {
    return {
      configured: false,
      mint: mintAddress || '',
      symbol: solanaEnv('TINYWORLD_TOKEN_SYMBOL', 'TINYWORLD'),
      amount: '0',
      decimals: 0,
      uiAmount: '0',
      accounts: [],
    };
  }
  const result = await solanaRpc('getTokenAccountsByOwner', [
    ownerAddress,
    { mint: mintAddress },
    { encoding: 'jsonParsed', commitment: 'confirmed' },
  ]);
  const rows = Array.isArray(result && result.value) ? result.value : [];
  let total = '0';
  let decimals = 0;
  const accounts = rows.map(row => {
    const info = row && row.account && row.account.data
      && row.account.data.parsed && row.account.data.parsed.info;
    const tokenAmount = info && info.tokenAmount ? info.tokenAmount : {};
    const amount = String(tokenAmount.amount || '0');
    decimals = Math.max(decimals, Number(tokenAmount.decimals) || 0);
    total = addAtomic(total, amount);
    return {
      pubkey: row.pubkey,
      amount,
      decimals: Number(tokenAmount.decimals) || 0,
      uiAmount: tokenAmount.uiAmountString || formatAtomicAmount(amount, tokenAmount.decimals),
    };
  });
  return {
    configured: true,
    mint: mintAddress,
    symbol: solanaEnv('TINYWORLD_TOKEN_SYMBOL', 'TINYWORLD'),
    amount: total,
    decimals,
    uiAmount: formatAtomicAmount(total, decimals),
    accounts,
  };
}

export async function activityForWallet(ownerAddress, tokenAccounts = []) {
  const addresses = [ownerAddress]
    .concat((Array.isArray(tokenAccounts) ? tokenAccounts : []).map(a => a && a.pubkey).filter(Boolean))
    .slice(0, 6);
  const seen = new Map();
  await Promise.all(addresses.map(async (address) => {
    try {
      const rows = await solanaRpc('getSignaturesForAddress', [
        address,
        { limit: address === ownerAddress ? 8 : 4 },
      ]);
      (Array.isArray(rows) ? rows : []).forEach(row => {
        if (!row || !row.signature || seen.has(row.signature)) return;
        seen.set(row.signature, {
          signature: row.signature,
          slot: row.slot,
          blockTime: row.blockTime || null,
          err: row.err || null,
          memo: row.memo || '',
          account: address,
        });
      });
    } catch (_) {}
  }));
  return Array.from(seen.values())
    .sort((a, b) => (Number(b.blockTime) || 0) - (Number(a.blockTime) || 0))
    .slice(0, 12);
}

export function solanaPayUrl({ recipient, amount, splToken, reference, label, message, memo }) {
  if (!isSolanaPublicKey(recipient)) throw new Error('Invalid payment recipient');
  if (splToken && !isSolanaPublicKey(splToken)) throw new Error('Invalid SPL token mint');
  if (reference && !isSolanaPublicKey(reference)) throw new Error('Invalid payment reference');
  const query = new URLSearchParams();
  if (amount) query.set('amount', String(amount));
  if (splToken) query.set('spl-token', splToken);
  if (reference) query.set('reference', reference);
  if (label) query.set('label', String(label).slice(0, 80));
  if (message) query.set('message', String(message).slice(0, 140));
  if (memo) query.set('memo', String(memo).slice(0, 120));
  const qs = query.toString();
  return 'solana:' + recipient + (qs ? '?' + qs : '');
}
