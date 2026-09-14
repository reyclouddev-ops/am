const crypto = require('crypto');

const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

class SimpleCookieJar {
    constructor() {
        this.cookies = new Map();
    }

    setFromHeaders(headers) {
        if (!headers) return;

        let setCookies = [];

        if (typeof headers.getSetCookie === 'function') {
            setCookies = headers.getSetCookie();
        } else {
            const cookie = headers.get('set-cookie');

            if (cookie) {
                setCookies = [cookie];
            }
        }

        for (const str of setCookies) {
            if (!str) continue;

            const parts = str.split(';');
            const nameValue = parts[0].trim();
            const eqIdx = nameValue.indexOf('=');

            if (eqIdx === -1) continue;

            const name = nameValue.slice(0, eqIdx).trim();
            const value = nameValue.slice(eqIdx + 1).trim();

            if (name) {
                this.cookies.set(name, value);
            }
        }
    }

    getCookieHeader() {
        return [...this.cookies.entries()]
            .map(([name, value]) => `${name}=${value}`)
            .join('; ');
    }

    get(name) {
        return this.cookies.get(name);
    }
}

function normalizeUrl(url) {
    let value = String(url || '').trim();

    if (!value) {
        return null;
    }

    if (!/^https?:\/\//i.test(value)) {
        value = `https://${value}`;
    }

    try {
        return new URL(value).href;
    } catch {
        return null;
    }
}

function generateSessionToken(rawXsrfCookie) {
    const unquotedXsrf = decodeURIComponent(rawXsrfCookie);

    const dummyFp = crypto
        .createHash('sha256')
        .update(
            'webgl:ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)||audio:12.345678901234||canvas:abcdef123||fonts:20/25||system:8CPU,8GB,Win32,0,1,0||env:Asia/Jakarta,1920,1080,24,en-US||network:4g,10,50'
        )
        .digest('hex');

    const o = `#${Buffer.from(dummyFp).toString('base64')}`;

    return unquotedXsrf.slice(0, 128 - o.length) + o;
}

async function fetchWithJar(url, options = {}, jar) {
    let currentUrl = url;
    let method = options.method || 'GET';
    let body = options.body;

    const headers = {
        'User-Agent': USER_AGENT,
        Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(options.headers || {})
    };

    const maxRedirects = 10;
    let redirectCount = 0;

    while (true) {
        const cookieHeader = jar
            ? jar.getCookieHeader()
            : '';

        if (cookieHeader) {
            headers.Cookie = cookieHeader;
        }

        const response = await fetch(currentUrl, {
            method,
            headers,
            body,
            redirect: 'manual',
            signal: AbortSignal.timeout(15000)
        });

        if (jar) {
            jar.setFromHeaders(response.headers);
        }

        if (
            response.status >= 300 &&
            response.status < 400
        ) {
            const location =
                response.headers.get('location');

            if (
                !location ||
                redirectCount >= maxRedirects
            ) {
                return response;
            }

            redirectCount++;

            headers.Referer = currentUrl;

            currentUrl =
                new URL(
                    location,
                    currentUrl
                ).href;

            method = 'GET';
            body = undefined;

            delete headers['Content-Type'];
            delete headers['Content-Length'];

            continue;
        }

        Object.defineProperty(
            response,
            'resolvedUrl',
            {
                value: currentUrl,
                writable: false
            }
        );

        return response;
    }
}

async function bypassSafelink(
    targetUrl,
    initialHtml = null,
    jar = null
) {
    if (!jar) {
        jar = new SimpleCookieJar();
    }

    let html = initialHtml;
    let currentShortlinkUrl = targetUrl;

    if (!html) {
        const response =
            await fetchWithJar(
                targetUrl,
                {},
                jar
            );

        html = await response.text();

        currentShortlinkUrl =
            response.resolvedUrl || targetUrl;
    }

    const formMatch = html.match(
        /<form[^>]+action=["']([^"']+)["'][^>]*>([\s\S]*?)<\/form>/i
    );

    const rayMatch = html.match(
        /name=["']ray_id["']\s+value=["']([^"']+)["']/i
    );

    const aliasMatch = html.match(
        /name=["']alias["']\s+value=["']([^"']+)["']/i
    );

    if (
        !formMatch ||
        !rayMatch ||
        !aliasMatch
    ) {
        return null;
    }

    const actionUrl =
        formMatch[1];

    const rayId =
        rayMatch[1];

    const alias =
        aliasMatch[1];

    const parsedAction =
        new URL(
            actionUrl,
            currentShortlinkUrl
        );

    const blogOrigin =
        `${parsedAction.protocol}//${parsedAction.host}`;

    const redirectUrl =
        `${blogOrigin}/redirect.php?ray_id=${encodeURIComponent(rayId)}&alias=${encodeURIComponent(alias)}`;

    const redirectResponse =
        await fetchWithJar(
            redirectUrl,
            {
                headers: {
                    Referer:
                        currentShortlinkUrl
                }
            },
            jar
        );

    const step1PageUrl =
        redirectResponse.resolvedUrl ||
        redirectUrl;

    const xsrf1 =
        jar.get('XSRF-TOKEN');

    if (!xsrf1) {
        throw new Error(
            'Missing XSRF-TOKEN on gateway.'
        );
    }

    const sessionHeaders = {
        Origin: blogOrigin,
        Referer: step1PageUrl,
        'Content-Type': 'application/json',
        Accept:
            'application/json, text/plain, */*',
        'X-Requested-With':
            'XMLHttpRequest'
    };

    const sessionRes1 =
        await fetchWithJar(
            `${blogOrigin}/api/session`,
            {
                method: 'POST',
                headers: sessionHeaders,
                body: JSON.stringify({
                    _token:
                        generateSessionToken(xsrf1)
                })
            },
            jar
        );

    const sessionData1 =
        await sessionRes1
            .json()
            .catch(() => ({}));

    const step =
        sessionData1.step || 1;

    let step2PageUrl =
        step1PageUrl;

    if (step === 1) {
        await new Promise(
            resolve =>
                setTimeout(resolve, 800)
        );

        const verifyRes =
            await fetchWithJar(
                `${blogOrigin}/api/verify`,
                {
                    method: 'POST',
                    headers: sessionHeaders,
                    body: JSON.stringify({
                        _a: 0,
                        captcha: null,
                        passcode: null
                    })
                },
                jar
            );

        const verifyData =
            await verifyRes
                .json()
                .catch(() => ({}));

        let target =
            verifyData.target ||
            '/redirect.php';

        if (
            target.startsWith('/')
        ) {
            target =
                `${blogOrigin}${target}`;
        }

        const response3 =
            await fetchWithJar(
                target,
                {
                    headers: {
                        Referer:
                            step1PageUrl
                    }
                },
                jar
            );

        step2PageUrl =
            response3.resolvedUrl ||
            target;

        const xsrf2 =
            jar.get('XSRF-TOKEN') ||
            xsrf1;

        sessionHeaders.Referer =
            step2PageUrl;

        await fetchWithJar(
            `${blogOrigin}/api/session`,
            {
                method: 'POST',
                headers: sessionHeaders,
                body: JSON.stringify({
                    _token:
                        generateSessionToken(
                            xsrf2
                        )
                })
            },
            jar
        );
    }

    await new Promise(
        resolve =>
            setTimeout(resolve, 1500)
    );

    const key = 500;

    const size =
        `${(1920 + key) * 2}.${(1080 + key) * 2}`;

    sessionHeaders.Referer =
        step2PageUrl;

    const goRes =
        await fetchWithJar(
            `${blogOrigin}/api/go`,
            {
                method: 'POST',
                headers: sessionHeaders,
                body: JSON.stringify({
                    key,
                    size
                })
            },
            jar
        );

    const goText =
        await goRes.text();

    let goData = {};

    try {
        goData =
            JSON.parse(goText);
    } catch {
        throw new Error(
            'Invalid /api/go response.'
        );
    }

    let readyUrl =
        goData.url;

    if (!readyUrl) {
        throw new Error(
            'Failed to get ready URL.'
        );
    }

    if (
        !/^https?:\/\//i.test(
            readyUrl
        )
    ) {
        readyUrl =
            new URL(
                readyUrl,
                blogOrigin
            ).href;
    }

    const readyResponse =
        await fetchWithJar(
            readyUrl,
            {
                headers: {
                    Referer:
                        step2PageUrl
                }
            },
            jar
        );

    const htmlReady =
        await readyResponse.text();

    const destinationMatch =
        htmlReady.match(
            /window\.location\.href\s*=\s*["']([^"']+)["']/i
        );

    if (destinationMatch) {
        return destinationMatch[1]
            .replace(/\\\//g, '/')
            .replace(/\\u0026/g, '&');
    }

    return readyUrl;
}

async function resolveChain(initialUrl) {
    let currentUrl =
        normalizeUrl(initialUrl);

    if (!currentUrl) {
        throw new Error(
            'URL tidak valid.'
        );
    }

    const visited =
        new Set();

    const maxHops = 15;

    for (
        let hop = 1;
        hop <= maxHops;
        hop++
    ) {
        if (
            visited.has(currentUrl)
        ) {
            break;
        }

        visited.add(currentUrl);

        const jar =
            new SimpleCookieJar();

        let response;

        try {
            response =
                await fetchWithJar(
                    currentUrl,
                    {},
                    jar
                );
        } catch (error) {
            throw new Error(
                `Fetch failed: ${error.message}`
            );
        }

        if (
            response.status >= 300 &&
            response.status < 400
        ) {
            const location =
                response.headers.get(
                    'location'
                );

            if (location) {
                currentUrl =
                    new URL(
                        location,
                        currentUrl
                    ).href;

                continue;
            }
        }

        const html =
            await response.text();

        const hasSafelinkStructure =
            html.includes(
                'name="ray_id"'
            ) ||
            html.includes(
                "name='ray_id'"
            ) ||
            html.includes(
                'redirect.php'
            );

        if (hasSafelinkStructure) {
            try {
                const destination =
                    await bypassSafelink(
                        currentUrl,
                        html,
                        jar
                    );

                if (
                    destination &&
                    destination !== currentUrl
                ) {
                    currentUrl =
                        normalizeUrl(
                            destination
                        ) ||
                        destination;

                    continue;
                }
            } catch {
            }
        }

        const metaRefresh =
            html.match(
                /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["']/i
            );

        if (metaRefresh) {
            currentUrl =
                new URL(
                    metaRefresh[1].trim(),
                    currentUrl
                ).href;

            continue;
        }

        const locationScript =
            html.match(
                /window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i
            );

        if (locationScript) {
            const destination =
                locationScript[1]
                    .replace(
                        /\\\//g,
                        '/'
                    )
                    .replace(
                        /\\u0026/g,
                        '&'
                    );

            currentUrl =
                new URL(
                    destination,
                    currentUrl
                ).href;

            continue;
        }

        break;
    }

    return currentUrl;
}

function getInputUrl(req) {
    const body =
        req.body || {};

    return (
        body.url ||
        body.link ||
        body.targetUrl ||
        req.query?.url ||
        req.query?.link ||
        req.query?.targetUrl ||
        null
    );
}

async function handler(req, res) {
    res.setHeader(
        'Access-Control-Allow-Origin',
        '*'
    );

    res.setHeader(
        'Access-Control-Allow-Methods',
        'GET, POST, OPTIONS'
    );

    res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type'
    );

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method === 'GET') {
        const url =
            getInputUrl(req);

        if (!url) {
            return res.status(200).json({
                status: true,
                creator: 'ReyCode',
                name: 'Universal Safelink Bypasser',
                endpoint: '/api/safelink',
                method: 'POST',
                parameters: {
                    url: 'URL safelink'
                },
                example: {
                    url: '/api/safelink?url=https://example.com'
                }
            });
        }

        try {
            const result =
                await resolveChain(url);

            return res.status(200).json({
                status: true,
                creator: 'ReyCode',
                input: url,
                result
            });
        } catch (error) {
            return res.status(502).json({
                status: false,
                creator: 'ReyCode',
                input: url,
                message:
                    error.message ||
                    'Gagal memproses URL.'
            });
        }
    }

    if (req.method !== 'POST') {
        return res.status(405).json({
            status: false,
            message: 'Method not allowed.'
        });
    }

    const url =
        getInputUrl(req);

    if (!url) {
        return res.status(400).json({
            status: false,
            message:
                'Parameter url wajib diisi.'
        });
    }

    const normalized =
        normalizeUrl(url);

    if (!normalized) {
        return res.status(400).json({
            status: false,
            message:
                'URL tidak valid.'
        });
    }

    try {
        const startedAt =
            Date.now();

        const result =
            await resolveChain(
                normalized
            );

        return res.status(200).json({
            status: true,
            creator: 'ReyCode',
            input: normalized,
            result,
            processingTime:
                `${Date.now() - startedAt}ms`
        });
    } catch (error) {
        return res.status(502).json({
            status: false,
            creator: 'ReyCode',
            input: normalized,
            message:
                error.message ||
                'Gagal memproses safelink.'
        });
    }
}

module.exports = handler;

module.exports.resolveChain =
    resolveChain;

module.exports.bypassSafelink =
    bypassSafelink;