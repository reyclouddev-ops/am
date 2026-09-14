const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const multer = require('multer')
const AdmZip = require('adm-zip')

const execFileAsync = promisify(execFile)

const ROOT_DIR = path.join(os.tmpdir(), 'reycode-web2apk')
const BUILDS_DIR = path.join(ROOT_DIR, 'builds')
const PROJECTS_DIR = path.join(ROOT_DIR, 'projects')
const TEMPLATE_DIR = path.join(__dirname, '..', 'web2apk-template')

const MAX_FILE_SIZE = 100 * 1024 * 1024
const BUILD_TIMEOUT = 10 * 60 * 1000

const DEFAULT_PERMISSIONS = [
    'android.permission.INTERNET',
    'android.permission.ACCESS_NETWORK_STATE',
    'android.permission.ACCESS_WIFI_STATE',
    'android.permission.VIBRATE',
    'android.permission.WAKE_LOCK',
    'android.permission.POST_NOTIFICATIONS'
]

const AVAILABLE_PERMISSIONS = [
    'android.permission.INTERNET',
    'android.permission.ACCESS_NETWORK_STATE',
    'android.permission.ACCESS_WIFI_STATE',
    'android.permission.VIBRATE',
    'android.permission.WAKE_LOCK',
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.RECEIVE_BOOT_COMPLETED',
    'android.permission.CAMERA',
    'android.permission.RECORD_AUDIO',
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.READ_CONTACTS',
    'android.permission.WRITE_CONTACTS',
    'android.permission.READ_SMS',
    'android.permission.SEND_SMS',
    'android.permission.RECEIVE_SMS',
    'android.permission.CALL_PHONE',
    'android.permission.READ_CALL_LOG',
    'android.permission.BLUETOOTH',
    'android.permission.BLUETOOTH_CONNECT',
    'android.permission.NFC',
    'android.permission.FLASHLIGHT',
    'android.permission.USE_FINGERPRINT',
    'android.permission.USE_BIOMETRIC'
]

const PERMISSION_PRESETS = {
    standard: DEFAULT_PERMISSIONS,
    minimal: [
        'android.permission.INTERNET',
        'android.permission.ACCESS_NETWORK_STATE'
    ],
    media: [
        'android.permission.INTERNET',
        'android.permission.ACCESS_NETWORK_STATE',
        'android.permission.CAMERA',
        'android.permission.RECORD_AUDIO',
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE'
    ],
    location: [
        'android.permission.INTERNET',
        'android.permission.ACCESS_NETWORK_STATE',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.ACCESS_COARSE_LOCATION'
    ],
    full: AVAILABLE_PERMISSIONS
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_FILE_SIZE
    }
})

async function ensureDirectories() {
    await fsp.mkdir(ROOT_DIR, { recursive: true })
    await fsp.mkdir(BUILDS_DIR, { recursive: true })
    await fsp.mkdir(PROJECTS_DIR, { recursive: true })
}

function safeString(value, fallback = '') {
    if (value === undefined || value === null) return fallback
    return String(value).trim()
}

function safeAppName(value) {
    const name = safeString(value, 'ReyCode App')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
        .replace(/\s+/g, ' ')
        .trim()

    return name.slice(0, 80) || 'ReyCode App'
}

function safePackageName(value) {
    let pkg = safeString(value, 'com.reycode.app')
        .toLowerCase()
        .replace(/[^a-z0-9_.]/g, '.')
        .replace(/\.+/g, '.')
        .replace(/^\.+|\.+$/g, '')

    const parts = pkg.split('.').filter(Boolean)

    if (parts.length < 2) {
        pkg = `com.reycode.${pkg || 'app'}`
    }

    const fixed = pkg
        .split('.')
        .map(part => {
            if (!/^[a-zA-Z_]/.test(part)) {
                return `a${part}`
            }
            return part
        })
        .join('.')

    return fixed.slice(0, 180)
}

function safeVersionName(value) {
    const version = safeString(value, '1.0')
        .replace(/[^0-9A-Za-z._-]/g, '')

    return version || '1.0'
}

function safeVersionCode(value) {
    const number = parseInt(value, 10)

    if (!Number.isFinite(number) || number < 1) {
        return 1
    }

    return Math.min(number, 2147483647)
}

function normalizeOrientation(value) {
    const orientation = safeString(value, 'auto').toLowerCase()

    if (orientation === 'portrait') return 'portrait'
    if (orientation === 'landscape') return 'landscape'

    return 'unspecified'
}

function parsePermissions(value) {
    if (!value) {
        return DEFAULT_PERMISSIONS
    }

    let permissions = value

    if (typeof value === 'string') {
        try {
            permissions = JSON.parse(value)
        } catch {
            permissions = value.split(',').map(item => item.trim())
        }
    }

    if (!Array.isArray(permissions)) {
        return DEFAULT_PERMISSIONS
    }

    const result = []

    for (const permission of permissions) {
        const item = safeString(permission)

        if (
            item &&
            item.startsWith('android.permission.') &&
            !result.includes(item)
        ) {
            result.push(item)
        }
    }

    return result.length ? result : DEFAULT_PERMISSIONS
}

function parsePreset(value) {
    const preset = safeString(value, 'standard').toLowerCase()

    return PERMISSION_PRESETS[preset]
        ? PERMISSION_PRESETS[preset]
        : DEFAULT_PERMISSIONS
}

function isValidHttpUrl(value) {
    try {
        const url = new URL(value)

        return (
            url.protocol === 'http:' ||
            url.protocol === 'https:'
        )
    } catch {
        return false
    }
}

function randomId() {
    return crypto.randomBytes(10).toString('hex')
}

function escapeXml(value) {
    return safeString(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
}

function escapeKotlin(value) {
    return safeString(value)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$')
}

function escapeGradle(value) {
    return safeString(value)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
}

function getMimeType(filename) {
    const ext = path.extname(filename).toLowerCase()

    if (ext === '.png') return 'image/png'
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
    if (ext === '.webp') return 'image/webp'
    if (ext === '.gif') return 'image/gif'
    if (ext === '.svg') return 'image/svg+xml'

    return 'application/octet-stream'
}

async function downloadUrl(url) {
    if (!isValidHttpUrl(url)) {
        throw new Error('URL website tidak valid.')
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    try {
        const response = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml'
            }
        })

        if (!response.ok) {
            throw new Error(`Website mengembalikan HTTP ${response.status}.`)
        }

        const contentType = response.headers.get('content-type') || ''

        if (
            !contentType.includes('text/html') &&
            !contentType.includes('application/xhtml+xml')
        ) {
            throw new Error('URL tidak mengembalikan halaman HTML.')
        }

        return Buffer.from(await response.arrayBuffer())
    } finally {
        clearTimeout(timeout)
    }
}

async function copyDirectory(source, destination) {
    await fsp.mkdir(destination, { recursive: true })

    const entries = await fsp.readdir(source, {
        withFileTypes: true
    })

    for (const entry of entries) {
        const sourcePath = path.join(source, entry.name)
        const destinationPath = path.join(destination, entry.name)

        if (entry.isDirectory()) {
            await copyDirectory(sourcePath, destinationPath)
        } else {
            await fsp.copyFile(sourcePath, destinationPath)
        }
    }
}

async function replaceInFile(file, replacements) {
    let content = await fsp.readFile(file, 'utf8')

    for (const [search, replace] of Object.entries(replacements)) {
        content = content.split(search).join(replace)
    }

    await fsp.writeFile(file, content, 'utf8')
}

async function findFilesRecursive(directory) {
    const result = []

    if (!fs.existsSync(directory)) {
        return result
    }

    const entries = await fsp.readdir(directory, {
        withFileTypes: true
    })

    for (const entry of entries) {
        const fullPath = path.join(directory, entry.name)

        if (entry.isDirectory()) {
            result.push(
                ...(await findFilesRecursive(fullPath))
            )
        } else {
            result.push(fullPath)
        }
    }

    return result
}

async function prepareSource(projectDir, body, files) {
    const sourceDir = path.join(projectDir, 'app', 'src', 'main', 'assets', 'website')

    await fsp.mkdir(sourceDir, {
        recursive: true
    })

    const zipFile =
        files.zip ||
        files.websiteZip ||
        files.sourceZip

    const htmlFile =
        files.html ||
        files.websiteHtml ||
        files.index

    if (zipFile?.buffer) {
        const zipPath = path.join(
            projectDir,
            'source.zip'
        )

        await fsp.writeFile(
            zipPath,
            zipFile.buffer
        )

        const zip = new AdmZip(zipPath)

        zip.extractAllTo(
            sourceDir,
            true
        )

        await fsp.rm(zipPath, {
            force: true
        })

        return {
            mode: 'zip',
            source: 'uploaded-zip'
        }
    }

    if (htmlFile?.buffer) {
        await fsp.writeFile(
            path.join(sourceDir, 'index.html'),
            htmlFile.buffer
        )

        return {
            mode: 'html',
            source: 'uploaded-html'
        }
    }

    const url = safeString(
        body.url ||
        body.websiteUrl ||
        body.targetUrl
    )

    if (!url) {
        throw new Error(
            'Source wajib diisi melalui URL, HTML, atau ZIP.'
        )
    }

    const html = await downloadUrl(url)

    await fsp.writeFile(
        path.join(sourceDir, 'index.html'),
        html
    )

    return {
        mode: 'url',
        source: url
    }
}

async function findIndexHtml(directory) {
    const files = await findFilesRecursive(directory)

    const candidates = files.filter(file => {
        const name = path.basename(file).toLowerCase()

        return (
            name === 'index.html' ||
            name === 'index.htm'
        )
    })

    if (!candidates.length) {
        return null
    }

    const preferred = candidates.find(file =>
        file
            .replace(/\\/g, '/')
            .includes('/website/')
    )

    return preferred || candidates[0]
}

async function normalizeWebsiteRoot(projectDir) {
    const websiteDir = path.join(
        projectDir,
        'app',
        'src',
        'main',
        'assets',
        'website'
    )

    const indexFile = await findIndexHtml(websiteDir)

    if (!indexFile) {
        throw new Error(
            'File index.html tidak ditemukan di source website.'
        )
    }

    const rootFiles = await fsp.readdir(
        websiteDir,
        {
            withFileTypes: true
        }
    )

    if (
        path.dirname(indexFile) !== websiteDir
    ) {
        const extractedRoot = path.dirname(indexFile)

        for (const entry of rootFiles) {
            const sourcePath = path.join(
                websiteDir,
                entry.name
            )

            if (sourcePath === extractedRoot) {
                continue
            }
        }

        const nestedFiles = await fsp.readdir(
            extractedRoot,
            {
                withFileTypes: true
            }
        )

        for (const entry of nestedFiles) {
            const sourcePath = path.join(
                extractedRoot,
                entry.name
            )

            const destinationPath = path.join(
                websiteDir,
                entry.name
            )

            await fsp.cp(
                sourcePath,
                destinationPath,
                {
                    recursive: true,
                    force: true
                }
            )
        }
    }

    return path.join(
        websiteDir,
        'index.html'
    )
}

async function writeWebViewActivity(
    projectDir,
    packageName,
    appName
) {
    const packagePath = packageName.split('.').join('/')

    const activityDir = path.join(
        projectDir,
        'app',
        'src',
        'main',
        'java',
        packagePath
    )

    await fsp.mkdir(activityDir, {
        recursive: true
    })

    const activity = `package ${packageName}

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebSettings
import android.view.View
import android.graphics.Color

class MainActivity : Activity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)

        webView.setBackgroundColor(Color.WHITE)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            javaScriptCanOpenWindowsAutomatically = true
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            cacheMode = WebSettings.LOAD_DEFAULT
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                return false
            }
        }

        webView.webChromeClient = WebChromeClient()

        setContentView(webView)

        webView.loadUrl("file:///android_asset/website/index.html")
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
`

    await fsp.writeFile(
        path.join(
            activityDir,
            'MainActivity.kt'
        ),
        activity,
        'utf8'
    )
}

async function writeManifest(
    projectDir,
    packageName,
    appName,
    orientation,
    permissions
) {
    const permissionXml = permissions
        .map(permission =>
            `    <uses-permission android:name="${escapeXml(permission)}" />`
        )
        .join('\n')

    const orientationValue =
        orientation === 'portrait'
            ? 'portrait'
            : orientation === 'landscape'
                ? 'landscape'
                : 'unspecified'

    const manifest = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

${permissionXml}

    <application
        android:allowBackup="true"
        android:hardwareAccelerated="true"
        android:usesCleartextTraffic="true"
        android:label="${escapeXml(appName)}"
        android:theme="@style/AppTheme"
        android:supportsRtl="true">

        <activity
            android:name=".MainActivity"
            android:screenOrientation="${orientationValue}"
            android:exported="true">

            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

        </activity>

    </application>

</manifest>
`

    await fsp.writeFile(
        path.join(
            projectDir,
            'app',
            'src',
            'main',
            'AndroidManifest.xml'
        ),
        manifest,
        'utf8'
    )
}

async function writeResources(
    projectDir,
    appName
) {
    const valuesDir = path.join(
        projectDir,
        'app',
        'src',
        'main',
        'res',
        'values'
    )

    await fsp.mkdir(valuesDir, {
        recursive: true
    })

    const strings = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">${escapeXml(appName)}</string>
</resources>
`

    const styles = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="android:style/Theme.Material.Light.NoActionBar">
        <item name="android:fontFamily">sans</item>
        <item name="android:windowActionModeOverlay">true</item>
        <item name="android:colorAccent">#111111</item>
        <item name="android:navigationBarColor">#000000</item>
        <item name="android:statusBarColor">#000000</item>
        <item name="android:windowLightStatusBar">false</item>
    </style>
</resources>
`

    await fsp.writeFile(
        path.join(valuesDir, 'strings.xml'),
        strings,
        'utf8'
    )

    await fsp.writeFile(
        path.join(valuesDir, 'styles.xml'),
        styles,
        'utf8'
    )
}

async function writeGradle(
    projectDir,
    packageName,
    versionName,
    versionCode
) {
    const settings = `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "ReyCodeWeb2APK"
include(":app")
`

    const rootGradle = `plugins {
    id 'com.android.application' version '8.7.3' apply false
    id 'org.jetbrains.kotlin.android' version '2.0.21' apply false
}
`

    const appGradle = `plugins {
    id 'com.android.application'
    id 'org.jetbrains.kotlin.android'
}

android {
    namespace '${escapeGradle(packageName)}'
    compileSdk 35

    defaultConfig {
        applicationId '${escapeGradle(packageName)}'
        minSdk 23
        targetSdk 35
        versionCode ${versionCode}
        versionName '${escapeGradle(versionName)}'
    }

    buildTypes {
        release {
            minifyEnabled false
            shrinkResources false
        }
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = '17'
    }
}
`

    const gradleProperties = `org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
kotlin.code.style=official
`

    await fsp.writeFile(
        path.join(projectDir, 'settings.gradle'),
        settings,
        'utf8'
    )

    await fsp.writeFile(
        path.join(projectDir, 'build.gradle'),
        rootGradle,
        'utf8'
    )

    await fsp.writeFile(
        path.join(
            projectDir,
            'app',
            'build.gradle'
        ),
        appGradle,
        'utf8'
    )

    await fsp.writeFile(
        path.join(
            projectDir,
            'gradle.properties'
        ),
        gradleProperties,
        'utf8'
    )
}

async function writeProject(
    projectDir,
    options
) {
    const {
        appName,
        packageName,
        versionName,
        versionCode,
        orientation,
        permissions
    } = options

    if (!fs.existsSync(TEMPLATE_DIR)) {
        throw new Error(
            `Template Android tidak ditemukan: ${TEMPLATE_DIR}`
        )
    }

    await copyDirectory(
        TEMPLATE_DIR,
        projectDir
    )

    await writeGradle(
        projectDir,
        packageName,
        versionName,
        versionCode
    )

    await writeManifest(
        projectDir,
        packageName,
        appName,
        orientation,
        permissions
    )

    await writeResources(
        projectDir,
        appName
    )

    await writeWebViewActivity(
        projectDir,
        packageName,
        appName
    )
}

async function copyUploadedIcon(
    projectDir,
    iconFile
) {
    if (!iconFile?.buffer) {
        return null
    }

    const mipmapDir = path.join(
        projectDir,
        'app',
        'src',
        'main',
        'res',
        'drawable'
    )

    await fsp.mkdir(
        mipmapDir,
        {
            recursive: true
        }
    )

    const extension =
        path.extname(
            iconFile.originalname || ''
        ).toLowerCase()

    const filename =
        extension === '.png'
            ? 'app_icon.png'
            : 'app_icon.jpg'

    const destination = path.join(
        mipmapDir,
        filename
    )

    await fsp.writeFile(
        destination,
        iconFile.buffer
    )

    const manifestPath = path.join(
        projectDir,
        'app',
        'src',
        'main',
        'AndroidManifest.xml'
    )

    let manifest =
        await fsp.readFile(
            manifestPath,
            'utf8'
        )

    manifest = manifest.replace(
        'android:theme="@style/AppTheme"',
        'android:icon="@drawable/app_icon" android:theme="@style/AppTheme"'
    )

    await fsp.writeFile(
        manifestPath,
        manifest,
        'utf8'
    )

    return filename
}

async function copySplash(
    projectDir,
    splashFile
) {
    if (!splashFile?.buffer) {
        return null
    }

    const drawableDir = path.join(
        projectDir,
        'app',
        'src',
        'main',
        'res',
        'drawable'
    )

    await fsp.mkdir(
        drawableDir,
        {
            recursive: true
        }
    )

    const extension =
        path.extname(
            splashFile.originalname || ''
        ).toLowerCase()

    const filename =
        extension === '.png'
            ? 'splash.png'
            : 'splash.jpg'

    await fsp.writeFile(
        path.join(
            drawableDir,
            filename
        ),
        splashFile.buffer
    )

    return filename
}

async function verifyGradle() {
    try {
        const result =
            await execFileAsync(
                'gradle',
                ['--version'],
                {
                    timeout: 30000
                }
            )

        return {
            available: true,
            command: 'gradle',
            version: result.stdout
        }
    } catch {}

    return {
        available: false
    }
}

async function buildGradle(projectDir) {
    const gradlew =
        process.platform === 'win32'
            ? 'gradlew.bat'
            : './gradlew'

    const wrapperPath = path.join(
        projectDir,
        gradlew
    )

    let command = gradlew

    let args = [
        'assembleRelease',
        '--no-daemon',
        '--stacktrace'
    ]

    if (
        process.platform !== 'win32' &&
        fs.existsSync(wrapperPath)
    ) {
        await fsp.chmod(
            wrapperPath,
            0o755
        )
    } else {
        const gradle =
            await verifyGradle()

        if (!gradle.available) {
            throw new Error(
                'Gradle tidak tersedia pada server.'
            )
        }

        command = 'gradle'
    }

    const result =
        await execFileAsync(
            command,
            args,
            {
                cwd: projectDir,
                timeout: BUILD_TIMEOUT,
                maxBuffer: 20 * 1024 * 1024,
                env: {
                    ...process.env,
                    GRADLE_OPTS:
                        '-Dorg.gradle.jvmargs=-Xmx2048m'
                }
            }
        )

    return {
        stdout: result.stdout,
        stderr: result.stderr
    }
}

async function findApk(projectDir) {
    const apkDir = path.join(
        projectDir,
        'app',
        'build',
        'outputs',
        'apk'
    )

    const files =
        await findFilesRecursive(
            apkDir
        )

    const apkFiles =
        files.filter(file =>
            file.toLowerCase().endsWith('.apk')
        )

    if (!apkFiles.length) {
        throw new Error(
            'APK hasil build tidak ditemukan.'
        )
    }

    const release =
        apkFiles.find(file =>
            file
                .replace(/\\/g, '/')
                .includes('/release/')
        )

    return release || apkFiles[0]
}

async function saveBuildResult(
    id,
    apkPath,
    metadata
) {
    const filename =
        `${metadata.slug}-${metadata.versionName}.apk`
            .replace(/[^a-zA-Z0-9._-]/g, '_')

    const destination =
        path.join(
            BUILDS_DIR,
            `${id}-${filename}`
        )

    await fsp.copyFile(
        apkPath,
        destination
    )

    const stat =
        await fsp.stat(destination)

    const data = {
        id,
        filename,
        file: destination,
        size: stat.size,
        createdAt: new Date().toISOString(),
        appName: metadata.appName,
        packageName: metadata.packageName,
        versionName: metadata.versionName,
        versionCode: metadata.versionCode,
        sourceMode: metadata.sourceMode
    }

    await fsp.writeFile(
        path.join(
            BUILDS_DIR,
            `${id}.json`
        ),
        JSON.stringify(
            data,
            null,
            2
        ),
        'utf8'
    )

    return data
}

function parseMultipart(req, res) {
    return new Promise(
        (resolve, reject) => {
            upload.any()(
                req,
                res,
                error => {
                    if (error) {
                        reject(error)
                        return
                    }

                    const files = {}

                    for (
                        const file of req.files || []
                    ) {
                        if (
                            !files[file.fieldname]
                        ) {
                            files[file.fieldname] =
                                file
                        }
                    }

                    resolve({
                        body: req.body || {},
                        files
                    })
                }
            )
        }
    )
}

async function handleBuild(
    req,
    res
) {
    const {
        body,
        files
    } = await parseMultipart(
        req,
        res
    )

    const appName =
        safeAppName(
            body.appName ||
            body.name
        )

    const packageName =
        safePackageName(
            body.packageName ||
            body.package
        )

    const versionName =
        safeVersionName(
            body.versionName ||
            body.version ||
            '1.0'
        )

    const versionCode =
        safeVersionCode(
            body.versionCode ||
            '1'
        )

    const orientation =
        normalizeOrientation(
            body.orientation
        )

    let permissions

    if (
        body.permissionPreset ||
        body.permissionsPreset
    ) {
        permissions =
            parsePreset(
                body.permissionPreset ||
                body.permissionsPreset
            )
    } else {
        permissions =
            parsePermissions(
                body.permissions
            )
    }

    const projectId =
        randomId()

    const projectDir =
        path.join(
            PROJECTS_DIR,
            projectId
        )

    await fsp.mkdir(
        projectDir,
        {
            recursive: true
        }
    )

    try {
        const source =
            await prepareSource(
                projectDir,
                body,
                files
            )

        await normalizeWebsiteRoot(
            projectDir
        )

        await writeProject(
            projectDir,
            {
                appName,
                packageName,
                versionName,
                versionCode,
                orientation,
                permissions
            }
        )

        const icon =
            files.icon ||
            files.appIcon

        const splash =
            files.splash ||
            files.splashImage

        await copyUploadedIcon(
            projectDir,
            icon
        )

        await copySplash(
            projectDir,
            splash
        )

        const buildStart =
            Date.now()

        await buildGradle(
            projectDir
        )

        const apk =
            await findApk(
                projectDir
            )

        const slug =
            appName
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, 50) ||
            'reycode-app'

        const saved =
            await saveBuildResult(
                projectId,
                apk,
                {
                    appName,
                    packageName,
                    versionName,
                    versionCode,
                    sourceMode:
                        source.mode,
                    slug
                }
            )

        await fsp.rm(
            projectDir,
            {
                recursive: true,
                force: true
            }
        )

        return res.status(200).json({
            status: true,
            success: true,
            creator: 'ReyCode',
            message: 'APK berhasil dibuat.',
            buildId: projectId,
            appName,
            packageName,
            versionName,
            versionCode,
            orientation,
            permissions,
            permissionsCount:
                permissions.length,
            sourceMode:
                source.mode,
            buildDuration:
                Number(
                    (
                        (Date.now() - buildStart) /
                        1000
                    ).toFixed(2)
                ),
            fileName:
                saved.filename,
            size:
                saved.size,
            sizeMB:
                Number(
                    (
                        saved.size /
                        1024 /
                        1024
                    ).toFixed(2)
                ),
            downloadUrl:
                `/api/web2apk/download/${projectId}`
        })
    } catch (error) {
        await fsp.rm(
            projectDir,
            {
                recursive: true,
                force: true
            }
        )

        throw error
    }
}

async function handleDownload(
    req,
    res
) {
    const id =
        safeString(
            req.params?.id ||
            req.query?.id
        )

    if (!/^[a-f0-9]{20}$/.test(id)) {
        return res.status(400).json({
            status: false,
            message: 'Build ID tidak valid.'
        })
    }

    const metadataPath =
        path.join(
            BUILDS_DIR,
            `${id}.json`
        )

    if (!fs.existsSync(metadataPath)) {
        return res.status(404).json({
            status: false,
            message: 'Build tidak ditemukan.'
        })
    }

    const metadata =
        JSON.parse(
            await fsp.readFile(
                metadataPath,
                'utf8'
            )
        )

    if (
        !metadata.file ||
        !fs.existsSync(metadata.file)
    ) {
        return res.status(404).json({
            status: false,
            message: 'File APK sudah tidak tersedia.'
        })
    }

    res.setHeader(
        'Content-Type',
        'application/vnd.android.package-archive'
    )

    res.setHeader(
        'Content-Disposition',
        `attachment; filename="${metadata.filename}"`
    )

    return res.sendFile(
        path.resolve(
            metadata.file
        )
    )
}

async function handleInfo(
    req,
    res
) {
    return res.status(200).json({
        status: true,
        success: true,
        creator: 'ReyCode',
        name: 'ReyCode Web2APK',
        version: '1.0.0',
        description:
            'Web to APK builder menggunakan Android WebView dan Gradle.',
        methods: {
            GET: {
                endpoint: '/api/web2apk',
                description:
                    'Informasi endpoint.'
            },
            POST: {
                endpoint: '/api/web2apk',
                description:
                    'Build website menjadi APK.'
            }
        },
        sourceModes: [
            'url',
            'html',
            'zip'
        ],
        fields: {
            appName: 'Nama aplikasi',
            packageName: 'Package Android',
            versionName: 'Versi aplikasi',
            versionCode: 'Version code',
            orientation:
                'auto | portrait | landscape',
            permissions:
                'JSON array atau comma separated',
            permissionPreset:
                'standard | minimal | media | location | full',
            url:
                'URL website',
            html:
                'File HTML',
            zip:
                'ZIP website',
            icon:
                'Icon APK',
            splash:
                'Splash image'
        },
        permissionPresets:
            Object.keys(
                PERMISSION_PRESETS
            ),
        limits: {
            maxUploadMB:
                MAX_FILE_SIZE /
                1024 /
                1024,
            buildTimeoutMinutes:
                BUILD_TIMEOUT /
                60000
        }
    })
}

async function handler(
    req,
    res
) {
    try {
        await ensureDirectories()

        const pathname =
            req.path ||
            req.url.split('?')[0]

        if (
            pathname.includes(
                '/download/'
            )
        ) {
            return handleDownload(
                req,
                res
            )
        }

        if (
            req.method === 'GET'
        ) {
            return handleInfo(
                req,
                res
            )
        }

        if (
            req.method !== 'POST'
        ) {
            res.setHeader(
                'Allow',
                'GET, POST'
            )

            return res.status(405).json({
                status: false,
                message:
                    'Method tidak diizinkan.'
            })
        }

        return await handleBuild(
            req,
            res
        )
    } catch (error) {
        console.error(
            'Web2APK Error:',
            error
        )

        const message =
            error?.code === 'LIMIT_FILE_SIZE'
                ? 'Ukuran file melebihi batas 100 MB.'
                : error?.message ||
                  'Gagal membuat APK.'

        return res.status(500).json({
            status: false,
            success: false,
            creator: 'ReyCode',
            message,
            error:
                process.env.NODE_ENV === 'production'
                    ? undefined
                    : error.stack
        })
    }
}

handler.AVAILABLE_PERMISSIONS =
    AVAILABLE_PERMISSIONS

handler.PERMISSION_PRESETS =
    PERMISSION_PRESETS

handler.build = handleBuild

module.exports = handler