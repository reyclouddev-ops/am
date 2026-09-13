const https = require('https')
const http = require('http')

const DOMAIN = 'akunlama.com'
const PROVIDER_BASE_URL =
    process.env.TEMPMAIL_PROVIDER_URL ||
    `https://${DOMAIN}`

const adjectives = [
    'happy',
    'sleepy',
    'clever',
    'swift',
    'brave',
    'calm',
    'wild',
    'gentle',
    'lucky',
    'proud',
    'cozy',
    'fuzzy',
    'bright',
    'quick',
    'silent',
    'mighty',
    'friendly',
    'curious',
    'fearless',
    'cheerful',
    'playful',
    'peaceful',
    'clever',
    'cool',
    'fresh',
    'smooth',
    'tiny',
    'big',
    'strong',
    'smart',
    'kind',
    'sweet',
    'funny',
    'jolly',
    'sunny',
    'chill',
    'rapid',
    'magic',
    'lively',
    'bouncy',
    'sleepy',
    'dreamy',
    'shiny',
    'happy',
    'mellow',
    'brisk',
    'bold',
    'epic',
    'royal',
    'noble',
    'young',
    'free',
    'crazy',
    'lucky',
    'awesome',
    'super',
    'hyper',
    'cosmic',
    'stellar',
    'mystic',
    'frosty',
    'stormy',
    'snowy',
    'sunny',
    'rainy',
    'windy',
    'cloudy',
    'golden',
    'silver',
    'hidden',
    'secret',
    'shadow',
    'rapid',
    'electric',
    'digital',
    'pixel',
    'neon',
    'cyber',
    'quantum',
    'atomic',
    'legendary',
    'ultimate',
    'ancient',
    'modern',
    'urban',
    'ninja',
    'swift',
    'silent',
    'dark',
    'light',
    'wild',
    'crazy',
    'lunar',
    'solar',
    'orbit',
    'nova',
    'zero',
    'alpha',
    'omega'
]

const animals = [
    'kitten',
    'cat',
    'tiger',
    'lion',
    'panther',
    'cheetah',
    'lynx',
    'puma',
    'jaguar',
    'leopard',
    'wolf',
    'fox',
    'bear',
    'panda',
    'koala',
    'rabbit',
    'bunny',
    'hamster',
    'mouse',
    'rat',
    'deer',
    'moose',
    'elk',
    'horse',
    'pony',
    'zebra',
    'giraffe',
    'monkey',
    'gorilla',
    'chimp',
    'otter',
    'beaver',
    'badger',
    'raccoon',
    'skunk',
    'squirrel',
    'hedgehog',
    'penguin',
    'owl',
    'eagle',
    'hawk',
    'falcon',
    'raven',
    'crow',
    'parrot',
    'sparrow',
    'pigeon',
    'duck',
    'goose',
    'swan',
    'flamingo',
    'peacock',
    'chicken',
    'rooster',
    'turkey',
    'dolphin',
    'whale',
    'shark',
    'seal',
    'otter',
    'turtle',
    'tortoise',
    'frog',
    'toad',
    'gecko',
    'lizard',
    'iguana',
    'chameleon',
    'snake',
    'python',
    'cobra',
    'dragon',
    'unicorn',
    'phoenix',
    'penguin',
    'kangaroo',
    'wombat',
    'platypus',
    'sloth',
    'armadillo',
    'meerkat',
    'mongoose',
    'hyena',
    'cheetah',
    'gazelle',
    'buffalo',
    'bison',
    'camel',
    'llama',
    'alpaca',
    'donkey',
    'ram',
    'goat',
    'sheep',
    'pig',
    'boar',
    'hamster',
    'ferret',
    'mole'
]

function request(url, options = {}, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        if (redirectCount > 7) {
            return reject(
                new Error('Terlalu banyak redirect dari provider.')
            )
        }

        let parsed

        try {
            parsed = new URL(url)
        } catch {
            return reject(new Error('URL provider tidak valid.'))
        }

        const client =
            parsed.protocol === 'https:'
                ? https
                : http

        const headers = {
            'User-Agent':
                'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
            Accept:
                'text/html,application/xhtml+xml,application/json,text/plain,*/*',
            ...options.headers
        }

        const reqOptions = {
            hostname: parsed.hostname,
            port:
                parsed.port ||
                (parsed.protocol === 'https:' ? 443 : 80),
            path:
                parsed.pathname +
                parsed.search,
            method: options.method || 'GET',
            headers
        }

        const req = client.request(
            reqOptions,
            res => {
                const statusCode = res.statusCode || 0
                const location = res.headers.location

                if (
                    [301, 302, 303, 307, 308].includes(statusCode) &&
                    location
                ) {
                    const redirectUrl =
                        new URL(
                            location,
                            url
                        ).toString()

                    res.resume()

                    return request(
                        redirectUrl,
                        options,
                        redirectCount + 1
                    )
                        .then(resolve)
                        .catch(reject)
                }

                let body = ''

                res.setEncoding('utf8')

                res.on('data', chunk => {
                    body += chunk
                })

                res.on('end', () => {
                    resolve({
                        statusCode,
                        headers: res.headers,
                        body,
                        url
                    })
                })
            }
        )

        req.on('error', reject)

        if (options.timeout) {
            req.setTimeout(
                options.timeout,
                () => {
                    req.destroy(
                        new Error(
                            'Request timeout.'
                        )
                    )
                }
            )
        }

        if (options.body) {
            req.write(options.body)
        }

        req.end()
    })
}

function normalizeUsername(input) {
    return String(input || '')
        .trim()
        .toLowerCase()
        .replace(/@${DOMAIN}$/i, '')
        .replace(/[^a-z0-9._-]/g, '')
        .replace(/^[._-]+|[._-]+$/g, '')
        .slice(0, 40)
}

function randomItem(array) {
    return array[
        Math.floor(
            Math.random() * array.length
        )
    ]
}

function randomNumber() {
    return Math.floor(
        100 + Math.random() * 900
    )
}

function generateUsername() {
    const adjective =
        randomItem(adjectives)

    const animal =
        randomItem(animals)

    const number =
        randomNumber()

    return `${adjective}_${animal}${number}`
}

function generateManualUsername(input) {
    const username =
        normalizeUsername(input)

    if (!username) {
        throw new Error(
            'Username tidak valid.'
        )
    }

    const animal =
        randomItem(animals)

    const number =
        randomNumber()

    return `${username}_${animal}${number}`
}

function getEmail(username) {
    return `${normalizeUsername(username)}@${DOMAIN}`
}

function escapeRegExp(value) {
    return String(value).replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
    )
}

function decodeHtml(value) {
    if (!value) return ''

    return String(value)
        .replace(
            /&nbsp;/gi,
            ' '
        )
        .replace(
            /&amp;/gi,
            '&'
        )
        .replace(
            /&lt;/gi,
            '<'
        )
        .replace(
            /&gt;/gi,
            '>'
        )
        .replace(
            /&quot;/gi,
            '"'
        )
        .replace(
            /&#39;/gi,
            "'"
        )
        .replace(
            /&#x27;/gi,
            "'"
        )
}

function stripHtml(html) {
    if (!html) return ''

    return decodeHtml(
        String(html)
            .replace(
                /<script[\s\S]*?<\/script>/gi,
                ' '
            )
            .replace(
                /<style[\s\S]*?<\/style>/gi,
                ' '
            )
            .replace(
                /<noscript[\s\S]*?<\/noscript>/gi,
                ' '
            )
            .replace(
                /<[^>]+>/g,
                ' '
            )
            .replace(
                /\s+/g,
                ' '
            )
            .trim()
    )
}

function extractAttribute(
    html,
    attribute,
    valuePattern
) {
    const regex = new RegExp(
        `<[^>]+${attribute}\\s*=\\s*["'][^"']*${valuePattern}[^"']*["'][^>]*>`,
        'i'
    )

    const match =
        html.match(regex)

    return match
        ? match[0]
        : null
}

function extractMessageIdFromHref(
    href
) {
    if (!href) return null

    const decoded =
        decodeHtml(href)

    const match =
        decoded.match(
            /\/message\/us\/([a-f0-9-]{20,})/i
        )

    return match
        ? match[1]
        : null
}

function extractLinks(html) {
    const links = []

    const regex =
        /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi

    let match

    while (
        (match = regex.exec(html))
    ) {
        const href = decodeHtml(
            match[1]
        )

        const text =
            stripHtml(match[2])

        const messageId =
            extractMessageIdFromHref(
                href
            )

        if (messageId) {
            links.push({
                id: messageId,
                href,
                text
            })
        }
    }

    return links
}

function uniqueMessages(messages) {
    const map = new Map()

    for (const message of messages) {
        if (!message || !message.id) {
            continue
        }

        if (!map.has(message.id)) {
            map.set(
                message.id,
                message
            )
        }
    }

    return Array.from(
        map.values()
    )
}

function parseInboxHtml(
    html,
    email
) {
    const messages = []
    const links =
        extractLinks(html)

    for (const link of links) {
        const containerRegex =
            new RegExp(
                `<(?:div|li|article|tr)[^>]*>[\\s\\S]{0,5000}?${escapeRegExp(link.id)}[\\s\\S]{0,5000}?<\\/(?:div|li|article|tr)>`,
                'i'
            )

        const container =
            html.match(
                containerRegex
            )

        const text =
            stripHtml(
                container
                    ? container[0]
                    : link.text
            )

        let subject = ''
        let sender = ''
        let date = ''

        const subjectMatch =
            text.match(
                /(?:subject|subjek)\s*[:\-]\s*(.+?)(?=\s+(?:from|sender|pengirim|date|tanggal)\s*[:\-]|$)/i
            )

        if (subjectMatch) {
            subject =
                subjectMatch[1].trim()
        }

        const senderMatch =
            text.match(
                /(?:from|sender|pengirim)\s*[:\-]\s*([^\s]+@[^\s]+)/i
            )

        if (senderMatch) {
            sender =
                senderMatch[1].trim()
        }

        const dateMatch =
            text.match(
                /(?:date|tanggal)\s*[:\-]\s*(.+)$/i
            )

        if (dateMatch) {
            date =
                dateMatch[1].trim()
        }

        if (!subject) {
            const titleMatch =
                text.match(
                    /(?:subject|subjek)\s+(.{1,200})/i
                )

            if (titleMatch) {
                subject =
                    titleMatch[1].trim()
            }
        }

        if (!sender) {
            const emailMatch =
                text.match(
                    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
                )

            if (
                emailMatch &&
                emailMatch[0].toLowerCase() !==
                    email.toLowerCase()
            ) {
                sender =
                    emailMatch[0]
            }
        }

        messages.push({
            id: link.id,
            messageId: link.id,
            uid: link.id,
            subject:
                subject ||
                link.text ||
                'Pesan masuk',
            sender:
                sender ||
                null,
            from:
                sender ||
                null,
            date:
                date ||
                null,
            email,
            url:
                new URL(
                    `/inbox/${encodeURIComponent(email)}/message/us/${encodeURIComponent(link.id)}`,
                    PROVIDER_BASE_URL
                ).toString()
        })
    }

    return uniqueMessages(
        messages
    )
}

function parseMessageHtml(
    html,
    email,
    messageId
) {
    const titleMatch =
        html.match(
            /<title[^>]*>([\s\S]*?)<\/title>/i
        )

    const title =
        titleMatch
            ? stripHtml(titleMatch[1])
            : ''

    const plain =
        stripHtml(html)

    let subject = ''

    const subjectMatch =
        plain.match(
            /(?:subject|subjek)\s*[:\-]\s*(.+?)(?=\s+(?:from|sender|pengirim|to|kepada|date|tanggal)\s*[:\-]|$)/i
        )

    if (subjectMatch) {
        subject =
            subjectMatch[1].trim()
    }

    let sender = null

    const senderMatch =
        plain.match(
            /(?:from|sender|pengirim)\s*[:\-]\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i
        )

    if (senderMatch) {
        sender =
            senderMatch[1]
    }

    let recipient = null

    const recipientMatch =
        plain.match(
            /(?:to|kepada)\s*[:\-]\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i
        )

    if (recipientMatch) {
        recipient =
            recipientMatch[1]
    }

    let date = null

    const dateMatch =
        plain.match(
            /(?:date|tanggal)\s*[:\-]\s*(.+?)(?=\s+(?:subject|subjek|from|sender|pengirim|to|kepada)\s*[:\-]|$)/i
        )

    if (dateMatch) {
        date =
            dateMatch[1].trim()
    }

    let content = ''

    const contentPatterns = [
        /<(?:div|section|article)[^>]*(?:class|id)\s*=\s*["'][^"']*(?:message|content|body|email)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section|article)>/gi,
        /<(?:main|article)[^>]*>([\s\S]*?)<\/(?:main|article)>/gi
    ]

    for (const pattern of contentPatterns) {
        const matches = [
            ...html.matchAll(pattern)
        ]

        if (matches.length) {
            const candidate =
                stripHtml(
                    matches[
                        matches.length - 1
                    ][1]
                )

            if (
                candidate &&
                candidate.length > content.length
            ) {
                content =
                    candidate
            }
        }
    }

    if (!content) {
        content = plain
    }

    return {
        id: messageId,
        messageId,
        uid: messageId,
        email,
        subject:
            subject ||
            title ||
            'Pesan',
        sender,
        from: sender,
        recipient,
        to: recipient,
        date,
        content,
        text: content,
        html,
        url:
            new URL(
                `/inbox/${encodeURIComponent(email)}/message/us/${encodeURIComponent(messageId)}`,
                PROVIDER_BASE_URL
            ).toString()
    }
}

async function providerInbox(
    username
) {
    const cleanUsername =
        normalizeUsername(username)

    if (!cleanUsername) {
        throw new Error(
            'Username wajib diisi.'
        )
    }

    const email =
        getEmail(cleanUsername)

    const url =
        `${PROVIDER_BASE_URL}/inbox/` +
        encodeURIComponent(email) +
        `/list`

    const response =
        await request(url, {
            timeout: 15000
        })

    if (
        response.statusCode < 200 ||
        response.statusCode >= 300
    ) {
        throw new Error(
            `Provider mengembalikan HTTP ${response.statusCode}.`
        )
    }

    const messages =
        parseInboxHtml(
            response.body,
            email
        )

    return {
        username:
            cleanUsername,
        email,
        messages,
        statusCode:
            response.statusCode,
        url:
            response.url
    }
}

async function providerMessage(
    username,
    messageId
) {
    const cleanUsername =
        normalizeUsername(username)

    if (!cleanUsername) {
        throw new Error(
            'Username wajib diisi.'
        )
    }

    if (!messageId) {
        throw new Error(
            'Message ID wajib diisi.'
        )
    }

    const email =
        getEmail(cleanUsername)

    const url =
        `${PROVIDER_BASE_URL}/inbox/` +
        encodeURIComponent(email) +
        `/message/us/` +
        encodeURIComponent(messageId)

    const response =
        await request(url, {
            timeout: 15000
        })

    if (
        response.statusCode < 200 ||
        response.statusCode >= 300
    ) {
        throw new Error(
            `Provider mengembalikan HTTP ${response.statusCode}.`
        )
    }

    const message =
        parseMessageHtml(
            response.body,
            email,
            messageId
        )

    return {
        username:
            cleanUsername,
        email,
        found: true,
        message,
        statusCode:
            response.statusCode,
        url:
            response.url
    }
}

async function isUsernameAvailable(
    username
) {
    try {
        const result =
            await providerInbox(
                username
            )

        return (
            result.messages.length === 0
        )
    } catch {
        return true
    }
}

async function createUsername(
    customUsername = null
) {
    const manual =
        normalizeUsername(
            customUsername
        )

    for (
        let attempt = 0;
        attempt < 10;
        attempt++
    ) {
        const candidate =
            manual
                ? generateManualUsername(
                      manual
                  )
                : generateUsername()

        if (
            await isUsernameAvailable(
                candidate
            )
        ) {
            return candidate
        }
    }

    throw new Error(
        'Tidak mendapatkan username unik setelah 10 percobaan.'
    )
}

async function createTempEmail(
    customUsername = null
) {
    const username =
        await createUsername(
            customUsername
        )

    return {
        username,
        email:
            getEmail(username),
        domain:
            DOMAIN
    }
}

async function getInbox(
    username
) {
    const result =
        await providerInbox(
            username
        )

    return {
        username:
            result.username,
        email:
            result.email,
        total:
            result.messages.length,
        messages:
            result.messages
    }
}

async function getMessage(
    username,
    messageId
) {
    return providerMessage(
        username,
        messageId
    )
}

async function proxyProvider(
    req,
    res
) {
    const query =
        req.query || {}

    const username =
        query.username ||
        query.mailbox ||
        query.recipient

    const id =
        query.id ||
        query.messageId ||
        query.uid

    if (!username) {
        return res.status(400).json({
            status: false,
            creator: 'ReyCode',
            error:
                'Parameter username wajib diisi.'
        })
    }

    try {
        if (id) {
            const data =
                await providerMessage(
                    username,
                    id
                )

            return res.status(200).json({
                status: true,
                creator: 'ReyCode',
                provider: DOMAIN,
                data
            })
        }

        const data =
            await providerInbox(
                username
            )

        return res.status(200).json({
            status: true,
            creator: 'ReyCode',
            provider: DOMAIN,
            data
        })
    } catch (error) {
        return res.status(500).json({
            status: false,
            creator: 'ReyCode',
            provider: DOMAIN,
            error:
                error.message
        })
    }
}

module.exports = async function handler(
    req,
    res
) {
    const query =
        req.query || {}

    const action =
        String(
            query.action || 'info'
        ).toLowerCase()

    try {
        if (action === 'create') {
            const customUsername =
                query.username ||
                query.name ||
                null

            const data =
                await createTempEmail(
                    customUsername
                )

            return res.status(200).json({
                status: true,
                creator: 'ReyCode',
                provider: DOMAIN,
                data
            })
        }

        if (
            action === 'inbox' ||
            action === 'check'
        ) {
            const username =
                query.username ||
                query.mailbox ||
                query.recipient

            if (!username) {
                return res.status(400).json({
                    status: false,
                    creator: 'ReyCode',
                    error:
                        'Parameter username wajib diisi.'
                })
            }

            const data =
                await getInbox(
                    username
                )

            return res.status(200).json({
                status: true,
                creator: 'ReyCode',
                provider: DOMAIN,
                data
            })
        }

        if (action === 'message') {
            const username =
                query.username ||
                query.mailbox ||
                query.recipient

            const id =
                query.id ||
                query.messageId ||
                query.uid

            if (!username) {
                return res.status(400).json({
                    status: false,
                    creator: 'ReyCode',
                    error:
                        'Parameter username wajib diisi.'
                })
            }

            if (!id) {
                return res.status(400).json({
                    status: false,
                    creator: 'ReyCode',
                    error:
                        'Parameter message ID wajib diisi.'
                })
            }

            const data =
                await getMessage(
                    username,
                    id
                )

            return res.status(200).json({
                status: true,
                creator: 'ReyCode',
                provider: DOMAIN,
                data
            })
        }

        if (action === 'provider') {
            return proxyProvider(
                req,
                res
            )
        }

        return res.status(200).json({
            status: true,
            creator: 'ReyCode',
            name:
                'ReyCode TempMail',
            provider:
                DOMAIN,
            message:
                'Temporary Mail API is online.',
            endpoints: {
                create:
                    '/api/mail?action=create',
                create_custom:
                    '/api/mail?action=create&username=reycode',
                inbox:
                    '/api/mail?action=inbox&username=lucky_lion625',
                check:
                    '/api/mail?action=check&username=lucky_lion625',
                message:
                    '/api/mail?action=message&username=lucky_lion625&id=4c6c2f7c-e820-4cf9-9d4b-226948dd19c3',
                provider:
                    '/api/mail?action=provider&username=lucky_lion625&id=4c6c2f7c-e820-4cf9-9d4b-226948dd19c3'
            }
        })
    } catch (error) {
        return res.status(500).json({
            status: false,
            creator: 'ReyCode',
            error:
                error.message
        })
    }
}

module.exports.createTempEmail =
    createTempEmail

module.exports.generateUsername =
    generateUsername

module.exports.generateManualUsername =
    generateManualUsername

module.exports.getInbox =
    getInbox

module.exports.getMessage =
    getMessage