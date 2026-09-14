// ==========================================
// API ROUTER: /api/alightmotion.js
// Lengkap dengan Auto, Bulk, dan Manual
// ==========================================
const http = require('node:http')
const https = require('node:https')
const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const mongoose = require('mongoose')

const CREATOR = 'ReyCode'
const DOMAIN = 'akunlama.com'
const PROVIDER_BASE_URL = 'https://akunlama.com/api'

const AM_KEY = process.env.AM_KEY || ''
const IDT = process.env.IDT || ''
const VFY = process.env.VFY || ''

const REQUEST_TIMEOUT = 15000
const MAX_REDIRECTS = 5

const ADJECTIVES = [
    'happy', 'sleepy', 'clever', 'swift', 'brave', 'calm', 'wild', 'gentle', 'lucky', 'proud', 
    'cozy', 'fuzzy', 'fierce', 'bold', 'bright', 'dark', 'epic', 'fast', 'grand', 'hidden', 
    'iron', 'jade', 'keen', 'lunar', 'mega', 'nitro', 'neon', 'quiet', 'royal', 'silent', 
    'solar', 'stellar', 'toxic', 'ultra', 'vivid', 'winter', 'xenon', 'yellow', 'zeal'
]

const ANIMALS = [
    'kitten', 'cat', 'tiger', 'lion', 'panther', 'cheetah', 'lynx', 'puma', 'jaguar', 'leopard', 
    'wolf', 'fox', 'bear', 'hawk', 'eagle', 'falcon', 'raven', 'viper', 'python', 'dragon', 
    'shark', 'whale', 'cobra', 'badger', 'bison', 'condor', 'coyote', 'dingo', 'dragonfly', 
    'ferret', 'griffin', 'hornet', 'kraken', 'mammoth', 'matrix', 'phoenix'
]

const apiKeySchema = new mongoose.Schema({
    apikey: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    owner: { type: String, required: true },
    name: { type: String, required: true },
    status: { type: String, default: 'active' },
    package: { type: String, default: 'default' },
    expired_at: { type: Date, required: true }
});

const ApiKey = mongoose.models.ApiKey || mongoose.model('ApiKey', apiKeySchema);

const dip = () => `${crypto.randomInt(1, 255)}.${crypto.randomInt(0, 255)}.${crypto.randomInt(0, 255)}.${crypto.randomInt(1, 255)}`

const sp = h => ({
    ...h,
    'x-forwarded-for': dip(),
    'x-real-ip': dip(),
    'client-ip': dip(),
    'x-client-ip': dip(),
    'x-originating-ip': dip(),
    'x-cluster-client-ip': dip()
})

const h1 = {
    'content-type': 'application/json',
    'x-android-package': 'com.alightcreative.motion',
    'x-android-cert': 'ECA6BF91B8715A6F810ED0BBFC65B6CD578F52A8',
    'user-agent': 'dalvik/2.1.0 (linux; u; android 15; 23127pn0cc build/bp1a.250505.005)'
}

const h2 = {
    'content-type': 'application/json; charset=utf-8',
    'user-agent': 'okhttp/3.12.1',
    'accept-encoding': 'gzip'
}

function request(url, options = {}, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        let parsed
        try {
            parsed = new URL(url)
        } catch {
            return reject(new Error('URL tidak valid.'))
        }

        const client = parsed.protocol === 'https:' ? https : http
        const headers = {
            Accept: '*/*',
            'User-Agent': 'Mozilla/5.0',
            ...(options.headers || {})
        }

        const req = client.request(
            parsed,
            {
                method: options.method || 'GET',
                headers,
                timeout: options.timeout || REQUEST_TIMEOUT
            },
            res => {
                const chunks = []
                res.on('data', chunk => chunks.push(chunk))
                res.on('end', async () => {
                    const body = Buffer.concat(chunks).toString('utf8')
                    const statusCode = res.statusCode || 0
                    const location = res.headers.location

                    if (location && statusCode >= 300 && statusCode < 400) {
                        if (redirectCount >= MAX_REDIRECTS) {
                            return reject(new Error('Terlalu banyak redirect.'))
                        }
                        try {
                            const redirectUrl = new URL(location, parsed).toString()
                            const result = await request(redirectUrl, options, redirectCount + 1)
                            return resolve(result)
                        } catch (error) {
                            return reject(error)
                        }
                    }

                    resolve({ statusCode, headers: res.headers, body, url: parsed.toString() })
                })
            }
        )

        req.on('timeout', () => {
            req.destroy(new Error('Request ke provider timeout.'))
        })

        req.on('error', error => {
            reject(error)
        })

        if (options.body) {
            req.write(options.body)
        }
        req.end()
    })
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeUsername(input) {
    let value = String(input || '').trim()
    value = value.replace(new RegExp(`@${escapeRegExp(DOMAIN)}$`, 'i'), '')
    return value.trim()
}

function getEmail(username) {
    const clean = normalizeUsername(username)
    if (!clean) return ''
    return `${clean}@${DOMAIN}`
}

function decodeHtml(value) {
    return String(value || '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
}

function stripHtml(value) {
    return decodeHtml(
        String(value || '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n')
            .replace(/<\/div>/gi, '\n')
            .replace(/<[^>]*>/g, '')
    ).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function extractLinks(html) {
    const result = []
    const regex = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
    let match
    while ((match = regex.exec(String(html || '')))) {
        result.push({
            href: decodeHtml(match[1]),
            text: stripHtml(match[2])
        })
    }
    return result
}

function code(raw) {
    if (!raw) return null
    let s = String(raw).replace(/&amp;/g, '&')
    try { s = decodeURIComponent(s) } catch {}
    try {
        const u = new URL(s)
        let c = u.searchParams.get('oobCode')
        if (!c) {
            const n = u.searchParams.get('link') || u.searchParams.get('q') || u.searchParams.get('url')
            if (n) { try { c = new URL(n).searchParams.get('oobCode') } catch {} }
        }
        if (c) return c.replace(/[^a-zA-Z0-9_-]/g, '')
    } catch {}
    const m = s.match(/oobCode=([a-zA-Z0-9_-]+)/i)
    if (m) return m[1]
    const t = raw.trim()
    if (/^[a-zA-Z0-9_-]{10,}$/.test(t) && !t.includes('://')) return t
    return null
}

async function listInbox(username) {
    const recipient = normalizeUsername(username)
    const reqUrl = `${PROVIDER_BASE_URL}/list?recipient=${encodeURIComponent(recipient)}`
    const res = await request(reqUrl, { timeout: REQUEST_TIMEOUT, headers: { Accept: 'application/json' } })
    if (res.statusCode < 200 || res.statusCode >= 300) return []
    try {
        const data = JSON.parse(res.body)
        return Array.isArray(data) ? data : []
    } catch {
        return []
    }
}

async function getEmailDetail(region, key) {
    const metaUrl = `${PROVIDER_BASE_URL}/getKey?region=${encodeURIComponent(region)}&key=${encodeURIComponent(key)}`
    const htmlUrl = `${PROVIDER_BASE_URL}/getHtml?region=${encodeURIComponent(region)}&key=${encodeURIComponent(key)}`
    const [metaRes, htmlRes] = await Promise.all([
        request(metaUrl, { timeout: REQUEST_TIMEOUT }),
        request(htmlUrl, { timeout: REQUEST_TIMEOUT })
    ])
    const rawHtml = htmlRes.body || ''
    return { html: rawHtml, links: extractLinks(rawHtml) }
}

async function waitForVerificationLink(username, timeoutSec = 90) {
    const clean = normalizeUsername(username)
    const startTime = Date.now()
    while (Date.now() - startTime < timeoutSec * 1000) {
        try {
            const messages = await listInbox(clean)
            if (messages.length > 0) {
                const latest = messages[0]
                const storage = latest.storage || {}
                const region = storage.region || 'us'
                const key = storage.key || latest.id
                if (key) {
                    const detail = await getEmailDetail(region, key)
                    const targetLink = detail.links.find(l => l.href.includes('firebaseapp.com') || l.href.includes('google.com') || l.href.includes('oobCode'))
                    if (targetLink) return targetLink.href
                }
            }
        } catch (_) {}
        await new Promise(resolve => setTimeout(resolve, 3500))
    }
    return null
}

function generateRandomName() {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
    const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)]
    const num = Math.floor(Math.random() * 90) + 10
    return { username: `${adj}-${animal}-${num}`, animalName: `${adj} ${animal}` }
}

// Fungsi Mengirim Link OOB (Manual step 1)
async function sendLink(email) {
    const cleanEmail = getEmail(email)
    const oobRes = await request(`${IDT}/getOobConfirmationCode?key=${AM_KEY}`, {
        method: 'POST',
        timeout: REQUEST_TIMEOUT,
        headers: sp(h1),
        body: JSON.stringify({
            requestType: 6,
            email: cleanEmail,
            androidInstallApp: true,
            canHandleCodeInApp: true,
            continueUrl: 'https://alightcreative.com?ui_sid=0366624874&ui_sd=0',
            iosBundleId: 'com.alightcreative.motion',
            androidPackageName: 'com.alightcreative.motion',
            androidMinimumVersion: '585',
            clientType: 'CLIENT_TYPE_ANDROID'
        })
    })

    if (oobRes.statusCode < 200 || oobRes.statusCode >= 300) {
        throw new Error('Gagal mengirim oobCode: ' + oobRes.body)
    }
    return { ok: true, email: cleanEmail }
}

// Fungsi Verifikasi Link & Aktivasi Pro (Manual step 2)
async function verifyAndActivate(email, rawLink) {
    const cleanEmail = getEmail(email)
    const c = code(rawLink)
    if (!c) throw new Error('OobCode / Magic Link tidak valid!')

    const signRes = await request(`${IDT}/emailLinkSignin?key=${AM_KEY}`, {
        method: 'POST',
        timeout: REQUEST_TIMEOUT,
        headers: sp(h1),
        body: JSON.stringify({
            email: cleanEmail,
            oobCode: c,
            clientType: 'CLIENT_TYPE_ANDROID'
        })
    })

    if (signRes.statusCode < 200 || signRes.statusCode >= 300) {
        throw new Error('Gagal sign-in Firebase: ' + signRes.body)
    }

    let signData
    try {
        signData = JSON.parse(signRes.body)
    } catch {
        throw new Error('Response sign-in Firebase tidak valid.')
    }

    const idToken = signData.idToken
    const localId = signData.localId
    const refreshToken = signData.refreshToken

    const orderId = 'reycode-' + crypto.randomBytes(6).toString('hex')
    const proRes = await request(VFY, {
        method: 'POST',
        timeout: REQUEST_TIMEOUT,
        headers: sp({
            ...h2,
            authorization: 'Bearer ' + idToken,
            'firebase-instance-id-token': 'cSDnCyp3T-uwp07z3tL86T:APA91bFkmvvsHw5nnqa1SBFci-99DRsKClLiETdRrVcJjS5yBx1v_FbCb1d8WhBuea_zmwnYBktyTIzcRhN4b6uNOUur9wPc0gKXmJDoZic0LhNq5V2s0xI'
        }),
        body: JSON.stringify({
            data: {
                productId: 'am.full.sub.annual.19q4',
                token: 'mmgaobamlahbbeccfplmbkbb.AO-J1OzqG0or_GJJIx-ms8GrTm-jaglCRfhQSRPUZKpl2YspYS-oN7_94uv8RC5vQbvd_Ios2pPDStZ2n7F0hLE3FiOU7HS3R6Fquulv5xLXFECSv4ctElw',
                skuType: 'subs',
                orderId: orderId
            }
        })
    })

    if (proRes.statusCode < 200 || proRes.statusCode >= 300) {
        throw new Error('Gagal aktivasi Pro: ' + proRes.body)
    }

    return {
        success: true,
        email: cleanEmail,
        uid: localId,
        orderId: orderId,
        idToken,
        refreshToken
    }
}

async function processSingleAccount(customUsername = null) {
    let username, animalName = 'Custom User Input'
    if (customUsername) {
        username = normalizeUsername(customUsername)
    } else {
        const generated = generateRandomName()
        username = generated.username
        animalName = generated.animalName
    }
    const tempEmail = getEmail(username)

    await sendLink(tempEmail)
    const verificationLink = await waitForVerificationLink(username, 90)
    if (!verificationLink) throw new Error('Magic link tidak tertangkap dalam 90 detik.')

    const resAct = await verifyAndActivate(tempEmail, verificationLink)

    const expiryDate = new Date()
    expiryDate.setFullYear(expiryDate.getFullYear() + 1)
    const dynamicValidUntil = expiryDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()

    return {
        success: true,
        email: tempEmail,
        weblogin: `https://${DOMAIN}`,
        animal: animalName,
        uid: resAct.uid,
        orderId: resAct.orderId,
        validUntil: dynamicValidUntil,
        idToken: resAct.idToken,
        refreshToken: resAct.refreshToken
    }
}

function getQuery(req) {
    if (req && req.query) return req.query
    const url = req && req.url ? new URL(req.url, 'http://localhost') : null
    return url ? Object.fromEntries(url.searchParams.entries()) : {}
}

async function handler(req, res) {
    const query = getQuery(req)
    const action = String(query.action || '').toLowerCase()

    try {
        if (action === 'auto') {
            const data = await processSingleAccount(query.username || query.mailbox || query.user)
            return res.status(200).json({
                status: true,
                creator: CREATOR,
                provider: DOMAIN,
                card: {
                    email: data.email,
                    weblogin: data.weblogin,
                    selamat_kamu_mendapatkan_animal: data.animal,
                    orderId: data.orderId,
                    validUntil: data.validUntil,
                    panduan_dan_cara_login: [
                        '1. Buka aplikasi Alight Motion.',
                        '2. Sign in dengan email: ' + data.email
                    ]
                }
            })
        }

        if (action === 'bulk') {
            const apiKeyInput = req.headers['x-apikey'] || query.apikey || ''
            const passwordInput = req.headers['x-api-password'] || query.password || query.pass || ''
            const username = query.username || query.user || ''

            if (mongoose.connection.readyState !== 1) {
                await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/reycloud')
            }

            if (!apiKeyInput) {
                return res.status(403).json({ status: false, creator: CREATOR, error: 'Akses ditolak! API Key wajib diisi.' })
            }
            if (!passwordInput) {
                return res.status(403).json({ status: false, creator: CREATOR, error: 'Akses ditolak! Password API Key wajib diisi.' })
            }

            const keyData = await ApiKey.findOne({ apikey: apiKeyInput })
            if (!keyData) {
                return res.status(403).json({ status: false, creator: CREATOR, error: 'API Key tidak ditemukan.' })
            }
            if (keyData.status !== 'active') {
                return res.status(403).json({ status: false, creator: CREATOR, error: 'API Key tidak aktif.' })
            }
            if (!keyData.expired_at || new Date() > new Date(keyData.expired_at)) {
                return res.status(403).json({ status: false, creator: CREATOR, error: 'API Key sudah kadaluarsa.' })
            }

            const passwordValid = await bcrypt.compare(passwordInput, keyData.password)
            if (!passwordValid) {
                return res.status(403).json({ status: false, creator: CREATOR, error: 'Password API Key salah.' })
            }

            const count = parseInt(query.count || query.jumlah || 1, 10)
            const maxCount = Math.min(Math.max(Number.isNaN(count) ? 1 : count, 1), 10)
            const generateUsername = username || keyData.name || keyData.owner

            const results = []
            for (let i = 0; i < maxCount; i++) {
                try {
                    results.push(await processSingleAccount(generateUsername))
                    if (i < maxCount - 1) {
                        await new Promise(r => setTimeout(r, 2000))
                    }
                } catch (err) {
                    results.push({ success: false, error: err.message })
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
            })
        }

        if (action === 'send-link') {
            const email = query.email || query.username
            if (!email) {
                return res.status(400).json({ status: false, creator: CREATOR, error: 'Parameter email wajib diisi!' })
            }
            const result = await sendLink(email)
            return res.status(200).json({
                status: true,
                creator: CREATOR,
                provider: DOMAIN,
                message: `Tautan verifikasi berhasil dikirim ke ${result.email}`
            })
        }

        if (action === 'verify-link') {
            const email = query.email || query.username
            const magicLink = query.magicLink || query.oobCode || query.link
            if (!email || !magicLink) {
                return res.status(400).json({ status: false, creator: CREATOR, error: 'Parameter email dan magicLink/oobCode wajib diisi!' })
            }
            const result = await verifyAndActivate(email, magicLink)
            return res.status(200).json({
                status: true,
                creator: CREATOR,
                provider: DOMAIN,
                message: 'Akun manual berhasil diverifikasi dan diaktifkan!',
                data: result
            })
        }

        return res.status(200).json({
            status: true,
            creator: CREATOR,
            provider: DOMAIN,
            message: 'Alight Motion API Engine aktif.',
            endpoints: {
                auto: '?action=auto&username=USERNAME',
                bulk: '?action=bulk&jumlah=5&apikey=APIKEY&password=PASSWORD',
                send_link: '?action=send-link&email=EMAIL',
                verify_link: '?action=verify-link&email=EMAIL&magicLink=LINK'
            }
        })
    } catch (error) {
        console.error('[ALIGHT MOTION API]', error)
        return res.status(500).json({
            status: false,
            creator: CREATOR,
            provider: DOMAIN,
            message: error?.message || 'Terjadi kesalahan pada server.'
        })
    }
}

handler.processSingleAccount = processSingleAccount
handler.sendLink = sendLink
handler.verifyAndActivate = verifyAndActivate
module.exports = handler
