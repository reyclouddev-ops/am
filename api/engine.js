/**
 * Name: Alight Motion Master Engine (The Ultimate Monolith Edition with Auth & CapCut Engine)
 * Description: Seluruh endpoint API, scraper, downloader, QRIS Mustika, AI Tools, 
 *              CapCut Automation, serta sistem Auth IP & Akun digabung utuh dalam satu file.
 */

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const fsp = require('node:fs/promises');
const https = require('https');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const FormData = require('form-data');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
const http = require('http');
const tls = require('tls');
const { execSync } = require('child_process');

const app = express();

app.use((req, res, next) => {
    const route = req.query.route;

    if (route) {
        const target = `/api/${String(route).replace(/^\/+/, '')}`;
        req.url = target;
    }

    next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const CREATOR = 'ReyCode';
// ==========================================
// 0. TURNSTILE CLOUDFLARE PROTECTION
// ==========================================
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || '';

async function verifyTurnstile(token, remoteip = '') {
    if (!TURNSTILE_SECRET_KEY) {
        return {
            success: false,
            error: 'Turnstile secret key belum dikonfigurasi.'
        };
    }

    if (!token) {
        return {
            success: false,
            error: 'Token Turnstile wajib diisi.'
        };
    }

    try {
        const response = await axios.post(
            'https://challenges.cloudflare.com/turnstile/v0/siteverify',
            new URLSearchParams({
                secret: TURNSTILE_SECRET_KEY,
                response: token,
                remoteip
            }).toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                timeout: 10000
            }
        );

        return response.data;
    } catch (error) {
        return {
            success: false,
            error: 'Gagal memverifikasi Turnstile.'
        };
    }
}

async function requireTurnstile(req, res, next) {
    const token =
        req.body?.['cf-turnstile-response'] ||
        req.body?.turnstileToken ||
        req.headers['x-turnstile-token'];

    const result = await verifyTurnstile(
        token,
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.socket.remoteAddress ||
        ''
    );

    if (!result.success) {
        return res.status(403).json({
            status: false,
            error: result.error || 'Verifikasi Turnstile gagal.'
        });
    }

    next();
}

// ==========================================
// 1. DATABASE & CONFIG SETUP (MONGODB)
// ==========================================
const MONGO_URI = process.env.MONGO_URI || '';
let isConnected = false;

async function connectDB() {
    if (isConnected) return;
    if (!MONGO_URI) return;
    try {
        await mongoose.connect(MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        isConnected = true;
    } catch (err) {
        throw new Error('Gagal terhubung ke MongoDB: ' + err.message);
    }
}

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    ip_address: { type: String, required: true },
    role: { type: String, default: 'user' },
    created_at: { type: Date, default: Date.now }
});
const User = mongoose.models.User || mongoose.model('User', userSchema);

const apiKeySchema = new mongoose.Schema({
    apikey: {
        type: String,
        required: true,
        unique: true
    },

    name: {
        type: String,
        required: true
    },

    password: {
        type: String,
        required: true
    },

    owner: {
        type: String,
        default: 'Client'
    },

    package: {
        type: String,
        default: 'Bulk Alight Motion Pro'
    },

    duration_days: {
        type: Number,
        default: 30
    },

    created_at: {
        type: Date,
        default: Date.now
    },

    expired_at: {
        type: Date,
        required: true
    },

    status: {
        type: String,
        default: 'active'
    }
});

const ApiKey =
    mongoose.models.ApiKey ||
    mongoose.model('ApiKey', apiKeySchema);
// ==========================================
// 2. INLINED AI HELPERS & SCRAPERS
// ==========================================

// --- A. Cloudinary Upscale Helper ---
const CLOUDINARY_URL = process.env.CLOUDINARY_URL || '';
const SIGN_URL = process.env.CLOUDINARY_SIGN_URL || '';
const CLOUD_API_KEY = process.env.CLOUDINARY_API_KEY || '';
const UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET || '';

async function getCloudinarySignature() {
    const timestamp = Math.floor(Date.now() / 1000);
    const { data } = await axios.post(SIGN_URL, {
        paramsToSign: { timestamp, upload_preset: UPLOAD_PRESET, source: 'ml' }
    }, {
        headers: {
            'Content-Type': 'application/json',
            'Origin': 'https://cloudinary-tools.netlify.app',
            'Referer': 'https://cloudinary-tools.netlify.app/',
            'User-Agent': 'Mozilla/5.0'
        }
    });
    return { signature: data.signature, timestamp };
}

async function upscaleImage(fileInput, filename = 'image.jpg') {
    let fileStreamOrBuffer = fileInput;
    if (typeof fileInput === 'string' && (fileInput.startsWith('http://') || fileInput.startsWith('https://'))) {
        const response = await axios.get(fileInput, { responseType: 'arraybuffer' });
        fileStreamOrBuffer = Buffer.from(response.data);
    }
    let safeFilename = filename;
    if (safeFilename.endsWith('.jpg')) safeFilename = safeFilename.replace('.jpg', '.jpeg');
    else if (!safeFilename.includes('.')) safeFilename = 'image.jpeg';

    const sig = await getCloudinarySignature();
    const form = new FormData();
    form.append('file', fileStreamOrBuffer, { filename: safeFilename });
    form.append('upload_preset', UPLOAD_PRESET);
    form.append('source', 'ml');
    form.append('api_key', CLOUD_API_KEY);
    form.append('signature', sig.signature);
    form.append('timestamp', sig.timestamp);

    const { data } = await axios.post(CLOUDINARY_URL, form, {
        headers: {
            ...form.getHeaders(),
            'Origin': 'https://upload-widget.cloudinary.com',
            'Referer': 'https://upload-widget.cloudinary.com/',
            'User-Agent': 'Mozilla/5.0'
        }
    });
    const publicId = data.public_id;
    return {
        status: true,
        creator: CREATOR,
        public_id: publicId,
        original_url: data.secure_url,
        url: `https://res.cloudinary.com/dtz0urit6/image/upload/f_jpg,e_upscale,q_auto/${publicId}.jpg`
    };
}


// --- B. Wink Video Enhancer Helper ---
const WINK_BASE_URL = "https://wink.ai";
const WINK_STRATEGY_URL = "https://strategy.app.meitudata.com";
const WINK_UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";
let _winkApi = null;

async function getWinkApi() {
    if (_winkApi) return _winkApi;
    const gnum = crypto.randomUUID();
    const jar = new CookieJar();
    await jar.setCookie(`_sm=${gnum}; Path=/; Domain=wink.ai`, WINK_BASE_URL);
    _winkApi = {
        client: wrapper(axios.create({
            baseURL: WINK_BASE_URL, jar, withCredentials: true, validateStatus: () => true,
            headers: { accept: '*/*', origin: WINK_BASE_URL, referer: `${WINK_BASE_URL}/video-enhancer/upload`, 'user-agent': WINK_UA }
        })),
        gnum
    };
    return _winkApi;
}

async function winkEnhance(video, { filename } = {}) {
    const safeName = filename || `wink-${crypto.randomUUID()}.mp4`;
    const filePath = Buffer.isBuffer(video) ? path.join(os.tmpdir(), safeName) : video;
    if (Buffer.isBuffer(video)) await fsp.writeFile(filePath, video);

    try {
        const { client: api, gnum } = await getWinkApi();
        const baseParams = new URLSearchParams({ client_id: "1189857605", version: "5.1.2", country_code: "ID", gnum, client_language: "en_US", client_timezone: "Asia/Jakarta" });
        
        const signRes = await api.get(`/api/file/get_maat_sign.json?${baseParams}&suffix=.mp4&type=temp&count=1`);
        const sign = signRes.data.data;

        const policyRes = await axios.get(`${WINK_STRATEGY_URL}/upload/policy?app=${sign.app}&count=${sign.count}&sig=${sign.sig}&sigTime=${sign.sig_time}&sigVersion=${sign.sig_version}&suffix=${sign.suffix}&type=${sign.type}`);
        const policy = policyRes.data[0].qiniu;

        const form = new FormData();
        form.append("file", fs.createReadStream(filePath), { filename: path.basename(filePath) });
        form.append("token", policy.token);
        form.append("key", policy.key);
        form.append("fname", path.basename(filePath));
        const qiniuRes = await axios.post(policy.url, form, { headers: form.getHeaders(), maxBodyLength: Infinity, maxContentLength: Infinity });

        const fileKey = policy.key;
        const sourceUrl = qiniuRes.data.url || qiniuRes.data.data || policy.data;

        await api.post("/api/file/video_cover_and_display_info_ext.json", new URLSearchParams({ ...Object.fromEntries(baseParams), file_key: fileKey }));
        const transStart = await api.post("/api/file/video_trans_start.json", new URLSearchParams({ ...Object.fromEntries(baseParams), file_key: fileKey }));
        const transId = transStart.data.data.id;

        let transcodedUrl = sourceUrl;
        for (let i = 0; i < 40; i++) {
            await new Promise(r => setTimeout(r, 3000));
            const q = await api.get(`/api/file/video_trans_query.json?${baseParams}&id=${transId}`);
            if (q.data.data?.video_transcoded) {
                transcodedUrl = q.data.data.video_transcoded;
                break;
            }
        }

        const deliveryRes = await api.post("/api/meitu_ai/delivery.json", new URLSearchParams({
            ...Object.fromEntries(baseParams), type: "11", content_type: "2", source_url: sourceUrl,
            type_params: JSON.stringify({ is_mirror: 0, orientation_tag: 1, j_420_trans: "1", return_ext: "2" }),
            right_detail: JSON.stringify({ source: "1", touch_type: "4", function_id: "630", material_id: "63011", url: "https://wink.ai/video-enhancer/upload" }),
            ext_params: JSON.stringify({ task_name: "Enhancer", records: "11", video_transcoded: transcodedUrl }),
            with_prepare: "1"
        }));
        let msgId = deliveryRes.data.data.msg_id || deliveryRes.data.data.prepare_msg_id;

        for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 4000));
            const batch = await api.get(`/api/meitu_ai/query_batch.json?${baseParams}&msg_ids=${msgId}`);
            const item = batch.data.data?.item_list?.[0];
            const resUrl = item?.result?.media_info_list?.[0]?.media_data || item?.result?.result_url;
            if (resUrl && resUrl.startsWith("http")) return { resultUrl: resUrl };
        }
        throw new Error("Wink timeout processing video.");
    } finally {
        if (Buffer.isBuffer(video)) try { await fsp.unlink(filePath); } catch {}
    }
}

// --- C. Imagen AI Scraper ---
class ImagenScraper {
    constructor() {
        this.accountId = process.env.CF_ACCOUNT_ID || '';
        this.apiToken = process.env.CF_API_TOKEN || '';
        this.imgbbKey = process.env.IMGBB_KEY || '';
        this.styles = {
            "Realistic": { prompt: "realistic photo {prompt}. highly detailed", negative: "anime, cartoon" },
            "Anime": { prompt: "anime style {prompt}, vibrant colors", negative: "blurry, realistic" }
        };
    }
    async generateImage({ prompt, style = "Realistic", ratio = "1:1", upload = true }) {
        const width = ratio === "16:9" ? 1344 : 1024;
        const height = ratio === "16:9" ? 768 : 1024;
        const styleObj = this.styles[style] || this.styles["Realistic"];
        const finalPrompt = styleObj.prompt.replace("{prompt}", prompt);

        const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${this.apiToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: finalPrompt, width, height, steps: 4 })
        });
        const json = await res.json();
        const buffer = Buffer.from(json.result.image, 'base64');

        let uploadUrl = null;
        if (upload) {
            const fd = new URLSearchParams();
            fd.append('image', buffer.toString('base64'));
            const upRes = await fetch(`https://api.imgbb.com/1/upload?key=${this.imgbbKey}`, { method: 'POST', body: fd });
            const upJson = await upRes.json();
            if (upJson.success) uploadUrl = upJson.data.url;
        }
        return { buffer, upload: { url: uploadUrl } };
    }
}
const imagenInstance = new ImagenScraper();

// --- D. DeepAI & Rayleigh Chat Scrapers ---
class DeepAIChatScraper {
    async chat(messages, options = {}) {
        const model = options.model || 'standard';
        const fd = new FormData();
        fd.append('chat_style', 'chat');
        fd.append('model', model);
        fd.append('chatHistory', JSON.stringify(messages));
        const res = await fetch("https://api.deepai.org/hacking_is_a_serious_crime", {
            method: "POST",
            headers: { "api-key": process.env.DEEP_AI_KEY || "tryit-123456", "origin": "https://deepai.org" },
            body: fd
        });
        return await res.text();
    }
}
const deepAiChat = new DeepAIChatScraper();

async function rayleighScrape(text) {
    try {
        const res = await axios.post("https://tabitoken.com/v1/messages", {
            model: "claude-opus-5-thinking",
            max_tokens: 4096,
            messages: [{ role: "user", content: text }]
        }, {
            headers: { "Content-Type": "application/json", "x-api-key": process.env.RAYLEIGH_API_KEY || '' }
        });
        return { status: true, data: res.data.content[0].text };
    } catch (err) {
        return { status: false, error: err.message };
    }
}


// ==========================================
// 3. MAIL MODULE & CAPCUT AUTOMATION ENGINE
// ==========================================
const MAIL_BASE = process.env.MAIL_BASE_URL || 'https://glx.web.id';
const MAIL_DOMAIN = process.env.MAIL_DOMAIN || 'glx.web.id';

function generateRandomMailUsername() {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let prefix = '';
  for (let i = 0; i < 7; i++) {
    prefix += chars[crypto.randomBytes(1)[0] % 26];
  }
  const timestampSuffix = String(Date.now()).slice(-6);
  return `${prefix}${timestampSuffix}`;
}

async function createTempEmail(domain = MAIL_DOMAIN) {
  const username = generateRandomMailUsername();
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

async function fetchEmails(address) {
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

function extractVerificationCode(emails) {
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

async function waitForVerificationCode(address, timeoutMs = 60000, intervalMs = 2500) {
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

// --- Utility Functions for CapCut & AM ---
function encryptToTargetHex(input) {
  let hexResult = '';
  for (const char of String(input)) {
    const encryptedCharCode = char.charCodeAt(0) ^ 0x05;
    hexResult += encryptedCharCode.toString(16).padStart(2, '0');
  }
  return hexResult;
}

function generateSecurePassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';
  let pass = 'Cc9!';
  for (let i = 0; i < 10; i++) {
    pass += chars[crypto.randomBytes(1)[0] % chars.length];
  }
  return pass;
}

function generateRandomBirthday() {
  const start = new Date(1992, 0, 1).getTime();
  const end = new Date(2003, 11, 31).getTime();
  const d = new Date(start + Math.random() * (end - start));
  return d.toISOString().split('T')[0];
}

function formatTimestamp(ts) {
  if (!ts) return null;
  const num = typeof ts === 'number' ? ts : parseInt(ts, 10);
  if (isNaN(num) || num <= 0) return null;
  const ms = num < 1e11 ? num * 1000 : num;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().replace('T', ' ').substring(0, 19);
}
// --- CapCut Engine Class (Fixed & Optimized) ---
class CapCut {
  constructor(options = {}) {
    this.apiBase = options.apiBase || process.env.CAPCUT_API_BASE || 'https://www.capcut.com';
    this.editApiBase = options.editApiBase || process.env.CAPCUT_EDIT_API_BASE || 'https://edit-api-sg.capcut.com';
    this.commerceApiBase = options.commerceApiBase || 'https://commerce-api-sg.capcut.com';
    this.feedApiBase = options.feedApiBase || 'https://feed-api-sg.capcut.com';
    this.userAgent = options.userAgent || process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    this.aid = options.aid || '348188';
    this.cookie = options.cookie || '';
  }

  generateFeedSign(url, pf = 0, timestamp = null) {
    const ts = timestamp || Math.floor(Date.now() / 1000);
    const raw = `9e2c|${url.slice(-7)}|${pf}||${ts}||11ac`;
    const sign = crypto.createHash('md5').update(raw).digest('hex');
    return { sign, deviceTime: ts };
  }

  getFeedHeaders(path, cookieString = null, extraHeaders = {}) {
    const effectiveCookie = cookieString || this.cookie;
    const { sign, deviceTime } = this.generateFeedSign(path, 0);
    return {
      'Content-Type': 'application/json',
      'Cookie': effectiveCookie,
      'sign': sign,
      'sign-ver': '1',
      'device-time': String(deviceTime),
      'pf': '0',
      'loc': 'SG',
      'app-sdk-version': '100.0.0',
      'User-Agent': this.userAgent,
      ...extraHeaders
    };
  }

  setCookie(cookie) {
    this.cookie = cookie;
  }

  buildHeaders(extraHeaders = {}) {
    const headers = {
      'User-Agent': this.userAgent,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
      ...extraHeaders
    };
    if (this.cookie) {
      headers['Cookie'] = this.cookie;
    }
    return headers;
  }

  buildWorkspaceHeaders(cookieString = null, extraHeaders = {}) {
    const effectiveCookie = cookieString || this.cookie;
    return this.buildHeaders({
      'Cookie': effectiveCookie,
      'Content-Type': 'application/json',
      'loc': 'sg',
      'lan': 'en',
      'pf': '7',
      'sign-ver': '1',
      ...extraHeaders
    });
  }

  parseCookiesFromHeaders(res) {
    let setCookieHeaders = [];
    if (typeof res.headers.getSetCookie === 'function') {
      setCookieHeaders = res.headers.getSetCookie();
    } else {
      const raw = res.headers.get('set-cookie');
      if (raw) {
        setCookieHeaders = [raw];
      }
    }

    const cookies = {};
    for (const header of setCookieHeaders) {
      const parts = header.split(';')[0].split('=');
      const key = parts[0]?.trim();
      const val = parts.slice(1).join('=').trim();
      if (key) {
        cookies[key] = val;
      }
    }
    return cookies;
  }

  formatCookieString(cookiesObj) {
    return Object.entries(cookiesObj)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  async sendVerificationCode(email, password) {
    const encryptedEmail = encryptToTargetHex(email);
    const encryptedPassword = encryptToTargetHex(password);

    const url = new URL(`${this.apiBase}/passport/web/email/send_code/`);
    url.searchParams.append('aid', this.aid);
    url.searchParams.append('account_sdk_source', 'web');
    url.searchParams.append('language', 'en');
    url.searchParams.append('verifyFp', 'verify_m7euzwhw_PNtb4tlY_I0az_4me0_9Hrt_sEBZgW5GGPdn');
    url.searchParams.append('check_region', '1');

    const formData = new URLSearchParams();
    formData.append('mix_mode', '1');
    formData.append('email', encryptedEmail);
    formData.append('password', encryptedPassword);
    formData.append('type', '34');
    formData.append('fixed_mix_mode', '1');

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: this.buildHeaders({
        'Content-Type': 'application/x-www-form-urlencoded'
      }),
      body: formData
    });

    const json = await res.json();
    
    // PENYESUAIAN/FIX VALIDASI RESPONSE: Cek apakah error_code === 0 atau message === 'success'
    const isSuccess = json.message === 'success' || json.error_code === 0 || json.data?.error_code === 0;
    if (!isSuccess) {
      throw new Error(`Failed to send verification code: ${json.message || json.data?.description || JSON.stringify(json)}`);
    }
    return json;
  }

  async registerVerifyLogin(email, password, code, options = {}) {
    const encryptedEmail = encryptToTargetHex(email);
    const encryptedPassword = encryptToTargetHex(password);
    const encryptedCode = encryptToTargetHex(code);

    const birthday = options.birthday || generateRandomBirthday();
    const region = options.region || 'ID';

    let bizParam = '%7B%7D';
    if (options.inviteCode || options.inviterUserId) {
      const bizObj = {};
      if (options.inviteCode) bizObj.invite_code = options.inviteCode;
      if (options.inviterUserId) bizObj.inviter_uid = options.inviterUserId;
      bizObj.enter_from = 'share';
      bizParam = encodeURIComponent(JSON.stringify(bizObj));
    }

    const url = new URL(`${this.apiBase}/passport/web/email/register_verify_login/`);
    url.searchParams.append('aid', this.aid);
    url.searchParams.append('account_sdk_source', 'web');
    url.searchParams.append('language', 'en');
    url.searchParams.append('verifyFp', 'verify_m7euzwhw_PNtb4tlY_I0az_4me0_9Hrt_sEBZgW5GGPdn');
    url.searchParams.append('check_region', '1');

    const formData = new URLSearchParams();
    formData.append('mix_mode', '1');
    formData.append('email', encryptedEmail);
    formData.append('code', encryptedCode);
    formData.append('password', encryptedPassword);
    formData.append('type', '34');
    formData.append('birthday', birthday);
    formData.append('force_user_region', region);
    formData.append('biz_param', bizParam);
    formData.append('check_region', '1');
    formData.append('fixed_mix_mode', '1');

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: this.buildHeaders({
        'Content-Type': 'application/x-www-form-urlencoded'
      }),
      body: formData
    });

    const json = await res.json();
    
    // PENYESUAIAN/FIX VALIDASI RESPONSE: Menangani struktur error handling TikTok/CapCut Passport API yang lebih fleksibel
    const isSuccess = (json.message === 'success' || json.error_code === 0 || json.data?.error_code === 0) && (json.data || json.user_id || json.sec_user_id);
    if (!isSuccess) {
      throw new Error(`Failed to verify and register: ${json.message || json.data?.description || JSON.stringify(json)}`);
    }

    const cookies = this.parseCookiesFromHeaders(res);
    const cookieString = this.formatCookieString(cookies);
    if (cookieString) {
      this.setCookie(cookieString);
    }

    return {
      data: json.data || json,
      cookies,
      cookieString
    };
  }

  async getFullAccountProfile(cookieString = null) {
    const effCookie = cookieString || this.cookie;
    const url = `${this.apiBase}/lv/web/v1/user/get_user_info`;
    const res = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders({ 'Cookie': effCookie })
    });
    const json = await res.json();
    return json;
  }

  async claimReferral(referralCode, cookieString = null, progressCb = () => {}) {
    const effCookie = cookieString || this.cookie;
    progressCb(`Mengklaim referral / kode: ${referralCode}`);
    
    const url = `${this.apiBase}/lv/web/v1/fission/claim`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders({
        'Cookie': effCookie,
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify({ invite_code: referralCode })
    });
    const json = await res.json();
    return json;
  }

  async registerDisposableAccount(options = {}, progressCb = () => {}) {
    progressCb('Membuat email sementara baru...');
    const email = await createTempEmail();
    const password = generateSecurePassword();

    progressCb(`Mengirim kode OTP ke ${email}...`);
    await this.sendVerificationCode(email, password);

    progressCb('Menunggu kode verifikasi masuk ke inbox...');
    const otpCode = await waitForVerificationCode(email, 60000, 2500);
    if (!otpCode) {
      throw new Error('Timeout: OTP tidak diterima dalam 60 detik.');
    }

    progressCb(`OTP diterima (${otpCode}), mendaftarkan akun ke CapCut...`);
    const regResult = await this.registerVerifyLogin(email, password, otpCode, {
      birthday: generateRandomBirthday(),
      region: options.region || 'ID',
      inviteCode: options.referralInput,
      inviterUserId: options.inviterUserId
    });

    let fissionResult = null;
    if (options.getTrial && options.referralInput) {
      try {
        progressCb('Mengklaim trial / fission referral...');
        fissionResult = await this.claimReferral(options.referralInput, regResult.cookieString, progressCb);
      } catch (err) {
        progressCb(`Gagal klaim trial: ${err.message}`);
      }
    }

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 7);
    const validUntil = expiryDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();

    return {
      email,
      password,
      uid: regResult.data?.user_id || regResult.data?.uid || regResult.data?.user_info?.user_id || 'unknown',
      cookie: regResult.cookieString,
      validUntil,
      fissionResult
    };
  }

  async scrapeTemplate(urlOrId) {
    let templateId = urlOrId;
    if (urlOrId.includes('capcut.com')) {
      const match = urlOrId.match(/\/template-detail\/(\d+)/) || urlOrId.match(/\/t\/([a-zA-Z0-9_-]+)/);
      if (match) templateId = match[1];
    }

    const apiLink = `${this.feedApiBase}/lv/v1/meta_template/template_detail?template_id=${templateId}`;
    const res = await fetch(apiLink, {
      method: 'GET',
      headers: this.getFeedHeaders(apiLink)
    });
    const json = await res.json();
    return json;
  }
}
// ==========================================
// 4. CORE ALIGHT MOTION & AKUNLAMA SCRAPER (UPDATED)
// ==========================================

const AM_KEY = process.env.AM_KEY || '';
const IDT = process.env.IDT || '';
const VFY = process.env.VFY || '';

const BASE_URL = 'https://akunlama.com/api';
const DOMAIN = 'akunlama.com';

const ADJECTIVES = ['happy', 'sleepy', 'clever', 'swift', 'brave', 'calm', 'wild', 'gentle', 'lucky', 'proud', 'cozy', 'fuzzy'];
const ANIMALS = ['kitten', 'cat', 'tiger', 'lion', 'panther', 'cheetah', 'lynx', 'puma', 'jaguar', 'leopard'];

const dip = () => `${crypto.randomInt(1, 255)}.${crypto.randomInt(0, 255)}.${crypto.randomInt(0, 255)}.${crypto.randomInt(1, 255)}`;
const sp = h => ({
  ...h,
  'x-forwarded-for': dip(),
  'x-real-ip': dip(),
  'client-ip': dip(),
  'x-client-ip': dip(),
  'x-originating-ip': dip(),
  'x-cluster-client-ip': dip()
});

const h1 = {
  'content-type': 'application/json',
  'x-android-package': 'com.alightcreative.motion',
  'x-android-cert': 'ECA6BF91B8715A6F810ED0BBFC65B6CD578F52A8',
  'user-agent': 'dalvik/2.1.0 (linux; u; android 15; 23127pn0cc build/bp1a.250505.005)'
};

const h2 = {
  'content-type': 'application/json; charset=utf-8',
  'user-agent': 'okhttp/3.12.1',
  'accept-encoding': 'gzip'
};

const bad = e => {
  const d = e.response?.data;
  return d ? (typeof d === 'object' ? JSON.stringify(d) : String(d)) : e.message;
};

class SimpleQueue {
  constructor(concurrency = 1) {
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }
  add(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.next();
    });
  }
  next() {
    if (this.running >= this.concurrency || this.queue.length === 0) return;
    const { fn, resolve, reject } = this.queue.shift();
    this.running++;
    fn().then(res => {
      this.running--;
      resolve(res);
      this.next();
    }).catch(err => {
      this.running--;
      reject(err);
      this.next();
    });
  }
}
const apiQueue = new SimpleQueue(1);

function generateRandomName() {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
    const num = Math.floor(Math.random() * 90) + 10;
    return { username: `${adj}-${animal}-${num}`, animalName: `${adj} ${animal}` };
}

function extractOobCode(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/&amp;/g, '&');
  try { s = decodeURIComponent(s); } catch {}
  try {
    const u = new URL(s);
    let c = u.searchParams.get('oobCode');
    if (!c) {
      const n = u.searchParams.get('link') || u.searchParams.get('q') || u.searchParams.get('url');
      if (n) { try { c = new URL(n).searchParams.get('oobCode'); } catch {} }
    }
    if (c) return c.replace(/[^a-zA-Z0-9_-]/g, '');
  } catch {}
  const m = s.match(/oobCode=([a-zA-Z0-9_-]+)/i);
  if (m) return m[1];
  const t = raw.trim();
  if (/^[a-zA-Z0-9_-]{10,}$/.test(t) && !t.includes('://')) return t;
  return null;
}

function extractLinks(html) {
    if (typeof html !== 'string') return [];
    const links = [];
    const regex = /href=["'](https?:\/\/[^"']+)["']/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
        const matchedUrl = match[1].replace(/&amp;/g, '&');
        if (!links.includes(matchedUrl)) links.push(matchedUrl);
    }
    return links;
}

function requestApi(targetUrl) {
    return new Promise((resolve, reject) => {
        https.get(targetUrl, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch { resolve(data); }
            });
        }).on('error', reject);
    });
}

async function listInbox(username) {
    const recipient = (username || '').replace(`@${DOMAIN}`, '').trim();
    const reqUrl = `${BASE_URL}/list?recipient=${encodeURIComponent(recipient)}`;
    const res = await requestApi(reqUrl);
    return Array.isArray(res) ? res : [];
}

async function getEmailDetail(region, key) {
    const metaUrl = `${BASE_URL}/getKey?region=${encodeURIComponent(region)}&key=${encodeURIComponent(key)}`;
    const htmlUrl = `${BASE_URL}/getHtml?region=${encodeURIComponent(region)}&key=${encodeURIComponent(key)}`;
    const [, html] = await Promise.all([requestApi(metaUrl), requestApi(htmlUrl)]);
    const rawHtml = typeof html === 'string' ? html : JSON.stringify(html);
    return { html: rawHtml, links: extractLinks(rawHtml) };
}

async function waitForVerificationLink(username, timeoutSec = 60) {
    const clean = (username || '').replace(`@${DOMAIN}`, '').trim();
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutSec * 1000) {
        try {
            const messages = await listInbox(clean);
            if (messages.length > 0) {
                const latest = messages[0];
                const region = latest.storage?.region || 'us';
                const key = latest.storage?.key;
                if (key) {
                    const detail = await getEmailDetail(region, key);
                    const targetLink = detail.links.find(l => l.includes('firebaseapp.com') || l.includes('google.com') || l.includes('oobCode'));
                    if (targetLink) return targetLink;
                }
            }
        } catch (_) {}
        await new Promise(resolve => setTimeout(resolve, 4000));
    }
    return null;
}

// Integrasi Fungsi Link, Auth, dan Pro baru
async function processSingleAccount(customUsername = null) {
    let username, animalName = 'Custom User Input';
    if (customUsername) {
        username = customUsername.replace(`@${DOMAIN}`, '').trim();
    } else {
        const generated = generateRandomName();
        username = generated.username;
        animalName = generated.animalName;
    }
    const tempEmail = `${username}@${DOMAIN}`;

    // 1. Kirim OOB Confirmation Code (link)
    const linkRes = await apiQueue.add(async () => {
        try {
            const r = await axios.post(`${IDT}/getOobConfirmationCode?key=${AM_KEY}`, {
                requestType: 6,
                email: tempEmail,
                androidInstallApp: true,
                canHandleCodeInApp: true,
                continueUrl: 'https://alightcreative.com?ui_sid=0366624874&ui_sd=0',
                iosBundleId: 'com.alightcreative.motion',
                androidPackageName: 'com.alightcreative.motion',
                androidMinimumVersion: '585',
                clientType: 'CLIENT_TYPE_ANDROID'
            }, { headers: sp(h1) });
            return { ok: true };
        } catch (e) { return { ok: false, why: bad(e) }; }
    });

    if (!linkRes.ok) throw new Error('Gagal mengirim oobCode: ' + linkRes.why);

    // 2. Tunggu link verifikasi masuk ke inbox akunlama.com
    const verificationLink = await waitForVerificationLink(username, 60);
    if (!verificationLink) throw new Error('Magic link tidak tertangkap dalam 60 detik.');

    const oobCode = extractOobCode(verificationLink);
    if (!oobCode) throw new Error('Gagal mengekstrak oobCode.');

    // 3. Autentikasi / Sign-in (auth)
    const authRes = await apiQueue.add(async () => {
        try {
            const a = await axios.post(`${IDT}/emailLinkSignin?key=${AM_KEY}`, {
                email: tempEmail,
                oobCode: oobCode,
                clientType: 'CLIENT_TYPE_ANDROID'
            }, { headers: sp(h1) });

            let u = null;
            try {
                const b = await axios.post(`${IDT}/getAccountInfo?key=${AM_KEY}`, { idToken: a.data.idToken }, { headers: sp(h1) });
                u = b.data?.users?.[0] || null;
            } catch {}

            return {
                ok: true,
                idToken: a.data.idToken,
                refreshToken: a.data.refreshToken,
                localId: a.data.localId,
                user: u
            };
        } catch (e) { return { ok: false, why: bad(e) }; }
    });

    if (!authRes.ok) throw new Error('Gagal sign-in: ' + authRes.why);

    // 4. Aktivasi langganan Pro (pro)
    const orderId = 'reycode-' + crypto.randomBytes(6).toString('hex');
    const proRes = await apiQueue.add(async () => {
        try {
            const b = {
                data: {
                    productId: 'am.full.sub.annual.19q4',
                    token: 'mmgaobamlahbbeccfplmbkbb.AO-J1OzqG0or_GJJIx-ms8GrTm-jaglCRfhQSRPUZKpl2YspYS-oN7_94uv8RC5vQbvd_Ios2pPDStZ2n7F0hLE3FiOU7HS3R6Fquulv5xLXFECSv4ctElw',
                    skuType: 'subs',
                    orderId: orderId
                }
            };
            const h = {
                ...h2,
                authorization: 'Bearer ' + authRes.idToken,
                'firebase-instance-id-token': 'cSDnCyp3T-uwp07z3tL86T:APA91bFkmvvsHw5nnqa1SBFci-99DRsKClLiETdRrVcJjS5yBx1v_FbCb1d8WhBuea_zmwnYBktyTIzcRhN4b6uNOUur9wPc0gKXmJDoZic0LhNq5V2s0xI'
            };
            const r = await axios.post(VFY, b, { headers: sp(h) });
            return { ok: true, data: r.data };
        } catch (e) { return { ok: false, why: bad(e) }; }
    });

    if (!proRes.ok) throw new Error('Gagal aktivasi Pro: ' + proRes.why);

    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    const dynamicValidUntil = expiryDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();

    return {
        success: true,
        email: tempEmail,
        uid: authRes.localId,
        weblogin: `https://${DOMAIN}`,
        animal: animalName,
        orderId: orderId,
        validUntil: dynamicValidUntil,
        idToken: authRes.idToken,
        refreshToken: authRes.refreshToken,
        verification_link: verificationLink,
        pro_response: proRes.data
    };
}

// --- Viu Drama Scraper Engine ---
class Viu {
    constructor(options = {}) {
        this.baseUrl = options.baseUrl || "https://api-gateway-global.viu.com";
        this.deviceId = options.deviceId || crypto.randomUUID();
        this.jwtToken = null;
        this.countryCode = options.countryCode || "ID";
        this.language = options.language || "8";
        this.areaId = options.areaId || "1000";
    }

    async init() {
        if (this.jwtToken) return;

        const authUrl = `${this.baseUrl}/api/auth/token`;
        const bodyData = new URLSearchParams({
            countryCode: this.countryCode,
            platform: "android",
            platformFlagLabel: "phone",
            language: this.language,
            deviceId: this.deviceId,
            dataTrackingDeviceId: "null",
            osVersion: "34",
            appVersion: "2.27.1",
            buildVersion: "840",
            carrierId: "7",
            carrierName: "Axis",
            appBundleId: "com.vuclip.viu",
            vuclipUserId: "",
            deviceBrand: "Neo G11",
            deviceModel: "Neo G11",
            flavour: "all"
        });

        const res = await fetch(authUrl, {
            method: "POST",
            headers: {
                "User-Agent": "Neo/10",
                "Content-Type": "application/x-www-form-urlencoded",
                "platform": "android"
            },
            body: bodyData.toString()
        });

        if (!res.ok) throw new Error(`Viu Auth failed with status ${res.status}`);
        const data = await res.json();

        if (data.status === 1 && data.token) {
            this.jwtToken = data.token;
        } else {
            throw new Error(`Viu Token fetch failed: ${JSON.stringify(data)}`);
        }
    }

    getHeaders() {
        return {
            "authorization": `Bearer ${this.jwtToken}`,
            "platform": "android",
            "user-agent": "Neo/1.0",
            "content-type": "application/json",
            "accept": "application/json"
        };
    }

    getCommonParams(extra = {}) {
        return new URLSearchParams({
            platform_flag_label: "phone",
            language_flag_id: this.language,
            ut: "0",
            area_id: this.areaId,
            os_flag_id: "2",
            countryCode: this.countryCode,
            ...extra
        });
    }

    async homepage() {
        await this.init();
        try {
            const params = this.getCommonParams({ r: '/home/index' });
            const url = `${this.baseUrl}/api/mobile?${params.toString()}`;
            const response = await fetch(url, { headers: this.getHeaders() });
            
            let modules = [];
            let seenIds = new Set();

            if (response.ok) {
                const res = await response.json();
                if (res.data) {
                    if (res.data.banner && Array.isArray(res.data.banner) && res.data.banner.length > 0) {
                        let bannerItems = [];
                        res.data.banner.forEach(b => {
                            const itemId = b.series_id || b.product_id;
                            const title = b.series_name || b.title;
                            if (itemId && title && !seenIds.has(itemId)) {
                                seenIds.add(itemId);
                                bannerItems.push({ id: itemId, series_id: b.series_id, title: title });
                            }
                        });
                        if (bannerItems.length > 0) {
                            modules.push({ module_name: "Featured Banner", items: bannerItems });
                        }
                    }

                    if (res.data.grid && Array.isArray(res.data.grid) && res.data.grid.length > 0) {
                        res.data.grid.forEach(sec => {
                            const rawItems = sec.items || sec.product_list || sec.series || [];
                            let moduleItems = [];
                            rawItems.forEach(item => {
                                const itemId = item.series_id || item.product_id || item.id;
                                const title = item.series_name || item.synopsis || item.title || item.name;
                                if (itemId && title && !seenIds.has(itemId)) {
                                    seenIds.add(itemId);
                                    moduleItems.push({ id: itemId, series_id: item.series_id, title: title });
                                }
                            });
                            if (moduleItems.length > 0) {
                                modules.push({ module_name: sec.title || sec.name || "Trending Grid", items: moduleItems });
                            }
                        });
                    }
                }
            }
            return { status: true, creator: CREATOR, data: { items: modules } };
        } catch (error) {
            throw new Error(error.message);
        }
    }

    async search(query) {
        await this.init();
        try {
            if (!query) throw new Error('Query is required.');
            const params = this.getCommonParams({
                r: '/search/video',
                limit: '18',
                page: '1',
                has_micro_drama: '1'
            });
            const url = `${this.baseUrl}/api/mobile?${params.toString()}&keyword%5B%5D=${encodeURIComponent(query)}`;
            const response = await fetch(url, { headers: this.getHeaders() });
            
            let items = [];
            if (response.ok) {
                const res = await response.json();
                const rawList = res.data?.series || res.data?.product_list || res.data?.items || [];
                rawList.forEach(show => {
                    items.push({
                        id: show.series_id || show.product_id || show.id,
                        series_id: show.series_id,
                        title: show.name || show.title || show.synopsis
                    });
                });
            }
            return { status: true, creator: CREATOR, data: { items } };
        } catch (error) {
            throw new Error(error.message);
        }
    }

    async detail(id) {
        await this.init();
        try {
            if (!id) throw new Error('Drama ID / Product ID is required.');
            
            let showTitle = "Viu Drama";
            let seriesId = id;
            
            try {
                const detailParams = this.getCommonParams({ r: '/vod/detail', product_id: String(id) });
                const detailUrl = `${this.baseUrl}/api/mobile?${detailParams.toString()}`;
                const response = await fetch(detailUrl, { headers: this.getHeaders() });
                const res = await response.json();
                if (res.data?.current_product) {
                    showTitle = res.data.current_product.synopsis || res.data.current_product.series_name || showTitle;
                    if (res.data.current_product.series_id) {
                        seriesId = res.data.current_product.series_id;
                    }
                }
            } catch(e) {}

            let episodes = [];
            const epParams = this.getCommonParams({
                r: '/vod/product-list',
                product_id: String(id),
                series_id: String(seriesId),
                size: '1000'
            });
            const epUrl = `${this.baseUrl}/api/mobile?${epParams.toString()}`;
            const epRes = await fetch(epUrl, { headers: this.getHeaders() });

            if (epRes.ok) {
                const epData = await epRes.json();
                const rawEps = epData.data?.product_list || [];
                rawEps.forEach((item, i) => {
                    episodes.push({
                        id: item.product_id || item.id,
                        ccs_product_id: item.ccs_product_id,
                        index: item.number || (i + 1),
                        name: item.synopsis || item.title || `Episode ${item.number || (i + 1)}`
                    });
                });
            }

            return { status: true, creator: CREATOR, data: { info: { name: showTitle, series_id: seriesId, episode_list: episodes } } };
        } catch (error) {
            throw new Error(error.message);
        }
    }

    async stream(id, epsid, quality = '1080p') {
        await this.init();
        try {
            if (!id || !epsid) throw new Error('Drama id & episode id is required.');

            let ccsProductId = epsid;

            if (!isNaN(epsid) || String(epsid).length < 20) {
                const detailRes = await this.detail(id);
                const episodes = detailRes?.data?.info?.episode_list || [];
                const targetEp = episodes.find(e => e.id == epsid || e.index == epsid);
                if (targetEp && targetEp.ccs_product_id) {
                    ccsProductId = targetEp.ccs_product_id;
                }
            }

            const pbParams = this.getCommonParams({
                ccs_product_id: String(ccsProductId),
                duration_start: '0',
                duration: '180'
            });
            const pbUrl = `${this.baseUrl}/api/playback/distribute?${pbParams.toString()}`;
            const pbRes = await fetch(pbUrl, { headers: this.getHeaders() });

            if (!pbRes.ok) throw new Error(`Playback API error! status: ${pbRes.status}`);
            const pbData = await pbRes.json();

            const streamData = pbData.data?.stream;
            let streamUrl = null;
            let availableResolutions = {};

            if (streamData && streamData.airplayurl) {
                const ap = streamData.airplayurl;
                if (ap.s1080p) availableResolutions["1080p"] = ap.s1080p;
                if (ap.s720p) availableResolutions["720p"] = ap.s720p;
                if (ap.s480p) availableResolutions["480p"] = ap.s480p;
                if (ap.s240p) availableResolutions["240p"] = ap.s240p;

                const qKey = String(quality).toLowerCase().replace('s', '');
                if (qKey.includes('1080') && ap.s1080p) streamUrl = ap.s1080p;
                else if (qKey.includes('720') && ap.s720p) streamUrl = ap.s720p;
                else if (qKey.includes('480') && ap.s480p) streamUrl = ap.s480p;
                else if (qKey.includes('240') && ap.s240p) streamUrl = ap.s240p;

                if (!streamUrl) {
                    streamUrl = ap.s1080p || ap.s720p || ap.s480p || ap.s240p || ap.url;
                }
            }

            if (!streamUrl) throw new Error('Stream URL tidak ditemukan.');

            let subtitles = [];
            if (streamData.subtitle && Array.isArray(streamData.subtitle)) {
                subtitles = streamData.subtitle.map(s => ({
                    display_name: s.name || s.language,
                    subtitle: s.url
                }));
            }

            return {
                status: true,
                creator: CREATOR,
                result: {
                    url: streamUrl,
                    quality: quality,
                    resolutions: availableResolutions,
                    subtitles: subtitles
                }
            };
        } catch (error) {
            throw new Error(error.message);
        }
    }
}

const viuInstance = new Viu();

// ==========================================
// 5. DOWNLOADERS & TOOLS
// ==========================================
async function indown(url) {
    try {
        const { data: pageData, headers } = await axios.get('https://indown.io/en1', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const $ = cheerio.load(pageData);
        const token = $('input[name="_token"]').val();
        const cookies = headers['set-cookie'] ? headers['set-cookie'].map(v => v.split(';')[0]).join('; ') : '';
        if (!token) throw new Error('Token Indown not found');

        const params = new URLSearchParams();
        params.append('referer', 'https://indown.io/en1');
        params.append('locale', 'en');
        params.append('_token', token);
        params.append('link', url);
        params.append('p', 'i');

        const { data: resultData } = await axios.post('https://indown.io/download', params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies }
        });
        const $result = cheerio.load(resultData);
        const resultUrls = [];
        $result('video source[src], a[href].btn-outline-primary').each((i, e) => {
            let link = $result(e).attr('src') || $result(e).attr('href');
            if (link) {
                if (link.includes('indown.io/fetch')) {
                    try { link = decodeURIComponent(new URL(link).searchParams.get('url')); } catch {}
                }
                if (/cdninstagram\.com|fbcdn\.net/.test(link)) {
                    resultUrls.push(link.replace(/&dl=1$/, ''));
                }
            }
        });
        const uniqueUrls = [...new Set(resultUrls)];
        if (uniqueUrls.length === 0) throw new Error('No media found');
        return { status: true, source: 'indown', result: { downloadUrl: uniqueUrls } };
    } catch (e) { return { status: false, message: e.message }; }
}

async function snapsave(targetUrl) {
    try {
        const form = new URLSearchParams();
        form.append('url', targetUrl);
        const { data } = await axios.post('https://snapsave.app/id/action.php?lang=id', form, {
            headers: { 'origin': 'https://snapsave.app', 'referer': 'https://snapsave.app/id/download-video-instagram' }
        });
        const ctx = { window: {}, document: { getElementById: () => ({ value: '' }) }, console, eval: r => r };
        vm.createContext(ctx);
        const decoded = vm.runInContext(data, ctx);
        const matches = decoded.match(/https:\/\/d\.rapidcdn\.app\/v2\?[^"]+/g);
        if (matches && matches.length > 0) {
            return { status: true, source: 'snapsave', result: { downloadUrl: [...new Set(matches.map(u => u.replace(/&amp;/g, '&')))] } };
        }
        throw new Error('No media found');
    } catch (e) { return { status: false, message: e.message }; }
}

async function igdl(url) {
    let res = await indown(url);
    if (!res.status || !res.result || res.result.downloadUrl.length === 0) res = await snapsave(url);
    return res;
}

async function tiktokv1(url) {
    try {
        const res = (await axios.post('https://www.tikwm.com/api/', {}, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'Origin': 'https://www.tikwm.com' },
            params: { url, count: 12, cursor: 0, web: 1, hd: 1 }
        })).data.data;

        let data = [];
        if (res?.duration == 0) {
            res.images.forEach(v => data.push({ type: 'photo', url: v }));
        } else {
            data.push(
                { type: 'watermark', url: 'https://www.tikwm.com' + (res?.wmplay || '') },
                { type: 'nowatermark', url: 'https://www.tikwm.com' + (res?.play || '') },
                { type: 'nowatermark_hd', url: 'https://www.tikwm.com' + (res?.hdplay || '') }
            );
        }
        return { status: true, title: res.title, data };
    } catch (e) { return { status: false, msg: e.message }; }
}

async function tiktokv2(url) {
    try {
        const r = await axios.post('https://savetik.co/api/ajaxSearch', new URLSearchParams({ q: url, lang: 'id' }).toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', origin: 'https://savetik.co' }
        });
        const $ = cheerio.load(r.data.data);
        return {
            status: true,
            title: $('h3').first().text().trim() || null,
            mp4: $('.dl-action a:contains("MP4")').not(':contains("HD")').attr('href') || null,
            mp4_hd: $('.dl-action a:contains("HD")').attr('href') || null
        };
    } catch (e) { return { status: false, msg: e.message }; }
}

async function ttdl(url) {
    let res = await tiktokv1(url);
    if (!res.status) res = await tiktokv2(url);
    return res;
}

// NanoBanana AI Image-to-Image Scraper Module
async function nanoBananaEdit(imageBuffer, promptText = 'enhance image') {
    const boundary = '----Boundary' + Date.now();
    const parts = [
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="image.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
        imageBuffer,
        Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${promptText}`),
        Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="output_format"\r\n\r\njpg`),
        Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="generator_slug"\r\n\r\nai-image-editor`),
        Buffer.from(`\r\n--${boundary}--\r\n`)
    ];
    
    const body = Buffer.concat(parts);

    const headers = {
        'Accept': '*/*',
        'Origin': 'https://banana-nano.ai',
        'Referer': 'https://banana-nano.ai/ai-image-editor',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
    };

    try {
        const response = await axios.post('https://ibbo.ai/api/nano-banana-lite-image-to-image', body, {
            headers,
            timeout: 60000,
            validateStatus: () => true
        });

        if (response.data && response.data.success) {
            return {
                status: true,
                creator: CREATOR,
                result: response.data.data
            };
        } else {
            return {
                status: false,
                error: response.data?._raw || response.data?.message || 'Gagal memproses gambar dengan NanoBanana AI.'
            };
        }
    } catch (err) {
        return {
            status: false,
            error: err.message
        };
    }
}

// --- Free Fire Guest Account Generator Module & API (/api/genfreefiree) ---
async function generateFreeFireGuest() {
    const app_id = parseInt(process.env.FF_APP_ID || '', 10);
    const secret = process.env.FF_SECRET || '';
    const host = process.env.FF_HOST || '';
    const ua = process.env.FF_UA || '';

    const password = crypto.randomBytes(32).toString('hex').toUpperCase();
    const regBody = { app_id, client_type: 2, password, source: 2 };
    const sig = crypto.createHmac('sha256', secret).update(JSON.stringify(regBody)).digest('hex');

    const regRes = await axios.post(`${host}/api/v2/oauth/guest:register`, regBody, {
        headers: { 'User-Agent': ua, 'Content-Type': 'application/json; charset=utf-8', 'Authorization': `Signature ${sig}` },
        validateStatus: () => true
    });

    if (regRes.data.code !== 0 || !regRes.data.data?.uid) {
        throw new Error(regRes.data.error || 'Gagal register akun guest Free Fire.');
    }

    const uid = regRes.data.data.uid;
    const grantRes = await axios.post(`${host}/api/v2/oauth/guest/token:grant`, {
        client_id: app_id,
        client_secret: secret,
        client_type: 2,
        password,
        response_type: 'token',
        uid
    }, {
        headers: { 'User-Agent': ua, 'Content-Type': 'application/json; charset=utf-8' },
        validateStatus: () => true
    });

    if (grantRes.data.code !== 0 || !grantRes.data.data?.access_token) {
        throw new Error(grantRes.data.error || 'Gagal mengambil token guest Free Fire.');
    }

    return {
        uid,
        password,
        open_id: grantRes.data.data.open_id,
        access_token: grantRes.data.data.access_token
    };
}
// Router
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-apikey, x-admin-token');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    next();
});

const MAINTENANCE_MODE = false;

app.use((req, res, next) => {
    if (!MAINTENANCE_MODE) {
        return next();
    }

    if (
        req.path.startsWith('/api/') ||
        req.path === '/maintenance' ||
        req.path.startsWith('/docs/maintenance')
    ) {
        return next();
    }

    return res.status(503).sendFile(
        path.join(__dirname, '../docs/maintenance/index.html')
    );
});

app.use('/docs', express.static(path.join(__dirname, '../docs')));
app.use(express.static(path.join(__dirname, '../')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

app.get('/api/engine', (req, res) => {
    res.status(200).json({
        status: true,
        creator: CREATOR,
        message: 'Alight Motion Ultimate Unified Master Engine Active in /api/'
    });
});

app.use((req, res, next) => {
    console.log('ROUTING DEBUG:', {
        url: req.url,
        originalUrl: req.originalUrl,
        path: req.path,
        query: req.query
    });

    next();
});

// --- AM Engine Routers (Updated Manual Mode) ---
app.all('/api/amgen', async (req, res) => {
    const body = req.method === 'GET' ? req.query : (req.body || {});
    const action = body.action || '';

    const apiKeyInput = req.headers['x-apikey'] || body.apikey || '';
    const passwordInput = req.headers['x-api-password'] || body.password || body.pass || '';
    const username = body.username || body.user || '';

    // 1. BULK GENERATE
    if (action === 'bulk-generate' || (!action && apiKeyInput)) {
        try {
            await connectDB();

            if (!apiKeyInput) {
                return res.status(403).json({ status: false, creator: CREATOR, error: 'Akses ditolak! API Key wajib diisi.' });
            }
            if (!passwordInput) {
                return res.status(403).json({ status: false, creator: CREATOR, error: 'Akses ditolak! Password API Key wajib diisi.' });
            }

            const keyData = await ApiKey.findOne({ apikey: apiKeyInput });
            if (!keyData) {
                return res.status(403).json({ status: false, creator: CREATOR, error: 'API Key tidak ditemukan.' });
            }
            if (keyData.status !== 'active') {
                return res.status(403).json({ status: false, creator: CREATOR, error: 'API Key tidak aktif.' });
            }
            if (!keyData.expired_at || new Date() > new Date(keyData.expired_at)) {
                return res.status(403).json({ status: false, creator: CREATOR, error: 'API Key sudah kadaluarsa.' });
            }

            const passwordValid = await bcrypt.compare(passwordInput, keyData.password);
            if (!passwordValid) {
                return res.status(403).json({ status: false, creator: CREATOR, error: 'Password API Key salah.' });
            }

            const count = parseInt(body.count || body.jumlah || 1, 10);
            const maxCount = Math.min(Math.max(Number.isNaN(count) ? 1 : count, 1), 10);
            const generateUsername = username || keyData.name || keyData.owner;

            const results = [];
            for (let i = 0; i < maxCount; i++) {
                try {
                    results.push(await processSingleAccount(generateUsername));
                } catch (err) {
                    results.push({ success: false, error: err.message });
                }
            }

            return res.status(200).json({
                status: true,
                creator: CREATOR,
                owner: keyData.owner,
                name: keyData.name,
                apikey: keyData.apikey,
                package: keyData.package,
                expired_at: keyData.expired_at,
                total_generated: maxCount,
                results
            });
        } catch (err) {
            return res.status(500).json({ status: false, creator: CREATOR, error: err.message });
        }
    }

    // 2. MANUAL: SEND LINK (Mengirim oobConfirmationCode ke email akunlama)
    if (action === 'send-link') {
        const email = body.email;
        if (!email) {
            return res.status(400).json({ status: false, creator: CREATOR, error: 'Alamat email wajib diisi!' });
        }
        try {
            const resLink = await link(email);
            if (!resLink.ok) {
                throw new Error(resLink.why);
            }
            return res.status(200).json({ 
                status: true, 
                creator: CREATOR, 
                message: 'Tautan verifikasi berhasil dikirim ke ' + email 
            });
        } catch (err) {
            return res.status(500).json({ status: false, creator: CREATOR, error: err.message });
        }
    }

    // 3. MANUAL: VERIFY LINK (Memproses magic link / oobCode manual & aktifkan Pro)
    if (action === 'verify-link') {
        const email = body.email;
        const magicLink = body.magicLink || body.oobCode;

        if (!email || !magicLink) {
            return res.status(400).json({ status: false, creator: CREATOR, error: 'Data email dan magicLink/oobCode wajib diisi!' });
        }

        try {
            // Proses sign-in menggunakan fungsi auth & code parser
            const authRes = await auth(email, magicLink);
            if (!authRes.ok) {
                throw new Error(authRes.why);
            }

            // Aktivasi Pro menggunakan idToken hasil auth manual
            const orderId = 'neo-' + crypto.randomBytes(6).toString('hex');
            const proRes = await pro(authRes.id);
            if (!proRes.ok) {
                throw new Error('Gagal aktivasi Pro: ' + proRes.why);
            }

            return res.status(200).json({
                status: true,
                creator: CREATOR,
                message: 'Akun manual berhasil diverifikasi dan diaktifkan!',
                data: {
                    email: authRes.email,
                    uid: authRes.uid,
                    orderId: orderId,
                    idToken: authRes.idToken,
                    refreshToken: authRes.ref
                }
            });
        } catch (err) {
            return res.status(500).json({ status: false, creator: CREATOR, error: err.message });
        }
    }

    return res.status(400).json({ status: false, creator: CREATOR, error: 'Aksi atau parameter tidak valid.' });
});

app.all('/api/amgen_auto', async (req, res) => {
    const body = req.method === 'GET' ? req.query : (req.body || {});
    try {
        const acc = await processSingleAccount(body.username || body.user);
        return res.status(200).json({
            status: true,
            creator: CREATOR,
            card: {
                email: acc.email,
                weblogin: acc.weblogin,
                selamat_kamu_mendapatkan_animal: acc.animal,
                orderId: acc.orderId,
                validUntil: acc.validUntil,
                panduan_dan_cara_login: [
                    '1. Buka aplikasi Alight Motion.',
                    '2. Sign in dengan email: ' + acc.email
                ]
            }
        });
    } catch (err) {
        return res.status(500).json({ status: false, creator: CREATOR, error: err.message });
    }
});

app.all('/api/bulk-am', async (req, res) => {
    if (req.method === 'POST' && req.body && !req.body.action) {
        req.body.action = 'bulk-generate';
    }
    req.url = '/api/amgen';
    return app._router.handle(req, res);
});

app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({
            status: false,
            creator: CREATOR,
            error: 'API endpoint tidak ditemukan.'
        });
    }

    return res.status(404).sendFile(
        path.join(__dirname, '../docs/404/index.html')
    );
});

// --- Downloader & Tools ---
app.all('/api/igdl', async (req, res) => {
    const url = req.method === 'POST' ? req.body?.url : req.query?.url;
    if (!url) return res.status(400).json({ status: false, error: 'URL Instagram wajib!' });
    return res.status(200).json(await igdl(url));
});

app.all('/api/tiktok', async (req, res) => {
    const url = req.method === 'POST' ? req.body?.url : req.query?.url;
    if (!url) return res.status(400).json({ status: false, error: 'URL TikTok wajib!' });
    return res.status(200).json(await ttdl(url));
});

// --- NanoBanana AI Edit Endpoint (/api/nanobanana) ---
app.all('/api/nanobanana', async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ status: false, error: 'Gunakan metode POST' });
    }

    try {
        const { imageUrl, base64Image, prompt } = req.body || {};
        let imageBuf = null;

        if (base64Image) {
            imageBuf = Buffer.from(base64Image.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        } else if (imageUrl) {
            const resp = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            imageBuf = Buffer.from(resp.data);
        }

        if (!imageBuf) {
            return res.status(400).json({ status: false, error: 'Parameter imageUrl atau base64Image wajib disertakan!' });
        }

        const result = await nanoBananaEdit(imageBuf, prompt || 'enhance image');
        return res.status(200).json(result);

    } catch (err) {
        return res.status(500).json({ status: false, error: err.message });
    }
});

app.all('/api/genfreefiree', async (req, res) => {
    try {
        const body = req.method === 'GET' ? req.query : (req.body || {});
        const count = parseInt(body.count || body.jumlah || 1, 10);
        const maxCount = Math.min(Math.max(count, 1), 5);

        const results = [];
        for (let i = 0; i < maxCount; i++) {
            try {
                const acc = await generateFreeFireGuest();
                results.push({ success: true, ...acc });
            } catch (err) {
                results.push({ success: false, error: err.message });
            }
        }

        return res.status(200).json({
            status: true,
            creator: CREATOR,
            total_generated: results.filter(r => r.success).length,
            results
        });
    } catch (err) {
        return res.status(500).json({ status: false, creator: CREATOR, error: err.message });
    }
});

// --- API Endpoints Viu (/api/viu/*) ---
app.all('/api/viu/home', async (req, res) => {
    try {
        const result = await viuInstance.homepage();
        return res.status(200).json(result);
    } catch (err) {
        return res.status(500).json({ status: false, error: err.message });
    }
});

app.all('/api/viu/search', async (req, res) => {
    const query = req.method === 'POST' ? req.body?.query : req.query?.query;
    if (!query) return res.status(400).json({ status: false, error: 'Query pencarian wajib disertakan!' });
    try {
        const result = await viuInstance.search(query);
        return res.status(200).json(result);
    } catch (err) {
        return res.status(500).json({ status: false, error: err.message });
    }
});

app.all('/api/viu/detail', async (req, res) => {
    const id = req.method === 'POST' ? req.body?.id : req.query?.id;
    if (!id) return res.status(400).json({ status: false, error: 'ID drama wajib disertakan!' });
    try {
        const result = await viuInstance.detail(id);
        return res.status(200).json(result);
    } catch (err) {
        return res.status(500).json({ status: false, error: err.message });
    }
});

app.all('/api/viu/stream', async (req, res) => {
    const body = req.method === 'POST' ? req.body : req.query;
    if (!body?.id || !body?.epsid) return res.status(400).json({ status: false, error: 'Parameter id dan epsid wajib disertakan!' });
    try {
        const result = await viuInstance.stream(body.id, body.epsid, body.quality || '1080p');
        return res.status(200).json(result);
    } catch (err) {
        return res.status(500).json({ status: false, error: err.message });
    }
});

// --- Chat AI Endpoint (/api/chat) ---
app.post('/api/chat', async (req, res) => {
    try {
        const { prompt, engine, model, history } = req.body || {};
        if (!prompt) {
            return res.status(400).json({ status: false, error: 'Prompt atau pesan wajib diisi!' });
        }

        let resultText = '';
        if (engine === 'deepai') {
            const selectedModel = model || 'standard';
            try {
                const messages = history && Array.isArray(history) && history.length > 0 
                    ? history 
                    : [{ role: 'user', content: prompt }];
                resultText = await deepAiChat.chat(messages, { model: selectedModel });
            } catch (apiErr) {
                resultText = `DeepAI Error (${selectedModel}): ` + apiErr.message;
            }
        } else {
            const rayleighResult = await rayleighScrape(prompt);
            if (rayleighResult.status) {
                resultText = rayleighResult.data;
            } else {
                throw new Error(rayleighResult.error || 'Gagal mendapatkan respons dari Rayleigh AI.');
            }
        }

        return res.status(200).json({
            status: true,
            creator: CREATOR,
            engine: engine || 'rayleigh',
            model: model || 'standard',
            result: resultText
        });
    } catch (err) {
        return res.status(500).json({ status: false, error: err.message });
    }
});

// --- AI Tools Endpoints (Upscale, Wink, Imagen) ---
app.post('/api/upscale', async (req, res) => {
    try {
        const { base64Image, imageUrl, filename } = req.body || {};
        let inputTarget = null;
        let safeFilename = filename || 'image.jpg';

        if (base64Image) {
            inputTarget = Buffer.from(base64Image.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        } else if (imageUrl) {
            inputTarget = imageUrl;
        }

        if (!inputTarget) {
            return res.status(400).json({ status: false, error: 'File gambar (base64) atau URL gambar wajib disertakan!' });
        }

        const result = await upscaleImage(inputTarget, safeFilename);
        return res.status(200).json(result);
    } catch (err) {
        return res.status(500).json({ status: false, error: err.message });
    }
});

app.post('/api/wink', async (req, res) => {
    try {
        const { base64Video, videoUrl, filename } = req.body || {};
        let inputTarget = null;
        let safeFilename = filename || `wink-${Date.now()}.mp4`;

        if (base64Video) {
            inputTarget = Buffer.from(base64Video.replace(/^data:video\/\w+;base64,/, ''), 'base64');
        } else if (videoUrl) {
            const response = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 120000 });
            inputTarget = Buffer.from(response.data);
        }

        if (!inputTarget) {
            return res.status(400).json({ status: false, error: 'File video (base64) atau URL video wajib disertakan!' });
        }

        const result = await winkEnhance(inputTarget, { filename: safeFilename });
        return res.status(200).json({
            status: true,
            creator: CREATOR,
            resultUrl: result.resultUrl
        });
    } catch (err) {
        return res.status(500).json({ status: false, error: err.message });
    }
});

app.post('/api/imagen', async (req, res) => {
    try {
        const { prompt, style, ratio, steps } = req.body || {};
        if (!prompt) {
            return res.status(400).json({ status: false, error: 'Prompt gambar wajib diisi!' });
        }

        const result = await imagenInstance.generateImage({
            prompt,
            style: style || 'Realistic',
            ratio: ratio || '1:1',
            steps: steps || 4,
            upload: true 
        });

        let imageUrl = result.upload && result.upload.url ? result.upload.url : `data:image/jpeg;base64,${result.buffer.toString('base64')}`;

        return res.status(200).json({
            status: true,
            creator: CREATOR,
            result: imageUrl
        });
    } catch (err) {
        return res.status(500).json({ status: false, error: err.message });
    }
});


app.all('/api/apikey/check', async (req, res) => {
    const body = req.method === 'GET' ? req.query : (req.body || {});
    const inputKey = req.headers['x-apikey'] || body.apikey;
    const currentUsername = body.user || req.query.user || '';
    
    if (!inputKey) return res.status(400).json({ status: false, creator: CREATOR, error: 'Silakan masukkan API Key Anda.' });

    try {
        await connectDB();
        const keyData = await ApiKey.findOne({ apikey: inputKey });
        
        if (!keyData) {
            return res.status(404).json({ status: false, creator: CREATOR, error: 'API Key tidak ditemukan!' });
        }

        if (currentUsername && keyData.owner.toLowerCase() !== currentUsername.toLowerCase()) {
            return res.status(403).json({ 
                status: false, 
                creator: CREATOR, 
                error: `Akses ditolak! API Key ini milik akun lain (${keyData.owner}), bukan milik Anda.` 
            });
        }

        const now = new Date();
        const expiredDate = new Date(keyData.expired_at);
        const isActive = keyData.status === 'active' && now <= expiredDate;

        if (!isActive) {
            return res.status(200).json({ 
                status: true, 
                creator: CREATOR, 
                data: { status: 'expired', owner: keyData.owner } 
            });
        }

        const diffTime = Math.abs(expiredDate - now);
        const remainingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        return res.status(200).json({ 
            status: true, 
            creator: CREATOR, 
            data: { 
                apikey: keyData.apikey,
                owner: keyData.owner,
                package: keyData.package,
                status: 'active',
                remaining_days: `${remainingDays} Hari`
            } 
        });
    } catch (err) {
        return res.status(500).json({ status: false, creator: CREATOR, error: err.message });
    }
});

// ==========================================
// 9. VERCEL DEPLOYMENT & PAYMENT NOTIFICATIONS
// ==========================================
const multer = require('multer');
const upload = multer({ dest: os.tmpdir() });
const AdmZip = require('adm-zip');

const VERCEL_API_URL = 'https://api.vercel.com';

function getVercelToken() {
    return process.env.API_TOKEN || global.vercel?.token || '';
}

function cleanProjectName(name) {
    return String(name || "")
        .trim()
        .toLowerCase()
        .replace(/\.zip$/i, "")
        .replace(/\.html?$/i, "")
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}

function findFileRecursive(directory, filename) {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) {
            return fullPath;
        }
        if (entry.isDirectory()) {
            const found = findFileRecursive(fullPath, filename);
            if (found) return found;
        }
    }
    return null;
}

function collectFiles(directory, base = directory) {
    const result = [];
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            result.push(...collectFiles(fullPath, base));
        } else {
            result.push({
                filePath: fullPath,
                fileName: path.relative(base, fullPath).replace(/\\/g, "/")
            });
        }
    }
    return result;
}

function readJsonSafe(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function detectFramework(siteDir) {
    const indexPath = findFileRecursive(siteDir, "index.html");
    const vercelPath = findFileRecursive(siteDir, "vercel.json");
    const packagePath = findFileRecursive(siteDir, "package.json");

    let html = "";
    if (indexPath) {
        try { html = fs.readFileSync(indexPath, "utf8").toLowerCase(); } catch {}
    }

    const vercelConfig = vercelPath ? readJsonSafe(vercelPath) : null;
    const packageJson = packagePath ? readJsonSafe(packagePath) : null;
    const dependencies = {
        ...(packageJson?.dependencies || {}),
        ...(packageJson?.devDependencies || {})
    };

    if (dependencies.next || html.includes("__next") || html.includes("_next/")) {
        return { name: "Next.js", type: "node", vercel: "nextjs" };
    }
    if (dependencies.react || html.includes("react")) {
        return { name: "React", type: "node", vercel: "create-react-app" };
    }
    if (dependencies.vue || html.includes("vue")) {
        return { name: "Vue", type: "node", vercel: "vue" };
    }
    if (dependencies.svelte || html.includes("svelte")) {
        return { name: "Svelte", type: "node", vercel: "svelte" };
    }
    if (dependencies["@angular/core"] || html.includes("ng-version")) {
        return { name: "Angular", type: "node", vercel: "angular" };
    }
    if (dependencies.astro || String(vercelConfig?.buildCommand || "").toLowerCase().includes("astro")) {
        return { name: "Astro", type: "node", vercel: "astro" };
    }
    if (dependencies.tailwindcss || html.includes("tailwind")) {
        return { name: "HTML + Tailwind", type: "static", vercel: null };
    }
    if (indexPath) {
        return { name: "HTML Static", type: "static", vercel: null };
    }
    if (packagePath) {
        return { name: "Node.js", type: "node", vercel: null };
    }
    return { name: "Other", type: "static", vercel: null };
}

app.post('/api/deploy', upload.single('file'), requireTurnstile, async (req, res) => {
    let workDir = null;
    try {
        const projectName = cleanProjectName(req.body.name);
        
        const allowedDomains = ['legionteknologi.my.id', 'reycode.my.id', 'reycode.web.id'];
        let selectedDomain = (req.body.domain || '').trim().toLowerCase();
        if (!allowedDomains.includes(selectedDomain)) {
            selectedDomain = 'reycode.my.id'; 
        }

        const uploadedFile = req.file;
        if (!projectName || !uploadedFile) {
            return res.status(400).json({ status: false, error: 'Nama project dan file wajib diisi!' });
        }

        const token = getVercelToken();
        if (!token) return res.status(500).json({ status: false, error: 'Token Vercel belum dikonfigurasi di server.' });

        workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rey-webdep-'));
        const targetPath = path.join(workDir, uploadedFile.originalname);
        fs.renameSync(uploadedFile.path, targetPath);

        let siteDir = workDir;
        const filename = uploadedFile.originalname.toLowerCase();

        if (filename.endsWith('.zip')) {
            const extractDir = path.join(workDir, 'site');
            fs.mkdirSync(extractDir, { recursive: true });
            const zip = new AdmZip(targetPath);
            zip.extractAllTo(extractDir, true);
            
            const indexPath = findFileRecursive(extractDir, "index.html");
            if (indexPath) {
                const indexDir = path.dirname(indexPath);
                if (indexDir !== extractDir) {
                    const normalizedRoot = path.join(workDir, "site-root");
                    fs.mkdirSync(normalizedRoot, { recursive: true });
                    fs.cpSync(indexDir, normalizedRoot, { recursive: true });
                    siteDir = normalizedRoot;
                } else {
                    siteDir = extractDir;
                }
            } else {
                siteDir = extractDir;
            }
        } else if (filename.endsWith('.html') || filename.endsWith('.htm')) {
            const htmlDir = path.join(workDir, 'site');
            fs.mkdirSync(htmlDir, { recursive: true });
            fs.copyFileSync(targetPath, path.join(htmlDir, 'index.html'));
            siteDir = htmlDir;
        }

        const files = collectFiles(siteDir);
        if (!files.length) throw new Error('Tidak ada file ditemukan dalam arsip.');

        const framework = detectFramework(siteDir);

        const payloadFiles = files.map(file => ({
            file: file.fileName,
            data: fs.readFileSync(file.filePath).toString('base64'),
            encoding: 'base64'
        }));

        await axios.post(`${VERCEL_API_URL}/v9/projects`, { name: projectName }, {
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            validateStatus: () => true
        });

        const deployPayload = {
            name: projectName,
            project: projectName,
            files: payloadFiles
        };

        if (framework.vercel) {
            deployPayload.projectSettings = { framework: framework.vercel };
        }

        const deployRes = await axios.post(`${VERCEL_API_URL}/v13/deployments`, deployPayload, {
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            maxContentLength: 50 * 1024 * 1024,
            maxBodyLength: 50 * 1024 * 1024
        });

        const deploymentId = deployRes.data.id;
        const vercelUrl = deployRes.data.url ? `https://${deployRes.data.url}` : `https://${projectName}.vercel.app`;
        
        const customDomain = `${projectName}.${selectedDomain}`;

        await axios.post(`${VERCEL_API_URL}/v10/projects/${encodeURIComponent(projectName)}/domains`, {
            name: customDomain
        }, {
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            validateStatus: () => true
        });

        return res.status(200).json({
            status: true,
            creator: CREATOR,
            deploymentId,
            framework: framework.name,
            totalFiles: files.length,
            vercelUrl,
            customDomain,
            domainUsed: selectedDomain
        });

    } catch (err) {
        console.error('[WEB DEPLOY ERROR]', err.response?.data || err);
        return res.status(500).json({ status: false, error: err.response?.data?.error?.message || err.message });
    } finally {
        if (workDir && fs.existsSync(workDir)) {
            try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
        }
    }
});
// ==========================================
// 10. AUTOMATION ENDPOINTS (/api/capcut/*) - UPGRADED PARALLEL
// ==========================================
const capcutEngine = new CapCut();

// 1. Auto Register + Auto OTP + Auto Trial Format Card (Bisa GET / POST) - Paralel Execution
app.all('/api/capcut/register', async (req, res) => {
    const body = req.method === 'GET' ? req.query : (req.body || {});
    const count = parseInt(body.count || body.jumlah || 1, 10);
    const maxCount = Math.min(Math.max(count, 1), 5); // Batasi maks 5 akun sekali tembak

    // Buat array promise untuk menjalankan pembuatan akun secara paralel (bersamaan)
    const taskPromises = Array.from({ length: maxCount }, async (_, i) => {
        const logs = [];
        const progressCb = (msg) => logs.push(`[Akun ${i + 1}] ${msg}`);

        try {
            const result = await capcutEngine.registerDisposableAccount({
                referralInput: body.referralInput || body.inviteCode || body.ref,
                inviterUserId: body.inviterUserId,
                region: body.region || 'SG',
                getTrial: true, 
                timeoutMs: 60000
            }, progressCb);

            return {
                success: true,
                card: {
                    email: result.email,
                    password: result.password,
                    uid: result.uid,
                    cookie: result.cookie,
                    weblogin: 'https://www.capcut.com',
                    selamat_kamu_mendapatkan: 'CapCut Pro Trial 7d',
                    validUntil: result.validUntil,
                    panduan_dan_cara_login: [
                        "1. Buka aplikasi atau website resmi CapCut.",
                        "2. Login menggunakan Email: " + result.email,
                        "3. Masukkan Password yang tertera, atau gunakan Cookie session."
                    ]
                },
                logs
            };
        } catch (err) {
            return { success: false, error: err.message, logs };
        }
    });

    // Jalankan semua task secara bersamaan menggunakan Promise.all
    const results = await Promise.all(taskPromises);

    return res.status(200).json({
        status: true,
        creator: CREATOR,
        total_generated: results.filter(r => r.success).length,
        results: results.length === 1 ? results[0] : results
    });
});

// 2. Scraper Template Publik (TANPA COOKIE)
app.all('/api/capcut/template', async (req, res) => {
    const urlOrId = req.method === 'POST' ? req.body?.url || req.body?.id : req.query?.url || req.query?.id;
    if (!urlOrId) {
        return res.status(400).json({ status: false, error: 'URL atau ID template CapCut wajib disertakan!' });
    }

    try {
        const templateData = await capcutEngine.scrapeTemplate(urlOrId);
        return res.status(200).json({
            status: true,
            creator: CREATOR,
            data: templateData
        });
    } catch (err) {
        return res.status(500).json({ status: false, creator: CREATOR, error: err.message });
    }
});

// 3. Cek Profil & Status Akun (BUTUH COOKIE)
app.all('/api/capcut/profile', async (req, res) => {
    const body = req.method === 'GET' ? req.query : (req.body || {});
    const cookie = req.headers['x-cookie'] || body.cookie;

    if (!cookie) {
        return res.status(400).json({ status: false, error: 'Cookie CapCut wajib disertakan di body, query, atau header x-cookie!' });
    }

    try {
        const profile = await capcutEngine.getFullAccountProfile(cookie);
        return res.status(200).json({
            status: true,
            creator: CREATOR,
            data: profile
        });
    } catch (err) {
        return res.status(500).json({ status: false, creator: CREATOR, error: err.message });
    }
});

// 4. Klaim Referral / Redeem Kode Tambahan (BUTUH COOKIE)
app.all('/api/capcut/claim', async (req, res) => {
    const body = req.method === 'GET' ? req.query : (req.body || {});
    const cookie = req.headers['x-cookie'] || body.cookie;
    const referralInput = body.referralInput || body.inviteCode || body.inviterUserId;

    if (!cookie) {
        return res.status(400).json({ status: false, error: 'Cookie CapCut wajib disertakan!' });
    }
    if (!referralInput) {
        return res.status(400).json({ status: false, error: 'Parameter referral (referralInput / inviteCode) wajib diisi!' });
    }

    try {
        const logs = [];
        const progressCb = (msg) => logs.push(msg);

        const result = await capcutEngine.claimReferral(referralInput, cookie, progressCb);

        return res.status(200).json({
            status: true,
            creator: CREATOR,
            result,
            logs
        });
    } catch (err) {
        return res.status(500).json({ status: false, creator: CREATOR, error: err.message });
    }
});
// TeleGram
app.all('/api/payment/success-notif', async (req, res) => {
    const body = req.method === 'GET' ? req.query : (req.body || {});
    const username = body.user || body.username || 'Tamu / Umum';
    const txType = body.type || 'am-bulk';

    let label = 'API Key Bulk (Rp 5.000)';
    if (txType === 'donasi') label = 'Donasi / Dukungan Kreator';
    if (txType === 'topup') label = 'Topup Saldo SMM & OTP';

    const msg = `<b>🟢 KONFIRMASI PEMBAYARAN BERHASIL</b>\n\n` +
                `👤 User: <code>${username}</code>\n` +
                `📦 Kategori: <b>${label}</b>\n` +
                `🕒 Waktu: <code>${new Date().toLocaleString('id-ID')}</code>\n\n` +
                `<i>User membuka halaman sukses dan siap melakukan konfirmasi via WhatsApp.</i>`;

    if (typeof sendTelegramNotification === 'function') {
        sendTelegramNotification(msg);
    }

    return res.status(200).json({ status: true, message: 'Notifikasi terkirim.' });
});

module.exports = app;
