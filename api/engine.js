/**
 * Name: Alight Motion Master Engine (The Ultimate Unified Edition)
 * Description: Seluruh endpoint API dipetakan secara bersih menggunakan prefix /api/ 
 *              lengkap dengan handler auto-activation, bulk, generator key admin/user, serta NanoBanana AI Image Editor.
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
// 3. DOWNLOADERS & TOOLS
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
    const app_id = 100067;
    const secret = '2ee44819e9b4598845141067b281621874d0d5d7af9d8f7e00c1e54715b7d1e3';
    const host = 'https://100067.connect.garena.com';
    const ua = 'GarenaMSDK/4.0.42(NEO G12 ;Android 17;in;ID;app 1.130.1 2019121040;)';

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

// ==========================================
// 4. ADMIN & USER VERIFICATION HELPERS
// ==========================================
function verifyAdmin(req) {
    const body = req.method === 'GET' ? req.query : (req.body || {});
    const adminToken = req.headers['x-admin-token'] || body.admintoken;
    const ADMIN_SECRET = process.env.ADMIN_GENERATOR_PASSWORD || '';
    if (!adminToken || adminToken !== ADMIN_SECRET) {
        return { authorized: false, response: { status: false, creator: CREATOR, error: 'Akses ditolak! Token atau password admin tidak valid.' } };
    }
    return { authorized: true };
}


// ==========================================
// 5. EXPRESS ROUTER & API ENDPOINT MAPPING
// ==========================================
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-apikey, x-admin-token');
    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
});

app.use('/docs', express.static(path.join(__dirname, '../docs')));
app.use(express.static(path.join(__dirname, '../')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

app.get('/api/engine', (req, res) => {
    res.status(200).json({ status: true, creator: CREATOR, message: 'Alight Motion Ultimate Unified Master Engine Active in /api/' });
});

// --- AM Engine ---
app.all('/api/amgen', async (req, res) => {
    const body = req.method === 'GET' ? req.query : (req.body || {});
    const apiKeyInput = req.headers['x-apikey'] || body.apikey;

    if (!apiKeyInput) return res.status(403).json({ status: false, creator: CREATOR, error: 'Akses ditolak! API Key tidak disertakan.' });

    try {
        await connectDB();
        const keyData = await ApiKey.findOne({ apikey: apiKeyInput });

        if (!keyData || keyData.status !== 'active' || new Date() > new Date(keyData.expired_at)) {
            return res.status(403).json({ status: false, creator: CREATOR, error: 'API Key tidak valid atau sudah kadaluarsa.' });
        }

        const requestedUser = body.username || body.user;
        const count = parseInt(body.count || body.jumlah || 1, 10);
        const maxCount = Math.min(Math.max(count, 1), 10);

        const results = [];
        for (let i = 0; i < maxCount; i++) {
            try {
                results.push(await processSingleAccount(requestedUser));
            } catch (err) {
                results.push({ success: false, error: err.message });
            }
        }

        return res.status(200).json({
            status: true, creator: CREATOR, owner: keyData.owner,
            expired_at: keyData.expired_at, total_generated: maxCount, results
        });
    } catch (err) {
        return res.status(500).json({ status: false, creator: CREATOR, error: err.message });
    }
});

app.all('/api/amgen_auto', async (req, res) => {
    const body = req.method === 'GET' ? req.query : (req.body || {});
    try {
        const acc = await processSingleAccount(body.username || body.user);
        return res.status(200).json({
            status: true, creator: CREATOR,
            card: {
                email: acc.email, weblogin: acc.weblogin,
                selamat_kamu_mendapatkan_animal: acc.animal,
                orderId: acc.orderId, validUntil: acc.validUntil,
                panduan_dan_cara_login: ["1. Buka aplikasi Alight Motion.", "2. Sign in dengan email: " + acc.email]
            }
        });
    } catch (err) {
        return res.status(500).json({ status: false, creator: CREATOR, error: err.message });
    }
});

app.all('/api/bulk-am', async (req, res) => {
    req.url = '/api/amgen';
    return app._router.handle(req, res);
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
        const maxCount = Math.min(Math.max(count, 1), 5); // Batasi maksimal 5 akun per request agar tidak timeout

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

app.all('/api/qris', async (req, res) => {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    try {
        const imagePath = path.join(__dirname, '../lib/qris.png');
        if (!fs.existsSync(imagePath)) return res.status(404).json({ status: false, error: "File qris.png tidak ditemukan!" });

        const form = new FormData();
        form.append('amount', '5000');
        form.append('image', fs.createReadStream(imagePath));

        const response = await axios.post('https://api.theresav.eu/api/tools/qris', form, {
            headers: { ...form.getHeaders(), 'x-apikey': 'DNcBJ' }
        });
        return res.status(200).json(response.data);
    } catch (err) {
        return res.status(500).json({ status: false, error: err.message });
    }
});


// ==========================================
// 6. API KEY CREATOR (ADMIN & USER TYPES)
// ==========================================
app.all('/api/admin/create-key', async (req, res) => {
    const auth = verifyAdmin(req, res);
    if (!auth.authorized) {
        return res.status(403).json(auth.response);
    }

    const body = req.method === 'GET' ? req.query : (req.body || {});

    try {
        await connectDB();

        const ownerName = body.name || body.username || 'Client User';
        const keyType = body.type || 'user';

        let durationDays = 30;
        let packageName = 'Bulk Alight Motion Pro (User)';

        if (keyType === 'admin') {
            durationDays = 36500;
            packageName = 'Unlimited Master Admin Key';
        }

        const randomSixDigits = crypto.randomInt(100000, 999999);
        const newApiKey = `reycoder_${randomSixDigits}`;

        const issuedAt = new Date();
        const expiredAt = new Date();
        expiredAt.setDate(issuedAt.getDate() + durationDays);

        const newKeyDoc = new ApiKey({
            apikey: newApiKey,
            owner: ownerName,
            package: packageName,
            duration_days: durationDays,
            created_at: issuedAt,
            expired_at: expiredAt,
            status: 'active'
        });

        await newKeyDoc.save();

        return res.status(200).json({
            status: true,
            creator: CREATOR,
            message: `API Key ${keyType.toUpperCase()} berhasil dibuat dan disimpan ke MongoDB!`,
            data: {
                apikey: newApiKey,
                owner: ownerName,
                type: keyType,
                package: packageName,
                duration_days: keyType === 'admin' ? 'Unlimited (100 Tahun)' : `${durationDays} Hari`,
                created_at: issuedAt,
                expired_at: expiredAt
            }
        });
    } catch (err) {
        return res.status(500).json({ status: false, creator: CREATOR, error: err.message });
    }
});

app.all('/api/admin/list-keys', async (req, res) => {
    const auth = verifyAdmin(req);
    if (!auth.authorized) return res.status(403).json(auth.response);

    try {
        await connectDB();
        const keys = await ApiKey.find({}).sort({ created_at: -1 });
        const now = new Date();

        const formattedKeys = keys.map(k => {
            const diffTime = new Date(k.expired_at) - now;
            let remainingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            let statusText = 'active';
            if (k.duration_days >= 30000) remainingDays = 'Unlimited';
            else if (remainingDays <= 0) { remainingDays = 'Expired'; statusText = 'expired'; }

            return {
                id: k._id, apikey: k.apikey, owner: k.owner, package: k.package,
                created_at: k.created_at, expired_at: k.expired_at, remaining_days: remainingDays, status: statusText
            };
        });

        return res.status(200).json({ status: true, creator: CREATOR, total: formattedKeys.length, keys: formattedKeys });
    } catch (err) {
        return res.status(500).json({ status: false, creator: CREATOR, error: err.message });
    }
});

app.all('/api/apikey/check', async (req, res) => {
    const body = req.method === 'GET' ? req.query : (req.body || {});
    const inputKey = req.headers['x-apikey'] || body.apikey;

    if (!inputKey) return res.status(400).json({ status: false, creator: CREATOR, error: 'Silakan masukkan API Key Anda.' });

    try {
        await connectDB();
        const keyData = await ApiKey.findOne({ apikey: inputKey });
        if (!keyData) return res.status(404).json({ status: false, creator: CREATOR, error: 'API Key tidak ditemukan!' });

        const now = new Date();
        const diffTime = new Date(keyData.expired_at) - now;
        let remainingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        let statusText = 'active';
        if (keyData.duration_days >= 30000) remainingDays = 'Unlimited';
        else if (remainingDays <= 0) { remainingDays = 'Expired'; statusText = 'expired'; }

        return res.status(200).json({
            status: true, creator: CREATOR,
            data: {
                apikey: keyData.apikey, owner: keyData.owner, package: keyData.package,
                created_at: keyData.created_at, expired_at: keyData.expired_at,
                remaining_days: remainingDays, status: statusText
            }
        });
    } catch (err) {
        return res.status(500).json({ status: false, creator: CREATOR, error: err.message });
    }
});

// Fallback 404
app.use((req, res) => {
    res.status(404).json({ status: false, error: 'Endpoint API tidak ditemukan' });
});

module.exports = app;
