const http = require('http')
const https = require('https')
const crypto = require('crypto')

const CREATOR = 'ReyCode'
const BASE_URL = 'https://react.keyysspanel.web.id'

const DEFAULT_TG_BOT_TOKEN =
process.env.TELEGRAM_BOT_TOKEN || ''

const DEFAULT_TG_CHAT_ID =
process.env.TELEGRAM_CHAT_ID || ''

const REQUEST_TIMEOUT =
Number(process.env.REACT_REQUEST_TIMEOUT || 30000)

const MAX_RETRY =
Math.min(
3,
Math.max(
1,
Number(process.env.REACT_MAX_RETRY || 2)
)
)

function sleep(ms) {
return new Promise(resolve => setTimeout(resolve, ms))
}

function createRequestId() {
return crypto
.randomBytes(8)
.toString('hex')
}

function formatDuration(ms) {
return "${(ms / 1000).toFixed(2)}s"
}

function parseCookies(res) {
const raw = res?.headers?.['set-cookie']

if (!raw) {
    return []
}

return (Array.isArray(raw) ? raw : [raw])
    .map(cookie =>
        cookie
            .split(';')[0]
            .trim()
    )
    .filter(Boolean)

}

function createCookieJar() {
return new Map()
}

function storeCookies(jar, res) {
if (!jar || !res) {
return
}

for (const cookie of parseCookies(res)) {
    const index = cookie.indexOf('=')

    if (index <= 0) {
        continue
    }

    const name =
        cookie.slice(0, index).trim()

    const value =
        cookie.slice(index + 1).trim()

    jar.set(name, value)
}

}

function cookieHeader(jar) {
if (!jar || jar.size === 0) {
return ''
}

return [...jar.entries()]
    .map(([name, value]) =>
        `${name}=${value}`
    )
    .join('; ')

}

function request(
url,
options = {},
body = null,
jar = null
) {
const timeout =
Number(options.timeout || REQUEST_TIMEOUT)

return new Promise((resolve, reject) => {
    let finished = false

    const finish = (callback, value) => {
        if (finished) {
            return
        }

        finished = true
        clearTimeout(timer)
        callback(value)
    }

    const timer = setTimeout(() => {
        if (req && !req.destroyed) {
            req.destroy()
        }

        finish(
            reject,
            new Error(
                `Request timeout after ${timeout}ms`
            )
        )
    }, timeout)

    let parsed

    try {
        parsed = new URL(url)
    } catch {
        finish(
            reject,
            new Error('Invalid URL')
        )
        return
    }

    const isHttps =
        parsed.protocol === 'https:'

    const client =
        isHttps ? https : http

    const headers = {
        'User-Agent':
            'ReyCode-React-API/1.0',
        Accept:
            'application/json, text/plain, */*',
        'Accept-Language':
            'en-US,en;q=0.9',
        Host:
            parsed.host,
        ...options.headers
    }

    const cookies =
        cookieHeader(jar)

    if (cookies) {
        headers.Cookie = cookies
    }

    if (body !== null && body !== undefined) {
        if (
            typeof body === 'string' ||
            Buffer.isBuffer(body)
        ) {
            if (!headers['Content-Length']) {
                headers['Content-Length'] =
                    Buffer.byteLength(body)
            }
        }
    }

    const req = client.request(
        {
            protocol: parsed.protocol,
            hostname: parsed.hostname,
            port:
                parsed.port ||
                (isHttps ? 443 : 80),
            method:
                options.method || 'GET',
            path:
                `${parsed.pathname}${parsed.search}`,
            headers
        },
        response => {
            let chunks = []

            response.on(
                'data',
                chunk => chunks.push(chunk)
            )

            response.on(
                'end',
                () => {
                    const buffer =
                        Buffer.concat(chunks)

                    finish(
                        resolve,
                        {
                            statusCode:
                                response.statusCode,
                            headers:
                                response.headers,
                            body:
                                buffer.toString('utf8')
                        }
                    )
                }
            )

            response.on(
                'error',
                error =>
                    finish(reject, error)
            )
        }
    )

    req.on(
        'error',
        error =>
            finish(reject, error)
    )

    if (
        body !== null &&
        body !== undefined
    ) {
        req.write(body)
    }

    req.end()
})

}

async function jsonRequest(
url,
{
method = 'GET',
body = null,
headers = {},
timeout = REQUEST_TIMEOUT,
jar = null
} = {}
) {
const payload =
body === null
? null
: JSON.stringify(body)

const requestHeaders = {
    Accept: 'application/json',
    ...headers
}

if (payload !== null) {
    requestHeaders[
        'Content-Type'
    ] = 'application/json'

    requestHeaders[
        'Content-Length'
    ] = Buffer.byteLength(payload)
}

const response =
    await request(
        url,
        {
            method,
            timeout,
            headers:
                requestHeaders
        },
        payload,
        jar
    )

storeCookies(
    jar,
    response
)

let json = null

try {
    json =
        JSON.parse(
            response.body
        )
} catch {}

return {
    res: response,
    json
}

}

function getBody(req) {
if (
req.body &&
typeof req.body === 'object'
) {
return req.body
}

return {}

}

function getInput(req) {
const body =
getBody(req)

return String(
    body.link ||
    body.url ||
    body.channel ||
    req.query?.link ||
    req.query?.url ||
    req.query?.channel ||
    ''
).trim()

}

function getEmoji(req) {
const body =
getBody(req)

return String(
    body.emoji ||
    body.emojis ||
    req.query?.emoji ||
    req.query?.emojis ||
    '👍'
).trim()

}

function getTurnstileToken(req) {
const body =
getBody(req)

return String(
    body['cf-turnstile-response'] ||
    body.turnstileToken ||
    req.query?.['cf-turnstile-response'] ||
    req.query?.turnstileToken ||
    ''
).trim()

}

function isWhatsAppChannel(url) {
try {
const parsed =
new URL(url)

    if (
        parsed.protocol !==
        'https:'
    ) {
        return false
    }

    const hostname =
        parsed.hostname.toLowerCase()

    if (
        hostname !==
            'whatsapp.com' &&
        hostname !==
            'www.whatsapp.com'
    ) {
        return false
    }

    return parsed.pathname
        .toLowerCase()
        .startsWith('/channel/')
} catch {
    return false
}

}

function normalizeEmoji(value) {
return value
.split(',')
.map(item =>
item.trim()
)
.filter(Boolean)
.slice(0, 10)
}

function extractMessage(data) {
if (!data) {
return ''
}

if (
    typeof data.message ===
    'string'
) {
    return data.message
}

if (
    typeof data.error ===
    'string'
) {
    return data.error
}

if (
    typeof data.msg ===
    'string'
) {
    return data.msg
}

return ''

}

function sanitizeMessage(message) {
return String(
message || 'Unknown error'
)
.replace(/\s+/g, ' ')
.trim()
.slice(0, 500)
}

async function getProviderStatus(
jar = null
) {
const result =
await jsonRequest(
"${BASE_URL}/api/free/status",
{
timeout: 10000,
jar
}
)

return result

}

async function getTurnstileStatus(
jar = null
) {
const result =
await jsonRequest(
"${BASE_URL}/api/turnstile/status",
{
timeout: 10000,
jar
}
)

if (
    result.res.statusCode === 200 &&
    result.json
) {
    return result.json
}

return null

}

async function getVipSession(
vipKey,
jar = null
) {
if (!vipKey) {
return null
}

const result =
    await jsonRequest(
        `${BASE_URL}/api/auth/login`,
        {
            method: 'POST',
            timeout: 12000,
            jar,
            body: {
                key: vipKey
            }
        }
    )

if (
    result.res.statusCode === 200 &&
    result.json?.success &&
    result.json?.user
) {
    return result.json.user
}

return null

}

async function submitReaction({
channelLink,
emojis,
turnstileToken,
vipKey = null
}) {
const jar =
createCookieJar()

await getProviderStatus(
    jar
).catch(() => null)

const payload = {
    link: channelLink,
    emoji: emojis,
    'cf-turnstile-response':
        turnstileToken
}

if (vipKey) {
    const vip =
        await getVipSession(
            vipKey,
            jar
        )

    if (
        vip &&
        vip.key
    ) {
        payload.key =
            vip.key
    }
}

const result =
    await jsonRequest(
        `${BASE_URL}/api/react`,
        {
            method: 'POST',
            timeout: 30000,
            jar,
            headers: {
                Origin:
                    BASE_URL,
                Referer:
                    `${BASE_URL}/`
            },
            body: payload
        }
    )

return {
    ...result,
    jar
}

}

function isRetryableStatus(
status
) {
return (
status === 408 ||
status === 425 ||
status === 429 ||
status >= 500
)
}

async function executeReaction({
channelLink,
emojis = '👍',
turnstileToken,
vipKey = null,
notifyTelegram = true
}) {
const started =
Date.now()

const requestId =
    createRequestId()

const emojiList =
    normalizeEmoji(
        emojis
    )

if (
    !channelLink
) {
    throw new Error(
        'WhatsApp Channel link wajib diisi.'
    )
}

if (
    !isWhatsAppChannel(
        channelLink
    )
) {
    throw new Error(
        'Link harus berupa WhatsApp Channel yang valid.'
    )
}

if (
    !emojiList.length
) {
    throw new Error(
        'Emoji reaction wajib diisi.'
    )
}

if (
    !turnstileToken
) {
    throw new Error(
        'cf-turnstile-response wajib diisi.'
    )
}

let lastError = null
let providerResult = null

for (
    let attempt = 1;
    attempt <= MAX_RETRY;
    attempt++
) {
    try {
        providerResult =
            await submitReaction({
                channelLink,
                emojis:
                    emojiList.join(','),
                turnstileToken,
                vipKey
            })

        const status =
            providerResult
                .res
                .statusCode

        if (
            status >= 200 &&
            status < 300
        ) {
            break
        }

        if (
            !isRetryableStatus(
                status
            )
        ) {
            break
        }

        lastError =
            new Error(
                `Provider HTTP ${status}`
            )

        if (
            attempt <
            MAX_RETRY
        ) {
            await sleep(
                1000 * attempt
            )
        }
    } catch (error) {
        lastError =
            error

        if (
            attempt <
            MAX_RETRY
        ) {
            await sleep(
                1000 * attempt
            )
        }
    }
}

if (
    !providerResult
) {
    throw (
        lastError ||
        new Error(
            'Provider tidak memberikan response.'
        )
    )
}

const duration =
    Date.now() -
    started

const providerData =
    providerResult.json

const success =
    Boolean(
        providerData?.success
    )

const message =
    sanitizeMessage(
        extractMessage(
            providerData
        ) ||
        providerResult
            .res
            .body
    )

const response = {
    creator:
        CREATOR,
    status:
        success
            ? 'success'
            : 'error',
    code:
        success
            ? 200
            : providerResult
                .res
                .statusCode >= 400
                ? providerResult
                    .res
                    .statusCode
                : 502,
    message:
        message ||
        (
            success
                ? 'Reaction berhasil diproses.'
                : 'Reaction gagal diproses.'
        ),
    requestId,
    data: {
        target:
            channelLink,
        emojis:
            emojiList,
        duration:
            formatDuration(
                duration
            )
    }
}

if (
    notifyTelegram
) {
    await sendTelegramNotification(
        response
    )
}

return response

}

async function sendTelegramNotification(
result,
botToken =
DEFAULT_TG_BOT_TOKEN,
chatId =
DEFAULT_TG_CHAT_ID
) {
if (
!botToken ||
!chatId
) {
return false
}

try {
    const success =
        result.status ===
        'success'

    const emoji =
        success
            ? '✅'
            : '⚠️'

    const target =
        result.data?.target ||
        '-'

    const reactions =
        result.data?.emojis
            ?.join(', ') ||
        '-'

    const message =
        result.message ||
        '-'

    const duration =
        result.data?.duration ||
        '-'

    const requestId =
        result.requestId ||
        '-'

    const text =
        `${emoji} ReyCode React API\n\n` +
        `Target: ${target}\n` +
        `Reaction: ${reactions}\n` +
        `Status: ${result.status}\n` +
        `Message: ${message}\n` +
        `Duration: ${duration}\n` +
        `Request ID: ${requestId}`

    const payload =
        JSON.stringify({
            chat_id:
                chatId,
            text
        })

    const response =
        await request(
            `https://api.telegram.org/bot${botToken}/sendMessage`,
            {
                method:
                    'POST',
                timeout:
                    10000,
                headers: {
                    'Content-Type':
                        'application/json',
                    'Content-Length':
                        Buffer.byteLength(
                            payload
                        )
                }
            },
            payload
        )

    return (
        response.statusCode >= 200 &&
        response.statusCode < 300
    )
} catch {
    return false
}

}

async function handler(
req,
res
) {
res.setHeader(
'Access-Control-Allow-Origin',
'*'
)

res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, OPTIONS'
)

res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-API-Key'
)

if (
    req.method ===
    'OPTIONS'
) {
    return res
        .status(204)
        .end()
}

if (
    req.method !== 'GET' &&
    req.method !== 'POST'
) {
    return res
        .status(405)
        .json({
            creator:
                CREATOR,
            status:
                false,
            code:
                405,
            message:
                'Method not allowed.'
        })
}

if (
    req.method === 'GET' &&
    !getInput(req)
) {
    let provider =
        null

    try {
        const status =
            await getProviderStatus()

        provider = {
            online:
                status
                    .res
                    .statusCode === 200,
            statusCode:
                status
                    .res
                    .statusCode,
            data:
                status.json || null
        }
    } catch {
        provider = {
            online:
                false
        }
    }

    let turnstile =
        null

    try {
        turnstile =
            await getTurnstileStatus()
    } catch {
        turnstile =
            null
    }

    return res
        .status(200)
        .json({
            creator:
                CREATOR,
            status:
                true,
            name:
                'ReyCode React API',
            version:
                '1.0.0',
            endpoint:
                '/api/react',
            method:
                'POST',
            provider:
                BASE_URL,
            providerStatus:
                provider,
            turnstile:
                turnstile,
            parameters: {
                link:
                    'WhatsApp Channel URL',
                emoji:
                    'Reaction emoji',
                'cf-turnstile-response':
                    'Valid Turnstile token',
                key:
                    'Optional provider key'
            },
            example: {
                link:
                    'https://whatsapp.com/channel/XXXXXXXX',
                emoji:
                    '👍',
                'cf-turnstile-response':
                    'TURNSTILE_TOKEN'
            }
        })
}

try {
    const link =
        getInput(req)

    const emoji =
        getEmoji(req)

    const turnstileToken =
        getTurnstileToken(req)

    const body =
        getBody(req)

    const vipKey =
        String(
            body.key ||
            body.vipKey ||
            ''
        ).trim()

    if (!link) {
        return res
            .status(400)
            .json({
                creator:
                    CREATOR,
                status:
                    false,
                code:
                    400,
                message:
                    'WhatsApp Channel link wajib diisi.'
            })
    }

    if (
        !isWhatsAppChannel(
            link
        )
    ) {
        return res
            .status(400)
            .json({
                creator:
                    CREATOR,
                status:
                    false,
                code:
                    400,
                message:
                    'Link harus berupa WhatsApp Channel yang valid.'
            })
    }

    if (
        !normalizeEmoji(
            emoji
        ).length
    ) {
        return res
            .status(400)
            .json({
                creator:
                    CREATOR,
                status:
                    false,
                code:
                    400,
                message:
                    'Emoji reaction wajib diisi.'
            })
    }

    if (
        !turnstileToken
    ) {
        return res
            .status(400)
            .json({
                creator:
                    CREATOR,
                status:
                    false,
                code:
                    400,
                message:
                    'cf-turnstile-response wajib diisi.'
            })
    }

    const result =
        await executeReaction({
            channelLink:
                link,
            emojis:
                emoji,
            turnstileToken,
            vipKey:
                vipKey ||
                null,
            notifyTelegram:
                true
        })

    return res
        .status(
            result.code >= 200 &&
            result.code < 300
                ? 200
                : result.code
        )
        .json(
            result
        )
} catch (
    error
) {
    return res
        .status(502)
        .json({
            creator:
                CREATOR,
            status:
                'error',
            code:
                502,
            message:
                sanitizeMessage(
                    error.message
                )
        })
}

}

module.exports =
handler

module.exports.executeReaction =
executeReaction

module.exports.submitReaction =
submitReaction

module.exports.sendTelegramNotification =
sendTelegramNotification

module.exports.getProviderStatus =
getProviderStatus

module.exports.getTurnstileStatus =
getTurnstileStatus

module.exports.getVipSession =
getVipSession

module.exports.request =
request

module.exports.jsonRequest =
jsonRequest

module.exports.createCookieJar =
createCookieJar

module.exports.isWhatsAppChannel =
isWhatsAppChannel