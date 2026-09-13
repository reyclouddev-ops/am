const https = require('https');
const http = require('http');

const DOMAIN = 'akunlama.com';
const PROVIDER_BASE_URL =
    process.env.TEMPMAIL_PROVIDER_URL ||
    `https://${DOMAIN}`;

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
    'fuzzy'
];

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
    'leopard'
];

function request(url, options = {}) {
    return new Promise((resolve, reject) => {
        try {
            const target = new URL(url);
            const client =
                target.protocol === 'https:' ? https : http;

            const req = client.request(
                target,
                {
                    method: options.method || 'GET',
                    headers: {
                        'User-Agent':
                            'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
                        'Accept':
                            'application/json, text/plain, */*',
                        ...options.headers
                    }
                },
                res => {
                    let body = '';

                    res.setEncoding('utf8');

                    res.on('data', chunk => {
                        body += chunk;
                    });

                    res.on('end', () => {
                        resolve({
                            statusCode: res.statusCode,
                            headers: res.headers,
                            body
                        });
                    });
                }
            );

            req.on('error', reject);

            if (options.body) {
                req.write(options.body);
            }

            req.end();
        } catch (error) {
            reject(error);
        }
    });
}

function normalizeUsername(input) {
    return String(input || '')
        .trim()
        .toLowerCase()
        .replace(
            new RegExp(
                `@${DOMAIN.replace('.', '\\.')}$`,
                'i'
            ),
            ''
        )
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 30);
}

function randomItem(array) {
    return array[
        Math.floor(Math.random() * array.length)
    ];
}

function randomNumber() {
    return Math.floor(100 + Math.random() * 900);
}

function generateUsername() {
    const adjective = randomItem(adjectives);
    const animal = randomItem(animals);
    const number = randomNumber();

    return `${adjective}_${animal}${number}`;
}

function generateManualUsername(input) {
    const username = normalizeUsername(input);

    if (!username) {
        throw new Error('Username tidak valid.');
    }

    const animal = randomItem(animals);
    const number = randomNumber();

    return `${username}_${animal}${number}`;
}

function getEmail(username) {
    return `${username}@${DOMAIN}`;
}

function parseJson(body) {
    try {
        return JSON.parse(body);
    } catch {
        return null;
    }
}

function extractMessages(data) {
    if (Array.isArray(data)) {
        return data;
    }

    if (!data || typeof data !== 'object') {
        return [];
    }

    if (Array.isArray(data.messages)) {
        return data.messages;
    }

    if (Array.isArray(data.data)) {
        return data.data;
    }

    if (Array.isArray(data.inbox)) {
        return data.inbox;
    }

    if (Array.isArray(data.results)) {
        return data.results;
    }

    return [];
}

async function providerInbox(username) {
    const cleanUsername =
        normalizeUsername(username);

    if (!cleanUsername) {
        throw new Error('Username wajib diisi.');
    }

    const url =
        `${PROVIDER_BASE_URL}/api/v1/mail/list?recipient=` +
        encodeURIComponent(cleanUsername);

    const response = await request(url);

    const data = parseJson(response.body);

    if (
        response.statusCode < 200 ||
        response.statusCode >= 300
    ) {
        throw new Error(
            `Provider mengembalikan HTTP ${response.statusCode}.`
        );
    }

    return {
        username: cleanUsername,
        email: getEmail(cleanUsername),
        messages: extractMessages(data),
        raw: data
    };
}

async function isUsernameAvailable(username) {
    try {
        const result =
            await providerInbox(username);

        return result.messages.length === 0;
    } catch {
        return true;
    }
}

async function createUsername(customUsername = null) {
    const manual =
        normalizeUsername(customUsername);

    for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = manual
            ? generateManualUsername(manual)
            : generateUsername();

        if (
            await isUsernameAvailable(candidate)
        ) {
            return candidate;
        }
    }

    throw new Error(
        'Tidak mendapatkan username unik setelah 10 percobaan.'
    );
}

async function createTempEmail(customUsername = null) {
    const username =
        await createUsername(customUsername);

    return {
        username,
        email: getEmail(username),
        domain: DOMAIN
    };
}

async function getInbox(username) {
    const result =
        await providerInbox(username);

    return {
        username: result.username,
        email: result.email,
        total: result.messages.length,
        messages: result.messages
    };
}

async function getMessage(username, messageId) {
    const result =
        await providerInbox(username);

    const messages = result.messages;

    const message =
        messages.find(item => {
            const id =
                item.id ??
                item._id ??
                item.messageId ??
                item.uid;

            return String(id) === String(messageId);
        }) || null;

    return {
        username: result.username,
        email: result.email,
        found: Boolean(message),
        message
    };
}

async function proxyProvider(req, res) {
    const query = req.query || {};

    const username =
        normalizeUsername(
            query.username ||
            query.mailbox ||
            query.recipient
        );

    if (!username) {
        return res.status(400).json({
            status: false,
            creator: 'ReyCode',
            error: 'Username wajib diisi.'
        });
    }

    const providerUrl =
        `${PROVIDER_BASE_URL}/api/v1/mail/list?recipient=` +
        encodeURIComponent(username);

    try {
        const response =
            await request(providerUrl);

        const contentType =
            response.headers['content-type'] ||
            'application/json';

        res.setHeader(
            'Content-Type',
            contentType
        );

        res.setHeader(
            'Cache-Control',
            'no-store, no-cache, must-revalidate, proxy-revalidate'
        );

        res.setHeader(
            'X-TempMail-Provider',
            DOMAIN
        );

        return res
            .status(response.statusCode)
            .send(response.body);
    } catch (error) {
        return res.status(502).json({
            status: false,
            creator: 'ReyCode',
            error:
                'Gagal menghubungi mail provider.',
            detail: error.message
        });
    }
}

module.exports = async function handler(req, res) {
    const query = req.query || {};
    const action =
        String(query.action || 'info')
            .toLowerCase();

    try {
        if (action === 'create') {
            const customUsername =
                query.username ||
                query.name ||
                null;

            const data =
                await createTempEmail(
                    customUsername
                );

            return res.status(200).json({
                status: true,
                creator: 'ReyCode',
                provider: DOMAIN,
                data
            });
        }

        if (
            action === 'inbox' ||
            action === 'check'
        ) {
            const username =
                query.username ||
                query.mailbox ||
                query.recipient;

            if (!username) {
                return res.status(400).json({
                    status: false,
                    creator: 'ReyCode',
                    error:
                        'Parameter username wajib diisi.'
                });
            }

            const data =
                await getInbox(username);

            return res.status(200).json({
                status: true,
                creator: 'ReyCode',
                provider: DOMAIN,
                data
            });
        }

        if (action === 'message') {
            const username =
                query.username ||
                query.mailbox ||
                query.recipient;

            const id =
                query.id ||
                query.messageId ||
                query.uid;

            if (!username) {
                return res.status(400).json({
                    status: false,
                    creator: 'ReyCode',
                    error:
                        'Parameter username wajib diisi.'
                });
            }

            if (!id) {
                return res.status(400).json({
                    status: false,
                    creator: 'ReyCode',
                    error:
                        'Parameter id wajib diisi.'
                });
            }

            const data =
                await getMessage(
                    username,
                    id
                );

            return res.status(200).json({
                status: true,
                creator: 'ReyCode',
                provider: DOMAIN,
                data
            });
        }

        if (action === 'provider') {
            return proxyProvider(req, res);
        }

        return res.status(200).json({
            status: true,
            creator: 'ReyCode',
            name: 'ReyCode TempMail',
            provider: DOMAIN,
            message:
                'Temporary Mail API is online.',
            endpoints: {
                create:
                    '/api/mail?action=create',
                create_custom:
                    '/api/mail?action=create&username=reycode',
                inbox:
                    '/api/mail?action=inbox&username=reycode_tiger123',
                check:
                    '/api/mail?action=check&username=reycode_tiger123',
                message:
                    '/api/mail?action=message&username=reycode_tiger123&id=123',
                provider:
                    '/api/mail?action=provider&username=reycode_tiger123'
            }
        });
    } catch (error) {
        return res.status(500).json({
            status: false,
            creator: 'ReyCode',
            error: error.message
        });
    }
};

module.exports.createTempEmail =
    createTempEmail;

module.exports.generateUsername =
    generateUsername;

module.exports.generateManualUsername =
    generateManualUsername;

module.exports.getInbox =
    getInbox;

module.exports.getMessage =
    getMessage;