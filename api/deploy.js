const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const axios = require('axios')
const AdmZip = require('adm-zip')
const multer = require('multer')

const VERCEL_API_URL = 'https://api.vercel.com'
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

const API_TOKEN =
    process.env.API_TOKEN ||
    global.vercel?.token ||
    ''

const TURNSTILE_SECRET =
    process.env.TURNSTILE_SECRET_KEY ||
    process.env.TURNSTILE_SECRET ||
    ''

const ALLOWED_DOMAINS = [
    'legionteknologi.my.id',
    'reycode.my.id',
    'reycode.web.id'
]

const DEFAULT_DOMAIN = 'reycode.my.id'

const MAX_FILE_SIZE =
    100 * 1024 * 1024

const REQUEST_TIMEOUT = 30000
const DEPLOY_TIMEOUT = 180000

const upload = multer({
    storage:
        multer.memoryStorage(),
    limits: {
        fileSize:
            MAX_FILE_SIZE
    }
})

function escapeRegExp(
    value
) {
    return String(value).replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
    )
}

function cleanProjectName(
    input
) {
    let value =
        String(input || '')
            .trim()
            .toLowerCase()

    value =
        value
            .replace(
                /\.zip$/i,
                ''
            )
            .replace(
                /\.html?$/i,
                ''
            )
            .replace(
                /[^a-z0-9-_]/g,
                '-'
            )
            .replace(
                /-+/g,
                '-'
            )
            .replace(
                /^-+|-+$/g,
                ''
            )

    if (!value) {
        value =
            `reycloud-${Date.now()}`
    }

    if (
        !/^[a-z]/.test(
            value
        )
    ) {
        value =
            `reycloud-${value}`
    }

    return value.slice(
        0,
        100
    )
}

function normalizeDomain(
    input
) {
    let domain =
        String(
            input ||
            DEFAULT_DOMAIN
        )
            .trim()
            .toLowerCase()

    domain =
        domain
            .replace(
                /^https?:\/\//,
                ''
            )
            .replace(
                /^www\./,
                ''
            )
            .replace(
                /\/.*$/,
                ''
            )
            .trim()

    if (
        !ALLOWED_DOMAINS.includes(
            domain
        )
    ) {
        return DEFAULT_DOMAIN
    }

    return domain
}

function getQuery(
    req
) {
    if (
        req &&
        req.query
    ) {
        return req.query
    }

    const url =
        req &&
        req.url
            ? new URL(
                req.url,
                'http://localhost'
            )
            : null

    return url
        ? Object.fromEntries(
            url.searchParams.entries()
        )
        : {}
}

function getBody(
    req
) {
    if (
        req &&
        req.body
    ) {
        return req.body
    }

    return {}
}

function getProjectName(
    req
) {
    const body =
        getBody(
            req
        )

    const query =
        getQuery(
            req
        )

    return (
        body.name ||
        body.project ||
        body.projectName ||
        query.name ||
        query.project ||
        query.projectName ||
        ''
    )
}

function getDomain(
    req
) {
    const body =
        getBody(
            req
        )

    const query =
        getQuery(
            req
        )

    return normalizeDomain(
        body.domain ||
        query.domain ||
        DEFAULT_DOMAIN
    )
}

function getTurnstileToken(
    req
) {
    const body =
        getBody(
            req
        )

    const headers =
        req?.headers || {}

    return (
        body['cf-turnstile-response'] ||
        body.turnstileToken ||
        body.turnstile ||
        headers['x-turnstile-token'] ||
        headers['x-cf-turnstile-response'] ||
        ''
    )
}

async function verifyTurnstile(
    token,
    req
) {
    if (!TURNSTILE_SECRET) {
        throw new Error(
            'TURNSTILE_SECRET_KEY belum dikonfigurasi.'
        )
    }

    if (!token) {
        return {
            success:
                false,
            message:
                'Selesaikan verifikasi Turnstile terlebih dahulu.'
        }
    }

    const remoteip =
        req?.ip ||
        req?.headers?.['cf-connecting-ip'] ||
        req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
        undefined

    const params =
        new URLSearchParams()

    params.append(
        'secret',
        TURNSTILE_SECRET
    )

    params.append(
        'response',
        token
    )

    if (remoteip) {
        params.append(
            'remoteip',
            remoteip
        )
    }

    const response =
        await axios.post(
            TURNSTILE_VERIFY_URL,
            params.toString(),
            {
                headers: {
                    'Content-Type':
                        'application/x-www-form-urlencoded'
                },
                timeout:
                    REQUEST_TIMEOUT,
                validateStatus:
                    () => true
            }
        )

    if (
        response.status < 200 ||
        response.status >= 300
    ) {
        throw new Error(
            `Turnstile mengembalikan HTTP ${response.status}.`
        )
    }

    const data =
        response.data || {}

    if (!data.success) {
        return {
            success:
                false,
            message:
                'Verifikasi Turnstile gagal.',
            errors:
                data['error-codes'] ||
                []
        }
    }

    return {
        success:
            true,
        hostname:
            data.hostname ||
            null,
        action:
            data.action ||
            null,
        cdata:
            data.cdata ||
            null
    }
}

function createTempDirectory() {
    return fs.mkdtempSync(
        path.join(
            os.tmpdir(),
            'reycloud-deploy-'
        )
    )
}

function removeDirectory(
    directory
) {
    try {
        if (
            directory &&
            fs.existsSync(
                directory
            )
        ) {
            fs.rmSync(
                directory,
                {
                    recursive:
                        true,
                    force:
                        true
                }
            )
        }
    } catch {}
}

function findFileRecursive(
    directory,
    filename
) {
    if (
        !fs.existsSync(
            directory
        )
    ) {
        return null
    }

    const entries =
        fs.readdirSync(
            directory,
            {
                withFileTypes:
                    true
            }
        )

    for (
        const entry of entries
    ) {
        const fullPath =
            path.join(
                directory,
                entry.name
            )

        if (
            entry.isDirectory()
        ) {
            const found =
                findFileRecursive(
                    fullPath,
                    filename
                )

            if (found) {
                return found
            }
        }

        if (
            entry.isFile() &&
            entry.name.toLowerCase() ===
                filename.toLowerCase()
        ) {
            return fullPath
        }
    }

    return null
}

function collectFiles(
    directory,
    baseDirectory = directory
) {
    const files = []

    if (
        !fs.existsSync(
            directory
        )
    ) {
        return files
    }

    const entries =
        fs.readdirSync(
            directory,
            {
                withFileTypes:
                    true
            }
        )

    for (
        const entry of entries
    ) {
        const fullPath =
            path.join(
                directory,
                entry.name
            )

        if (
            entry.isDirectory()
        ) {
            files.push(
                ...collectFiles(
                    fullPath,
                    baseDirectory
                )
            )

            continue
        }

        if (
            entry.isFile()
        ) {
            const relativePath =
                path.relative(
                    baseDirectory,
                    fullPath
                )
                .split(
                    path.sep
                )
                .join('/')

            files.push({
                file:
                    relativePath,
                path:
                    fullPath
            })
        }
    }

    return files
}

function safeReadJson(
    file
) {
    try {
        if (
            !fs.existsSync(
                file
            )
        ) {
            return null
        }

        return JSON.parse(
            fs.readFileSync(
                file,
                'utf8'
            )
        )
    } catch {
        return null
    }
}

function detectFramework(
    directory
) {
    const packagePath =
        path.join(
            directory,
            'package.json'
        )

    const packageJson =
        safeReadJson(
            packagePath
        )

    if (packageJson) {
        const dependencies = {
            ...(packageJson.dependencies || {}),
            ...(packageJson.devDependencies || {})
        }

        if (
            dependencies.next ||
            fs.existsSync(
                path.join(
                    directory,
                    'next.config.js'
                )
            ) ||
            fs.existsSync(
                path.join(
                    directory,
                    'next.config.mjs'
                )
            ) ||
            fs.existsSync(
                path.join(
                    directory,
                    'next.config.ts'
                )
            )
        ) {
            return 'nextjs'
        }

        if (
            dependencies.react ||
            dependencies['react-dom']
        ) {
            return 'react'
        }

        if (
            dependencies.vue ||
            dependencies['@vitejs/plugin-vue']
        ) {
            return 'vue'
        }

        if (
            dependencies.svelte ||
            dependencies['@sveltejs/kit']
        ) {
            return 'svelte'
        }

        if (
            dependencies['@angular/core']
        ) {
            return 'angular'
        }

        if (
            dependencies.astro
        ) {
            return 'astro'
        }

        if (
            dependencies.express ||
            dependencies.fastify ||
            dependencies.koa ||
            dependencies.hono
        ) {
            return 'nodejs'
        }

        if (
            dependencies.vite
        ) {
            return 'vite'
        }
    }

    const viteConfig =
        [
            'vite.config.js',
            'vite.config.mjs',
            'vite.config.ts',
            'vite.config.cjs'
        ].some(
            file =>
                fs.existsSync(
                    path.join(
                        directory,
                        file
                    )
                )
        )

    if (viteConfig) {
        return 'vite'
    }

    const indexFile =
        findFileRecursive(
            directory,
            'index.html'
        )

    if (indexFile) {
        const html =
            fs.readFileSync(
                indexFile,
                'utf8'
            )

        if (
            /tailwind/i.test(
                html
            )
        ) {
            return 'html-tailwind'
        }

        return 'static'
    }

    return 'other'
}

function normalizeProjectRoot(
    directory
) {
    const indexFile =
        findFileRecursive(
            directory,
            'index.html'
        )

    if (!indexFile) {
        return directory
    }

    const indexDirectory =
        path.dirname(
            indexFile
        )

    if (
        indexDirectory ===
        directory
    ) {
        return directory
    }

    const entries =
        fs.readdirSync(
            indexDirectory,
            {
                withFileTypes:
                    true
            }
        )

    for (
        const entry of entries
    ) {
        const source =
            path.join(
                indexDirectory,
                entry.name
            )

        const destination =
            path.join(
                directory,
                entry.name
            )

        if (
            source ===
            destination
        ) {
            continue
        }

        if (
            fs.existsSync(
                destination
            )
        ) {
            fs.rmSync(
                destination,
                {
                    recursive:
                        true,
                    force:
                        true
                }
            )
        }

        fs.renameSync(
            source,
            destination
        )
    }

    if (
        indexDirectory !==
        directory
    ) {
        try {
            fs.rmSync(
                indexDirectory,
                {
                    recursive:
                        true,
                    force:
                        true
                }
            )
        } catch {}
    }

    return directory
}

function isZipFile(
    filename
) {
    return /\.zip$/i.test(
        String(
            filename || ''
        )
    )
}

function isHtmlFile(
    filename
) {
    return /\.html?$/i.test(
        String(
            filename || ''
        )
    )
}

function extractZip(
    buffer,
    directory
) {
    const zip =
        new AdmZip(
            buffer
        )

    zip.extractAllTo(
        directory,
        true
    )
}

function getVercelHeaders() {
    return {
        Authorization:
            `Bearer ${API_TOKEN}`,
        'Content-Type':
            'application/json'
    }
}

function getVercelError(
    response,
    fallback
) {
    return (
        response?.data?.error?.message ||
        response?.data?.message ||
        response?.data?.error ||
        fallback
    )
}

async function createVercelProject(
    name,
    framework
) {
    if (!API_TOKEN) {
        throw new Error(
            'API_TOKEN Vercel belum dikonfigurasi.'
        )
    }

    const payload = {
        name
    }

    if (
        framework &&
        framework !==
            'static' &&
        framework !==
            'html-tailwind' &&
        framework !==
            'other'
    ) {
        payload.framework =
            framework
    }

    const response =
        await axios.post(
            `${VERCEL_API_URL}/v9/projects`,
            payload,
            {
                headers:
                    getVercelHeaders(),
                timeout:
                    REQUEST_TIMEOUT,
                validateStatus:
                    () => true
            }
        )

    if (
        response.status >=
            200 &&
        response.status <
            300
    ) {
        return response.data
    }

    const errorMessage =
        getVercelError(
            response,
            `Vercel mengembalikan HTTP ${response.status}.`
        )

    if (
        response.status ===
            409 ||
        /already exists/i.test(
            errorMessage
        )
    ) {
        const existing =
            await axios.get(
                `${VERCEL_API_URL}/v9/projects/${encodeURIComponent(name)}`,
                {
                    headers:
                        getVercelHeaders(),
                    timeout:
                        REQUEST_TIMEOUT,
                    validateStatus:
                        () => true
                }
            )

        if (
            existing.status >=
                200 &&
            existing.status <
                300
        ) {
            return existing.data
        }
    }

    throw new Error(
        errorMessage
    )
}

async function createVercelDeployment(
    projectName,
    files
) {
    if (!API_TOKEN) {
        throw new Error(
            'API_TOKEN Vercel belum dikonfigurasi.'
        )
    }

    const deploymentFiles =
        files.map(
            item => ({
                file:
                    item.file,
                data:
                    fs.readFileSync(
                        item.path
                    ).toString(
                        'base64'
                    ),
                encoding:
                    'base64'
            })
        )

    const payload = {
        name:
            projectName,
        project:
            projectName,
        files:
            deploymentFiles,
        target:
            'production'
    }

    const response =
        await axios.post(
            `${VERCEL_API_URL}/v13/deployments`,
            payload,
            {
                headers:
                    getVercelHeaders(),
                timeout:
                    DEPLOY_TIMEOUT,
                maxContentLength:
                    Infinity,
                maxBodyLength:
                    Infinity,
                validateStatus:
                    () => true
            }
        )

    if (
        response.status < 200 ||
        response.status >= 300
    ) {
        throw new Error(
            getVercelError(
                response,
                `Vercel deployment gagal dengan HTTP ${response.status}.`
            )
        )
    }

    return response.data
}

async function addCustomDomain(
    projectName,
    domain
) {
    const response =
        await axios.post(
            `${VERCEL_API_URL}/v10/projects/${encodeURIComponent(projectName)}/domains`,
            {
                name:
                    domain
            },
            {
                headers:
                    getVercelHeaders(),
                timeout:
                    REQUEST_TIMEOUT,
                validateStatus:
                    () => true
            }
        )

    if (
        response.status >=
            200 &&
        response.status <
            300
    ) {
        return {
            success:
                true,
            existing:
                false,
            data:
                response.data
        }
    }

    const message =
        getVercelError(
            response,
            `Gagal menambahkan custom domain dengan HTTP ${response.status}.`
        )

    if (
        response.status ===
            409 ||
        /already exists/i.test(
            message
        )
    ) {
        return {
            success:
                true,
            existing:
                true,
            data:
                response.data
        }
    }

    return {
        success:
            false,
        existing:
            false,
        message
    }
}

function getDeploymentUrl(
    deployment,
    projectName
) {
    if (
        deployment?.url
    ) {
        return `https://${deployment.url}`
    }

    if (
        Array.isArray(
            deployment?.alias
        ) &&
        deployment.alias.length
    ) {
        return `https://${deployment.alias[0]}`
    }

    return `https://${projectName}.vercel.app`
}

function getCustomDomainUrl(
    domain
) {
    if (!domain) {
        return null
    }

    return `https://${domain}`
}

function validateUploadedFile(
    file
) {
    if (!file) {
        throw new Error(
            'File project wajib diupload.'
        )
    }

    const filename =
        String(
            file.originalname ||
            ''
        )

    if (
        !isZipFile(
            filename
        ) &&
        !isHtmlFile(
            filename
        )
    ) {
        throw new Error(
            'Format file tidak didukung. Gunakan ZIP atau HTML.'
        )
    }

    if (
        !file.buffer ||
        !file.buffer.length
    ) {
        throw new Error(
            'File project kosong.'
        )
    }
}

async function deployProject(
    req
) {
    if (!API_TOKEN) {
        throw new Error(
            'API_TOKEN Vercel belum dikonfigurasi.'
        )
    }

    validateUploadedFile(
        req.file
    )

    const turnstileToken =
        getTurnstileToken(
            req
        )

    const turnstile =
        await verifyTurnstile(
            turnstileToken,
            req
        )

    if (!turnstile.success) {
        const error =
            new Error(
                turnstile.message ||
                'Verifikasi Turnstile gagal.'
            )

        error.code =
            'TURNSTILE_FAILED'

        error.details =
            turnstile.errors ||
            []

        throw error
    }

    const originalName =
        req.file.originalname ||
        'project.zip'

    const projectName =
        cleanProjectName(
            getProjectName(
                req
            ) ||
            path.basename(
                originalName,
                path.extname(
                    originalName
                )
            )
        )

    const domain =
        getDomain(
            req
        )

    const tempDirectory =
        createTempDirectory()

    const projectDirectory =
        path.join(
            tempDirectory,
            'project'
        )

    try {
        fs.mkdirSync(
            projectDirectory,
            {
                recursive:
                    true
            }
        )

        if (
            isZipFile(
                originalName
            )
        ) {
            extractZip(
                req.file.buffer,
                projectDirectory
            )
        } else {
            fs.writeFileSync(
                path.join(
                    projectDirectory,
                    'index.html'
                ),
                req.file.buffer
            )
        }

        normalizeProjectRoot(
            projectDirectory
        )

        const files =
            collectFiles(
                projectDirectory
            )

        if (
            !files.length
        ) {
            throw new Error(
                'Project tidak memiliki file yang dapat dideploy.'
            )
        }

        const indexFile =
            findFileRecursive(
                projectDirectory,
                'index.html'
            )

        const packageJson =
            findFileRecursive(
                projectDirectory,
                'package.json'
            )

        if (
            !indexFile &&
            !packageJson
        ) {
            throw new Error(
                'Project tidak memiliki index.html atau package.json.'
            )
        }

        const framework =
            detectFramework(
                projectDirectory
            )

        const vercelProject =
            await createVercelProject(
                projectName,
                framework
            )

        const deployment =
            await createVercelDeployment(
                projectName,
                files
            )

        const domainResult =
            await addCustomDomain(
                projectName,
                domain
            )

        const vercelUrl =
            getDeploymentUrl(
                deployment,
                projectName
            )

        const customDomain =
            domainResult.success
                ? domain
                : null

        const customDomainUrl =
            customDomain
                ? getCustomDomainUrl(
                    customDomain
                )
                : null

        const liveUrl =
            customDomainUrl ||
            vercelUrl

        return {
            status:
                true,
            creator:
                'ReyCloudSHP',
            provider:
                'Vercel',
            project:
                projectName,
            projectId:
                vercelProject?.id ||
                null,
            deploymentId:
                deployment?.id ||
                null,
            framework:
                framework,
            totalFiles:
                files.length,
            vercelUrl:
                vercelUrl,
            customDomain:
                customDomain,
            customDomainUrl:
                customDomainUrl,
            domainUsed:
                domain,
            liveUrl:
                liveUrl,
            domainStatus:
                domainResult.success
                    ? 'added'
                    : 'failed',
            domainMessage:
                domainResult.success
                    ? 'Custom domain berhasil ditambahkan ke project Vercel.'
                    : domainResult.message ||
                      'Custom domain gagal ditambahkan.',
            turnstile:
                true
        }
    } finally {
        removeDirectory(
            tempDirectory
        )
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
        !error
    ) {
        return null
    }

    if (
        error.code ===
        'LIMIT_FILE_SIZE'
    ) {
        return 'Ukuran file terlalu besar. Maksimal 100 MB.'
    }

    if (
        error.code ===
        'LIMIT_UNEXPECTED_FILE'
    ) {
        return 'Field upload file tidak valid.'
    }

    return (
        error.message ||
        'Upload file gagal.'
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
            return res.status(200).json({
                status:
                    true,
                creator:
                    'ReyCloudSHP',
                provider:
                    'Vercel',
                message:
                    'Vercel Deploy API aktif.',
                endpoint:
                    '/api/deploy',
                method:
                    'POST',
                fields: {
                    name:
                        'Nama project',
                    domain:
                        'Custom domain',
                    file:
                        'ZIP atau HTML',
                    'cf-turnstile-response':
                        'Token Cloudflare Turnstile'
                },
                allowedDomains:
                    ALLOWED_DOMAINS,
                maxFileSize:
                    '100MB',
                turnstile:
                    Boolean(
                        TURNSTILE_SECRET
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

            return res.status(405).json({
                status:
                    false,
                creator:
                    'ReyCloudSHP',
                message:
                    'Method tidak diizinkan.'
            })
        }

        await parseMultipart(
            req,
            res
        )

        const data =
            await deployProject(
                req
            )

        return res.status(200).json(
            data
        )
    } catch (error) {
        console.error(
            '[DEPLOY API]',
            error
        )

        if (
            error?.code ===
            'TURNSTILE_FAILED'
        ) {
            return res.status(403).json({
                status:
                    false,
                creator:
                    'ReyCloudSHP',
                message:
                    error.message ||
                    'Verifikasi Turnstile gagal.',
                errors:
                    error.details ||
                    []
            })
        }

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

        return res.status(500).json({
            status:
                false,
            creator:
                'ReyCloudSHP',
            message:
                error?.message ||
                'Terjadi kesalahan saat deployment.'
        })
    }
}

handler.deployProject =
    deployProject

handler.verifyTurnstile =
    verifyTurnstile

handler.createVercelProject =
    createVercelProject

handler.createVercelDeployment =
    createVercelDeployment

handler.addCustomDomain =
    addCustomDomain

handler.detectFramework =
    detectFramework

handler.collectFiles =
    collectFiles

handler.cleanProjectName =
    cleanProjectName

handler.normalizeDomain =
    normalizeDomain

handler.findFileRecursive =
    findFileRecursive

handler.getDeploymentUrl =
    getDeploymentUrl

module.exports =
    handler