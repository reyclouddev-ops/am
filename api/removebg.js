const multer = require('multer')

const MAX_FILE_SIZE =
    20 * 1024 * 1024

const PIXELCUT_URL =
    'https://api2.pixelcut.app/image/matte/v1'

const upload =
    multer({
        storage:
            multer.memoryStorage(),
        limits: {
            fileSize:
                MAX_FILE_SIZE
            }
        })

function getQuery(req) {
    if (
        req &&
        req.query
    ) {
        return req.query
    }

    try {
        const url =
            new URL(
                req.url,
                'http://localhost'
            )

        return Object.fromEntries(
            url.searchParams.entries()
        )
    } catch {
        return {}
    }
}

function getBody(req) {
    return req?.body || {}
}

function getImageUrl(req) {
    const body =
        getBody(req)

    const query =
        getQuery(req)

    return String(
        body.url ||
        body.image ||
        body.imageUrl ||
        query.url ||
        query.image ||
        query.imageUrl ||
        ''
    ).trim()
}

function isValidUrl(value) {
    try {
        const url =
            new URL(value)

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

async function downloadImage(
    url
) {
    if (
        !isValidUrl(
            url
        )
    ) {
        throw new Error(
            'URL gambar tidak valid.'
        )
    }

    const response =
        await fetch(
            url,
            {
                method:
                    'GET',
                headers: {
                    'User-Agent':
                        'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
                    Accept:
                        'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
                },
                signal:
                    AbortSignal.timeout(
                        60000
                    )
            }
        )

    if (
        !response.ok
    ) {
        throw new Error(
            `Gagal mengambil gambar. HTTP ${response.status}.`
        )
    }

    const contentLength =
        Number(
            response.headers.get(
                'content-length'
            ) ||
            0
        )

    if (
        contentLength >
        MAX_FILE_SIZE
    ) {
        throw new Error(
            'Ukuran gambar terlalu besar. Maksimal 20 MB.'
        )
    }

    const arrayBuffer =
        await response.arrayBuffer()

    const buffer =
        Buffer.from(
            arrayBuffer
        )

    if (
        !buffer.length
    ) {
        throw new Error(
            'Gambar yang diunduh kosong.'
        )
    }

    if (
        buffer.length >
        MAX_FILE_SIZE
    ) {
        throw new Error(
            'Ukuran gambar terlalu besar. Maksimal 20 MB.'
        )
    }

    return buffer
}

async function pixa(
    img
) {
    let buffer

    if (
        Buffer.isBuffer(
            img
        )
    ) {
        buffer =
            img
    } else if (
        typeof img ===
        'string'
    ) {
        buffer =
            await downloadImage(
                img
            )
    } else {
        throw new Error(
            'Input gambar tidak valid.'
        )
    }

    if (
        !buffer.length
    ) {
        throw new Error(
            'File gambar kosong.'
        )
    }

    if (
        buffer.length >
        MAX_FILE_SIZE
    ) {
        throw new Error(
            'Ukuran gambar terlalu besar. Maksimal 20 MB.'
        )
    }

    const form =
        new FormData()

    const blob =
        new Blob(
            [
                buffer
            ],
            {
                type:
                    'image/jpeg'
            }
        )

    form.append(
        'image',
        blob,
        'image.jpg'
    )

    form.append(
        'format',
        'png'
    )

    form.append(
        'model',
        'v1'
    )

    const response =
        await fetch(
            PIXELCUT_URL,
            {
                method:
                    'POST',
                headers: {
                    'User-Agent':
                        'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
                    Accept:
                        'application/json, text/plain, */*',
                    'sec-ch-ua':
                        '"Chromium";v="139", "Not;A=Brand";v="99"',
                    'x-locale':
                        'en',
                    'x-client-version':
                        'web:pixa.com:4a5b0af2',
                    'sec-ch-ua-mobile':
                        '?1',
                    'sec-ch-ua-platform':
                        '"Android"',
                    origin:
                        'https://www.pixa.com',
                    'sec-fetch-site':
                        'cross-site',
                    'sec-fetch-mode':
                        'cors',
                    'sec-fetch-dest':
                        'empty',
                    referer:
                        'https://www.pixa.com/',
                    'accept-language':
                        'id-ID,id;q=0.9,en-AU;q=0.8,en;q=0.7,en-US;q=0.6'
                },
                body:
                    form,
                signal:
                    AbortSignal.timeout(
                        120000
                    )
            }
        )

    if (
        !response.ok
    ) {
        let message =
            `Pixelcut API Error Status: ${response.status}`

        try {
            const errorText =
                await response.text()

            if (
                errorText
            ) {
                message +=
                    ` - ${errorText.slice(0, 500)}`
            }
        } catch {}

        throw new Error(
            message
        )
    }

    const arrayBuffer =
        await response.arrayBuffer()

    const output =
        Buffer.from(
            arrayBuffer
        )

    if (
        !output.length
    ) {
        throw new Error(
            'Pixelcut mengembalikan file kosong.'
        )
    }

    return output
}

function parseMultipart(
    req,
    res
) {
    return new Promise(
        (
            resolve,
            reject
        ) => {
            upload.single(
                'file'
            )(
                req,
                res,
                error => {
                    if (
                        error
                    ) {
                        return reject(
                            error
                        )
                    }

                    resolve()
                }
            )
        }
    )
}

function getMulterErrorMessage(
    error
) {
    if (
        error?.code ===
        'LIMIT_FILE_SIZE'
    ) {
        return 'Ukuran gambar terlalu besar. Maksimal 20 MB.'
    }

    if (
        error?.code ===
        'LIMIT_UNEXPECTED_FILE'
    ) {
        return 'Field upload harus menggunakan nama file.'
    }

    return (
        error?.message ||
        'Upload gambar gagal.'
    )
}

async function handler(
    req,
    res
) {
    const method =
        String(
            req?.method ||
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
                    'Remove Background API aktif.',
                endpoint:
                    '/api/removebg',
                method:
                    'POST',
                input: {
                    file:
                        'Multipart image file',
                    url:
                        'URL gambar'
                },
                output:
                    'PNG transparan',
                maxFileSize:
                    '20MB'
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

        const contentType =
            String(
                req.headers?.[
                    'content-type'
                ] ||
                ''
            ).toLowerCase()

        if (
            contentType.includes(
                'multipart/form-data'
            )
        ) {
            await parseMultipart(
                req,
                res
            )
        }

        let output

        if (
            req.file?.buffer
        ) {
            output =
                await pixa(
                    req.file.buffer
                )
        } else {
            const imageUrl =
                getImageUrl(
                    req
                )

            if (
                !imageUrl
            ) {
                return res.status(
                    400
                ).json({
                    status:
                        false,
                    creator:
                        'ReyCloudSHP',
                    message:
                        'Kirim file gambar atau parameter url.'
                })
            }

            output =
                await pixa(
                    imageUrl
                )
        }

        res.setHeader(
            'Content-Type',
            'image/png'
        )

        res.setHeader(
            'Content-Disposition',
            'inline; filename="removebg.png"'
        )

        res.setHeader(
            'Cache-Control',
            'no-store'
        )

        return res.status(
            200
        ).send(
            output
        )
    } catch (
        error
    ) {
        console.error(
            '[REMOVEBG API]',
            error
        )

        if (
            error instanceof
            multer.MulterError
        ) {
            return res.status(
                error.code ===
                    'LIMIT_FILE_SIZE'
                    ? 413
                    : 400
            ).json({
                status:
                    false,
                creator:
                    'ReyCloudSHP',
                message:
                    getMulterErrorMessage(
                        error
                    )
            })
        }

        return res.status(
            500
        ).json({
            status:
                false,
            creator:
                'ReyCloudSHP',
            message:
                error?.message ||
                'Gagal menghapus background gambar.'
        })
    }
}

handler.pixa =
    pixa

handler.downloadImage =
    downloadImage

module.exports =
    handler