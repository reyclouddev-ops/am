import { randomBytes } from 'node:crypto';

const MAIL_BASE = process.env.MAIL_BASE_URL || 'https://glx.web.id';
const MAIL_DOMAIN = process.env.MAIL_DOMAIN || 'glx.web.id';

function generateRandomUsername() {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let prefix = '';
  for (let i = 0; i < 7; i++) {
    prefix += chars[randomBytes(1)[0] % 26];
  }
  const timestampSuffix = String(Date.now()).slice(-6);
  return `${prefix}${timestampSuffix}`;
}

export async function createTempEmail(domain = MAIL_DOMAIN) {
  const username = generateRandomUsername();
  const address = `${username}@${domain}`;

  const confirmUrl = `${MAIL_BASE}/confirm/${encodeURIComponent(address)}/__data.json?x-sveltekit-invalidated=01`;
  const res = await fetch(confirmUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });

  if (!res.ok) {
    throw new Error(`Failed to initialize mailbox ${address}: HTTP ${res.status}`);
  }

  return address;
}

function resolveCompact(v, raw, depth = 0) {
  if (depth > 50) return v;
  if (typeof v === 'number') return resolveCompact(raw[v], raw, depth + 1);
  if (Array.isArray(v)) return v.map((i) => resolveCompact(i, raw, depth + 1));
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const obj = {};
    for (const [k, val] of Object.entries(v)) {
      obj[k] = resolveCompact(val, raw, depth + 1);
    }
    return obj;
  }
  return v;
}

export async function fetchEmails(address) {
  const inboxUrl = `${MAIL_BASE}/inbox/${encodeURIComponent(address)}/__data.json?x-sveltekit-invalidated=01`;
  const res = await fetch(inboxUrl, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch mailbox: HTTP ${res.status}`);
  }

  const json = await res.json();
  for (const node of json.nodes || []) {
    if (node?.type === 'data') {
      const raw = node.data;
      if (Array.isArray(raw)) {
        const descriptor = resolveCompact(raw[0], raw);
        if (descriptor && Array.isArray(descriptor.emails)) {
          return descriptor.emails;
        }
      } else if (raw?.emails && Array.isArray(raw.emails)) {
        return raw.emails;
      }
    }
  }

  return [];
}

export function extractVerificationCode(emails) {
  for (const email of emails) {
    const rawContent = `${email.subject || ''} ${email.text || ''} ${email.html || ''}`;
    const matchOtp = rawContent.match(/verification code is (\d{6})/i) ||
                     rawContent.match(/verify code:[\s\S]*?>\s*(\d{6})\s*</i) ||
                     rawContent.match(/(\d{6})<\/p>/i) ||
                     rawContent.match(/\b(\d{6})\b/);
    if (matchOtp) {
      return matchOtp[1];
    }
  }
  return null;
}

export async function waitForVerificationCode(address, timeoutMs = 60000, intervalMs = 2500) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const emails = await fetchEmails(address);
      if (emails && emails.length > 0) {
        const code = extractVerificationCode(emails);
        if (code) {
          return code;
        }
      }
    } catch {}
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`Timeout waiting for verification email after ${Math.round(timeoutMs / 1000)}s`);
}
