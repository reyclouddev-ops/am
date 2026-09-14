// ==========================================
// API ROUTER: /api/netflixtoken.js
// Diadaptasi dari CLI client Netflix Token Generator
// ==========================================
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const fetch = require('node-fetch');
const haidarPkg = require('haidarcf');

const { haidarcf } = haidarPkg;

const CREATOR = 'ReyCode';
const BASE_URL = 'https://nftools.live';
const TURNSTILE_SITEKEY = '0x4AAAAAADrtSr01ExtZ3ikN';
const SUPABASE_URL = 'https://ytowziwmmvtxhbcfyonk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl0b3d6aXdtbXZ0eGhiY2Z5b25rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzNjY2NzQsImV4cCI6MjA5NTk0MjY3NH0.9Frm3-Sdph_ztQ56q0R9EmrV033OVLO5lBOxy3VBcY0';

const SERVER_FN_IDS = {
  TOKEN: '170f89ee5ad7e666f1eb147823da1546f98126cceecb548f2aefe3a2349b6c57',
  COUNTRIES: 'b6f32cb097d03b340ab7820a0c3449f410e38dd0621d3d13682b52b00de500d3',
  USAGE: 'b0a92a794170f9dd228fc024748957e676e45d7a3853cc371ee0378c016d79eb',
  GET_LINK: '77925f08e3f251cda34d206a5097f6d339da6ed089307ae03ca160b34ca385c4',
  CONVERT: '8210e805f6a6e6ab0d5f9831b51d242038d6a7ff0991105f06ce137267f06fe2'
};

const COUNTRY_NAMES = {
  US: "United States", CA: "Canada", GB: "United Kingdom", IN: "India",
  BR: "Brazil", FR: "France", TR: "Turkey", MX: "Mexico", ES: "Spain",
  KR: "South Korea", PH: "Philippines", ID: "Indonesia", IT: "Italy",
  DE: "Germany", PL: "Poland", ZA: "South Africa", PK: "Pakistan",
  TH: "Thailand", JP: "Japan", AR: "Argentina", MY: "Malaysia",
  SG: "Singapore", HK: "Hong Kong", TW: "Taiwan", AU: "Australia",
  RO: "Romania", NL: "Netherlands", EG: "Egypt", VN: "Vietnam"
};

// Seroval Serialization
function serializeSeroval(data) {
  let id = 0;
  function walk(val) {
    if (val === null) return { t: 2, s: 0 };
    if (val === undefined) return { t: 2, s: 1 };
    if (typeof val === 'boolean') return { t: 2, s: val ? 2 : 3 };
    if (typeof val === 'number') return { t: 0, s: val };
    if (typeof val === 'string') return { t: 1, s: val };
    if (Array.isArray(val)) {
      const curId = id++;
      return { t: 9, i: curId, a: val.map(walk), o: 0 };
    }
    if (typeof val === 'object') {
      const curId = id++;
      const keys = Object.keys(val);
      const values = keys.map(k => walk(val[k]));
      return {
        t: 10,
        i: curId,
        p: { k: keys, v: values },
        o: 0
      };
    }
    throw new Error('Unsupported Seroval type: ' + typeof val);
  }

  return {
    t: walk(data),
    f: 63,
    m: []
  };
}

function parseSerovalNode(node) {
  if (!node || typeof node !== 'object') return node;
  if (node.t === 0) return node.s;
  if (node.t === 1) return node.s;
  if (node.t === 2) {
    if (node.s === 2) return true;
    if (node.s === 3) return false;
    if (node.s === 0) return null;
    if (node.s === 1) return undefined;
  }
  if (node.t === 9) return (node.a || []).map(parseSerovalNode);
  if ((node.t === 10 || node.t === 11) && node.p) {
    const obj = {};
    const keys = node.p.k || [];
    const vals = node.p.v || [];
    for (let i = 0; i < keys.length; i++) {
      obj[keys[i]] = parseSerovalNode(vals[i]);
    }
    return obj;
  }
  return node;
}

function parseSerovalResponse(json) {
  const root = parseSerovalNode(json);
  if (root && root.result !== undefined) return root.result;
  if (root && root.error !== undefined) throw new Error(JSON.stringify(root.error));
  return root;
}

class NFToolsEngine {
  constructor() {
    this.deviceId = crypto.randomUUID();
    this.ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
    this.wafHeaders = {};
    this.accessToken = null;
    this.sessionCookie = null;
    this.toolToken = null;
    this.tokenExpiresAt = 0;
  }

  async initSession() {
    this.deviceId = crypto.randomUUID();

    const wafParams = { url: `${BASE_URL}/tools/nftoken-link` };
    let wafData = await haidarcf.wafSession(wafParams);
    
    if (wafData && wafData.headers) {
      this.wafHeaders = wafData.headers;
      if (wafData.headers['user-agent']) {
        this.ua = wafData.headers['user-agent'];
      }
    }
    let cookieList = [];
    if (wafData && wafData.cookies) {
      cookieList = wafData.cookies.map(c => `${c.name}=${c.value}`);
    }

    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({})
    });
    const authData = await authRes.json();
    this.accessToken = authData.access_token;

    const tsData = await haidarcf.turnstileMin({
      url: `${BASE_URL}/tools/nftoken-link`,
      siteKey: TURNSTILE_SITEKEY
    });

    if (!tsData || !tsData.token) {
      throw new Error('Gagal mendapatkan Turnstile token');
    }

    const verifyRes = await fetch(`${BASE_URL}/api/turnstile/verify`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'origin': BASE_URL,
        'referer': `${BASE_URL}/tools/nftoken-link`,
        'user-agent': this.ua,
        'cookie': cookieList.join('; '),
        ...this.wafHeaders
      },
      body: JSON.stringify({ token: tsData.token })
    });
    const setCookies = verifyRes.headers.raw()['set-cookie'] || [];
    for (const c of setCookies) {
      cookieList.push(c.split(';')[0]);
    }
    this.sessionCookie = cookieList.join('; ');

    await this.refreshToken();
  }

  async refreshToken() {
    const tokenPayload = serializeSeroval({ data: { deviceId: this.deviceId } });
    const gpRes = await fetch(`${BASE_URL}/_serverFn/${SERVER_FN_IDS.TOKEN}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/x-tss-framed, application/x-ndjson, application/json',
        'x-tsr-serverfn': 'true',
        'authorization': `Bearer ${this.accessToken}`,
        'cookie': this.sessionCookie,
        'user-agent': this.ua,
        'origin': BASE_URL,
        'referer': `${BASE_URL}/tools/nftoken-link`,
        ...this.wafHeaders
      },
      body: JSON.stringify(tokenPayload)
    });
    const gpJson = await gpRes.json();
    const gpResult = parseSerovalResponse(gpJson);
    this.toolToken = gpResult.token;
    this.tokenExpiresAt = gpResult.expiresAt || (Date.now() + (gpResult.ttlMs || 30000));
    return this.toolToken;
  }

  async getValidToken() {
    if (!this.toolToken || Date.now() >= (this.tokenExpiresAt - 5000)) {
      await this.refreshToken();
    }
    return this.toolToken;
  }

  async callServerFn(fnId, data, refererPath = '/tools/nftoken-link') {
    const payload = serializeSeroval({ data });
    const res = await fetch(`${BASE_URL}/_serverFn/${fnId}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/x-tss-framed, application/x-ndjson, application/json',
        'x-tsr-serverfn': 'true',
        'authorization': `Bearer ${this.accessToken}`,
        'cookie': this.sessionCookie,
        'user-agent': this.ua,
        'origin': BASE_URL,
        'referer': `${BASE_URL}${refererPath}`,
        ...this.wafHeaders
      },
      body: JSON.stringify(payload),
      timeout: 60000
    });

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Server returned ${res.status}: ${text.substring(0, 100)}`);
    }

    return parseSerovalResponse(json);
  }

  getBotSignals(dwellMs = 12500, mouseEvents = 40) {
    const isLinux = this.ua.includes('Linux');
    return {
      webdriver: false,
      headlessUA: false,
      noPlugins: false,
      noLanguages: false,
      noChrome: false,
      permissionsAnomaly: false,
      webglHash: crypto.randomBytes(4).toString('hex'),
      canvasHash: crypto.randomBytes(4).toString('hex'),
      screen: '1920x1080@1',
      hardware: '8/8',
      gpu: 'Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      timezone: 'Asia/Jakarta',
      platform: isLinux ? 'Linux x86_64' : 'Win32',
      touchPoints: 0,
      screenSize: '1920x1080',
      mouseEvents,
      keyEvents: 15,
      touchEvents: 0,
      scrollEvents: 6,
      dwellMs
    };
  }

  async getCountries() {
    const token = await this.getValidToken();
    return await this.callServerFn(SERVER_FN_IDS.COUNTRIES, {
      deviceId: this.deviceId,
      token
    });
  }

  async getUsage() {
    const token = await this.getValidToken();
    return await this.callServerFn(SERVER_FN_IDS.USAGE, {
      deviceId: this.deviceId,
      token,
      fingerprint: crypto.randomBytes(8).toString('hex'),
      botSignals: this.getBotSignals(5000, 25)
    });
  }

  async generateLink(countryCode) {
    const token = await this.getValidToken();
    return await this.callServerFn(SERVER_FN_IDS.GET_LINK, {
      deviceId: this.deviceId,
      countryCode: countryCode.toUpperCase(),
      token,
      fingerprint: crypto.randomBytes(8).toString('hex'),
      botSignals: this.getBotSignals(12500, 45)
    }, `/tools/nftoken-link/${countryCode.toUpperCase()}`);
  }

  async convertCookies(rawCookies) {
    const token = await this.getValidToken();
    return await this.callServerFn(SERVER_FN_IDS.CONVERT, {
      raw: rawCookies,
      deviceId: this.deviceId,
      token
    }, '/tools/convert');
  }
}

function getBodyAndQuery(req) {
  const query = req && req.query ? req.query : {};
  const body = req && req.body ? req.body : {};
  return { ...query, ...body };
}

router.all('/', async (req, res) => {
  const data = getBodyAndQuery(req);
  const action = String(data.action || '').toLowerCase();

  try {
    const engine = new NFToolsEngine();
    await engine.initSession();

    if (action === 'usage') {
      const usage = await engine.getUsage();
      return res.status(200).json({
        status: true,
        creator: CREATOR,
        data: {
          dailyLimit: usage.limit ?? 3,
          usedCount: usage.count ?? 0,
          remaining: usage.remaining ?? 0,
          deviceId: engine.deviceId
        }
      });
    }

    if (action === 'countries') {
      const responseData = await engine.getCountries();
      const countries = responseData.countries || [];
      const formatted = countries.map(c => ({
        code: c.country_code,
        name: COUNTRY_NAMES[c.country_code] || c.country_code,
        activeCookies: c.count
      }));
      return res.status(200).json({
        status: true,
        creator: CREATOR,
        totalCountries: countries.length,
        countries: formatted
      });
    }

    if (action === 'generate') {
      const countryCode = data.country || data.code;
      if (!countryCode) {
        return res.status(400).json({ status: false, creator: CREATOR, error: 'Parameter country/code wajib diisi!' });
      }
      let result = await engine.generateLink(countryCode);
      
      const isLimitReached = !result.ok && (
        (result.remaining !== undefined && result.remaining <= 0) ||
        (result.error && /used all your free links|limit|tomorrow/i.test(result.error))
      );

      if (isLimitReached) {
        await engine.initSession();
        result = await engine.generateLink(countryCode);
      }

      if (result.ok) {
        return res.status(200).json({
          status: true,
          creator: CREATOR,
          data: {
            country: countryCode.toUpperCase(),
            links: {
              browser: result.browserLink,
              mobile: result.mobileLink,
              tv: result.tvLink
            },
            expires: result.expires,
            expiresReadable: result.expires ? new Date(result.expires * 1000).toLocaleString() : null,
            accountInfo: result.accountInfo || [],
            remainingQuota: result.remaining
          }
        });
      } else {
        return res.status(400).json({
          status: false,
          creator: CREATOR,
          error: result.error || 'Gagal membuat link',
          remainingQuota: result.remaining ?? 0
        });
      }
    }

    if (action === 'convert') {
      const rawCookies = data.cookies || data.raw;
      if (!rawCookies) {
        return res.status(400).json({ status: false, creator: CREATOR, error: 'Parameter cookies/raw wajib diisi!' });
      }
      const result = await engine.convertCookies(rawCookies);
      if (result.ok) {
        return res.status(200).json({
          status: true,
          creator: CREATOR,
          data: {
            links: {
              browser: result.browserLink,
              mobile: result.mobileLink,
              tv: result.tvLink
            },
            expires: result.expires,
            expiresReadable: result.expires ? new Date(result.expires * 1000).toLocaleString() : null,
            accountInfo: result.accountInfo || []
          }
        });
      } else {
        return res.status(400).json({ status: false, creator: CREATOR, error: result.error || 'Format cookies tidak valid' });
      }
    }

    return res.status(200).json({
      status: true,
      creator: CREATOR,
      message: 'Netflix Token Generator API aktif.',
      endpoints: {
        usage: '?action=usage',
        countries: '?action=countries',
        generate: '?action=generate&country=US',
        convert: '?action=convert&cookies=RAW_COOKIES'
      }
    });
  } catch (error) {
    console.error('[NETFLIX TOKEN API ERROR]', error);
    return res.status(500).json({
      status: false,
      creator: CREATOR,
      error: error?.message || 'Terjadi kesalahan pada server.'
    });
  }
});

module.exports = router;
