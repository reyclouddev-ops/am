const axios = require('axios')
const cheerio = require('cheerio')
const vm = require('node:vm')

const TIKWM_URL = 'https://www.tikwm.com/api/'
const SAVETIK_URL = 'https://savetik.co/api/ajaxSearch'
const GETDL_URL = 'https://getdl.space/api/download'
const INDOWN_PAGE = 'https://indown.io/en1'
const INDOWN_DOWNLOAD = 'https://indown.io/download'
const SNAP_SAVE_URL = 'https://snapsave.app/id/action.php?lang=id'

function formatNumber(integer) {
    const numb = parseInt(integer)

    if (
        Number.isNaN(numb)
    ) {
        return '0'
    }

    return Number(
        numb
    ).toLocaleString(
        'id-ID'
    )
}

function formatDate(
    value,
    locale = 'id-ID'
) {
    const date =
        new Date(
            value
        )

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        return null
    }

    return date.toLocaleString(
        locale,
        {
            weekday:
                'long',
            day:
                'numeric',
            month:
                'long',
            year:
                'numeric',
            hour:
                'numeric',
            minute:
                'numeric',
            second:
                'numeric'
        }
    )
}

function isValidUrl(
    value
) {
    try {
        const url =
            new URL(
                value
            )

        return (
            url.protocol ===
                'http:' ||
            url.protocol ===
                'https:'
        )
    } catch {
        return false
    }
}

function normalizeUrl(
    value
) {
    if (
        typeof value !==
        'string'
    ) {
        return ''
    }

    return value.trim()
}

function detectPlatform(
    url
) {
    const value =
        normalizeUrl(
            url
        ).toLowerCase()

    if (
        value.includes(
            'tiktok.com'
        ) ||
        value.includes(
            'vm.tiktok.com'
        ) ||
        value.includes(
            'vt.tiktok.com'
        )
    ) {
        return 'tiktok'
    }

    if (
        value.includes(
            'instagram.com'
        ) ||
        value.includes(
            'instagr.am'
        )
    ) {
        return 'instagram'
    }

    if (
        value.includes(
            'youtube.com'
        ) ||
        value.includes(
            'youtu.be'
        )
    ) {
        return 'youtube'
    }

    if (
        value.includes(
            'facebook.com'
        ) ||
        value.includes(
            'fb.watch'
        ) ||
        value.includes(
            'm.facebook.com'
        )
    ) {
        return 'facebook'
    }

    if (
        value.includes(
            'twitter.com'
        ) ||
        value.includes(
            'x.com'
        )
    ) {
        return 'twitter'
    }

    return 'unknown'
}

async function tiktokv1(
    url
) {
    try {
        const response =
            await axios.post(
                TIKWM_URL,
                {},
                {
                    params: {
                        url,
                        count:
                            12,
                        cursor:
                            0,
                        web:
                            1,
                        hd:
                            1
                    },
                    headers: {
                        Accept:
                            'application/json, text/javascript, */*; q=0.01',
                        'Accept-Language':
                            'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
                        'Content-Type':
                            'application/x-www-form-urlencoded; charset=UTF-8',
                        Origin:
                            'https://www.tikwm.com',
                        Referer:
                            'https://www.tikwm.com/',
                        'Sec-Ch-Ua':
                            '"Not)A;Brand";v="24", "Chromium";v="116"',
                        'Sec-Ch-Ua-Mobile':
                            '?1',
                        'Sec-Ch-Ua-Platform':
                            'Android',
                        'Sec-Fetch-Dest':
                            'empty',
                        'Sec-Fetch-Mode':
                            'cors',
                        'Sec-Fetch-Site':
                            'same-origin',
                        'User-Agent':
                            'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
                        'X-Requested-With':
                            'XMLHttpRequest'
                    },
                    timeout:
                        60000,
                    validateStatus:
                        () => true
                }
            )

        if (
            response.status <
                200 ||
            response.status >=
                300
        ) {
            return {
                status:
                    false,
                source:
                    'tiktokv1',
                message:
                    `TikWM HTTP ${response.status}.`
            }
        }

        const res =
            response.data?.data

        if (
            !res
        ) {
            return {
                status:
                    false,
                source:
                    'tiktokv1',
                message:
                    'Data TikTok tidak ditemukan.'
            }
        }

        const data =
            []

        if (
            Number(
                res.duration
            ) ===
            0
        ) {
            for (
                const image of
                res.images ||
                []
            ) {
                if (
                    image
                ) {
                    data.push({
                        type:
                            'photo',
                        url:
                            image
                    })
                }
            }
        } else {
            if (
                res.wmplay
            ) {
                data.push({
                    type:
                        'watermark',
                    url:
                        `https://www.tikwm.com${res.wmplay}`
                })
            }

            if (
                res.play
            ) {
                data.push({
                    type:
                        'nowatermark',
                    url:
                        `https://www.tikwm.com${res.play}`
                })
            }

            if (
                res.hdplay
            ) {
                data.push({
                    type:
                        'nowatermark_hd',
                    url:
                        `https://www.tikwm.com${res.hdplay}`
                })
            }
        }

        return {
            status:
                true,
            source:
                'tiktokv1',
            title:
                res.title ||
                null,
            taken_at:
                formatDate(
                    Number(
                        res.create_time
                    ) *
                    1000
                ),
            region:
                res.region ||
                null,
            id:
                res.id ||
                null,
            durations:
                Number(
                    res.duration ||
                    0
                ),
            duration:
                `${Number(
                    res.duration ||
                    0
                )} Seconds`,
            cover:
                res.cover
                    ? `https://www.tikwm.com${res.cover}`
                    : null,
            size_wm:
                res.wm_size ||
                null,
            size_nowm:
                res.size ||
                null,
            size_nowm_hd:
                res.hd_size ||
                null,
            data,
            music_info: {
                id:
                    res.music_info?.id ||
                    null,
                title:
                    res.music_info?.title ||
                    null,
                author:
                    res.music_info?.author ||
                    null,
                album:
                    res.music_info?.album ||
                    null,
                url:
                    res.music
                        ? `https://www.tikwm.com${res.music}`
                        : res.music_info?.play ||
                          null
            },
            stats: {
                views:
                    formatNumber(
                        res.play_count
                    ),
                likes:
                    formatNumber(
                        res.digg_count
                    ),
                comment:
                    formatNumber(
                        res.comment_count
                    ),
                share:
                    formatNumber(
                        res.share_count
                    ),
                download:
                    formatNumber(
                        res.download_count
                    )
            },
            author: {
                id:
                    res.author?.id ||
                    null,
                fullname:
                    res.author?.unique_id ||
                    null,
                nickname:
                    res.author?.nickname ||
                    null,
                avatar:
                    res.author?.avatar
                        ? `https://www.tikwm.com${res.author.avatar}`
                        : null
            }
        }
    } catch (
        error
    ) {
        return {
            status:
                false,
            source:
                'tiktokv1',
            message:
                error?.message ||
                'TikTok v1 gagal.'
        }
    }
}

async function tiktokv2(
    url
) {
    try {
        const response =
            await axios.post(
                SAVETIK_URL,
                new URLSearchParams({
                    q:
                        url,
                    lang:
                        'id'
                }).toString(),
                {
                    headers: {
                        'User-Agent':
                            'Mozilla/5.0 (Linux; Android 10)',
                        'Content-Type':
                            'application/x-www-form-urlencoded',
                        'X-Requested-With':
                            'XMLHttpRequest',
                        origin:
                            'https://savetik.co',
                        referer:
                            'https://savetik.co/id1'
                    },
                    timeout:
                        60000
                }
            )

        const html =
            response.data?.data ||
            response.data

        const $ =
            cheerio.load(
                html ||
                ''
            )

        const photos =
            $('.photo-list a[href*="snapcdn"]')
                .map(
                    (
                        _,
                        element
                    ) =>
                        $(element).attr(
                            'href'
                        )
                )
                .get()
                .filter(
                    Boolean
                )

        return {
            status:
                true,
            source:
                'tiktokv2',
            title:
                $('h3')
                    .first()
                    .text()
                    .trim() ||
                null,
            thumbnail:
                $('.image-tik img')
                    .attr(
                        'src'
                    ) ||
                $('.thumbnail img')
                    .attr(
                        'src'
                    ) ||
                null,
            mp4:
                $('.dl-action a:contains("MP4")')
                    .not(
                        ':contains("HD")'
                    )
                    .attr(
                        'href'
                    ) ||
                null,
            mp4_hd:
                $('.dl-action a:contains("HD")')
                    .attr(
                        'href'
                    ) ||
                null,
            mp3:
                $('.dl-action a:contains("MP3")')
                    .attr(
                        'href'
                    ) ||
                null,
            foto:
                [
                    ...new Set(
                        photos
                    )
                ]
        }
    } catch (
        error
    ) {
        return {
            status:
                false,
            source:
                'tiktokv2',
            message:
                error?.message ||
                'TikTok v2 gagal.'
        }
    }
}

async function getDL(
    targetUrl
) {
    if (
        !targetUrl
    ) {
        return {
            status:
                false,
            source:
                'getdl',
            message:
                'URL wajib diisi.'
        }
    }

    if (
        typeof targetUrl !==
        'string'
    ) {
        return {
            status:
                false,
            source:
                'getdl',
            message:
                'URL harus berupa string.'
        }
    }

    targetUrl =
        targetUrl.trim()

    if (
        !isValidUrl(
            targetUrl
        )
    ) {
        return {
            status:
                false,
            source:
                'getdl',
            message:
                'URL tidak valid.'
        }
    }

    try {
        const response =
            await axios.post(
                GETDL_URL,
                {
                    url:
                        targetUrl
                },
                {
                    headers: {
                        'User-Agent':
                            'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
                        Referer:
                            'https://getdl.space/id',
                        Origin:
                            'https://getdl.space',
                        'Content-Type':
                            'application/json',
                        Accept:
                            'application/json, text/plain, */*',
                        Cookie:
                            'NEXT_LOCALE=id'
                    },
                    timeout:
                        60000,
                    responseType:
                        'json',
                    validateStatus:
                        () => true
                }
            )

        if (
            response.status <
                200 ||
            response.status >=
                300
        ) {
            return {
                status:
                    false,
                source:
                    'getdl',
                statusCode:
                    response.status,
                message:
                    response.data?.message ||
                    response.data?.error ||
                    `GetDL mengembalikan HTTP ${response.status}.`,
                data:
                    response.data ??
                    null
            }
        }

        return {
            status:
                true,
            source:
                'getdl',
            statusCode:
                response.status,
            data:
                response.data
        }
    } catch (
        error
    ) {
        return {
            status:
                false,
            source:
                'getdl',
            message:
                error.response?.data?.message ||
                error.response?.data?.error ||
                error.message ||
                'Gagal menghubungi GetDL.'
        }
    }
}

async function indown(
    url
) {
    try {
        const page =
            await axios.get(
                INDOWN_PAGE,
                {
                    headers: {
                        'User-Agent':
                            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
                    },
                    timeout:
                        60000
                }
            )

        const $ =
            cheerio.load(
                page.data
            )

        const token =
            $('input[name="_token"]')
                .val()

        const cookies =
            page.headers[
                'set-cookie'
            ]
                ? page.headers[
                    'set-cookie'
                ]
                    .map(
                        value =>
                            value.split(
                                ';'
                            )[0]
                    )
                    .join(
                        '; '
                    )
                : ''

        if (
            !token
        ) {
            throw new Error(
                'Token Indown not found'
            )
        }

        const params =
            new URLSearchParams()

        params.append(
            'referer',
            INDOWN_PAGE
        )

        params.append(
            'locale',
            'en'
        )

        params.append(
            '_token',
            token
        )

        params.append(
            'link',
            url
        )

        params.append(
            'p',
            'i'
        )

        const response =
            await axios.post(
                INDOWN_DOWNLOAD,
                params,
                {
                    headers: {
                        'Content-Type':
                            'application/x-www-form-urlencoded',
                        Cookie:
                            cookies,
                        'User-Agent':
                            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
                    },
                    timeout:
                        60000
                }
            )

        const $result =
            cheerio.load(
                response.data
            )

        const resultUrls =
            []

        $result(
            'video source[src], a[href].btn-outline-primary'
        ).each(
            (
                _,
                element
            ) => {
                let link =
                    $result(
                        element
                    ).attr(
                        'src'
                    ) ||
                    $result(
                        element
                    ).attr(
                        'href'
                    )

                if (
                    !link
                ) {
                    return
                }

                if (
                    link.includes(
                        'indown.io/fetch'
                    )
                ) {
                    try {
                        const encoded =
                            new URL(
                                link
                            ).searchParams.get(
                                'url'
                            )

                        if (
                            encoded
                        ) {
                            link =
                                decodeURIComponent(
                                    encoded
                                )
                        }
                    } catch {}
                }

                if (
                    /cdninstagram\.com|fbcdn\.net/i.test(
                        link
                    )
                ) {
                    resultUrls.push(
                        link.replace(
                            /&dl=1$/,
                            ''
                        )
                    )
                }
            }
        )

        const uniqueUrls =
            [
                ...new Set(
                    resultUrls
                )
            ]

        if (
            uniqueUrls.length ===
            0
        ) {
            throw new Error(
                'No media found'
            )
        }

        return {
            status:
                true,
            source:
                'indown',
            result: {
                metadata: {
                    username:
                        '-',
                    caption:
                        'Downloaded via Indown'
                },
                downloadUrl:
                    uniqueUrls
            }
        }
    } catch (
        error
    ) {
        return {
            status:
                false,
            source:
                'indown',
            message:
                error?.message ||
                'Indown gagal.'
        }
    }
}

async function snapsave(
    targetUrl
) {
    try {
        const form =
            new URLSearchParams()

        form.append(
            'url',
            targetUrl
        )

        const response =
            await axios.post(
                SNAP_SAVE_URL,
                form,
                {
                    headers: {
                        origin:
                            'https://snapsave.app',
                        referer:
                            'https://snapsave.app/id/download-video-instagram',
                        'user-agent':
                            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    },
                    timeout:
                        60000
                }
            )

        const ctx = {
            window: {},
            document: {
                getElementById:
                    () => ({
                        value:
                            ''
                    })
            },
            console,
            eval:
                value =>
                    value
        }

        vm.createContext(
            ctx
        )

        const decoded =
            vm.runInContext(
                response.data,
                ctx
            )

        const regex =
            /https:\/\/d\.rapidcdn\.app\/v2\?[^"]+/g

        const matches =
            String(
                decoded
            ).match(
                regex
            )

        if (
            !matches?.length
        ) {
            throw new Error(
                'No media found'
            )
        }

        const cleanUrls =
            [
                ...new Set(
                    matches.map(
                        value =>
                            value.replace(
                                /&amp;/g,
                                '&'
                            )
                    )
                )
            ]

        return {
            status:
                true,
            source:
                'snapsave',
            result: {
                metadata: {
                    username:
                        '-',
                    caption:
                        'Downloaded via Snapsave'
                },
                downloadUrl:
                    cleanUrls
            }
        }
    } catch (
        error
    ) {
        return {
            status:
                false,
            source:
                'snapsave',
            message:
                error?.message ||
                'Snapsave gagal.'
        }
    }
}

async function igdl(
    url
) {
    const first =
        await indown(
            url
        )

    if (
        first.status &&
        first.result?.downloadUrl?.length
    ) {
        return first
    }

    const second =
        await snapsave(
            url
        )

    if (
        second.status
    ) {
        return second
    }

    return {
        status:
            false,
        source:
            'igdl',
        message:
            second.message ||
            first.message ||
            'Instagram download gagal.',
        fallback: {
            indown:
                first,
            snapsave:
                second
        }
    }
}

async function runSource(
    source,
    url
) {
    switch (
        String(
            source ||
            'auto'
        ).toLowerCase()
    ) {
        case 'tiktokv1':
        case 'tikwm':
            return tiktokv1(
                url
            )

        case 'tiktokv2':
        case 'savetik':
            return tiktokv2(
                url
            )

        case 'getdl':
            return getDL(
                url
            )

        case 'indown':
            return indown(
                url
            )

        case 'snapsave':
            return snapsave(
                url
            )

        case 'igdl':
        case 'instagram':
            return igdl(
                url
            )

        case 'auto': {
            const platform =
                detectPlatform(
                    url
                )

            if (
                platform ===
                'tiktok'
            ) {
                const first =
                    await tiktokv1(
                        url
                    )

                if (
                    first.status
                ) {
                    return first
                }

                const second =
                    await tiktokv2(
                        url
                    )

                if (
                    second.status
                ) {
                    return second
                }

                return {
                    status:
                        false,
                    source:
                        'auto',
                    platform,
                    message:
                        'Semua scraper TikTok gagal.',
                    fallback: {
                        tiktokv1:
                            first,
                        tiktokv2:
                            second
                    }
                }
            }

            if (
                platform ===
                'instagram'
            ) {
                return igdl(
                    url
                )
            }

            const result =
                await getDL(
                    url
                )

            return result
        }

        default:
            return {
                status:
                    false,
                message:
                    `Source "${source}" tidak tersedia.`
            }
    }
}

function getInputUrl(
    req
) {
    const query =
        req.query ||
        {}

    const body =
        req.body ||
        {}

    return normalizeUrl(
        body.url ||
        body.link ||
        body.targetUrl ||
        query.url ||
        query.link ||
        query.targetUrl
    )
}

async function handler(
    req,
    res
) {
    const method =
        String(
            req.method ||
            'GET'
        ).toUpperCase()

    try {
        if (
            method ===
            'GET'
        ) {
            return res.status(
                200
            ).json({
                status:
                    true,
                creator:
                    'ReyCloudSHP',
                message:
                    'Multi Platform Downloader API aktif.',
                endpoint:
                    '/api/multiflatfrom',
                method:
                    'POST',
                parameter: {
                    url:
                        'URL media',
                    source:
                        'auto | tiktokv1 | tiktokv2 | igdl | indown | snapsave | getdl'
                },
                platforms: [
                    'TikTok',
                    'Instagram',
                    'YouTube',
                    'Facebook',
                    'Twitter/X',
                    'Other supported platforms via GetDL'
                ]
            })
        }

        if (
            method !==
            'POST'
        ) {
            res.setHeader(
                'Allow',
                'GET, POST'
            )

            return res.status(
                405
            ).json({
                status:
                    false,
                creator:
                    'ReyCloudSHP',
                message:
                    'Method tidak diizinkan.'
            })
        }

        const url =
            getInputUrl(
                req
            )

        const source =
            req.body?.source ||
            req.query?.source ||
            'auto'

        if (
            !url
        ) {
            return res.status(
                400
            ).json({
                status:
                    false,
                creator:
                    'ReyCloudSHP',
                message:
                    'Parameter url wajib diisi.'
            })
        }

        if (
            !isValidUrl(
                url
            )
        ) {
            return res.status(
                400
            ).json({
                status:
                    false,
                creator:
                    'ReyCloudSHP',
                message:
                    'URL tidak valid.'
            })
        }

        const result =
            await runSource(
                source,
                url
            )

        return res.status(
            result.status
                ? 200
                : 502
        ).json({
            creator:
                'ReyCloudSHP',
            ...result
        })
    } catch (
        error
    ) {
        console.error(
            '[MULTIFLATFROM API]',
            error
        )

        return res.status(
            500
        ).json({
            status:
                false,
            creator:
                'ReyCloudSHP',
            message:
                error?.message ||
                'Gagal memproses request.'
        })
    }
}

handler.tiktokv1 =
    tiktokv1

handler.tiktokv2 =
    tiktokv2

handler.getDL =
    getDL

handler.indown =
    indown

handler.snapsave =
    snapsave

handler.igdl =
    igdl

handler.runSource =
    runSource

module.exports =
    handler