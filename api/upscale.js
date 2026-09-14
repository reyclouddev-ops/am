const axios = require('axios')
const FormData = require('form-data')
const multer = require('multer')
const crypto = require('node:crypto')

const CLOUDINARY_CLOUD_NAME =
    process.env.CLOUDINARY_CLOUD_NAME ||
    'dtz0urit6'

const CLOUDINARY_API_KEY =
    process.env.CLOUDINARY_API_KEY ||
    ''

const CLOUDINARY_API_SECRET =
    process.env.CLOUDINARY_API_SECRET ||
    ''

const CLOUDINARY_UPLOAD_PRESET =
    process.env.CLOUDINARY_UPLOAD_PRESET ||
    'cloudinary-tools'

const CLOUDINARY_UPLOAD_URL =
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`

const MAX_FILE_SIZE =
    20 * 1024 * 1024

const REQUEST_TIMEOUT =
    60000

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

function getFilename(
    filename
) {
    let value =
        String(
            filename ||
            'image.jpg'
        )
            .trim()
            .replace(
                /[^a-zA-Z0-9._-]/g,
                '_'
            )

    if (!value) {
        value =
            'image.jpg'
    }

    if (
        !/\.[a-zA-Z0-9]+$/.test(
            value
        )
    ) {
        value += '.jpg'
    }

    return value
}

function getExtension(
    filename
) {
    const match =
        String(
            filename ||
            ''
        ).match(
            /\.([a-zA-Z0-9]+)$/
        )

    return match
        ? match[1].toLowerCase()
        : 'jpg'
}

function getContentType(
    extension
) {
    const types = {
        jpg:
            'image/jpeg',
        jpeg:
            'image/jpeg',
        png:
            'image/png',
        webp:
            'image/webp',
        gif:
            'image/gif',
        avif:
            'image/avif'
    }

    return (
        types[
            extension
        ] ||
        'image/jpeg'
    )
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
        await axios.get(
            url,
            {
                responseType:
                    'arraybuffer',
                timeout:
                    REQUEST_TIMEOUT,
                maxContentLength:
                    MAX_FILE_SIZE,
                maxBodyLength:
                    MAX_FILE_SIZE,
                validateStatus:
                    status =>
                        status >=
                            200 &&
                        status < 300
            }
        )

    const buffer =
        Buffer.from(
            response.data
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

    const contentType =
        String(
            response.headers[
                'content-type'
            ] ||
            ''
        ).toLowerCase()

    const extension =
        contentType.includes(
            'png'
        )
            ? 'png'
            : contentType.includes(
                'webp'
            )
                ? 'webp'
                : contentType.includes(
                    'gif'
                )
                    ? 'gif'
                    : 'jpg'

    return {
        buffer,
        filename:
            `image.${extension}`,
        contentType:
            getContentType(
                extension
            )
    }
}

async function getSignature() {
    if (
        !CLOUDINARY_API_SECRET
    ) {
        throw new Error(
            'CLOUDINARY_API_SECRET belum dikonfigurasi.'
        )
    }

    const timestamp =
        Math.floor(
            Date.now() / 1000
        )

    const params =
        `timestamp=${timestamp}&upload_preset=${CLOUDINARY_UPLOAD_PRESET}`

    const signature =
        crypto
            .createHash(
                'sha1'
            )
            .update(
                `${params}${CLOUDINARY_API_SECRET}`
            )
            .digest(
                'hex'
            )

    return {
        signature,
        timestamp
    }
}

async function uploadToCloudinary(
    buffer,
    filename
) {
    if (
        !CLOUDINARY_CLOUD_NAME
    ) {
        throw new Error(
            'CLOUDINARY_CLOUD_NAME belum dikonfigurasi.'
        )
    }

    if (
        !CLOUDINARY_API_KEY
    ) {
        throw new Error(
            'CLOUDINARY_API_KEY belum dikonfigurasi.'
        )
    }

    if (
        !CLOUDINARY_UPLOAD_PRESET
    ) {
        throw new Error(
            'CLOUDINARY_UPLOAD_PRESET belum dikonfigurasi.'
        )
    }

    const sig =
        await getSignature()

    const safeFilename =
        getFilename(
            filename
        )

    const form =
        new FormData()

    form.append(
        'file',
        buffer,
        {
            filename:
                safeFilename
        }
    )

    form.append(
        'upload_preset',
        CLOUDINARY_UPLOAD_PRESET
    )

    form.append(
        'api_key',
        CLOUDINARY_API_KEY
    )

    form.append(
        'signature',
        sig.signature
    )

    form.append(
        'timestamp',
        String(
            sig.timestamp
        )
    )

    const response =
        await axios.post(
            CLOUDINARY_UPLOAD_URL,
            form,
            {
                headers: {
                    ...form.getHeaders()
                },
                timeout:
                    REQUEST_TIMEOUT,
                maxContentLength:
                    Infinity,
                maxBodyLength:
                    MAX_FILE_SIZE,
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
        const message =
            response.data?.error?.message ||
            response.data?.message ||
            `Cloudinary HTTP ${response.status}`

        throw new Error(
            message
        )
    }

    return response.data
}

function createUpscaleUrl(
    publicId,
    resourceType =
        'image'
) {
    const encodedPublicId =
        String(
            publicId
        )
            .split('/')
            .map(
                encodeURIComponent
            )
            .join('/')

    return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload/f_jpg,e_upscale,q_auto/${encodedPublicId}.jpg`
}

async function upscaleImage(
    fileInput,
    filename =
        'image.jpg'
) {
    let buffer =
        fileInput

    let finalFilename =
        filename

    if (
        typeof fileInput ===
        'string'
    ) {
        const downloaded =
            await downloadImage(
                fileInput
            )

        buffer =
            downloaded.buffer

        finalFilename =
            downloaded.filename
    }

    if (
        !Buffer.isBuffer(
            buffer
        )
    ) {
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

    const data =
        await uploadToCloudinary(
            buffer,
            finalFilename
        )

    const publicId =
        data.public_id

    if (
        !publicId
    ) {
        throw new Error(
            'Cloudinary tidak mengembalikan public_id.'
        )
    }

    const upscaledUrl =
        createUpscaleUrl(
            publicId,
            data.resource_type ||
                'image'
        )

    return {
        status:
            true,
        creator:
            'ReyCloudSHP',
        public_id:
            publicId,
        original_url:
            data.secure_url ||
            null,
        url:
            upscaledUrl
    }
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
                    if (error) {
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
                    'Image Upscale API aktif.',
                endpoint:
                    '/api/upscale',
                method:
                    'POST',
                input: {
                    file:
                        'Multipart image file',
                    url:
                        'URL gambar'
                },
                maxFileSize:
                    '20MB',
                cloudinary:
                    Boolean(
                        CLOUDINARY_CLOUD_NAME &&
                        CLOUDINARY_API_KEY &&
                        CLOUDINARY_API_SECRET &&
                        CLOUDINARY_UPLOAD_PRESET
                    )
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

        const body =
            getBody(
                req
            )

        let result

        if (
            req.file?.buffer
        ) {
            result =
                await upscaleImage(
                    req.file.buffer,
                    req.file.originalname
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

            result =
                await upscaleImage(
                    imageUrl
                )
        }

        return res.status(
            200
        ).json(
            result
        )
    } catch (
        error
    ) {
        console.error(
            '[UPSCALE API]',
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
                'Gagal melakukan upscale gambar.'
        })
    }
}

handler.upscaleImage =
    upscaleImage

handler.getSignature =
    getSignature

handler.uploadToCloudinary =
    uploadToCloudinary

handler.createUpscaleUrl =
    createUpscaleUrl

module.exports =
    handler