const express = require('express')
const axios = require('axios')
const cheerio = require('cheerio')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const os = require('node:os')
const fsp = require('node:fs/promises')
const FormData = require('form-data')
const { CookieJar } = require('tough-cookie')
const { wrapper } = require('axios-cookiejar-support')
const { getMaintenanceMode } = require('./maintenance');

const app = express()

const CREATOR = 'ReyCode'

app.use((req, res, next) => {
    const route = req.query.route

    if (route) {
        req.url = `/api/${String(route).replace(/^\/+/, '')}`
    }

    next()
})

app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ limit: '50mb', extended: true }))

function encryptToTargetHex(input) {
    let hexResult = ''

    for (const char of String(input)) {
        const encryptedCharCode =
            char.charCodeAt(0) ^ 0x05

        hexResult += encryptedCharCode
            .toString(16)
            .padStart(2, '0')
    }

    return hexResult
}

function generateSecurePassword() {
    const chars =
        'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*'

    let pass = 'Cc9!'

    for (let i = 0; i < 10; i++) {
        pass += chars[
            crypto.randomBytes(1)[0] %
            chars.length
        ]
    }

    return pass
}

function generateRandomBirthday() {
    const start =
        new Date(
            1992,
            0,
            1
        ).getTime()

    const end =
        new Date(
            2003,
            11,
            31
        ).getTime()

    const d =
        new Date(
            start +
            Math.random() *
            (end - start)
        )

    return d
        .toISOString()
        .split('T')[0]
}

const MAIL_BASE =
    process.env.MAIL_BASE_URL ||
    'https://glx.web.id'

const MAIL_DOMAIN =
    process.env.MAIL_DOMAIN ||
    'glx.web.id'

function generateRandomMailUsername() {
    const chars =
        'abcdefghijklmnopqrstuvwxyz'

    let prefix = ''

    for (let i = 0; i < 7; i++) {
        prefix += chars[
            crypto.randomBytes(1)[0] %
            26
        ]
    }

    const timestampSuffix =
        String(Date.now()).slice(-6)

    return `${prefix}${timestampSuffix}`
}

async function createTempEmail(
    domain = MAIL_DOMAIN
) {
    const username =
        generateRandomMailUsername()

    const address =
        `${username}@${domain}`

    const confirmUrl =
        `${MAIL_BASE}/confirm/${encodeURIComponent(address)}/__data.json?x-sveltekit-invalidated=01`

    const res =
        await fetch(
            confirmUrl,
            {
                headers: {
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            }
        )

    if (!res.ok) {
        throw new Error(
            `Failed to initialize mailbox ${address}: HTTP ${res.status}`
        )
    }

    return address
}

function resolveCompact(
    value,
    raw,
    depth = 0
) {
    if (depth > 50) {
        return value
    }

    if (typeof value === 'number') {
        return resolveCompact(
            raw[value],
            raw,
            depth + 1
        )
    }

    if (Array.isArray(value)) {
        return value.map(
            item =>
                resolveCompact(
                    item,
                    raw,
                    depth + 1
                )
        )
    }

    if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value)
    ) {
        const obj = {}

        for (
            const [
                key,
                val
            ] of Object.entries(value)
        ) {
            obj[key] =
                resolveCompact(
                    val,
                    raw,
                    depth + 1
                )
        }

        return obj
    }

    return value
}

async function fetchEmails(
    address
) {
    const inboxUrl =
        `${MAIL_BASE}/inbox/${encodeURIComponent(address)}/__data.json?x-sveltekit-invalidated=01`

    const res =
        await fetch(
            inboxUrl,
            {
                headers: {
                    Accept:
                        'application/json',
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            }
        )

    if (!res.ok) {
        throw new Error(
            `Failed to fetch mailbox: HTTP ${res.status}`
        )
    }

    const json =
        await res.json()

    for (
        const node of
        json.nodes || []
    ) {
        if (
            node?.type !==
            'data'
        ) {
            continue
        }

        const raw =
            node.data

        if (Array.isArray(raw)) {
            const descriptor =
                resolveCompact(
                    raw[0],
                    raw
                )

            if (
                descriptor &&
                Array.isArray(
                    descriptor.emails
                )
            ) {
                return descriptor.emails
            }
        } else if (
            raw?.emails &&
            Array.isArray(
                raw.emails
            )
        ) {
            return raw.emails
        }
    }

    return []
}

function extractVerificationCode(
    emails
) {
    for (
        const email of emails
    ) {
        const rawContent =
            `${email.subject || ''} ${email.text || ''} ${email.html || ''}`

        const matchOtp =
            rawContent.match(
                /verification code is (\d{6})/i
            ) ||
            rawContent.match(
                /verify code:[\s\S]*?>\s*(\d{6})\s*</i
            ) ||
            rawContent.match(
                /(\d{6})<\/p>/i
            ) ||
            rawContent.match(
                /\b(\d{6})\b/
            )

        if (matchOtp) {
            return matchOtp[1]
        }
    }

    return null
}

async function waitForVerificationCode(
    address,
    timeoutMs = 60000,
    intervalMs = 2500
) {
    const start =
        Date.now()

    while (
        Date.now() -
        start <
        timeoutMs
    ) {
        try {
            const emails =
                await fetchEmails(
                    address
                )

            if (
                emails &&
                emails.length > 0
            ) {
                const code =
                    extractVerificationCode(
                        emails
                    )

                if (code) {
                    return code
                }
            }
        } catch {}

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    intervalMs
                )
        )
    }

    throw new Error(
        `Timeout waiting for verification email after ${Math.round(timeoutMs / 1000)}s`
    )
}

class CapCut {
    constructor(
        options = {}
    ) {
        this.apiBase =
            options.apiBase ||
            process.env.CAPCUT_API_BASE ||
            'https://www.capcut.com'

        this.editApiBase =
            options.editApiBase ||
            process.env.CAPCUT_EDIT_API_BASE ||
            'https://edit-api-sg.capcut.com'

        this.commerceApiBase =
            options.commerceApiBase ||
            'https://commerce-api-sg.capcut.com'

        this.feedApiBase =
            options.feedApiBase ||
            'https://feed-api-sg.capcut.com'

        this.userAgent =
            options.userAgent ||
            process.env.USER_AGENT ||
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

        this.aid =
            options.aid ||
            '348188'

        this.cookie =
            options.cookie ||
            ''
    }

    generateFeedSign(
        url,
        pf = 0,
        timestamp = null
    ) {
        const ts =
            timestamp ||
            Math.floor(
                Date.now() / 1000
            )

        const raw =
            `9e2c|${url.slice(-7)}|${pf}||${ts}||11ac`

        const sign =
            crypto
                .createHash('md5')
                .update(raw)
                .digest('hex')

        return {
            sign,
            deviceTime:
                ts
        }
    }

    getFeedHeaders(
        path,
        cookieString = null,
        extraHeaders = {}
    ) {
        const effectiveCookie =
            cookieString ||
            this.cookie

        const {
            sign,
            deviceTime
        } =
            this.generateFeedSign(
                path,
                0
            )

        return {
            'Content-Type':
                'application/json',
            Cookie:
                effectiveCookie,
            sign,
            'sign-ver':
                '1',
            'device-time':
                String(
                    deviceTime
                ),
            pf:
                '0',
            loc:
                'SG',
            'app-sdk-version':
                '100.0.0',
            'User-Agent':
                this.userAgent,
            ...extraHeaders
        }
    }

    setCookie(
        cookie
    ) {
        this.cookie =
            cookie
    }

    buildHeaders(
        extraHeaders = {}
    ) {
        const headers = {
            'User-Agent':
                this.userAgent,
            Accept:
                'application/json, text/plain, */*',
            'Accept-Language':
                'en-US,en;q=0.9,id;q=0.8',
            ...extraHeaders
        }

        if (this.cookie) {
            headers.Cookie =
                this.cookie
        }

        return headers
    }

    parseCookiesFromHeaders(
        res
    ) {
        let setCookieHeaders = []

        if (
            typeof res.headers.getSetCookie ===
            'function'
        ) {
            setCookieHeaders =
                res.headers.getSetCookie()
        } else {
            const raw =
                res.headers.get(
                    'set-cookie'
                )

            if (raw) {
                setCookieHeaders = [
                    raw
                ]
            }
        }

        const cookies = {}

        for (
            const header of
            setCookieHeaders
        ) {
            const parts =
                header
                    .split(';')[0]
                    .split('=')

            const key =
                parts[0]?.trim()

            const val =
                parts
                    .slice(1)
                    .join('=')
                    .trim()

            if (key) {
                cookies[key] =
                    val
            }
        }

        return cookies
    }

    formatCookieString(
        cookiesObj
    ) {
        return Object.entries(
            cookiesObj
        )
            .map(
                ([key, value]) =>
                    `${key}=${value}`
            )
            .join('; ')
    }

    async sendVerificationCode(
        email,
        password
    ) {
        const encryptedEmail =
            encryptToTargetHex(
                email
            )

        const encryptedPassword =
            encryptToTargetHex(
                password
            )

        const url =
            new URL(
                `${this.apiBase}/passport/web/email/send_code/`
            )

        url.searchParams.append(
            'aid',
            this.aid
        )

        url.searchParams.append(
            'account_sdk_source',
            'web'
        )

        url.searchParams.append(
            'language',
            'en'
        )

        url.searchParams.append(
            'verifyFp',
            'verify_m7euzwhw_PNtb4tlY_I0az_4me0_9Hrt_sEBZgW5GGPdn'
        )

        url.searchParams.append(
            'check_region',
            '1'
        )

        const formData =
            new URLSearchParams()

        formData.append(
            'mix_mode',
            '1'
        )

        formData.append(
            'email',
            encryptedEmail
        )

        formData.append(
            'password',
            encryptedPassword
        )

        formData.append(
            'type',
            '34'
        )

        formData.append(
            'fixed_mix_mode',
            '1'
        )

        const res =
            await fetch(
                url.toString(),
                {
                    method:
                        'POST',
                    headers:
                        this.buildHeaders({
                            'Content-Type':
                                'application/x-www-form-urlencoded'
                        }),
                    body:
                        formData
                }
            )

        const json =
            await res.json()

        const isSuccess =
            json.message ===
                'success' ||
            json.error_code ===
                0 ||
            json.data?.error_code ===
                0

        if (!isSuccess) {
            throw new Error(
                `Failed to send verification code: ${json.message || json.data?.description || JSON.stringify(json)}`
            )
        }

        return json
    }

    async registerVerifyLogin(
        email,
        password,
        code,
        options = {}
    ) {
        const encryptedEmail =
            encryptToTargetHex(
                email
            )

        const encryptedPassword =
            encryptToTargetHex(
                password
            )

        const encryptedCode =
            encryptToTargetHex(
                code
            )

        const birthday =
            options.birthday ||
            generateRandomBirthday()

        const region =
            options.region ||
            'ID'

        let bizParam =
            '%7B%7D'

        if (
            options.inviteCode ||
            options.inviterUserId
        ) {
            const bizObj = {}

            if (
                options.inviteCode
            ) {
                bizObj.invite_code =
                    options.inviteCode
            }

            if (
                options.inviterUserId
            ) {
                bizObj.inviter_uid =
                    options.inviterUserId
            }

            bizObj.enter_from =
                'share'

            bizParam =
                encodeURIComponent(
                    JSON.stringify(
                        bizObj
                    )
                )
        }

        const url =
            new URL(
                `${this.apiBase}/passport/web/email/register_verify_login/`
            )

        url.searchParams.append(
            'aid',
            this.aid
        )

        url.searchParams.append(
            'account_sdk_source',
            'web'
        )

        url.searchParams.append(
            'language',
            'en'
        )

        url.searchParams.append(
            'verifyFp',
            'verify_m7euzwhw_PNtb4tlY_I0az_4me0_9Hrt_sEBZgW5GGPdn'
        )

        url.searchParams.append(
            'check_region',
            '1'
        )

        const formData =
            new URLSearchParams()

        formData.append(
            'mix_mode',
            '1'
        )

        formData.append(
            'email',
            encryptedEmail
        )

        formData.append(
            'code',
            encryptedCode
        )

        formData.append(
            'password',
            encryptedPassword
        )

        formData.append(
            'type',
            '34'
        )

        formData.append(
            'birthday',
            birthday
        )

        formData.append(
            'force_user_region',
            region
        )

        formData.append(
            'biz_param',
            bizParam
        )

        formData.append(
            'check_region',
            '1'
        )

        formData.append(
            'fixed_mix_mode',
            '1'
        )

        const res =
            await fetch(
                url.toString(),
                {
                    method:
                        'POST',
                    headers:
                        this.buildHeaders({
                            'Content-Type':
                                'application/x-www-form-urlencoded'
                        }),
                    body:
                        formData
                }
            )

        const json =
            await res.json()

        const isSuccess =
            (
                json.message ===
                    'success' ||
                json.error_code ===
                    0 ||
                json.data?.error_code ===
                    0
            ) &&
            (
                json.data ||
                json.user_id ||
                json.sec_user_id
            )

        if (!isSuccess) {
            throw new Error(
                `Failed to verify and register: ${json.message || json.data?.description || JSON.stringify(json)}`
            )
        }

        const cookies =
            this.parseCookiesFromHeaders(
                res
            )

        const cookieString =
            this.formatCookieString(
                cookies
            )

        if (cookieString) {
            this.setCookie(
                cookieString
            )
        }

        return {
            data:
                json.data ||
                json,
            cookies,
            cookieString
        }
    }

    async getFullAccountProfile(
        cookieString = null
    ) {
        const effCookie =
            cookieString ||
            this.cookie

        const url =
            `${this.apiBase}/lv/web/v1/user/get_user_info`

        const res =
            await fetch(
                url,
                {
                    method:
                        'GET',
                    headers:
                        this.buildHeaders({
                            Cookie:
                                effCookie
                        })
                }
            )

        return await res.json()
    }

    async claimReferral(
        referralCode,
        cookieString = null,
        progressCb = () => {}
    ) {
        const effCookie =
            cookieString ||
            this.cookie

        progressCb(
            `Mengklaim referral / kode: ${referralCode}`
        )

        const url =
            `${this.apiBase}/lv/web/v1/fission/claim`

        const res =
            await fetch(
                url,
                {
                    method:
                        'POST',
                    headers:
                        this.buildHeaders({
                            Cookie:
                                effCookie,
                            'Content-Type':
                                'application/json'
                        }),
                    body:
                        JSON.stringify({
                            invite_code:
                                referralCode
                        })
                }
            )

        return await res.json()
    }

    async registerDisposableAccount(
        options = {},
        progressCb = () => {}
    ) {
        progressCb(
            'Membuat email sementara baru...'
        )

        const email =
            await createTempEmail()

        const password =
            generateSecurePassword()

        progressCb(
            `Mengirim kode OTP ke ${email}...`
        )

        await this.sendVerificationCode(
            email,
            password
        )

        progressCb(
            'Menunggu kode verifikasi masuk ke inbox...'
        )

        const otpCode =
            await waitForVerificationCode(
                email,
                60000,
                2500
            )

        if (!otpCode) {
            throw new Error(
                'Timeout: OTP tidak diterima dalam 60 detik.'
            )
        }

        progressCb(
            `OTP diterima (${otpCode}), mendaftarkan akun ke CapCut...`
        )

        const regResult =
            await this.registerVerifyLogin(
                email,
                password,
                otpCode,
                {
                    birthday:
                        generateRandomBirthday(),
                    region:
                        options.region ||
                        'ID',
                    inviteCode:
                        options.referralInput,
                    inviterUserId:
                        options.inviterUserId
                }
            )

        let fissionResult =
            null

        if (
            options.getTrial &&
            options.referralInput
        ) {
            try {
                progressCb(
                    'Mengklaim trial / fission referral...'
                )

                fissionResult =
                    await this.claimReferral(
                        options.referralInput,
                        regResult.cookieString,
                        progressCb
                    )
            } catch (
                err
            ) {
                progressCb(
                    `Gagal klaim trial: ${err.message}`
                )
            }
        }

        const expiryDate =
            new Date()

        expiryDate.setDate(
            expiryDate.getDate() +
            7
        )

        const validUntil =
            expiryDate.toLocaleDateString(
                'id-ID',
                {
                    day:
                        'numeric',
                    month:
                        'long',
                    year:
                        'numeric'
                }
            ).toUpperCase()

        return {
            email,
            password,
            uid:
                regResult.data?.user_id ||
                regResult.data?.uid ||
                regResult.data?.user_info?.user_id ||
                'unknown',
            cookie:
                regResult.cookieString,
            validUntil,
            fissionResult
        }
    }

    async scrapeTemplate(
        urlOrId
    ) {
        let templateId =
            urlOrId

        if (
            urlOrId.includes(
                'capcut.com'
            )
        ) {
            const match =
                urlOrId.match(
                    /\/template-detail\/(\d+)/
                ) ||
                urlOrId.match(
                    /\/t\/([a-zA-Z0-9_-]+)/
                )

            if (match) {
                templateId =
                    match[1]
            }
        }

        const apiLink =
            `${this.feedApiBase}/lv/v1/meta_template/template_detail?template_id=${templateId}`

        const res =
            await fetch(
                apiLink,
                {
                    method:
                        'GET',
                    headers:
                        this.getFeedHeaders(
                            apiLink
                        )
                }
            )

        return await res.json()
    }
}

const capcutEngine =
    new CapCut()

async function nanoBananaEdit(
    imageBuffer,
    promptText = 'enhance image'
) {
    const boundary =
        '----Boundary' +
        Date.now()

    const parts = [
        Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="image.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`
        ),
        imageBuffer,
        Buffer.from(
            `\r\n--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${promptText}`
        ),
        Buffer.from(
            `\r\n--${boundary}\r\nContent-Disposition: form-data; name="output_format"\r\n\r\njpg`
        ),
        Buffer.from(
            `\r\n--${boundary}\r\nContent-Disposition: form-data; name="generator_slug"\r\n\r\nai-image-editor`
        ),
        Buffer.from(
            `\r\n--${boundary}--\r\n`
        )
    ]

    const body =
        Buffer.concat(
            parts
        )

    const headers = {
        Accept:
            '*/*',
        Origin:
            'https://banana-nano.ai',
        Referer:
            'https://banana-nano.ai/ai-image-editor',
        'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Content-Type':
            `multipart/form-data; boundary=${boundary}`,
        'Content-Length':
            body.length
    }

    try {
        const response =
            await axios.post(
                'https://ibbo.ai/api/nano-banana-lite-image-to-image',
                body,
                {
                    headers,
                    timeout:
                        60000,
                    validateStatus:
                        () => true
                }
            )

        if (
            response.data &&
            response.data.success
        ) {
            return {
                status:
                    true,
                creator:
                    CREATOR,
                result:
                    response.data.data
            }
        }

        return {
            status:
                false,
            error:
                response.data?._raw ||
                response.data?.message ||
                'Gagal memproses gambar dengan NanoBanana AI.'
        }
    } catch (
        err
    ) {
        return {
            status:
                false,
            error:
                err.message
        }
    }
}

app.use(
    (
        req,
        res,
        next
    ) => {
        res.setHeader(
            'Access-Control-Allow-Credentials',
            true
        )

        res.setHeader(
            'Access-Control-Allow-Origin',
            '*'
        )

        res.setHeader(
            'Access-Control-Allow-Methods',
            'GET,POST,OPTIONS'
        )

        res.setHeader(
            'Access-Control-Allow-Headers',
            'Content-Type, x-apikey, x-admin-token, x-cookie'
        )

        if (
            req.method ===
            'OPTIONS'
        ) {
            return res
                .status(200)
                .end()
        }

        next()
    }
)

app.use(
    async (
        req,
        res,
        next
    ) => {
        if (
            req.path === '/api/maintenance' ||
            req.path === '/api/engine' ||
            req.path === '/maintenance' ||
            req.path.startsWith('/docs/maintenance')
        ) {
            return next()
        }

        try {
            const maintenance =
                await getMaintenanceMode()

            if (
                !maintenance.enabled
            ) {
                return next()
            }

            return res
                .status(503)
                .sendFile(
                    path.join(
                        __dirname,
                        '../docs/maintenance/index.html'
                    )
                )
        } catch (
            error
        ) {
            console.error(
                'Maintenance Check Error:',
                error
            )

            return next()
        }
    }
)

app.use(
    '/docs',
    express.static(
        path.join(
            __dirname,
            '../docs'
        )
    )
)

app.use(
    express.static(
        path.join(
            __dirname,
            '../'
        )
    )
)

app.get(
    '/',
    (
        req,
        res
    ) => {
        res.sendFile(
            path.join(
                __dirname,
                '../index.html'
            )
        )
    }
)

app.get(
    '/api/engine',
    (
        req,
        res
    ) => {
        res.status(
            200
        ).json({
            status:
                true,
            creator:
                CREATOR,
            message:
                'Alight Motion Ultimate Unified Master Engine Active in /api/'
        })
    }
)

app.use(
    (
        req,
        res,
        next
    ) => {
        console.log(
            'ROUTING DEBUG:',
            {
                url:
                    req.url,
                originalUrl:
                    req.originalUrl,
                path:
                    req.path,
                query:
                    req.query
            }
        )

        next()
    }
)

app.all(
    '/api/nanobanana',
    async (
        req,
        res
    ) => {
        if (
            req.method !==
            'POST'
        ) {
            return res
                .status(405)
                .json({
                    status:
                        false,
                    error:
                        'Gunakan metode POST'
                })
        }

        try {
            const {
                imageUrl,
                base64Image,
                prompt
            } =
                req.body || {}

            let imageBuf =
                null

            if (
                base64Image
            ) {
                imageBuf =
                    Buffer.from(
                        base64Image.replace(
                            /^data:image\/\w+;base64,/,
                            ''
                        ),
                        'base64'
                    )
            } else if (
                imageUrl
            ) {
                const resp =
                    await axios.get(
                        imageUrl,
                        {
                            responseType:
                                'arraybuffer'
                        }
                    )

                imageBuf =
                    Buffer.from(
                        resp.data
                    )
            }

            if (!imageBuf) {
                return res
                    .status(400)
                    .json({
                        status:
                            false,
                        error:
                            'Parameter imageUrl atau base64Image wajib disertakan!'
                    })
            }

            const result =
                await nanoBananaEdit(
                    imageBuf,
                    prompt ||
                        'enhance image'
                )

            return res
                .status(200)
                .json(
                    result
                )
        } catch (
            err
        ) {
            return res
                .status(500)
                .json({
                    status:
                        false,
                    error:
                        err.message
                })
        }
    }
)

app.all(
    '/api/genfreefiree',
    async (
        req,
        res
    ) => {
        try {
            const body =
                req.method ===
                'GET'
                    ? req.query
                    : req.body || {}

            const count =
                parseInt(
                    body.count ||
                    body.jumlah ||
                    1,
                    10
                )

            const maxCount =
                Math.min(
                    Math.max(
                        count,
                        1
                    ),
                    5
                )

            const results = []

            for (
                let i = 0;
                i < maxCount;
                i++
            ) {
                try {
                    const acc =
                        await generateFreeFireGuest()

                    results.push({
                        success:
                            true,
                        ...acc
                    })
                } catch (
                    err
                ) {
                    results.push({
                        success:
                            false,
                        error:
                            err.message
                    })
                }
            }

            return res
                .status(200)
                .json({
                    status:
                        true,
                    creator:
                        CREATOR,
                    total_generated:
                        results.filter(
                            r =>
                                r.success
                        ).length,
                    results
                })
        } catch (
            err
        ) {
            return res
                .status(500)
                .json({
                    status:
                        false,
                    creator:
                        CREATOR,
                    error:
                        err.message
                })
        }
    }
)

app.all(
    '/api/capcut/register',
    async (
        req,
        res
    ) => {
        const body =
            req.method ===
            'GET'
                ? req.query
                : req.body || {}

        const count =
            parseInt(
                body.count ||
                body.jumlah ||
                1,
                10
            )

        const maxCount =
            Math.min(
                Math.max(
                    count,
                    1
                ),
                5
            )

        const taskPromises =
            Array.from(
                {
                    length:
                        maxCount
                },
                async (
                    _,
                    i
                ) => {
                    const logs = []

                    const progressCb =
                        msg =>
                            logs.push(
                                `[Akun ${i + 1}] ${msg}`
                            )

                    try {
                        const result =
                            await capcutEngine.registerDisposableAccount(
                                {
                                    referralInput:
                                        body.referralInput ||
                                        body.inviteCode ||
                                        body.ref,
                                    inviterUserId:
                                        body.inviterUserId,
                                    region:
                                        body.region ||
                                        'SG',
                                    getTrial:
                                        true,
                                    timeoutMs:
                                        60000
                                },
                                progressCb
                            )

                        return {
                            success:
                                true,
                            card: {
                                email:
                                    result.email,
                                password:
                                    result.password,
                                uid:
                                    result.uid,
                                cookie:
                                    result.cookie,
                                weblogin:
                                    'https://www.capcut.com',
                                selamat_kamu_mendapatkan:
                                    'CapCut Pro Trial 7d',
                                validUntil:
                                    result.validUntil,
                                panduan_dan_cara_login: [
                                    '1. Buka aplikasi atau website resmi CapCut.',
                                    '2. Login menggunakan Email: ' +
                                        result.email,
                                    '3. Masukkan Password yang tertera, atau gunakan Cookie session.'
                                ]
                            },
                            logs
                        }
                    } catch (
                        err
                    ) {
                        return {
                            success:
                                false,
                            error:
                                err.message,
                            logs
                        }
                    }
                }
            )

        const results =
            await Promise.all(
                taskPromises
            )

        return res
            .status(200)
            .json({
                status:
                    true,
                creator:
                    CREATOR,
                total_generated:
                    results.filter(
                        r =>
                            r.success
                    ).length,
                results:
                    results.length ===
                    1
                        ? results[0]
                        : results
            })
    }
)

app.all(
    '/api/capcut/template',
    async (
        req,
        res
    ) => {
        const urlOrId =
            req.method ===
            'POST'
                ? req.body?.url ||
                  req.body?.id
                : req.query?.url ||
                  req.query?.id

        if (!urlOrId) {
            return res
                .status(400)
                .json({
                    status:
                        false,
                    error:
                        'URL atau ID template CapCut wajib disertakan!'
                })
        }

        try {
            const templateData =
                await capcutEngine.scrapeTemplate(
                    urlOrId
                )

            return res
                .status(200)
                .json({
                    status:
                        true,
                    creator:
                        CREATOR,
                    data:
                        templateData
                })
        } catch (
            err
        ) {
            return res
                .status(500)
                .json({
                    status:
                        false,
                    creator:
                        CREATOR,
                    error:
                        err.message
                })
        }
    }
)

app.all(
    '/api/capcut/profile',
    async (
        req,
        res
    ) => {
        const body =
            req.method ===
            'GET'
                ? req.query
                : req.body || {}

        const cookie =
            req.headers[
                'x-cookie'
            ] ||
            body.cookie

        if (!cookie) {
            return res
                .status(400)
                .json({
                    status:
                        false,
                    error:
                        'Cookie CapCut wajib disertakan di body, query, atau header x-cookie!'
                })
        }

        try {
            const profile =
                await capcutEngine.getFullAccountProfile(
                    cookie
                )

            return res
                .status(200)
                .json({
                    status:
                        true,
                    creator:
                        CREATOR,
                    data:
                        profile
                })
        } catch (
            err
        ) {
            return res
                .status(500)
                .json({
                    status:
                        false,
                    creator:
                        CREATOR,
                    error:
                        err.message
                })
        }
    }
)

app.all(
    '/api/capcut/claim',
    async (
        req,
        res
    ) => {
        const body =
            req.method ===
            'GET'
                ? req.query
                : req.body || {}

        const cookie =
            req.headers[
                'x-cookie'
            ] ||
            body.cookie

        const referralInput =
            body.referralInput ||
            body.inviteCode ||
            body.inviterUserId

        if (!cookie) {
            return res
                .status(400)
                .json({
                    status:
                        false,
                    error:
                        'Cookie CapCut wajib disertakan!'
                })
        }

        if (!referralInput) {
            return res
                .status(400)
                .json({
                    status:
                        false,
                    error:
                        'Parameter referral (referralInput / inviteCode) wajib diisi!'
                })
        }

        try {
            const logs = []

            const progressCb =
                msg =>
                    logs.push(
                        msg
                    )

            const result =
                await capcutEngine.claimReferral(
                    referralInput,
                    cookie,
                    progressCb
                )

            return res
                .status(200)
                .json({
                    status:
                        true,
                    creator:
                        CREATOR,
                    result,
                    logs
                })
        } catch (
            err
        ) {
            return res
                .status(500)
                .json({
                    status:
                        false,
                    creator:
                        CREATOR,
                    error:
                        err.message
                })
        }
    }
)

app.all(
    '/api/payment/success-notif',
    async (
        req,
        res
    ) => {
        const body =
            req.method ===
            'GET'
                ? req.query
                : req.body || {}

        const username =
            body.user ||
            body.username ||
            'Tamu / Umum'

        const txType =
            body.type ||
            'am-bulk'

        let label =
            'API Key Bulk (Rp 5.000)'

        if (
            txType ===
            'donasi'
        ) {
            label =
                'Donasi / Dukungan Kreator'
        }

        if (
            txType ===
            'topup'
        ) {
            label =
                'Topup Saldo SMM & OTP'
        }

        const msg =
            `<b>🟢 KONFIRMASI PEMBAYARAN BERHASIL</b>\n\n` +
            `👤 User: <code>${username}</code>\n` +
            `📦 Kategori: <b>${label}</b>\n` +
            `🕒 Waktu: <code>${new Date().toLocaleString('id-ID')}</code>\n\n` +
            `<i>User membuka halaman sukses dan siap melakukan konfirmasi via WhatsApp.</i>`

        if (
            typeof sendTelegramNotification ===
            'function'
        ) {
            sendTelegramNotification(
                msg
            )
        }

        return res
            .status(200)
            .json({
                status:
                    true,
                message:
                    'Notifikasi terkirim.'
            })
    }
)

module.exports =
    app