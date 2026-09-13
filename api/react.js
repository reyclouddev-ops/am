const http = require('http');
const https = require('https');
const tls = require('tls');
const readline = require('readline');
const { execSync } = require('child_process');

let globalRl = null;

function getReadline() {
  if (!globalRl || globalRl.closed) {
    globalRl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }
  return globalRl;
}

function askQuestion(query) {
  const rl = getReadline();
  return new Promise(resolve => {
    rl.question(query, answer => {
      resolve((answer || '').trim());
    });
  });
}

function closeReadline() {
  if (globalRl && !globalRl.closed) {
    globalRl.close();
    globalRl = null;
  }
}

const CREATOR = 'ReyCode';
const BASE_URL = 'https://react.keyysspanel.web.id';
const DEFAULT_TG_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const DEFAULT_TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '2027479396';
const TURNSTILE_FALLBACK_SITEKEY = '0x4AAAAAAErNYkwC4FusFhKz';

const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  subtle: '\x1b[90m',
  accent: '\x1b[38;5;208m'
};

function formatDuration(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function printProgress(step, label, status = 'pending', duration = null) {
  const symbol = status === 'success'
    ? `${c.green}●${c.reset}`
    : status === 'error'
    ? `${c.red}✖${c.reset}`
    : `${c.dim}○${c.reset}`;

  const timing = duration ? ` ${c.dim}${duration}${c.reset}` : '';
  const text = `  ${symbol}  ${label}${timing}`;

  if (status === 'pending') {
    process.stderr.write(`\r${text.padEnd(70)}`);
  } else {
    process.stderr.write(`\r${text.padEnd(70)}\n`);
  }
}

function parseSetCookies(res) {
  const raw = res.headers['set-cookie'];
  if (!raw) return [];
  return (Array.isArray(raw) ? raw : [raw])
    .map(line => line.split(';')[0].trim())
    .filter(Boolean);
}

function request(url, options = {}, postData = null, proxy = null, jar = null) {
  const timeoutMs = options.timeout || 15000;
  const maxDurationMs = options.maxDuration || null;
  return new Promise((outerResolve, outerReject) => {
    let settled = false;
    const settle = (fn, v) => { if (!settled) { settled = true; clearTimeout(deadline); fn(v); } };

    const deadline = setTimeout(() => {
      settle(outerReject, new Error(`Timeout ${maxDurationMs || timeoutMs}ms: ${url}${proxy ? ` (via ${proxy})` : ''}`));
    }, maxDurationMs || timeoutMs);

    const u = new URL(url);
    const isHttps = u.protocol === 'https:';
    const defaultPort = isHttps ? 443 : 80;
    const targetPort = u.port || defaultPort;

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      Host: u.hostname,
      ...options.headers
    };

    if (jar && jar.size > 0) {
      headers['Cookie'] = [...jar.values()].join('; ');
    }

    const finish = (response, socketRef) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        settle(outerResolve, {
          statusCode: response.statusCode,
          headers: response.headers,
          body: data
        });
      });
      response.on('error', (e) => settle(outerReject, e));
      if (socketRef && socketRef.destroy) {}
    };

    if (proxy) {
      const [proxyHost, proxyPortStr] = proxy.replace(/^https?:\/\//, '').split(':');
      const proxyPort = parseInt(proxyPortStr) || 8080;

      const connectReq = http.request({
        host: proxyHost,
        port: proxyPort,
        method: 'CONNECT',
        path: `${u.hostname}:${targetPort}`,
        headers: { Host: `${u.hostname}:${targetPort}` }
      });

      connectReq.on('connect', (res, socket) => {
        if (settled) { socket.destroy(); return; }
        if (res.statusCode !== 200) {
          socket.destroy();
          return settle(outerReject, new Error(`Proxy CONNECT returned ${res.statusCode}`));
        }

        const proceedWithSocket = (networkSocket) => {
          if (settled) { networkSocket.destroy(); return; }
          const req = (isHttps ? https : http).request({
            hostname: u.hostname,
            port: targetPort,
            path: u.pathname + u.search,
            method: options.method || 'GET',
            createConnection: () => networkSocket,
            headers
          }, (response) => finish(response));

          req.on('error', (e) => settle(outerReject, e));
          if (postData) {
            req.write(postData);
          }
          req.end();
        };

        if (isHttps) {
          const tlsSocket = tls.connect({
            socket,
            servername: u.hostname,
            rejectUnauthorized: false
          }, () => proceedWithSocket(tlsSocket));
          tlsSocket.on('error', (e) => settle(outerReject, e));
        } else {
          proceedWithSocket(socket);
        }
      });

      connectReq.on('error', (e) => settle(outerReject, e));
      connectReq.end();
      return;
    }

    const client = isHttps ? https : http;
    const req = client.request({
      hostname: u.hostname,
      port: targetPort,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers
    }, (response) => finish(response));

    req.on('error', (e) => settle(outerReject, e));
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

function createCookieJar() {
  return new Map();
}

function storeCookies(jar, res) {
  if (!jar || !res || !res.headers) return;
  for (const cookie of parseSetCookies(res)) {
    const eq = cookie.indexOf('=');
    if (eq > 0) {
      jar.set(cookie.slice(0, eq), cookie.slice(eq + 1));
    }
  }
}

async function jsonRequest(url, { method = 'GET', body = null, headers = {}, timeout = 15000, proxy = null, jar = null } = {}) {
  const payload = body === null ? null : JSON.stringify(body);
  const res = await request(url, {
    method,
    timeout,
    headers: {
      Accept: 'application/json',
      ...(payload !== null ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      } : {}),
      ...headers
    }
  }, payload, proxy, jar);

  storeCookies(jar, res);

  try {
    return { res, json: JSON.parse(res.body) };
  } catch {
    return { res, json: null };
  }
}

const PROXYSCRAPE_API_KEY = process.env.PROXYSCRAPE_API_KEY || 'bYUUcDxaPvupyNuMBn6wTJnR5f6PehQ08i6AvyHYwKGSpZDQear1Wb4YJ7gm5Ozz';

async function fetchProxyScrapeList(options = {}) {
  const country = options.country || null;
  const apiKey = options.apiKey !== undefined ? options.apiKey : PROXYSCRAPE_API_KEY;

  let endpoint = 'https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&proxy_format=protocolipport&format=text';
  if (country && country !== 'all') endpoint += `&country=${encodeURIComponent(country)}`;
  if (apiKey) endpoint += `&api_key=${encodeURIComponent(apiKey)}`;

  const res = await request(endpoint, { timeout: 20000, maxDuration: 30000 });
  if (res.statusCode !== 200 || !res.body) {
    throw new Error(`ProxyScrape API error (${res.statusCode}): ${(res.body || '').slice(0, 120)}`);
  }

  const list = res.body
    .trim()
    .split(/\r?\n/)
    .map(p => p.trim())
    .filter(p => /^https?:\/\//i.test(p))
    .map(p => p.replace(/^https?:\/\//i, ''))
    .filter(p => /^[^:\s]+:\d{2,5}$/.test(p));

  return [...new Set(list)];
}

function solveTurnstile(siteKey, proxy = null, targetPageUrl = BASE_URL) {
  const pageUrl = targetPageUrl || BASE_URL;
  const proxyArg = proxy ? ` --proxy http://${proxy.replace(/^https?:\/\//, '')}` : '';
  const cmd = `npx haidarcf turnstile-min --url ${pageUrl} --sitekey ${siteKey}${proxyArg}`;
  const output = execSync(cmd, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'ignore'],
    timeout: 90000,
    killSignal: 'SIGKILL'
  });
  const match = output.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Solver output invalid');
  const data = JSON.parse(match[0]);
  if (!data.token) throw new Error('Failed to obtain captcha token');
  return data.token;
}

async function findWorkingProxy(quiet = false, country = 'id', want = 5) {
  const pools = [];
  if (country && country !== 'all') pools.push(country);
  pools.push(null);

  const t0 = Date.now();
  const tested = new Set();
  const candidates = [];
  const chunkSize = 25;
  const maxPerPool = 100;

  const probePool = async (list, label) => {
    const shuffled = list.filter(p => !tested.has(p)).sort(() => Math.random() - 0.5);
    const maxToTest = Math.min(shuffled.length, maxPerPool);
    if (!maxToTest) return;

    for (let i = 0; i < maxToTest && candidates.length < want; i += chunkSize) {
      const chunk = shuffled.slice(i, i + chunkSize);
      chunk.forEach(p => tested.add(p));
      if (!quiet) printProgress(0, `Probing ${label} proxies (${i + 1}-${Math.min(i + chunk.length, maxToTest)}/${maxToTest})`, 'pending');

      const results = await Promise.all(chunk.map(async (proxyAddr) => {
        try {
          const { res, json } = await jsonRequest(`${BASE_URL}/api/free/status`, { timeout: 1800, proxy: proxyAddr });
          if (res.statusCode === 200 && json && typeof json.uid === 'string' && json.uid) {
            return { proxy: proxyAddr, uid: json.uid, limit: json.limit || 0 };
          }
        } catch {}
        return null;
      }));

      for (const r of results) {
        if (r && candidates.length < want) candidates.push(r);
      }
    }
  };

  for (const pool of pools) {
    if (candidates.length >= want) break;
    const label = pool ? pool.toUpperCase() : 'GLOBAL';
    if (!quiet) printProgress(0, `Fetching free proxies from ProxyScrape (pool: ${label})`, 'pending');
    let list = [];
    try {
      list = await fetchProxyScrapeList({ country: pool });
    } catch (e) {
      if (!quiet) printProgress(0, `Pool ${label} gagal: ${e.message}`, 'pending');
      continue;
    }
    if (!quiet) printProgress(0, `Obtained ${list.length} HTTP proxies (pool: ${label})`, 'success', formatDuration(Date.now() - t0));
    await probePool(list, label);
  }

  if (!candidates.length) {
    throw new Error('Tidak ada proxy ProxyScrape yang berhasil terhubung');
  }

  candidates.sort((a, b) => b.limit - a.limit);
  if (!quiet) {
    printProgress(0, `Found ${candidates.length} alive proxies: ${candidates.map(x => x.proxy).join(', ')}`, 'success');
  }
  return { proxy: candidates[0].proxy, uid: candidates[0].uid, candidates };
}

async function sendTelegramNotification(message, botToken = DEFAULT_TG_BOT_TOKEN, chatId = DEFAULT_TG_CHAT_ID) {
  if (!botToken || !chatId) return false;
  try {
    const payload = JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown'
    });
    await request(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, payload);
    return true;
  } catch {
    return false;
  }
}

async function getTurnstileStatus(proxy = null) {
  try {
    const { json } = await jsonRequest(`${BASE_URL}/api/turnstile/status`, { timeout: 10000, proxy });
    if (json && json.siteKey) return json;
  } catch {}
  return { configured: true, siteKey: TURNSTILE_FALLBACK_SITEKEY };
}

async function getFreeStatus(proxy = null, jar = null) {
  const { res, json } = await jsonRequest(`${BASE_URL}/api/free/status`, { timeout: 10000, proxy, jar });
  return (res.statusCode === 200 && json) ? json : null;
}

async function getVipSession(vipKey, proxy = null, jar = null) {
  const { res, json } = await jsonRequest(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    timeout: 12000,
    proxy,
    jar,
    body: { key: vipKey }
  });

  if (res.statusCode === 200 && json && json.success && json.user) {
    return json.user;
  }
  return null;
}

async function executeReaction({
  channelLink,
  emojis = '👍',
  vipKey = null,
  notifyTelegram = true,
  quiet = false,
  useProxy = false,
  proxyCountry = 'id',
  manualProxy = null
}) {
  const startTime = Date.now();
  let activeProxy = null;
  let useProxyLocal = useProxy;

  if (!manualProxy && !useProxyLocal && !vipKey) {
    try {
      const sData = await getFreeStatus(null);
      if (sData && (sData.limit <= 0 || sData.ipBlocked)) {
        if (!quiet) printProgress(0, 'IP limit reached (24h cooldown). Auto-switching to ProxyScrape pool', 'pending');
        useProxyLocal = true;
      }
    } catch {}
  }

  if (typeof module.exports.cachedAliveProxies === 'undefined') module.exports.cachedAliveProxies = null;
  let candidateList = [];
  if (manualProxy) {
    activeProxy = manualProxy;
    candidateList = [{ proxy: manualProxy, uid: null, limit: 0 }];
    if (!quiet) printProgress(0, `Custom proxy configured: ${manualProxy}`, 'success');
  } else if (useProxyLocal) {
    if (module.exports.cachedAliveProxies && module.exports.cachedAliveProxies.length) {
      candidateList = module.exports.cachedAliveProxies;
      if (!quiet) printProgress(0, `Reusing ${candidateList.length} cached alive proxies`, 'success');
    } else {
      const proxyData = await findWorkingProxy(quiet, proxyCountry);
      candidateList = proxyData.candidates;
      module.exports.cachedAliveProxies = candidateList;
    }
  }

  const t0 = Date.now();
  let uid = null;
  let vipUser = null;
  let jar = null;
  let isSuccess = false;
  let messageDetail = '';
  let lastError = null;
  let solverCalls = 0;

  for (let ci = 0; ci < candidateList.length; ci++) {
    activeProxy = candidateList[ci].proxy;
    jar = createCookieJar();
    uid = null;
    vipUser = null;

    try {
      if (!quiet) printProgress(1, `Establishing session via ${activeProxy} (${ci + 1}/${candidateList.length})`, 'pending');

      try {
        const free = await getFreeStatus(activeProxy, jar);
        if (free && free.uid) uid = free.uid;
      } catch {}

      if (vipKey) {
        vipUser = await getVipSession(vipKey, activeProxy, jar);
        if (vipUser && vipUser.key) {
          uid = vipUser.key;
          if (!quiet) printProgress(1, `VIP session established (${vipUser.key})`, 'success', formatDuration(Date.now() - t0));
        }
      }

      if (!uid) {
        throw new Error('Gagal mendapatkan uid via proxy (api/free/status)');
      }
      if (!vipUser && !quiet) {
        printProgress(1, `Session established (uid: ${uid})`, 'success', formatDuration(Date.now() - t0));
      }

      if (!quiet) printProgress(2, 'Solving Cloudflare Turnstile verification', 'pending');
      const t1 = Date.now();
      const tsStatus = await getTurnstileStatus(activeProxy);
      const siteKey = tsStatus.siteKey || TURNSTILE_FALLBACK_SITEKEY;
      let turnstileToken = null;
      if (solverCalls < 3) {
        try {
          solverCalls++;
          turnstileToken = solveTurnstile(siteKey, activeProxy, `${BASE_URL}/`);
        } catch (solverErr) {
          if (solverCalls < 3) {
            await new Promise(r => setTimeout(r, 1500));
            try {
              solverCalls++;
              turnstileToken = solveTurnstile(siteKey, null, `${BASE_URL}/`);
            } catch {}
          }
        }
      }
      if (!turnstileToken) {
        throw new Error('Gagal solve Turnstile (solver API gagal)');
      }
      if (!quiet) printProgress(2, 'Cloudflare Turnstile verified', 'success', formatDuration(Date.now() - t1));

      if (!quiet) printProgress(3, 'Dispatching reaction payload', 'pending');
      const t2 = Date.now();
      const payload = JSON.stringify({
        link: channelLink,
        emoji: emojis,
        'cf-turnstile-response': turnstileToken
      });

      const submitHeaders = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Origin': BASE_URL,
        'Referer': `${BASE_URL}/`
      };

      const submitRes = await request(`${BASE_URL}/api/react`, {
        method: 'POST',
        timeout: 20000,
        headers: submitHeaders
      }, payload, activeProxy, jar);

      storeCookies(jar, submitRes);

      let jsonResp = null;
      try {
        jsonResp = JSON.parse(submitRes.body);
      } catch {}

      isSuccess = Boolean(jsonResp && jsonResp.success);
      messageDetail = (jsonResp && jsonResp.message) ||
        (submitRes.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) ||
        'Failed';

      if (isSuccess) {
        if (!quiet) printProgress(3, `Reaction successfully delivered: ${messageDetail}`, 'success', formatDuration(Date.now() - t2));
        break;
      }

      const msgLower = messageDetail.toLowerCase();
      const retryable = /(cooldown|limit|blacklist|blocked|coba lagi|try again|provider|menolak|gagal memproses)/.test(msgLower);
      if (retryable && ci < candidateList.length - 1) {
        await new Promise(r => setTimeout(r, 2500));
        throw new Error(`Server rejected via ${activeProxy}: ${messageDetail}`);
      }

      if (!quiet) printProgress(3, `Server rejected: ${messageDetail}`, 'error', formatDuration(Date.now() - t2));
      break;
    } catch (err) {
      lastError = err;
      if (ci < candidateList.length - 1) {
        if (!quiet) printProgress(0, `Proxy ${activeProxy} failed (${err.message}) - failing over`, 'pending');
      }
    }
  }

  if (!isSuccess && !messageDetail && lastError) {
    throw lastError;
  }
  if (!isSuccess && !messageDetail) {
    messageDetail = lastError ? lastError.message : 'Failed';
  }

  const durationMs = Date.now() - startTime;

  const responseJson = {
    creator: CREATOR,
    status: isSuccess ? 'success' : 'error',
    code: isSuccess ? 200 : 400,
    message: messageDetail,
    data: {
      target: channelLink,
      emojis: emojis.split(',').map(e => e.trim()).filter(Boolean),
      vip: Boolean(vipUser),
      key: vipUser ? vipUser.key : uid,
      proxy: activeProxy || null,
      duration: `${(durationMs / 1000).toFixed(2)}s`
    }
  };

  if (notifyTelegram) {
    const tgText = isSuccess
      ? `✅ *Reaction Dispatched*\n\n` +
        `• *Target*: \`${channelLink}\`\n` +
        `• *Emoji*: ${emojis}\n` +
        `• *Duration*: ${(durationMs / 1000).toFixed(2)}s\n` +
        `• *Creator*: ${CREATOR}`
      : `⚠️ *Reaction Dispatch Failed*\n\n` +
        `• *Target*: \`${channelLink}\`\n` +
        `• *Response*: ${responseJson.message}`;
    await sendTelegramNotification(tgText);
  }

  return responseJson;
}

function printHelp() {
  const options = [
    ['-e, --emoji <emojis>', 'Reaction emojis separated by comma (default: 👍)'],
    ['-n, --count <num>', 'Number of automated reaction rounds (default: 1)'],
    ['-k, --key <vip_key>', 'VIP member key for privileged access'],
    ['--proxy', 'Rotate free proxies from ProxyScrape (v4 free-proxy-list)'],
    ['--proxy-country <cc>', 'Country filter for proxy pool (default: id)'],
    ['--custom-proxy <host:port>', 'Tunnel traffic through a custom HTTP/HTTPS proxy'],
    ['--proxy-info', 'Display current ProxyScrape account & pool metrics'],
    ['--no-telegram', 'Suppress automated Telegram notifications'],
    ['--quiet, -q', 'Output raw JSON only for machine parsing'],
    ['-h, --help', 'Display this documentation']
  ];

  process.stdout.write(`
${c.dim}Usage:${c.reset}
  node cli.js [whatsapp_channel_url] [options]

${c.dim}Service:${c.reset}
  ${c.cyan}Keyyss React${c.reset}  WhatsApp Channel Reaction Automation (react.keyysspanel.web.id)
                Murni HTTP + solver API - tanpa browser.

${c.dim}Options:${c.reset}
${options.map(([flag, desc]) => `  ${c.cyan}${flag.padEnd(28)}${c.reset}${desc}`).join('\n')}

${c.dim}Examples:${c.reset}
  # Interactive prompt
  node cli.js

  # WhatsApp Channel Reaction
  node cli.js "https://whatsapp.com/channel/0029VbD8Muz9WtBuZR9UMq0x/1020" -e "🔥,❤️" -n 5 --proxy

  # Dengan VIP Key
  node cli.js "https://whatsapp.com/channel/0029VbD8Muz9WtBuZR9UMq0x/1020" -k "VIP-KEYANDA"

  # Output JSON murni (scripting / API)
  node cli.js "https://whatsapp.com/channel/0029VbD8Muz9WtBuZR9UMq0x/1020" -e "🔥" --quiet

`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  let channelLink = '';
  let emojis = null;
  let count = null;
  let vipKey = null;
  let notifyTelegram = true;
  let quiet = false;
  let useProxy = false;
  let manualProxy = null;
  let proxyCountry = 'id';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--emoji' || args[i] === '-e') {
      emojis = args[++i];
    } else if (args[i] === '--count' || args[i] === '-n' || args[i] === '--amount' || args[i] === '-c') {
      count = Math.max(1, parseInt(args[++i], 10) || 1);
    } else if (args[i] === '--key' || args[i] === '-k') {
      vipKey = args[++i];
    } else if (args[i] === '--proxy') {
      useProxy = true;
    } else if (args[i] === '--proxy-country') {
      proxyCountry = (args[++i] || 'id').toLowerCase();
    } else if (args[i] === '--custom-proxy') {
      manualProxy = args[++i];
    } else if (args[i] === '--proxy-info') {
      try {
        const list = await fetchProxyScrapeList({ country: proxyCountry });
        console.log(JSON.stringify({
          creator: CREATOR,
          status: 'success',
          code: 200,
          data: {
            endpoint: 'proxyscrape v4 free-proxy-list',
            country: proxyCountry,
            totalHttpProxies: list.length,
            sample: list.slice(0, 10)
          }
        }, null, 2));
        process.exit(0);
      } catch (e) {
        console.log(JSON.stringify({
          creator: CREATOR,
          status: 'error',
          code: 500,
          message: e.message
        }, null, 2));
        process.exit(1);
      }
    } else if (args[i] === '--no-telegram') {
      notifyTelegram = false;
    } else if (args[i] === '--quiet' || args[i] === '-q') {
      quiet = true;
    } else if (!args[i].startsWith('-') && !channelLink) {
      channelLink = args[i];
    }
  }

  if (!channelLink && !quiet) {
    const inputUrl = await askQuestion(`  ${c.cyan}?${c.reset} Target WhatsApp Channel Link: `);
    channelLink = inputUrl;
  }

  if (!channelLink) {
    printHelp();
    process.exit(1);
  }

  if (!emojis && !quiet) {
    const inputEmoji = await askQuestion(`  ${c.cyan}?${c.reset} Reaction emojis (misal: 👍,🔥,❤️ - default: 👍): `);
    emojis = inputEmoji || '👍';
  } else if (!emojis) {
    emojis = '👍';
  }

  if (!count && !quiet) {
    const inputCount = await askQuestion(`  ${c.cyan}?${c.reset} Total nominal / tembakan reaction (default: 1): `);
    count = Math.max(1, parseInt(inputCount, 10) || 1);
  } else if (!count) {
    count = 1;
  }

  closeReadline();

  try {
    const results = [];
    for (let round = 1; round <= count; round++) {
      if (count > 1 && !quiet) {
        process.stderr.write(`\n${c.bold}=== [Reaction Round ${round}/${count}] ===${c.reset}\n`);
      }

      let roundResult = null;

      for (let retry = 1; retry <= 3; retry++) {
        try {
          roundResult = await executeReaction({
            channelLink,
            emojis,
            vipKey,
            notifyTelegram,
            quiet,
            useProxy,
            proxyCountry,
            manualProxy
          });
          break;
        } catch (err) {
          if (retry < 3) {
            if (!quiet) printProgress(0, `Round ${round} failed (${err.message}). Retrying with fresh proxy (${retry}/3)...`, 'pending');
            await new Promise(res => setTimeout(res, 2000));
          } else {
            roundResult = {
              creator: CREATOR,
              status: 'error',
              code: 500,
              message: err.message,
              data: { target: channelLink }
            };
          }
        }
      }

      results.push(roundResult);

      if (round < count) {
        await new Promise(res => setTimeout(res, 1500));
      }
    }

    if (count === 1) {
      console.log(JSON.stringify(results[0], null, 2));
      process.exit(results[0].status === 'success' ? 0 : 1);
    } else {
      const summary = {
        creator: CREATOR,
        status: results.every(r => r.status === 'success') ? 'success' : 'partial',
        code: 200,
        totalRequested: count,
        successful: results.filter(r => r.status === 'success').length,
        results
      };
      console.log(JSON.stringify(summary, null, 2));
      process.exit(0);
    }
  } catch (err) {
    const errorJson = {
      creator: CREATOR,
      status: 'error',
      code: 500,
      message: err.message,
      data: { target: channelLink }
    };
    console.log(JSON.stringify(errorJson, null, 2));
    if (notifyTelegram) {
      await sendTelegramNotification(`❌ *Reaction Error*\n\n• *Target*: \`${channelLink}\`\n• *Error*: ${err.message}`);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  executeReaction,
  solveTurnstile,
  sendTelegramNotification,
  fetchProxyScrapeList,
  findWorkingProxy,
  request,
  jsonRequest,
  
  // Wrapper yang ramah untuk dipanggil langsung dari plugin bot WhatsApp (CJS)
  async run(url, emoji = '👍', vipKey = null) {
    try {
      const result = await executeReaction({
        channelLink: url,
        emojis: emoji,
        vipKey: vipKey || null,
        notifyTelegram: false,
        quiet: true,
        useProxy: false
      });
      return {
        status: true,
        result
      };
    } catch (err) {
      return {
        status: false,
        error: err.message
      };
    }
  }
};
