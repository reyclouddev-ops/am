/**
 * Name: Alight Motion Master Engine (The Ultimate Unified Edition)
 * Description: Seluruh endpoint API dipetakan secara bersih menggunakan prefix /api/ 
 *              tanpa mengganggu file frontend yang ada di dalam folder docs/.
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
const FormData = require('form-data');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const CREATOR = 'ReyCode';

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

const apiKeySchema = new mongoose.Schema({
    apikey: { type: String, required: true, unique: true },
    owner: { type: String, default: 'Client' },
    package: { type: String, default: 'Bulk Alight Motion Pro' },
    duration_days: { type: Number, default: 30 },
    created_at: { type: Date, default: Date.now },
    expired_at: { type: Date, required: true },
    status: { type: String, default: 'active' }
});

const ApiKey = mongoose.models.ApiKey || mongoose.model('ApiKey', apiKeySchema);


// ==========================================
// 2. CORE ALIGHT MOTION & AKUNLAMA SCRAPER
// ==========================================
const AM_KEY = 'AIzaSyDtG1AU22ErnQD60AzBAcaknySiz9_CEq0';
const IDT = 'https://www.googleapis.com/identitytoolkit/v3/relyingparty';
const VFY = 'https://us-central1-alight-creative.cloudfunctions.net/verifyPurchase';

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

async function authLink(email) {
  return apiQueue.add(async () => {
    try {
      await axios.post(`${IDT}/getOobConfirmationCode?key=${AM_KEY}`, {
        requestType: 6, email: email, androidInstallApp: true, canHandleCodeInApp: true,
        continueUrl: 'https://alightcreative.com?ui_sid=0366624874&ui_sd=0',
        iosBundleId: 'com.alightcreative.motion', androidPackageName: 'com.alightcreative.motion',
        androidMinimumVersion: '585', clientType: 'CLIENT_TYPE_ANDROID'
      }, { headers: sp(h1) });
      return { ok: true };
    } catch (e) { return { ok: false, why: bad(e) }; }
  });
}

async function authVerify(email, raw) {
  return apiQueue.add(async () => {
    const c = extractOobCode(raw);
    if (!c) return { ok: false, why: 'code gak ada' };
    try {
      const a = await axios.post(`${IDT}/emailLinkSignin?key=${AM_KEY}`, {
        email: email, oobCode: c, clientType: 'CLIENT_TYPE_ANDROID'
      }, { headers: sp(h1) });
      let u = null;
      try {
        const b = await axios.post(`${IDT}/getAccountInfo?key=${AM_KEY}`, { idToken: a.data.idToken }, { headers: sp(h1) });
        u = b.data?.users?.[0] || null;
      } catch {}
      return {
        ok: true, email: email, id: a.data.idToken, ref: a.data.refreshToken,
        uid: a.data.localId, baru: !!a.data.isNewUser, user: u
      };
    } catch (e) { return { ok: false, why: bad(e) }; }
  });
}

async function authPro(id) {
  return apiQueue.add(async () => {
    const o = 'reycode-' + crypto.randomBytes(6).toString('hex');
    const b = {
      data: {
        productId: 'am.full.sub.annual.19q4',
        token: 'mmgaobamlahbbeccfplmbkbb.AO-J1OzqG0or_GJJIx-ms8GrTm-jaglCRfhQSRPUZKpl2YspYS-oN7_94uv8RC5vQbvd_Ios2pPDStZ2n7F0hLE3FiOU7HS3R6Fquulv5xLXFECSv4ctElw',
        skuType: 'subs', orderId: o
      }
    };
    const h = {
      ...h2, authorization: 'Bearer ' + id,
      'firebase-instance-id-token': 'cSDnCyp3T-uwp07z3tL86T:APA91bFkmvvsHw5nnqa1SBFci-99DRsKClLiETdRrVcJjS5yBx1v_FbCb1d8WhBuea_zmwnYBktyTIzcRhN4b6uNOUur9wPc0gKXmJDoZic0LhNq5V2s0xI'
    };
    try {
      const r = await axios.post(VFY, b, { headers: sp(h) });
      return { ok: true, order: o, r: r.data };
    } catch (e) { return { ok: false, why: bad(e) }; }
  });
}

async function authRefresh(ref) {
  return apiQueue.add(async () => {
    try {
      const r = await axios.post(`https://securetoken.googleapis.com/v1/token?key=${AM_KEY}`, {
        grant_type: 'refresh_token', refresh_token: ref
      });
      return { ok: true, id: r.data.id_token, ref: r.data.refresh_token };
    } catch (e) { return { ok: false, why: bad(e) }; }
  });
}

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

    const linkRes = await apiQueue.add(async () => {
        try {
            await axios.post(`${IDT}/getOobConfirmationCode?key=${AM_KEY}`, {
                requestType: 6, email: tempEmail, androidInstallApp: true, canHandleCodeInApp: true,
                continueUrl: 'https://alightcreative.com?ui_sid=0366624874&ui_sd=0',
                iosBundleId: 'com.alightcreative.motion', androidPackageName: 'com.alightcreative.motion',
                androidMinimumVersion: '585', clientType: 'CLIENT_TYPE_ANDROID'
            }, { headers: sp(h1) });
            return { ok: true };
        } catch (e) { return { ok: false, why: bad(e) }; }
    });

    if (!linkRes.ok) throw new Error('Gagal mengirim oobCode: ' + linkRes.why);

    const verificationLink = await waitForVerificationLink(username, 60);
    if (!verificationLink) throw new Error('Magic link tidak tertangkap dalam 60 detik.');

    const oobCode = extractOobCode(verificationLink);
    if (!oobCode) throw new Error('Gagal mengekstrak oobCode.');

    const authRes = await apiQueue.add(async () => {
        try {
            const a = await axios.post(`${IDT}/emailLinkSignin?key=${AM_KEY}`, {
                email: tempEmail, oobCode: oobCode, clientType: 'CLIENT_TYPE_ANDROID'
            }, { headers: sp(h1) });
            return { ok: true, idToken: a.data.idToken, refreshToken: a.data.refreshToken, localId: a.data.localId };
        } catch (e) { return { ok: false, why: bad(e) }; }
    });

    if (!authRes.ok) throw new Error('Gagal sign-in: ' + authRes.why);

    const orderId = 'reycode-' + crypto.randomBytes(6).toString('hex');
    const proRes = await apiQueue.add(async () => {
        try {
            const r = await axios.post(VFY, {
                data: {
                    productId: 'am.full.sub.annual.19q4',
                    token: 'mmgaobamlahbbeccfplmbkbb.AO-J1OzqG0or_GJJIx-ms8GrTm-jaglCRfhQSRPUZKpl2YspYS-oN7_94uv8RC5vQbvd_Ios2pPDStZ2n7F0hLE3FiOU7HS3R6Fquulv5xLXFECSv4ctElw',
                    skuType: 'subs', orderId: orderId
                }
            }, { 
                headers: sp({
                    ...h2, authorization: 'Bearer ' + authRes.idToken,
                    'firebase-instance-id-token': 'cSDnCyp3T-uwp07z3tL86T:APA91bFkmvvsHw5nnqa1SBFci-99DRsKClLiETdRrVcJjS5yBx1v_FbCb1d8WhBuea_zmwnYBktyTIzcRhN4b6uNOUur9wPc0gKXmJDoZic0LhNq5V2s0xI'
                })
            });
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


// ==========================================
// 3. DOWNLOADERS & TOOLS (IG, TikTok, RemoveBG, Upscale, Wink)
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

async function pixa(img) {
  let filePath = img;
  let shouldCleanup = false;
  if (Buffer.isBuffer(img)) {
    filePath = path.join(os.tmpdir(), `removebg-${crypto.randomUUID()}.jpg`);
    await fsp.writeFile(filePath, img);
    shouldCleanup = true;
  }
  try {
    const fileBuffer = await fsp.readFile(filePath);
    const form = new FormData();
    form.append('image', fileBuffer, { filename: path.basename(filePath), contentType: 'image/jpeg' });
    form.append('format', 'png');
    form.append('model', 'v1');
    const res = await axios.post('https://api2.pixelcut.app/image/matte/v1', form, { headers: form.getHeaders() });
    return Buffer.from(res.data);
  } finally {
    if (shouldCleanup) { try { await fsp.unlink(filePath); } catch {} }
  }
}

const CLOUDINARY_URL = 'https://api.cloudinary.com/v1_1/dtz0urit6/auto/upload';
const SIGN_URL = 'https://cloudinary-tools.netlify.app/.netlify/functions/sign-upload-params';
const C_API_KEY = '985946268373735';
const UPLOAD_PRESET = 'cloudinary-tools';

async function getSignature() {
    const timestamp = Math.floor(Date.now() / 1000);
    const { data } = await axios.post(SIGN_URL, { paramsToSign: { timestamp, upload_preset: UPLOAD_PRESET, source: 'ml' } });
    return { signature: data.signature, timestamp };
}

async function upscaleImage(fileInput, filename = 'image.jpg') {
    let fileStreamOrBuffer = fileInput;
    if (typeof fileInput === 'string' && fileInput.startsWith('http')) {
        const response = await axios.get(fileInput, { responseType: 'arraybuffer' });
        fileStreamOrBuffer = Buffer.from(response.data);
    }
    const sig = await getSignature();
    const form = new FormData();
    form.append('file', fileStreamOrBuffer, { filename });
    form.append('upload_preset', UPLOAD_PRESET);
    form.append('source', 'ml');
    form.append('api_key', C_API_KEY);
    form.append('signature', sig.signature);
    form.append('timestamp', sig.timestamp);
    const { data } = await axios.post(CLOUDINARY_URL, form, { headers: form.getHeaders() });
    return { status: true, url: `https://res.cloudinary.com/dtz0urit6/image/upload/f_jpg,e_upscale,q_auto/${data.public_id}.jpg` };
}

// Wink Video Enhancer Engine
const WINK_BASE_URL = "https://wink.ai";
const STRATEGY_URL = "https://strategy.app.meitudata.com";
const WINK_CLIENT_ID = "1189857605";
const WINK_VERSION = "5.1.2";
const WINK_COUNTRY_CODE = "ID";
const WINK_CLIENT_LANGUAGE = "en_US";
const WINK_CLIENT_TIMEZONE = "Asia/Jakarta";
const WINK_TASK_TYPE = "11";
const WINK_CONTENT_TYPE = "2";
const WINK_UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";

let _winkApi = null;

async function getWinkApi() {
  if (_winkApi) return _winkApi;
  const gnum = crypto.randomUUID();
  const jar = new CookieJar();
  await jar.setCookie(`_sm=${gnum}; Path=/; Domain=wink.ai`, WINK_BASE_URL);
  await jar.setCookie(`meitustat=${encodeURIComponent(JSON.stringify({ wgid: gnum }))}; Path=/; Domain=wink.ai`, WINK_BASE_URL);

  _winkApi = {
    client: wrapper(
      axios.create({
        baseURL: WINK_BASE_URL, jar, withCredentials: true, validateStatus: () => true,
        headers: { accept: "*/*", origin: WINK_BASE_URL, referer: `${WINK_BASE_URL}/video-enhancer/upload`, "user-agent": WINK_UA },
      }),
    ),
    gnum,
  };
  return _winkApi;
}

function extToMime(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mkv") return "video/x-matroska";
  return "application/octet-stream";
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function makeTrace() { return `${crypto.randomBytes(16).toString("hex")}-${crypto.randomBytes(8).toString("hex")}-1`; }
function traceHeaders() {
  const trace = makeTrace();
  return {
    "sentry-trace": trace,
    baggage: `sentry-environment=release,sentry-release=5.1.2,sentry-public_key=e1bf914f3448d9bc8a10c7e499d17d54,sentry-trace_id=${trace.split("-")[0]},sentry-sampled=true`,
  };
}

async function winkBaseParams(extra = {}) {
  const { gnum } = await getWinkApi();
  return new URLSearchParams({
    client_id: WINK_CLIENT_ID, version: WINK_VERSION, country_code: WINK_COUNTRY_CODE,
    gnum, client_language: WINK_CLIENT_LANGUAGE, client_channel_id: "", client_timezone: WINK_CLIENT_TIMEZONE, ...extra,
  });
}

async function getMaatSign() {
  const { client: api } = await getWinkApi();
  const params = await winkBaseParams({ suffix: ".mp4", type: "temp", count: "1" });
  const res = await api.get(`/api/file/get_maat_sign.json?${params.toString()}`, { headers: traceHeaders() });
  if (res.status >= 400 || res.data?.code !== 0) throw new Error(`get_maat_sign gagal: ${JSON.stringify(res.data)}`);
  return res.data.data;
}

async function getUploadPolicy(sign) {
  const params = new URLSearchParams({
    app: sign.app, count: String(sign.count), sig: sign.sig, sigTime: sign.sig_time, sigVersion: sign.sig_version, suffix: sign.suffix, type: sign.type,
  });
  const res = await axios.get(`${STRATEGY_URL}/upload/policy?${params.toString()}`, {
    headers: { accept: "*/*", origin: WINK_BASE_URL, referer: `${WINK_BASE_URL}/`, "user-agent": WINK_UA },
    validateStatus: () => true,
  });
  if (res.status >= 400 || !Array.isArray(res.data) || !res.data[0]?.qiniu) throw new Error(`upload policy gagal: ${JSON.stringify(res.data)}`);
  return res.data[0].qiniu;
}

async function uploadToQiniu(policy, filePath) {
  const form = new FormData();
  form.append("file", fs.createReadStream(filePath), { filename: path.basename(filePath), contentType: extToMime(filePath) });
  form.append("token", policy.token);
  form.append("key", policy.key);
  form.append("fname", path.basename(filePath));

  const res = await axios.post(policy.url, form, {
    headers: form.getHeaders({ origin: WINK_BASE_URL, referer: `${WINK_BASE_URL}/`, "user-agent": WINK_UA, accept: "*/*" }),
    maxBodyLength: Infinity, maxContentLength: Infinity, validateStatus: () => true,
  });
  if (res.status >= 400) throw new Error(`upload qiniu gagal HTTP ${res.status}: ${JSON.stringify(res.data)}`);
  return { file_key: policy.key, source_url: res.data.url || res.data.data || policy.data, video_transcoded: res.data.data || policy.data };
}

async function getVideoInfo(fileKey) {
  const { client: api } = await getWinkApi();
  const body = await winkBaseParams({ file_key: fileKey });
  await api.post("/api/file/video_cover_and_display_info_ext.json", body.toString(), {
    headers: { ...traceHeaders(), "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
  });
}

async function startTranscode(fileKey) {
  const { client: api } = await getWinkApi();
  const body = await winkBaseParams({ file_key: fileKey });
  const res = await api.post("/api/file/video_trans_start.json", body.toString(), {
    headers: { ...traceHeaders(), "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
  });
  return res.data.data.id;
}

async function queryTranscode(id) {
  const { client: api } = await getWinkApi();
  const params = await winkBaseParams({ id });
  const res = await api.get(`/api/file/video_trans_query.json?${params.toString()}`, { headers: traceHeaders() });
  return res.data.data;
}

async function waitTranscode(id, fallbackSourceUrl, maxTry = 80, delayMs = 3000) {
  for (let i = 1; i <= maxTry; i++) {
    const data = await queryTranscode(id);
    const video = data?.video || data?.url || data?.source_url || "";
    const videoTranscoded = data?.video_transcoded || data?.transcoded_video || data?.transcoded_url || data?.video_url || "";
    if (videoTranscoded) return { source_url: video || fallbackSourceUrl, video_transcoded: videoTranscoded };
    await sleep(delayMs);
  }
  return { source_url: fallbackSourceUrl, video_transcoded: fallbackSourceUrl };
}

async function delivery(sourceUrl, videoTranscoded, taskName) {
  const { client: api } = await getWinkApi();
  const body = await winkBaseParams({
    type: WINK_TASK_TYPE, content_type: WINK_CONTENT_TYPE, source_url: sourceUrl,
    type_params: JSON.stringify({ is_mirror: 0, orientation_tag: 1, j_420_trans: "1", return_ext: "2" }),
    right_detail: JSON.stringify({ source: "1", touch_type: "4", function_id: "630", material_id: "63011", url: "https://wink.ai/video-enhancer/upload" }),
    ext_params: JSON.stringify({ task_name: taskName, records: WINK_TASK_TYPE, video_transcoded: videoTranscoded }),
    with_prepare: "1",
  });
  const res = await api.post("/api/meitu_ai/delivery.json", body.toString(), {
    headers: { ...traceHeaders(), "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
  });
  return res.data.data || {};
}

async function queryBatch(msgId) {
  const { client: api } = await getWinkApi();
  const params = await winkBaseParams({ msg_ids: msgId });
  const res = await api.get(`/api/meitu_ai/query_batch.json?${params.toString()}`, {
    headers: { ...traceHeaders(), referer: `${WINK_BASE_URL}/video-enhancer/upload` },
  });
  return res.data.data;
}

function extractResultUrl(data) {
  const item = data?.item_list?.[0];
  const media = item?.result?.media_info_list?.[0];
  return media?.media_data || item?.result?.result_url || item?.result?.url || item?.client_ext_params?.video_transcoded || "";
}

function extractNextMsgId(data, currentMsgId) {
  const item = data?.item_list?.[0];
  const resultValue = item?.result?.result || "";
  const realMsgId = item?.result?.msg_id || item?.msg_id || "";
  if (resultValue && resultValue !== currentMsgId && !resultValue.startsWith("http")) return resultValue;
  if (realMsgId && realMsgId !== currentMsgId && !realMsgId.startsWith("wpr_")) return realMsgId;
  return "";
}

async function waitResult(firstMsgId, maxTry = 120, delayMs = 5000) {
  let msgId = firstMsgId;
  for (let i = 1; i <= maxTry; i++) {
    const data = await queryBatch(msgId);
    const nextMsgId = extractNextMsgId(data, msgId);
    if (nextMsgId) { msgId = nextMsgId; await sleep(1000); continue; }
    const url = extractResultUrl(data);
    const errorCode = data?.item_list?.[0]?.result?.error_code;
    if (url && url.startsWith("http") && errorCode === 0) return url;
    await sleep(delayMs);
  }
  throw new Error("Timeout menunggu hasil video enhance Wink");
}

async function winkEnhance(video, { filename } = {}) {
  if (!video) throw new Error("video is required");
  const safeName = filename || `wink-${crypto.randomUUID()}.mp4`;
  const filePath = Buffer.isBuffer(video) ? path.join(os.tmpdir(), safeName) : video;
  const shouldCleanup = Buffer.isBuffer(video);
  if (shouldCleanup) await fsp.writeFile(filePath, video);

  try {
    const taskName = `Enhancer-Ultra HD-${path.parse(filePath).name}`;
    const sign = await getMaatSign();
    const policy = await getUploadPolicy(sign);
    const uploaded = await uploadToQiniu(policy, filePath);

    await getVideoInfo(uploaded.file_key);
    const transcodeId = await startTranscode(uploaded.file_key);
    const transcode = await waitTranscode(transcodeId, uploaded.source_url);

    const task = await delivery(transcode.source_url, transcode.video_transcoded, taskName);
    const firstMsgId = task.msg_id || task.prepare_msg_id;
    if (!firstMsgId) throw new Error("Delivery gagal mendapatkan msg_id");

    const resultUrl = await waitResult(firstMsgId);
    return { status: true, resultUrl };
  } finally {
    if (shouldCleanup) { try { await fsp.unlink(filePath); } catch {} }
  }
}


// ==========================================
// 4. AI CHAT MODULES (DeepAI & Rayleigh AI)
// ==========================================
class DeepAIChatScraper {
    constructor() {
        this.apiUrl = "https://api.deepai.org/hacking_is_a_serious_crime";
        this.defaultUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
        this.models = [
            "standard",
            "deepseek-v3.2",
            "gemini-2.5-flash-lite",
            "gemma-4",
            "llama-3.3-70b-instruct",
            "gpt-oss-120b",
            "gpt-5-nano"
        ];
    }

    getModels() {
        return this.models;
    }

    generateIslandKey(userAgent = this.defaultUserAgent) {
        let myrandomstr = Math.round((Math.random() * 100000000000)) + "";
        const myhashfunction = (function() {
            const a = [];
            for (let b = 0; 64 > b;)
                a[b] = 0 | 4294967296 * Math.sin(++b % Math.PI);
            return function(input) {
                let d, e, f, g = [d = 1732584193, e = 4023233417, ~d, ~e], h = [], l = unescape(encodeURI(input)) + "\u0080", k = l.length;
                let c = --k / 4 + 2 | 15;
                for (h[--c] = 8 * k; ~k;)
                    h[k >> 2] |= l.charCodeAt(k) << 8 * k--;
                for (let b = 0, l = 0; b < c; b += 16) {
                    for (k = g; 64 > l; k = [f = k[3], d + ((f = k[0] + [d & e | ~d & f, f & d | ~f & e, d ^ e ^ f, e ^ (d | ~f)][k = l >> 4] + a[l] + ~~h[b | [l, 5 * l + 1, 3 * l + 5, 7 * l][k] & 15]) << (k = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21][4 * k + l++ % 4]) | f >>> -k), d, e])
                        d = k[1] | 0, e = k[2];
                    for (l = 4; l;)
                        g[--l] += k[l];
                }
                let result = "";
                for (let l = 0; 32 > l;)
                    result += (g[l >> 3] >> 4 * (1 ^ l++) & 15).toString(16);
                return result.split("").reverse().join("");
            };
        })();
        const tryitApiKey = 'tryit-' + myrandomstr + '-' + myhashfunction(userAgent + myhashfunction(userAgent + myhashfunction(userAgent + myrandomstr + 'hackers_become_a_little_stinkier_every_time_they_hack')));
        return tryitApiKey;
    }

    async chat(messages, options = {}) {
        const model = options.model || 'standard';
        if (!this.models.includes(model)) {
            throw new Error(`Model '${model}' tidak valid atau tidak didukung.`);
        }

        const userAgent = options.userAgent || this.defaultUserAgent;
        const key = this.generateIslandKey(userAgent);
        const sessionUUID = options.sessionUUID || crypto.randomUUID();
        const sensitivityRequestID = options.sensitivityRequestID || crypto.randomUUID();

        const fd = new FormData();
        fd.append('chat_style', 'chat');
        fd.append('model', model);
        fd.append('session_uuid', sessionUUID);
        fd.append('sensitivity_request_id', sensitivityRequestID);
        fd.append('hacker_is_stinky', 'very_stinky');
        fd.append('enabled_tools', JSON.stringify(['image_generator', 'image_editor']));
        fd.append('chatHistory', JSON.stringify(messages));

        const res = await axios.post(this.apiUrl, fd, {
            method: "POST",
            headers: {
                "api-key": key,
                "user-agent": userAgent,
                "referer": "https://deepai.org/chat",
                "origin": "https://deepai.org"
            }
        });

        if (!res.status || res.status >= 400) {
            const errText = res.data ? JSON.stringify(res.data) : 'HTTP Error';
            throw new Error(errText);
        }

        return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    }
}

async function rayleighScrape(text) {
  const systemPrompt = `
Kamu adalah Rayleigh AI, asisten AI yang dibuat dan dikembangkan oleh ReyCloudShop.
IDENTITAS: Rayleigh AI | Developer: ReyCloudShop | Ekosistem: ReyCloud
PERAN: Membantu pengguna dalam programming, JavaScript, Node.js, HTML, CSS, Python, PHP, API, backend, frontend, database, MongoDB, MySQL, bot WhatsApp, bot Telegram, Baileys, Pterodactyl, VPS, Linux, Termux, hosting, deployment, GitHub, debugging, dll.
GAYA BICARA: Bahasa Indonesia, santai, ramah, natural, mudah dipahami, tidak bertele-tele.
`;

  try {
    const res = await axios.post(
      "https://tabitoken.com/v1/messages",
      {
        model: "claude-opus-5-thinking",
        system: systemPrompt,
        max_tokens: 8192,
        messages: [{ role: "user", content: text }]
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": "sk-gfdSPQt3496tsUQwBPYOnaIHyV5LeOlngMhUFrhyajHzruPe",
          "anthropic-version": "2023-06-01",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Origin": "https://tabitoken.com",
          "Referer": "https://tabitoken.com/"
        },
        timeout: 180000
      }
    );

    let reply = "";
    if (Array.isArray(res.data?.content)) {
      reply = res.data.content
        .filter(item => item?.type === "text")
        .map(item => item.text || "")
        .join("\n")
        .trim();
    } else if (typeof res.data?.text === "string") {
      reply = res.data.text.trim();
    } else if (typeof res.data?.response === "string") {
      reply = res.data.response.trim();
    }

    if (!reply) throw new Error("Server AI tidak mengembalikan teks jawaban.");
    return { status: true, data: reply };
    
  } catch (err) {
    const errorMessage = err.response?.data?.error?.message || err.response?.data?.message || err.message || "Terjadi kesalahan server.";
    return { status: false, error: errorMessage };
  }
}


// ==========================================
// 5. ZFILE REACT MODULES
// ==========================================
const ZFILE_BASE = 'https://react.zfile.web.id';
const ZFILE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function genSessionId() {
  const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'zx_';
  for (let i = 0; i < 16; i++) id += c[Math.floor(Math.random() * c.length)];
  return id;
}

function parseCookies(headers, cookiesObj) {
  const sc = headers['set-cookie'];
  if (!sc) return;
  const arr = Array.isArray(sc) ? sc : [sc];
  for (const c of arr) {
    const m = c.match(/^([^=]+)=([^;]+)/);
    if (m) cookiesObj[m[1]] = m[2];
  }
}

function cookieHeader(cookiesObj) {
  return Object.entries(cookiesObj).map(([k,v]) => `${k}=${v}`).join('; ');
}

function zfileReq(method, pathUrl, body, cookiesObj, extra = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathUrl);
    const hdrs = {
      'User-Agent': ZFILE_UA,
      'Accept': 'application/json',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
      'Origin': ZFILE_BASE,
      'Referer': ZFILE_BASE + '/',
      ...extra,
    };
    const ch = cookieHeader(cookiesObj);
    if (ch) hdrs['Cookie'] = ch;

    const opts = {
      method,
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      headers: hdrs,
    };

    const r = https.request(opts, (res) => {
      parseCookies(res.headers, cookiesObj);
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    r.on('error', reject);
    r.setTimeout(30000, () => { r.destroy(); reject(new Error('Timeout')); });
    if (body) r.write(typeof body === 'string' ? body : JSON.stringify(body));
    r.end();
  });
}

async function getZFileTicket(sid, cookiesObj) {
  const data = await zfileReq('GET', ZFILE_BASE + '/api/challenge', null, cookiesObj, {
    'X-Session-Id': sid,
  });
  if (!data.ok) throw new Error('Challenge gagal');
  return data;
}

async function sendZFileReact(url, reactions, ticket, sid, cookiesObj) {
  return zfileReq('POST', ZFILE_BASE + '/api/react', {
    url, reactions, ticket,
  }, cookiesObj, {
    'Content-Type': 'application/json',
    'X-ZX-Request': 'zx-reactch',
    'X-Session-Id': sid,
  });
}


// ==========================================
// 6. ADMIN VERIFICATION HELPER
// ==========================================
function verifyAdmin(req, res) {
    const body = req.method === 'GET' ? req.query : (req.body || {});
    const adminToken = req.headers['x-admin-token'] || body.admintoken;
    const ADMIN_SECRET = process.env.ADMIN_GENERATOR_PASSWORD || '';

    if (!adminToken || adminToken !== ADMIN_SECRET) {
        return {
            authorized: false,
            response: {
                status: false,
                creator: CREATOR,
                error: 'Akses ditolak! Token atau password admin tidak valid.'
            }
        };
    }
    return { authorized: true };
}


// ==========================================
// 7. EXPRESS ROUTER & API ENDPOINT MAPPING (/api/...)
// ==========================================
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-apikey, x-admin-token');
    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
});

// Servis folder statis frontend 'docs' dan root dashboard utama
app.use('/docs', express.static(path.join(__dirname, '../docs')));
app.use(express.static(path.join(__dirname, '../')));

// Home / Root Dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

app.get('/api/engine', (req, res) => {
    res.status(200).json({ status: true, creator: CREATOR, message: 'Alight Motion Ultimate Unified Master Engine Active in /api/' });
});

// --- AM Engine (/api/amgen) ---
app.all('/api/amgen', async (req, res) => {
    const body = req.method === 'GET' ? req.query : (req.body || {});
    const apiKeyInput = req.headers['x-apikey'] || body.apikey;

    if (!apiKeyInput) {
        return res.status(403).json({ status: false, creator: CREATOR, error: 'Akses ditolak! API Key tidak disertakan.' });
    }

    try {
        await connectDB();
        const keyData = await ApiKey.findOne({ apikey: apiKeyInput });

        if (!keyData) {
            return res.status(403).json({ status: false, creator: CREATOR, error: 'API Key tidak valid atau tidak terdaftar!' });
        }

        const now = new Date();
        if (keyData.status !== 'active' || now > new Date(keyData.expired_at)) {
            return res.status(403).json({ status: false, creator: CREATOR, error: 'API Key sudah kadaluarsa (expired) atau dinonaktifkan.' });
        }

        const requestedUser = body.username || body.user;
        const count = parseInt(body.count || body.jumlah || 1, 10);
        const maxCount = Math.min(Math.max(count, 1), 10);

        const results = [];
        for (let i = 0; i < maxCount; i++) {
            try {
                const acc = await processSingleAccount(requestedUser);
                results.push(acc);
            } catch (err) {
                results.push({ success: false, error: err.message });
            }
        }

        return res.status(200).json({
            status: true, creator: CREATOR, owner: keyData.owner,
            expired_at: keyData.expired_at, total_generated: maxCount, results: results
        });
    } catch (err) {
        return res.status(500).json({ status: false, creator: CREATOR, error: err.message });
    }
});

// --- Auth Manual Endpoints (/api/auth/...) ---
app.all('/api/auth/link', async (req, res) => {
    const email = req.method === 'POST' ? req.body?.email : req.query?.email;
    if (!email) return res.status(400).json({ status: false, error: 'Parameter email wajib disertakan!' });
    const result = await authLink(email);
    return res.status(result.ok ? 200 : 500).json(result);
});

app.all('/api/auth/verify', async (req, res) => {
    const body = req.method === 'POST' ? req.body : req.query;
    const { email, code: rawCode } = body || {};
    if (!email || !rawCode) return res.status(400).json({ status: false, error: 'Email dan code/link wajib disertakan!' });
    const result = await authVerify(email, rawCode);
    return res.status(result.ok ? 200 : 400).json(result);
});

app.all('/api/auth/pro', async (req, res) => {
    const idToken = req.method === 'POST' ? req.body?.idToken : req.query?.idToken;
    if (!idToken) return res.status(400).json({ status: false, error: 'Parameter idToken wajib disertakan!' });
    const result = await authPro(idToken);
    return res.status(result.ok ? 200 : 500).json(result);
});

app.all('/api/auth/refresh', async (req, res) => {
    const refreshToken = req.method === 'POST' ? req.body?.refreshToken : req.query?.refreshToken;
    if (!refreshToken) return res.status(400).json({ status: false, error: 'Parameter refreshToken wajib disertakan!' });
    const result = await authRefresh(refreshToken);
    return res.status(result.ok ? 200 : 500).json(result);
});

// --- Downloader & Tools Endpoints (/api/...) ---
app.all('/api/igdl', async (req, res) => {
    const targetUrl = req.method === 'POST' ? req.body?.url : req.query?.url;
    if (!targetUrl) return res.status(400).json({ status: false, error: 'URL Instagram wajib disertakan!' });
    return res.status(200).json(await igdl(targetUrl));
});

app.all('/api/tiktok', async (req, res) => {
    const targetUrl = req.method === 'POST' ? req.body?.url : req.query?.url;
    if (!targetUrl) return res.status(400).json({ status: false, error: 'URL TikTok wajib disertakan!' });
    return res.status(200).json(await ttdl(targetUrl));
});

app.all('/api/removebg', async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ status: false, error: 'Gunakan metode POST' });
    const { base64Image } = req.body || {};
    if (!base64Image) return res.status(400).json({ status: false, error: 'Parameter base64Image wajib!' });
    const buf = Buffer.from(base64Image.replace(/^data:image\/\w+;base64,/, ''), 'base64');
    const resBuf = await pixa(buf);
    return res.status(200).json({ status: true, creator: CREATOR, result: `data:image/png;base64,${resBuf.toString('base64')}` });
});

app.all('/api/upscale', async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ status: false, error: 'Gunakan metode POST' });
    const { imageUrl, base64Image, filename } = req.body || {};
    let inputData = imageUrl || base64Image;
    if (!inputData) return res.status(400).json({ status: false, error: 'imageUrl atau base64Image wajib!' });
    if (typeof inputData === 'string' && inputData.startsWith('data:image')) {
        inputData = Buffer.from(inputData.split(';base64,').pop(), 'base64');
    }
    return res.status(200).json(await upscaleImage(inputData, filename || 'upload.jpg'));
});

app.all('/api/wink', async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ status: false, error: 'Gunakan metode POST' });
    try {
        const { videoUrl, base64Video, filename } = req.body || {};
        let targetVideo = videoUrl || base64Video;
        if (!targetVideo) return res.status(400).json({ status: false, error: 'videoUrl atau base64Video wajib disertakan!' });

        if (typeof targetVideo === 'string' && targetVideo.startsWith('data:video')) {
            targetVideo = Buffer.from(targetVideo.split(';base64,').pop(), 'base64');
        } else if (typeof targetVideo === 'string' && targetVideo.startsWith('http')) {
            const response = await axios.get(targetVideo, { responseType: 'arraybuffer' });
            targetVideo = Buffer.from(response.data);
        }

        const result = await winkEnhance(targetVideo, { filename: filename || 'enhance.mp4' });
        return res.status(200).json(result);
    } catch (err) {
        return res.status(500).json({ status: false, error: err.message });
    }
});

// --- AI Chat Endpoint (/api/chat) ---
app.all('/api/chat', async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ status: false, error: 'Method not allowed' });
    }

    const { prompt, engine = 'rayleigh', model = 'standard', history = [] } = req.body || {};

    if (!prompt && history.length === 0) {
        return res.status(400).json({ status: false, error: 'Prompt pesan wajib disertakan!' });
    }

    try {
        if (engine === 'deepai') {
            const deepAi = new DeepAIChatScraper();
            const messages = history.length > 0 ? history : [{ role: 'user', content: prompt }];
            const answer = await deepAi.chat(messages, { model });
            return res.status(200).json({ status: true, engine: 'deepai', model, result: answer });
        } else {
            const result = await rayleighScrape(prompt || history[history.length - 1]?.content || "");
            return res.status(200).json({ status: true, engine: 'rayleigh', result: result.data || result.error });
        }
    } catch (err) {
        return res.status(500).json({ status: false, error: err.message });
    }
});

// --- QRIS Generator Tool Endpoint (/api/tools/qris) ---
app.all('/api/qris', async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ status: false, creator: CREATOR, error: 'Method not allowed' });
    }

    try {
        const amount = "5000";
        const imagePath = path.join(__dirname, '../lib/qris.png');

        if (!fs.existsSync(imagePath)) {
            return res.status(404).json({ 
                status: false, 
                creator: CREATOR, 
                error: "File qris.png tidak ditemukan di dalam folder lib!" 
            });
        }

        const form = new FormData();
        form.append('amount', amount);
        form.append('image', fs.createReadStream(imagePath));

        const response = await axios.post('https://api.theresav.eu/api/tools/qris', form, {
            headers: {
                ...form.getHeaders(),
                'x-apikey': 'DNcBJ'
            }
        });

        return res.status(200).json(response.data);

    } catch (err) {
        const errorMsg = err.response?.data ? (typeof err.response.data === 'object' ? JSON.stringify(err.response.data) : err.response.data) : err.message;
        return res.status(500).json({ 
            status: false, 
            creator: CREATOR, 
            error: errorMsg 
        });
    }
});

// --- ZFile React Automation Endpoint (/api/zfile/react) ---
app.all('/api/react', async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ status: false, error: 'Method not allowed, use POST' });
    }

    const { url, emojis, count } = req.body || {};

    if (!url || !emojis) {
        return res.status(400).json({ status: false, error: 'Parameter url dan emojis wajib diisi!' });
    }

    const emojiArray = Array.isArray(emojis) ? emojis : emojis.split(',').map(e => e.trim());
    const totalCount = parseInt(count) || 1;

    let ok = 0, fail = 0;
    const results = [];

    for (let i = 1; i <= totalCount; i++) {
        const sid = genSessionId();
        const cookiesObj = {};
        try {
            const challenge = await getZFileTicket(sid, cookiesObj);
            const ticket = challenge.ticket;
            const delay = Math.max(2500, challenge.minAgeMs || 2500);
            await sleep(delay);

            const resReact = await sendZFileReact(url, emojiArray, ticket, sid, cookiesObj);

            results.push({
                index: i,
                success: resReact.success || false,
                message: resReact.message || 'Unknown',
            });

            if (resReact.success) ok++;
            else fail++;
        } catch (e) {
            results.push({ index: i, success: false, message: e.message });
            fail++;
        }
        if (i < totalCount) await sleep(1000);
    }

    return res.status(200).json({
        status: ok > 0,
        creator: CREATOR,
        target: url,
        emojis: emojiArray,
        total: totalCount,
        success: ok,
        failed: fail,
        results: results,
    });
});

// --- ADMIN API KEY MANAGEMENT ENDPOINTS (/api/admin/... & /api/apikey/...) ---

// 1. Endpoint Generate Admin Unlimited Key (/api/admin/create-key)
app.all('/api/admin/create-key', async (req, res) => {
    const auth = verifyAdmin(req, res);
    if (!auth.authorized) {
        return res.status(403).json(auth.response);
    }

    const body = req.method === 'GET' ? req.query : (req.body || {});

    try {
        await connectDB();

        const ownerName = body.name || body.username || 'Admin Master';
        const durationDays = 36500; // 100 Tahun (Unlimited)
        const randomSixDigits = crypto.randomInt(100000, 999999);
        const newApiKey = `reycoder_${randomSixDigits}`;

        const issuedAt = new Date();
        const expiredAt = new Date();
        expiredAt.setDate(issuedAt.getDate() + durationDays);

        const newKeyDoc = new ApiKey({
            apikey: newApiKey,
            owner: ownerName,
            package: 'Unlimited Master Admin Key',
            duration_days: durationDays,
            created_at: issuedAt,
            expired_at: expiredAt,
            status: 'active'
        });

        await newKeyDoc.save();

        return res.status(200).json({
            status: true,
            creator: CREATOR,
            message: 'API Key Admin Unlimited berhasil dibuat dan disimpan ke MongoDB!',
            data: {
                apikey: newApiKey,
                owner: ownerName,
                package: 'Unlimited Master Admin Key',
                duration_days: 'Unlimited (100 Tahun)',
                created_at: issuedAt,
                expired_at: expiredAt
            }
        });
    } catch (err) {
        return res.status(500).json({ status: false, creator: CREATOR, error: err.message });
    }
});

// 2. Endpoint List All API Keys (/api/admin/list-keys)
app.all('/api/admin/list-keys', async (req, res) => {
    const auth = verifyAdmin(req, res);
    if (!auth.authorized) {
        return res.status(403).json(auth.response);
    }

    try {
        await connectDB();
        const keys = await ApiKey.find({}).sort({ created_at: -1 });
        const now = new Date();

        const formattedKeys = keys.map(k => {
            const expiredDate = new Date(k.expired_at);
            const diffTime = expiredDate - now;
            let remainingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            let statusText = 'active';
            if (k.duration_days >= 30000) {
                remainingDays = 'Unlimited';
            } else if (remainingDays <= 0) {
                remainingDays = 'Expired';
                statusText = 'expired';
            }

            return {
                id: k._id,
                apikey: k.apikey,
                owner: k.owner,
                package: k.package,
                created_at: k.created_at,
                expired_at: k.expired_at,
                remaining_days: remainingDays,
                status: statusText
            };
        });

        return res.status(200).json({
            status: true,
            creator: CREATOR,
            total: formattedKeys.length,
            keys: formattedKeys
        });
    } catch (err) {
        return res.status(500).json({ status: false, creator: CREATOR, error: err.message });
    }
});

// 3. Endpoint Check API Key Status (/api/apikey/check)
app.all('/api/apikey/check', async (req, res) => {
    const body = req.method === 'GET' ? req.query : (req.body || {});
    const inputKey = req.headers['x-apikey'] || body.apikey;

    if (!inputKey) {
        return res.status(400).json({
            status: false,
            creator: CREATOR,
            error: 'Silakan masukkan API Key Anda terlebih dahulu.'
        });
    }

    try {
        await connectDB();
        const keyData = await ApiKey.findOne({ apikey: inputKey });

        if (!keyData) {
            return res.status(404).json({
                status: false,
                creator: CREATOR,
                error: 'API Key tidak ditemukan atau tidak terdaftar!'
            });
        }

        const now = new Date();
        const expiredDate = new Date(keyData.expired_at);
        const diffTime = expiredDate - now;
        let remainingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        let statusText = 'active';
        if (keyData.duration_days >= 30000) {
            remainingDays = 'Unlimited';
        } else if (remainingDays <= 0) {
            remainingDays = 'Expired';
            statusText = 'expired';
        }

        return res.status(200).json({
            status: true,
            creator: CREATOR,
            data: {
                apikey: keyData.apikey,
                owner: keyData.owner,
                package: keyData.package,
                created_at: keyData.created_at,
                expired_at: keyData.expired_at,
                remaining_days: remainingDays,
                status: statusText
            }
        });
    } catch (err) {
        return res.status(500).json({
            status: false,
            creator: CREATOR,
            error: err.message
        });
    }
});

// Fallback 404
app.use((req, res) => {
    res.status(404).json({ status: false, error: 'Endpoint API tidak ditemukan' });
});

module.exports = app;
