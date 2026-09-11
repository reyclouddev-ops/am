/**
 * ReyCloudSHP REST API Gateway
 * Base URL: https://api.legionteknologi.my.id
 * License: MIT
 * Diharapkan Jangan Hapus Lisensi Ini
 * Mohon Kerja Sama Nya
 * Version 2.1.0
 */

const express = require('express');
const os = require('os');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');
const axios = require('axios');
const cheerio = require('cheerio');
require("dotenv").config();

const config = require('./config');
const { handleFileUpload, generateShortId } = require('./scrape/upload');
const mediafire = require('./scrape/mediafire');
const { TeraBoxDL } = require('./scrape/terabox');
const winkEnhance = require('./scrape/wink');
const { pixa } = require('./scrape/removebg');
const { ytdl, Youtube } = require('./scrape/ytdl');
const videy = require('./scrape/videy');
const { tiktokv1, tiktokv2 } = require('./scrape/tiktok');
const { igdl } = require('./scrape/instagram');
const { getHealthStatus } = require('./scrape/status');
const imgtoprompt = require('./scrape/imgtoprompt');
const { Img2Img } = require('./scrape/img2img');
const { getNsfwMediaUrl, getCategoriesList } = require('./scrape/nsfw');
const SamehadakuScraper = require('./scrape/samehadaku');
const samehadaku = new SamehadakuScraper();
const ImagenScraper = require('./scrape/imagen');
const imagen = new ImagenScraper();
const NekopoiScraper = require('./scrape/nekopoi');
const nekopoi = new NekopoiScraper();
const { rayleighScraper } = require('./scrape/rayleigh'); 
const DonghubScraper = require('./scrape/donghub');
const donghub = new DonghubScraper();
const DeepAIScraper = require('./scrape/deepai');
const deepai = new DeepAIScraper();
const { fetchTokens: fetchNftoken } = require('./scrape/nftoken');
const TokusatsuScraper = require('./scrape/tokusatsu');
const tokusatsu = new TokusatsuScraper();
const DeepAIChatScraper = require('./scrape/deepai_chat');
const deepaiChat = new DeepAIChatScraper();
const AlwaysCodexScraper = require("./scrape/AlwaysCodexScraper");
const scraper = new AlwaysCodexScraper();
const TelegramReqHandler = require('./scrape/reqbot');
const { sendKeyyssReaction } = require('./scrape/keyyss');
const { upscaleImage } = require('./scrape/upscale');
const {
    TempMailCreate,
    TempMailInbox,
    TempMailMessage,
    TempMailDelete
} = require('./scrape/tempmail');
const { getDL } = require("./scrape/getdl");
const AlightMotionScraper = require('./scrape/AmGenerator');
const alightMotion = new AlightMotionScraper();


const app = express();

// ============================================================
// 📦 LOCAL CDN + MULTER STORAGE
// ============================================================
const uploadDir = path.join(__dirname, 'public/uploads');

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Length', 'Content-Type']
}));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

// ============================================================
// 🌐 SERVE FILE CDN
// ============================================================
app.use('/r', express.static(uploadDir, {
    etag: true,
    lastModified: true,
    acceptRanges: true,
    setHeaders: (res, filePath) => {
        const mimeType = mime.lookup(filePath);
        if (mimeType) res.setHeader('Content-Type', mimeType);

        if (mimeType && (mimeType.startsWith('video/') || mimeType.startsWith('audio/') || mimeType.startsWith('image/'))) {
            if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) {
                res.setHeader('Accept-Ranges', 'bytes');
            }
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
    }
}));

// ============================================================
// 💾 MULTER DISK & MEMORY STORAGE
// ============================================================
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        let ext = mime.extension(file.mimetype);
        if (!ext || ext === 'bin') {
            ext = path.extname(file.originalname || '').replace('.', '').toLowerCase() || 'tmp';
        }
        cb(null, `${generateShortId(6)}.${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: config.maxFileSize || 500 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!file || !file.mimetype) return cb(new Error('MIME type file tidak valid.'));
        cb(null, true);
    }
});

const uploadMemory = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 500 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!file || !file.mimetype) return cb(new Error('MIME type file tidak valid.'));
        cb(null, true);
    }
});

// ============================================================
// 📖 ROOT & DOCUMENTATION ROUTE
// ============================================================
app.get('/', (req, res) => {
    res.json({
        status: true,
        name: config.name,
        version: config.version,
        baseUrl: config.baseUrl,
        endpoints: {
            status: "GET /status or /health",
            upload: "POST /upload",
            
            lk21: {
                home: "GET /lk21/home",
                browse: "GET /lk21/browse?path=/populer&page=1&type=movie",
                genres: "GET /lk21/genres",
                search: "GET /lk21/search?q=query&page=1",
                detail: "GET /lk21/detail?url=...",
                stream: "GET /lk21/stream?url=..."
            },

            animeid: {
                latest: "GET /animeid/latest?page=1",
                ongoing: "GET /animeid/ongoing",
                popular: "GET /animeid/popular",
                catalog: "GET /animeid/catalog?page=1",
                genres: "GET /animeid/genres",
                genre: "GET /animeid/genre?genre=action&page=1",
                schedule: "GET /animeid/schedule",
                search: "GET /animeid/search?q=one+piece",
                detail: "GET /animeid/detail?url=slug_atau_url&ep=1",
                stream: "GET /animeid/stream?url=url_episode"
            },

            amprem: {
                createTask: "GET /amprem/create"
            },
            
                        amprem: {
                sendLink: "POST /amprem/send-link (JSON Body { email })",
                verifyLink: "POST /amprem/verify (JSON Body { email, magicLink })"
            },


            ai: {
                rayleigh: "GET /ai/rayleigh?text=pertanyaan_kamu",
                deepai: "GET /ai/deepai?text=pertanyaan_kamu&model=standard",
                deepaiModels: "GET /ai/deepai/models",
                imgtoprompt: "ALL /ai/imgtoprompt (File upload or JSON/Query { url })",
                img2img: "ALL /ai/img2img (Prompt & File upload or JSON/Query { url })",
                imagen: {
                    generate: "GET /ai/imagen?prompt=...&style=Realistic&ratio=1:1",
                    image: "GET /ai/imagen/image?prompt=...&style=Anime&ratio=16:9",
                    styles: "GET /ai/imagen/styles",
                    ratios: "GET /ai/imagen/ratios"
                }
            },

            download: {
                ytmp3: "GET /download/ytmp3?url=https://youtu.be/xxx",
                ytmp4: "GET /download/ytmp4?url=https://youtu.be/xxx",
                tiktok: "GET /download/tiktok?url=https://vt.tiktok.com/xxx",
                tiktokv2: "GET /download/tiktokv2?url=https://vt.tiktok.com/xxx",
                igdl: "GET /download/igdl?url=https://www.instagram.com/p/xxx",
                mediafire: "GET /download/mediafire?url=https://www.mediafire.com/file/xxx",
                terabox: "GET /download/terabox?url=https://terabox.com/s/xxx",
                videy: "ALL /download/videy (File upload or JSON/Query { url })",
                savefrom: "GET /download/savefrom?url=https://www.youtube.com/watch?v=xxx"
            },

            utility: {
                tempMailCreate: "GET /utility/tempmail/create",
                tempMailInbox: "GET /utility/tempmail/inbox?email=user@domain.com",
                removebg: "ALL /utility/removebg (File upload or JSON/Query { url })",
                wink: "ALL /utility/wink (File upload or JSON/Query { url })",
                nsfw: "GET /utility/nsfw?category=waifu (&json=true for JSON output)",
                nftoken: "GET /utility/nftoken?count=1&plan=premium",
                upscaleFile: "POST /tools/upscale (Multipart/Form-Data dengan key 'image')",
                upscaleUrl: "POST /tools/upscale-url (JSON Body { url })",
                bypass: "GET /tools/bypass?url=..."             
            },

            anime: {
                home: "GET /anime/home",
                list: "GET /anime/list",
                schedule: "GET /anime/schedule",
                batch: "GET /anime/batch",
                batchDetail: "GET /anime/batch/detail?url=...",
                detail: "GET /anime/detail?url=...",
                episode: "GET /anime/episode?url=..."
            },

            donghub: {
                home: "GET /donghub/home",
                schedule: "GET /donghub/schedule",
                detail: "GET /donghub/detail?slug=...",
                search: "GET /donghub/search?q=query&page=1",
                genre: "GET /donghub/genre?slug=action&page=1",
                genres: "GET /donghub/genres",
                episode: "GET /donghub/episode?slug=..."
            },

            nekopoi: {
                latest: "GET /nekopoi/latest?page=1",
                search: "GET /nekopoi/search?q=query&page=1",
                category: "GET /nekopoi/category?name=3d-hentai&page=1",
                genres: "GET /nekopoi/genres",
                genre: "GET /nekopoi/genre?name=action&page=1",
                hentaiList: "GET /nekopoi/hentai-list",
                javList: "GET /nekopoi/jav-list",
                schedule: "GET /nekopoi/schedule",
                detail: "GET /nekopoi/detail?url=slug_atau_url"
            }
        }
    });
});

// ==========================================
// ⚙️ SYSTEM HEALTH & UPLOAD
// ==========================================
app.get(['/status', '/health'], (req, res) => {
    try {
        const health = getHealthStatus(config);
        return res.json(health);
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

app.post('/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ status: false, message: 'File tidak ditemukan' });
        }
        const result = handleFileUpload(req.file);
        if (req.query.userhash || req.query.reqtype === 'fileupload') {
            return res.send(result.url);
        }
        return res.json({ status: true, result });
    } catch (err) {
        return res.status(400).json({ status: false, message: err.message });
    }
});

// ==========================================
// 🎬 CATEGORY: LK21 SCRAPER
// ==========================================
const LK21_BASE = 'https://tv10.lk21official.cc';
const LK21_DRAMAMU = 'https://dramamu.lk21.de';
const LK21_COVER = 'https://cover.showcdnx.com/wp-content/uploads/';
const LK21_SEARCH_API = 'https://gudangvape.com/search.php';

const lk21Headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
    'Referer': LK21_BASE + '/'
};

const lk21Cache = new Map();
const LK21_CACHE_TTL = 5 * 60 * 1000;

function lk21Clean(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

async function lk21Request(url) {
    const response = await axios.get(url, {
        headers: lk21Headers,
        timeout: 30000,
        maxRedirects: 5,
        validateStatus: status => status >= 200 && status < 400
    });
    return response.data;
}

async function lk21RequestJSON(url) {
    const response = await axios.get(url, {
        headers: {
            ...lk21Headers,
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest'
        },
        timeout: 30000
    });
    return response.data;
}

function lk21ParseItem($, el) {
    const a = $(el).find('a[itemprop="url"], a').first();
    const img = $(el).find('img').first();
    const poster = img.attr('src') || img.attr('data-src') || '';
    
    return {
        title: lk21Clean($(el).find('.poster-title').text()),
        slug: (a.attr('href') || '').replace(/^\//, '').replace(/\/$/, ''),
        url: a.attr('href')?.startsWith('http') ? a.attr('href') : `${LK21_BASE}${a.attr('href') || ''}`,
        year: lk21Clean($(el).find('.year').text()),
        rating: lk21Clean($(el).find('.poster .rating [itemprop="ratingValue"]').text()) || (lk21Clean($(el).find('.poster .rating').text()).match(/\d+(\.\d+)?/) || [''])[0],
        quality: lk21Clean($(el).find('.poster .label').text()),
        episode: lk21Clean($(el).find('.episode strong').text()),
        season: lk21Clean($(el).find('.duration:not([itemprop])').text()).replace('S.', ''),
        runtime: lk21Clean($(el).find('.duration[itemprop="duration"]').text()),
        genre: $(el).find('meta[itemprop="genre"]').attr('content') || '',
        poster: poster.startsWith('http') ? poster : poster ? LK21_COVER + poster : '',
    };
}

function lk21ParseDetailCore($) {
    const infoTag = $('.info-tag span').map((_, el) => lk21Clean($(el).text())).get();
    const tags = $('.tag-list .tag a').map((_, el) => ({
        type: $(el).attr('href').split('/').filter(Boolean)[0],
        slug: $(el).attr('href').split('/').filter(Boolean)[1],
        name: lk21Clean($(el).text()),
    })).get();

    const meta = {};
    $('.detail p').each((_, el) => {
        const label = lk21Clean($(el).find('span').text().replace(':', ''));
        const val = lk21Clean($(el).clone().find('span').remove().end().text());
        if (label) meta[label] = val;
    });
    
    const terbaru = lk21Clean($('.meta-info > p').first().find('a').text());

    return {
        title: lk21Clean($('h1').first().text()),
        infoTag,
        rating: $('.rating-number').attr('data-base-rating') || '',
        votes: $('.rating-users').attr('data-base-votes') || '',
        genres: tags.filter(t => t.type === 'genre').map(t => t.name),
        country: tags.filter(t => t.type === 'country').map(t => t.name),
        director: meta['Sutradara'] || '',
        cast: (meta['Bintang Film'] || '').split(',').map(s => lk21Clean(s)).filter(Boolean),
        release: meta['Release'] || '',
        updated: meta['Updated'] || '',
        votesMeta: meta['Votes'] || '',
        synopsis: lk21Clean($('.synopsis').text()),
        latestEpisode: terbaru,
        poster: $('.detail img').attr('src') || $('.detail img').attr('data-src') || '',
        trailer: $('.trailer-series iframe, .simple-box iframe').attr('src') || '',
    };
}

app.get('/lk21/home', async (req, res) => {
    try {
        const key = 'lk21_home';
        const cached = lk21Cache.get(key);
        if (cached && Date.now() - cached.time < LK21_CACHE_TTL) {
            return res.json({ status: true, creator: 'ReyCloudSHP', result: cached.data });
        }

        const html = await lk21Request(LK21_BASE + '/');
        const $ = cheerio.load(html);
        const sections = [];

        $('.widget[data-type]').each((_, w) => {
            const type = $(w).attr('data-type') || '';
            const title = lk21Clean($(w).find('.header h2').text());
            const seeAll = $(w).find('.header a').attr('href') || '';
            if ($(w).attr('id') === 'you-may-wrapper') return;
            
            const items = [];
            $(w).find('li.slider, #you-may-also-like li').each((_, el) => items.push(lk21ParseItem($, el)));
            
            sections.push({
                type,
                title,
                seeAll: seeAll.startsWith('http') ? seeAll : `${LK21_BASE}${seeAll}`,
                items,
            });
        });

        const latest = [];
        $('#post-container article, .gallery-grid article').each((_, el) => latest.push(lk21ParseItem($, el)));

        const result = { sections, latest };
        lk21Cache.set(key, { time: Date.now(), data: result });

        res.json({ status: true, creator: 'ReyCloudSHP', result });
    } catch (err) {
        res.status(500).json({ status: false, creator: 'ReyCloudSHP', error: err.message });
    }
});

app.get('/lk21/browse', async (req, res) => {
    try {
        const path = req.query.path || '/populer';
        const page = parseInt(req.query.page) || 1;
        const type = req.query.type || '';

        let url = path.startsWith('http') ? path : `${LK21_BASE}/${path.replace(/^\//, '')}`;
        if (page > 1) url += `${url.endsWith('/') ? '' : '/'}page/${page}`;
        if (type && ['movie', 'series', 'both'].includes(type)) url += `${url.includes('?') ? '&' : '?'}type=${type}`;

        const html = await lk21Request(url);
        const $ = cheerio.load(html);

        const title = lk21Clean($('h1').first().text());
        const items = [];
        $('.gallery-grid article, #post-container article').each((_, el) => items.push(lk21ParseItem($, el)));

        const totalPages = $('.pagination li:not(.active) a')
            .map((_, a) => parseInt($(a).attr('href')?.match(/page\/(\d+)/)?.[1] || lk21Clean($(a).text()), 10))
            .get()
            .filter(n => !isNaN(n));
        const last = totalPages.length ? Math.max(...totalPages) : 1;

        res.json({ status: true, creator: 'ReyCloudSHP', title, page, totalPages: last, items });
    } catch (err) {
        res.status(500).json({ status: false, creator: 'ReyCloudSHP', error: err.message });
    }
});

app.get('/lk21/genres', async (req, res) => {
    try {
        const html = await lk21Request(LK21_BASE + '/genre/');
        const $ = cheerio.load(html);
        const result = [...new Set($('a[href^="/genre/"]').map((_, a) => ({
            slug: $(a).attr('href').split('/').filter(Boolean)[1],
            name: lk21Clean($(a).text()),
        })).get())].filter(g => g.name);

        res.json({ status: true, creator: 'ReyCloudSHP', total: result.length, result });
    } catch (err) {
        res.status(500).json({ status: false, creator: 'ReyCloudSHP', error: err.message });
    }
});

app.get('/lk21/search', async (req, res) => {
    try {
        const query = lk21Clean(req.query.q || req.query.query || '');
        const page = parseInt(req.query.page) || 1;
        if (!query) return res.status(400).json({ status: false, creator: 'ReyCloudSHP', message: 'Parameter query (q) wajib diisi.' });

        const url = `${LK21_SEARCH_API}?s=${encodeURIComponent(query)}&page=${page}`;
        const data = await lk21RequestJSON(url);

        const items = (data?.data || data?.items || []).map(it => ({
            title: it.title,
            slug: it.slug,
            url: `${LK21_BASE}/${it.slug}`,
            year: it.year,
            rating: it.rating,
            quality: it.quality,
            episode: it.episode || undefined,
            season: it.season || undefined,
            runtime: it.runtime || undefined,
            type: it.type || undefined,
            poster: it.poster?.startsWith('http') ? it.poster : it.poster ? LK21_COVER + it.poster : '',
        }));

        res.json({ status: true, creator: 'ReyCloudSHP', query, page, totalPages: data?.totalPages || data?.total_pages || 1, items });
    } catch (err) {
        res.status(500).json({ status: false, creator: 'ReyCloudSHP', error: err.message });
    }
});

app.get('/lk21/detail', async (req, res) => {
    try {
        const targetUrl = req.query.url;
        if (!targetUrl) return res.status(400).json({ status: false, creator: 'ReyCloudSHP', message: 'Parameter url diperlukan!' });

        const html = await lk21Request(targetUrl);
        const $tmp = cheerio.load(html);
        const openNow = $tmp('#openNow').attr('href');

        if (openNow) {
            const seriesHtml = await lk21Request(openNow);
            const $ = cheerio.load(seriesHtml);
            const core = lk21ParseDetailCore($);
            
            const seasons = {};
            const sd = $('#season-data').text();
            if (sd) {
                try {
                    const parsed = JSON.parse(sd);
                    for (const [s, eps] of Object.entries(parsed)) {
                        seasons[s] = eps.map(e => ({
                            episode: e.episode_no,
                            title: e.title,
                            slug: e.slug,
                            url: `${LK21_DRAMAMU}/${e.slug}`,
                        }));
                    }
                } catch {}
            }

            const related = [];
            $('.widget[data-type] li.slider').each((_, el) => related.push(lk21ParseItem($, el)));

            return res.json({
                status: true,
                creator: 'ReyCloudSHP',
                type: 'series',
                url: openNow,
                ...core,
                seasons,
                totalEpisodes: Object.values(seasons).reduce((n, e) => n + e.length, 0),
                related,
            });
        } else {
            const $ = cheerio.load(html);
            const core = lk21ParseDetailCore($);

            const players = [];
            $('#player-list a[data-url], #player-list li a').each((_, el) => {
                players.push({
                    server: lk21Clean($(el).attr('data-server') || $(el).text()).toLowerCase(),
                    url: $(el).attr('data-url') || $(el).attr('href'),
                });
            });

            return res.json({
                status: true,
                creator: 'ReyCloudSHP',
                type: 'movie',
                url: targetUrl,
                ...core,
                download: $('a[title^="Download"]').attr('href') || '',
                players: players.filter(p => p.url),
            });
        }
    } catch (err) {
        res.status(500).json({ status: false, creator: 'ReyCloudSHP', error: err.message });
    }
});

app.get('/lk21/stream', async (req, res) => {
    try {
        const targetUrl = req.query.url;
        if (!targetUrl) return res.status(400).json({ status: false, creator: 'ReyCloudSHP', message: 'Parameter url diperlukan!' });

        const html = await lk21Request(targetUrl);
        const $ = cheerio.load(html);

        const players = [];
        $('#player-list a[data-url], #player-list li a').each((_, el) => {
            const server = lk21Clean($(el).attr('data-server') || $(el).text()).toLowerCase();
            const u = $(el).attr('data-url') || $(el).attr('href');
            if (u && u !== '#') players.push({ server, url: u, active: $(el).hasClass('active') });
        });

        if (!players.length) {
            const src = $('#main-player').attr('src');
            if (src) players.push({ server: 'p2p', url: src, active: true });
        }

        const nav = [];
        $('a:contains("EPISODE SEBELUMNYA"), a:contains("EPISODE BERIKUTNYA"), .prev-episode a, .next-episode a').each((_, el) => {
            const href = $(el).attr('href');
            if (href && /^\/|^https?:/.test(href)) nav.push({ text: lk21Clean($(el).text()), url: href });
        });

        res.json({
            status: true,
            creator: 'ReyCloudSHP',
            url: targetUrl,
            title: lk21Clean($('h1').first().text()),
            players,
            nav,
        });
    } catch (err) {
        res.status(500).json({ status: false, creator: 'ReyCloudSHP', error: err.message });
    }
});

// ==========================================
// 🎬 CATEGORY: ANIMEID SCRAPER ENDPOINTS
// ==========================================
const animeid = require('./scrape/animeid');

// 1. Episode Terbaru
app.get('/animeid/latest', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const result = await animeid.getLatestEpisodes(page);
        result.creator = "ReyCloudSHP";
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ status: false, creator: "ReyCloudSHP", message: err.message });
    }
});

// 2. Anime Ongoing
app.get('/animeid/ongoing', async (req, res) => {
    try {
        const result = await animeid.getOngoingAnime();
        result.creator = "ReyCloudSHP";
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ status: false, creator: "ReyCloudSHP", message: err.message });
    }
});

// 3. Serial Populer
app.get('/animeid/popular', async (req, res) => {
    try {
        const result = await animeid.getPopularSeries();
        result.creator = "ReyCloudSHP";
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ status: false, creator: "ReyCloudSHP", message: err.message });
    }
});

// 4. Katalog Anime
app.get('/animeid/catalog', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const result = await animeid.getAnimeCatalog(page);
        result.creator = "ReyCloudSHP";
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ status: false, creator: "ReyCloudSHP", message: err.message });
    }
});

// 5. Daftar Genre
app.get('/animeid/genres', async (req, res) => {
    try {
        const result = await animeid.getGenreList();
        result.creator = "ReyCloudSHP";
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ status: false, creator: "ReyCloudSHP", message: err.message });
    }
});

// 6. Anime Berdasarkan Genre
app.get('/animeid/genre', async (req, res) => {
    try {
        const genre = req.query.genre || req.query.slug;
        const page = parseInt(req.query.page) || 1;
        if (!genre) return res.status(400).json({ status: false, creator: "ReyCloudSHP", message: "Parameter 'genre' atau 'slug' wajib diisi!" });
        const result = await animeid.getAnimeByGenre(genre, page);
        result.creator = "ReyCloudSHP";
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ status: false, creator: "ReyCloudSHP", message: err.message });
    }
});

// 7. Jadwal Rilis
app.get('/animeid/schedule', async (req, res) => {
    try {
        const result = await animeid.getReleaseSchedule();
        result.creator = "ReyCloudSHP";
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ status: false, creator: "ReyCloudSHP", message: err.message });
    }
});

// 8. Pencarian Anime
app.get('/animeid/search', async (req, res) => {
    try {
        const query = req.query.q || req.query.query;
        if (!query) return res.status(400).json({ status: false, creator: "ReyCloudSHP", message: "Parameter 'q' wajib diisi!" });
        const result = await animeid.searchAnime(query);
        result.creator = "ReyCloudSHP";
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ status: false, creator: "ReyCloudSHP", message: err.message });
    }
});

// 9. Detail Anime & Episode List
app.get('/animeid/detail', async (req, res) => {
    try {
        const url = req.query.url || req.query.slug;
        const episode = req.query.ep || req.query.episode || null;
        if (!url) return res.status(400).json({ status: false, creator: "ReyCloudSHP", message: "Parameter 'url' atau 'slug' wajib diisi!" });
        const result = await animeid.getAnimeDetails(url, episode);
        result.creator = "ReyCloudSHP";
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ status: false, creator: "ReyCloudSHP", message: err.message });
    }
});

// 10. Streaming & Link Download Episode
app.get('/animeid/stream', async (req, res) => {
    try {
        const url = req.query.url || req.query.path;
        if (!url) return res.status(400).json({ status: false, creator: "ReyCloudSHP", message: "Parameter 'url' wajib diisi!" });
        const result = await animeid.getEpisodeStream(url);
        result.creator = "ReyCloudSHP";
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ status: false, creator: "ReyCloudSHP", message: err.message });
    }
});



// ==========================================
// 🤖 CATEGORY: AI INTELLIGENCE & OTHERS (Existing Code)
// ==========================================
app.get('/ai/rayleigh', async (req, res) => {
    try {
        const text = req.query.text || req.query.q;
        if (!text) return res.status(400).json({ status: false, creator: "ReyCloudShop", message: "Parameter 'text' wajib diisi!" });
        const result = await rayleighScraper(text);
        if (!result.status) return res.status(500).json({ status: false, creator: "ReyCloudShop", message: result.error });
        return res.json({ status: true, creator: "ReyCloudShop", result: result.data });
    } catch (err) {
        return res.status(500).json({ status: false, creator: "ReyCloudShop", message: err.message });
    }
});

app.all('/ai/imgtoprompt', uploadMemory.single('file'), async (req, res) => {
    try {
        let imageBuffer = null;
        if (req.file) {
            imageBuffer = req.file.buffer;
        } else if (req.query.url || req.body?.url) {
            const imageUrl = req.query.url || req.body.url;
            const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            imageBuffer = Buffer.from(response.data);
        }
        if (!imageBuffer) return res.status(400).json({ status: false, message: "Kirim gambar via multipart/form-data (key: 'file') atau sertakan query/body 'url'!" });
        const result = await imgtoprompt(imageBuffer);
        if (!result.status) return res.status(500).json({ status: false, message: result.msg });
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

app.all('/ai/img2img', uploadMemory.single('file'), async (req, res) => {
    try {
        const prompt = req.query.prompt || req.body?.prompt;
        if (!prompt) return res.status(400).json({ status: false, message: "Parameter 'prompt' wajib diisi!" });
        let imageBuffer = null;
        if (req.file) {
            imageBuffer = req.file.buffer;
        } else if (req.query.url || req.body?.url) {
            const imageUrl = req.query.url || req.body.url;
            const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            imageBuffer = Buffer.from(response.data);
        }
        if (!imageBuffer) return res.status(400).json({ status: false, message: "Kirim gambar via multipart/form-data (key: 'file') atau sertakan query/body 'url'!" });
        const result = await Img2Img(prompt, imageBuffer);
        if (!result.status) return res.status(500).json({ status: false, message: result.error });
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

// ==========================================
// 📥 CATEGORY: MEDIA DOWNLOADER
// ==========================================
app.get('/download/ytmp3', async (req, res) => {
    try {
        const url = req.query.url;
        if (!url) return res.status(400).json({ status: false, message: "Parameter 'url' YouTube wajib diisi!" });
        const yt = new Youtube();
        const result = await yt.download(url, 'mp3');
        return res.json({ status: true, result });
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

app.get('/download/ytmp4', async (req, res) => {
    try {
        const url = req.query.url;
        if (!url) return res.status(400).json({ status: false, message: "Parameter 'url' YouTube wajib diisi!" });
        const yt = new Youtube();
        const result = await yt.download(url, 'mp4');
        return res.json({ status: true, result });
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

app.get('/download/tiktok', async (req, res) => {
    try {
        const url = req.query.url;
        if (!url) return res.status(400).json({ status: false, message: "Parameter 'url' TikTok wajib diisi!" });
        const result = await tiktokv1(url);
        if (!result.status) return res.status(500).json({ status: false, message: result.msg || "Gagal mengambil data TikTok" });
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

app.get('/download/tiktokv2', async (req, res) => {
    try {
        const url = req.query.url;
        if (!url) return res.status(400).json({ status: false, message: "Parameter 'url' TikTok wajib diisi!" });
        const result = await tiktokv2(url);
        if (!result.status) return res.status(500).json({ status: false, message: result.msg || "Gagal mengambil data TikTok" });
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

app.get('/download/igdl', async (req, res) => {
    try {
        const url = req.query.url;
        if (!url) return res.status(400).json({ status: false, message: "Parameter 'url' Instagram wajib diisi!" });
        const result = await igdl(url);
        if (!result.status) return res.status(500).json({ status: false, message: result.message || "Gagal mengambil media Instagram" });
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

app.get('/download/mediafire', async (req, res) => {
    try {
        const url = req.query.url;
        if (!url) return res.status(400).json({ status: false, message: "Parameter 'url' MediaFire wajib diisi!" });
        const result = await mediafire(url);
        return res.json({ status: true, result });
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

app.get('/download/terabox', async (req, res) => {
    try {
        const url = req.query.url;
        if (!url) return res.status(400).json({ status: false, message: "Parameter 'url' TeraBox wajib diisi!" });
        const result = await TeraBoxDL(url);
        if (!result.status) return res.status(500).json({ status: false, message: result.error });
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

app.all('/download/videy', uploadMemory.single('file'), async (req, res) => {
    try {
        let videoBuffer = null;
        if (req.file) {
            videoBuffer = req.file.buffer;
        } else if (req.query.url || req.body?.url) {
            const videoUrl = req.query.url || req.body.url;
            const response = await axios.get(videoUrl, { responseType: 'arraybuffer' });
            videoBuffer = Buffer.from(response.data);
        }
        if (!videoBuffer) return res.status(400).json({ status: false, message: "Kirim video via multipart/form-data (key: 'file') atau sertakan query/body 'url'!" });
        const result = await videy(videoBuffer);
        return res.json({ status: true, result });
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

// ==========================================
// 📧 UTILITY / TEMPMAIL / OTHERS
// ==========================================
app.get('/utility/tempmail/create', async (req, res) => {
    try {
        const result = await TempMailCreate();
        if (!result.status) return res.status(500).json({ status: false, message: result.error });
        return res.json({ status: true, ...result });
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

app.get('/utility/tempmail/inbox', async (req, res) => {
    try {
        const { token } = req.query;
        if (!token) return res.status(400).json({ status: false, message: "Parameter 'token' wajib diisi!" });
        const result = await TempMailInbox({ status: true, token });
        if (!result.status) return res.status(500).json({ status: false, message: result.error });
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

app.get('/utility/tempmail/message', async (req, res) => {
    try {
        const { token, messageId } = req.query;
        if (!token || !messageId) return res.status(400).json({ status: false, message: "Parameter 'token' dan 'messageId' wajib diisi!" });
        const result = await TempMailMessage({ status: true, token }, messageId);
        if (!result.status) return res.status(500).json({ status: false, message: result.error });
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

app.delete('/utility/tempmail/delete', async (req, res) => {
    try {
        const { token, accountId } = req.query;
        if (!token || !accountId) return res.status(400).json({ status: false, message: "Parameter 'token' dan 'accountId' wajib diisi!" });
        const result = await TempMailDelete({ status: true, token, account: { id: accountId } });
        if (!result.status) return res.status(500).json({ status: false, message: result.error });
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

app.all('/utility/removebg', uploadMemory.single('file'), async (req, res) => {
    try {
        let imageBuffer = null;
        if (req.file) {
            imageBuffer = req.file.buffer;
        } else if (req.query.url || req.body?.url) {
            const imageUrl = req.query.url || req.body.url;
            const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            imageBuffer = Buffer.from(response.data);
        }
        if (!imageBuffer) return res.status(400).json({ status: false, message: "Kirim gambar via multipart/form-data (key: 'file') atau sertakan query/body 'url'!" });
        const resultBuffer = await pixa(imageBuffer);
        res.setHeader('Content-Type', 'image/png');
        return res.send(resultBuffer);
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

app.all('/utility/wink', uploadMemory.single('file'), async (req, res) => {
    let tempFilePath = null;
    try {
        let videoInput = null;
        if (req.file) {
            const tempDir = path.join(__dirname, 'public/uploads/temp');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
            tempFilePath = path.join(tempDir, `${generateShortId(8)}.mp4`);
            fs.writeFileSync(tempFilePath, req.file.buffer);
            videoInput = tempFilePath;
        } else if (req.query.url || req.body?.url) {
            videoInput = req.query.url || req.body.url;
        }
        if (!videoInput) return res.status(400).json({ status: false, creator: "ReyCloudSHP", message: "Kirim file video via multipart/form-data (key: 'file') atau sertakan query/body 'url'!" });
        const result = await winkEnhance(videoInput, { filename: req.file ? req.file.originalname : undefined });
        return res.json({ status: true, creator: "ReyCloudSHP", result });
    } catch (err) {
        return res.status(500).json({ status: false, creator: "ReyCloudSHP", message: err.message });
    } finally {
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            try { fs.unlinkSync(tempFilePath); } catch (e) {}
        }
    }
});

app.get('/utility/nsfw', async (req, res) => {
    try {
        const category = req.query.category;
        if (!category) return res.json({ status: true, message: "Parameter 'category' wajib diisi untuk mengambil gambar.", availableCategories: getCategoriesList() });
        const result = await getNsfwMediaUrl(category);
        if (req.query.json === 'true') return res.json(result);
        const imgRes = await axios.get(result.url, { responseType: 'arraybuffer', timeout: 30000 });
        res.setHeader('Content-Type', imgRes.headers['content-type'] || 'image/jpeg');
        return res.send(Buffer.from(imgRes.data));
    } catch (err) {
        return res.status(400).json({ status: false, message: err.message });
    }
});

app.get('/utility/nftoken', async (req, res) => {
    try {
        let count = parseInt(req.query.count) || 1;
        if (count > 10) count = 10;
        const plan = req.query.plan || null;
        if (plan && !['premium', 'standard', 'basic'].includes(plan)) return res.status(400).json({ status: false, creator: "ReyCloudSHP", message: "Plan tidak valid!" });
        const tokens = await fetchNftoken(count, plan);
        return res.json({ status: true, creator: "ReyCloudSHP", total: tokens.length, result: tokens });
    } catch (err) {
        return res.status(500).json({ status: false, creator: "ReyCloudSHP", message: err.message });
    }
});

app.post('/tools/upscale', uploadMemory.single('image'), async (req, res) => {
    try {
        const uploadedFile = req.file || req.files?.image || req.files?.file;
        if (!uploadedFile) return res.status(400).json({ status: false, creator: "ReyCloudSHP", message: "❌ Harap lampirkan file gambar dengan field key 'image' atau 'file'!" });
        const result = await upscaleImage(uploadedFile.buffer, uploadedFile.originalname || 'image.jpg');
        return res.status(200).json(result);
    } catch (err) {
        return res.status(500).json({ status: false, creator: "ReyCloudSHP", message: err.message });
    }
});

app.post('/tools/upscale-url', express.json(), async (req, res) => {
    try {
        const imageUrl = req.body?.url || req.query?.url;
        if (!imageUrl) return res.status(400).json({ status: false, creator: "ReyCloudSHP", message: "❌ Harap sertakan parameter 'url' pada body JSON atau query!" });
        const result = await upscaleImage(imageUrl);
        return res.status(200).json(result);
    } catch (err) {
        return res.status(500).json({ status: false, creator: "ReyCloudSHP", message: err.message });
    }
});

// ==========================================
// 🎞️ ANIME (SAMEHADAKU)
// ==========================================
const SAMEH_CREATOR = "ReyCloudSHP";
app.get('/anime/home', async (req, res) => {
    try {
        const result = await samehadaku.scrapeHome();
        res.json({ status: true, creator: SAMEH_CREATOR, result });
    } catch (err) {
        res.status(500).json({ status: false, creator: SAMEH_CREATOR, message: err.message });
    }
});

app.get('/anime/list', async (req, res) => {
    try {
        const result = await samehadaku.scrapeDaftarAnime();
        res.json({ status: true, creator: SAMEH_CREATOR, total: result.length, result });
    } catch (err) {
        res.status(500).json({ status: false, creator: SAMEH_CREATOR, message: err.message });
    }
});

app.get('/anime/schedule', async (req, res) => {
    try {
        const result = await samehadaku.scrapeJadwalRilis();
        const total = Object.values(result).reduce((sum, items) => sum + items.length, 0);
        res.json({ status: true, creator: SAMEH_CREATOR, total, result });
    } catch (err) {
        res.status(500).json({ status: false, creator: SAMEH_CREATOR, message: err.message });
    }
});

app.get('/anime/batch', async (req, res) => {
    try {
        const result = await samehadaku.scrapeDaftarBatch();
        res.json({ status: true, creator: SAMEH_CREATOR, total: result.length, result });
    } catch (err) {
        res.status(500).json({ status: false, creator: SAMEH_CREATOR, message: err.message });
    }
});

app.get('/anime/batch/detail', async (req, res) => {
    try {
        const url = req.query.url;
        if (!url) return res.status(400).json({ status: false, creator: SAMEH_CREATOR, message: "Parameter 'url' wajib diisi!" });
        const result = await samehadaku.scrapeBatchDetail(url);
        res.json({ status: true, creator: SAMEH_CREATOR, result });
    } catch (err) {
        res.status(500).json({ status: false, creator: SAMEH_CREATOR, message: err.message });
    }
});

app.get('/anime/detail', async (req, res) => {
    try {
        const url = req.query.url;
        if (!url) return res.status(400).json({ status: false, creator: SAMEH_CREATOR, message: "Parameter 'url' wajib diisi!" });
        const result = await samehadaku.scrapeDetailAnime(url);
        res.json({ status: true, creator: SAMEH_CREATOR, result });
    } catch (err) {
        res.status(500).json({ status: false, creator: SAMEH_CREATOR, message: err.message });
    }
});

app.get('/anime/episode', async (req, res) => {
    try {
        const url = req.query.url;
        const resolve = req.query.resolve === 'true'; 
        if (!url) return res.status(400).json({ status: false, creator: SAMEH_CREATOR, message: "Parameter 'url' wajib diisi!" });
        const result = await samehadaku.scrapeEpisode(url, resolve);
        res.json({ status: true, creator: SAMEH_CREATOR, result });
    } catch (err) {
        res.status(500).json({ status: false, creator: SAMEH_CREATOR, message: err.message });
    }
});

// ==========================================
// 🎨 IMAGEN AI & NEKOPOI & DONGHUB & TOKUSATSU
// ==========================================
const IMAGEN_CREATOR = "ReyCloudSHP";
app.get('/ai/imagen', async (req, res) => {
    try {
        const prompt = req.query.prompt || req.query.text;
        if (!prompt) return res.status(400).json({ status: false, creator: IMAGEN_CREATOR, message: "Parameter 'prompt' wajib diisi!" });
        const result = await imagen.generateImage({
            prompt,
            style: req.query.style || "Realistic",
            ratio: req.query.ratio || "1:1",
            steps: req.query.steps || 4,
            upload: req.query.upload === "true"
        });
        const output = {
            status: true,
            creator: IMAGEN_CREATOR,
            result: { prompt: result.prompt, style: result.style, ratio: result.ratio, width: result.width, height: result.height, seed: result.seed }
        };
        if (result.upload) {
            output.result.url = result.upload.url;
            output.result.displayUrl = result.upload.displayUrl;
            output.result.deleteUrl = result.upload.deleteUrl;
        }
        return res.json(output);
    } catch (err) {
        return res.status(500).json({ status: false, creator: IMAGEN_CREATOR, message: err.message });
    }
});

app.get('/ai/imagen/image', async (req, res) => {
    try {
        const prompt = req.query.prompt || req.query.text;
        if (!prompt) return res.status(400).json({ status: false, creator: IMAGEN_CREATOR, message: "Parameter 'prompt' wajib diisi!" });
        const result = await imagen.generateImage({ prompt, style: req.query.style || "Realistic", ratio: req.query.ratio || "1:1", steps: req.query.steps || 4, upload: false });
        res.setHeader("Content-Type", result.mimeType);
        res.setHeader("Cache-Control", "no-store");
        return res.send(result.buffer);
    } catch (err) {
        return res.status(500).json({ status: false, creator: IMAGEN_CREATOR, message: err.message });
    }
});

app.get('/ai/imagen/styles', (req, res) => res.json({ status: true, creator: IMAGEN_CREATOR, result: imagen.getStyles() }));
app.get('/ai/imagen/ratios', (req, res) => res.json({ status: true, creator: IMAGEN_CREATOR, result: imagen.getRatios() }));

// NEKOPOI
const NEKO_CREATOR = "ReyCloudSHP";
app.get('/nekopoi/latest', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const result = await nekopoi.getLatest(page);
        res.json({ status: true, creator: NEKO_CREATOR, page, total: result.length, result });
    } catch (err) {
        res.status(500).json({ status: false, creator: NEKO_CREATOR, message: err.message });
    }
});

app.get('/nekopoi/search', async (req, res) => {
    try {
        const query = req.query.q || req.query.query;
        const page = parseInt(req.query.page) || 1;
        if (!query) return res.status(400).json({ status: false, creator: NEKO_CREATOR, message: "Parameter 'q' wajib diisi!" });
        const result = await nekopoi.search(query, page);
        res.json({ status: true, creator: NEKO_CREATOR, query, page, total: result.length, result });
    } catch (err) {
        res.status(500).json({ status: false, creator: NEKO_CREATOR, message: err.message });
    }
});

app.get('/nekopoi/category', async (req, res) => {
    try {
        const name = req.query.name || req.query.category;
        const page = parseInt(req.query.page) || 1;
        if (!name) return res.status(400).json({ status: false, creator: NEKO_CREATOR, message: "Parameter 'name' wajib diisi!" });
        const result = await nekopoi.getCategory(name, page);
        res.json({ status: true, creator: NEKO_CREATOR, category: name, page, total: result.length, result });
    } catch (err) {
        res.status(500).json({ status: false, creator: NEKO_CREATOR, message: err.message });
    }
});

app.get('/nekopoi/genres', async (req, res) => {
    try {
        const result = await nekopoi.getGenres();
        res.json({ status: true, creator: NEKO_CREATOR, total: result.length, result });
    } catch (err) {
        res.status(500).json({ status: false, creator: NEKO_CREATOR, message: err.message });
    }
});

app.get('/nekopoi/genre', async (req, res) => {
    try {
        const name = req.query.name || req.query.genre;
        const page = parseInt(req.query.page) || 1;
        if (!name) return res.status(400).json({ status: false, creator: NEKO_CREATOR, message: "Parameter 'name' wajib diisi!" });
        const result = await nekopoi.getByGenre(name, page);
        res.json({ status: true, creator: NEKO_CREATOR, genre: name, page, total: result.length, result });
    } catch (err) {
        res.status(500).json({ status: false, creator: NEKO_CREATOR, message: err.message });
    }
});

app.get('/nekopoi/hentai-list', async (req, res) => {
    try {
        const result = await nekopoi.getHentaiList();
        res.json({ status: true, creator: NEKO_CREATOR, total: result.length, result });
    } catch (err) {
        res.status(500).json({ status: false, creator: NEKO_CREATOR, message: err.message });
    }
});

app.get('/nekopoi/jav-list', async (req, res) => {
    try {
        const result = await nekopoi.getJavList();
        res.json({ status: true, creator: NEKO_CREATOR, total: result.length, result });
    } catch (err) {
        res.status(500).json({ status: false, creator: NEKO_CREATOR, message: err.message });
    }
});

app.get('/nekopoi/schedule', async (req, res) => {
    try {
        const result = await nekopoi.getSchedule();
        res.json({ status: true, creator: NEKO_CREATOR, total: result.length, result });
    } catch (err) {
        res.status(500).json({ status: false, creator: NEKO_CREATOR, message: err.message });
    }
});

app.get('/nekopoi/detail', async (req, res) => {
    try {
        const url = req.query.url;
        if (!url) return res.status(400).json({ status: false, creator: NEKO_CREATOR, message: "Parameter 'url' wajib diisi!" });
        const result = await nekopoi.getDetail(url);
        res.json({ status: true, creator: NEKO_CREATOR, result });
    } catch (err) {
        res.status(500).json({ status: false, creator: NEKO_CREATOR, message: err.message });
    }
});

// SAVEFROM MULTI DOWNLOADER
app.get("/download/getdl", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ status: false, creator: "ReyCloudSHP", message: "Parameter url wajib diisi." });
    const result = await getDL(url);
    return res.status(result.status ? 200 : 500).json({
      status: result.status,
      creator: "ReyCloudSHP",
      data: result.status ? result.data : null,
      message: result.status ? "Berhasil mendapatkan data dari GetDL." : result.message
    });
  } catch (error) {
    return res.status(500).json({ status: false, creator: "ReyCloudSHP", message: error.message });
  }
});

// DONGHUB
const DONGHUB_CREATOR = "ReyCloudSHP";
app.get('/donghub/home', async (req, res) => {
    try {
        const result = await donghub.getHome();
        res.json({ status: true, creator: DONGHUB_CREATOR, result });
    } catch (err) {
        res.status(500).json({ status: false, creator: DONGHUB_CREATOR, message: err.message });
    }
});

app.get('/donghub/schedule', async (req, res) => {
    try {
        const result = await donghub.getSchedule();
        res.json({ status: true, creator: DONGHUB_CREATOR, result });
    } catch (err) {
        res.status(500).json({ status: false, creator: DONGHUB_CREATOR, message: err.message });
    }
});

app.get('/donghub/detail', async (req, res) => {
    try {
        const slug = req.query.slug || req.query.url;
        if (!slug) return res.status(400).json({ status: false, creator: DONGHUB_CREATOR, message: "Parameter 'slug' wajib diisi!" });
        const result = await donghub.getDetail(slug);
        res.json({ status: true, creator: DONGHUB_CREATOR, result });
    } catch (err) {
        res.status(500).json({ status: false, creator: DONGHUB_CREATOR, message: err.message });
    }
});

app.get('/donghub/search', async (req, res) => {
    try {
        const query = req.query.q || req.query.query;
        const page = parseInt(req.query.page) || 1;
        if (!query) return res.status(400).json({ status: false, creator: DONGHUB_CREATOR, message: "Parameter 'q' wajib diisi!" });
        const result = await donghub.search(query, page);
        res.json({ status: true, creator: DONGHUB_CREATOR, query, page, ...result });
    } catch (err) {
        res.status(500).json({ status: false, creator: DONGHUB_CREATOR, message: err.message });
    }
});

app.get('/donghub/genre', async (req, res) => {
    try {
        const genreSlug = req.query.slug || req.query.genre;
        const page = parseInt(req.query.page) || 1;
        if (!genreSlug) return res.status(400).json({ status: false, creator: DONGHUB_CREATOR, message: "Parameter 'slug' wajib diisi!" });
        const result = await donghub.getDonghuaByGenre(genreSlug, page);
        res.json({ status: true, creator: DONGHUB_CREATOR, genre: genreSlug, page, ...result });
    } catch (err) {
        res.status(500).json({ status: false, creator: DONGHUB_CREATOR, message: err.message });
    }
});

app.get('/donghub/genres', async (req, res) => {
    try {
        const result = await donghub.getGenres();
        res.json({ status: true, creator: DONGHUB_CREATOR, total: result.length, result });
    } catch (err) {
        res.status(500).json({ status: false, creator: DONGHUB_CREATOR, message: err.message });
    }
});

app.get('/donghub/episode', async (req, res) => {
    try {
        const slug = req.query.slug || req.query.url;
        if (!slug) return res.status(400).json({ status: false, creator: DONGHUB_CREATOR, message: "Parameter 'slug' wajib diisi!" });
        const result = await donghub.getEpisode(slug);
        res.json({ status: true, creator: DONGHUB_CREATOR, result });
    } catch (err) {
        res.status(500).json({ status: false, creator: DONGHUB_CREATOR, message: err.message });
    }
});

// DEEPAI CHAT
const DEEPAI_CREATOR = "ReyCloudSHP";
app.get('/ai/deepai/models', async (req, res) => {
    try {
        const models = await deepai.getUsableModels();
        res.json({ status: true, creator: DEEPAI_CREATOR, total: models.length, result: models });
    } catch (err) {
        res.status(500).json({ status: false, creator: DEEPAI_CREATOR, message: err.message });
    }
});

app.get('/ai/deepai', async (req, res) => {
    try {
        const prompt = req.query.text || req.query.q || req.query.prompt;
        const model = req.query.model || "standard"; 
        if (!prompt) return res.status(400).json({ status: false, creator: DEEPAI_CREATOR, message: "Parameter 'text' wajib diisi!" });
        const history = [{ role: "user", content: prompt }];
        const answer = await deepai.ask(model, history);
        res.json({ status: true, creator: DEEPAI_CREATOR, model, result: answer });
    } catch (err) {
        res.status(500).json({ status: false, creator: DEEPAI_CREATOR, message: err.message });
    }
});

// TOKUSATSU
const TOKU_CREATOR = "ReyCloudSHP";
app.get('/tokusatsu/home', async (req, res) => {
    try {
        const result = await tokusatsu.scrapeHome();
        res.json({ status: true, creator: TOKU_CREATOR, result });
    } catch (err) {
        res.status(500).json({ status: false, creator: TOKU_CREATOR, message: err.message });
    }
});

app.get('/tokusatsu/movie', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const result = await tokusatsu.scrapeMovies(page);
        res.json({ status: true, creator: TOKU_CREATOR, ...result });
    } catch (err) {
        res.status(500).json({ status: false, creator: TOKU_CREATOR, message: err.message });
    }
});

app.get('/tokusatsu/movie-special', async (req, res) => {
    try {
        const result = await tokusatsu.scrapeMovieSpecial();
        res.json({ status: true, creator: TOKU_CREATOR, result });
    } catch (err) {
        res.status(500).json({ status: false, creator: TOKU_CREATOR, message: err.message });
    }
});

app.get('/tokusatsu/era', async (req, res) => {
    try {
        const type = req.query.type || 'kamen-raider';
        const slugMap = { 'kamen-raider': 'kamen-rider-2', 'super-sentai': 'super-sentai2', 'ultraman': 'ultraman2' };
        const slug = slugMap[type] || 'kamen-rider-2';
        const result = await tokusatsu.scrapeEraCategory(slug);
        res.json({ status: true, creator: TOKU_CREATOR, type, result });
    } catch (err) {
        res.status(500).json({ status: false, creator: TOKU_CREATOR, message: err.message });
    }
});

app.get('/tokusatsu/other', async (req, res) => {
    try {
        const result = await tokusatsu.scrapeOtherTokusatsu();
        res.json({ status: true, creator: TOKU_CREATOR, total: result.length, result });
    } catch (err) {
        res.status(500).json({ status: false, creator: TOKU_CREATOR, message: err.message });
    }
});

app.get('/tokusatsu/search', async (req, res) => {
    try {
        const query = req.query.q || req.query.query;
        const page = parseInt(req.query.page) || 1;
        if (!query) return res.status(400).json({ status: false, creator: TOKU_CREATOR, message: "Parameter 'q' wajib diisi!" });
        const result = await tokusatsu.scrapeSearch(query, page);
        res.json({ status: true, creator: TOKU_CREATOR, query, ...result });
    } catch (err) {
        res.status(500).json({ status: false, creator: TOKU_CREATOR, message: err.message });
    }
});

app.get('/tokusatsu/detail', async (req, res) => {
    try {
        const url = req.query.url;
        if (!url) return res.status(400).json({ status: false, creator: TOKU_CREATOR, message: "Parameter 'url' wajib diisi!" });
        const result = await tokusatsu.scrapeDetail(url);
        res.json({ status: true, creator: TOKU_CREATOR, result });
    } catch (err) {
        res.status(500).json({ status: false, creator: TOKU_CREATOR, message: err.message });
    }
});

// ==========================================
// ⚡ AMP PREMIUM (SINGLE ENDPOINT SYNC)
// ==========================================
app.get('/amprem/generate', async (req, res) => {
    try {
        const result = await scraper.generateAccount();
        return res.json({
            status: true,
            creator: "ReyCloudSHP",
            result
        });
    } catch (err) {
        return res.status(500).json({
            status: false,
            creator: "ReyCloudSHP",
            message: err.message
        });
    }
});

// ==========================================
// ⚡ ALIGHT MOTION PREMIUM GENERATOR SUITE
// ==========================================
const AMPREM_CREATOR = "ReyCloudSHP";

app.post('/amprem/send-link', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email || !email.includes('@')) {
            return res.status(400).json({ status: false, creator: AMPREM_CREATOR, message: "Parameter 'email' wajib diisi dan harus valid!" });
        }
        const result = await alightMotion.requestMagicLink(email);
        if (!result.status) {
            return res.status(500).json({ status: false, creator: AMPREM_CREATOR, message: result.error });
        }
        return res.json({ status: true, creator: AMPREM_CREATOR, result: result.raw || result.message });
    } catch (err) {
        return res.status(500).json({ status: false, creator: AMPREM_CREATOR, message: err.message });
    }
});

app.post('/amprem/verify', async (req, res) => {
    try {
        const { email, magicLink } = req.body;
        if (!email || !magicLink) {
            return res.status(400).json({ status: false, creator: AMPREM_CREATOR, message: "Parameter 'email' dan 'magicLink' wajib diisi!" });
        }
        const result = await alightMotion.verifyMagicLink(email, magicLink);
        if (!result.status) {
            return res.status(500).json({ status: false, creator: AMPREM_CREATOR, message: result.error });
        }
        return res.json({ status: true, creator: AMPREM_CREATOR, result: result.data });
    } catch (err) {
        return res.status(500).json({ status: false, creator: AMPREM_CREATOR, message: err.message });
    }
});


// ==========================================
// 🤖 CATEGORY: QWEN AI UNIVERSAL SUITE
// ==========================================
const { askQwenGuest } = require('./scrape/qwen');

app.all('/ai/qwen', async (req, res) => {
    try {
        const prompt = req.query.text || req.query.q || req.body?.text || req.body?.prompt;
        if (!prompt) {
            return res.status(400).json({ 
                status: false, 
                creator: "ReyCloudSHP", 
                message: "Parameter 'text' atau 'prompt' wajib diisi!" 
            });
        }

        const options = {
            headless: req.query.headless !== 'false' && req.body?.headless !== false,
            timeout: parseInt(req.query.timeout || req.body?.timeout) || 60000,
            cookie: req.query.cookie || req.body?.cookie
        };

        const result = await askQwenGuest(prompt, options);
        return res.json({
            status: true,
            creator: "ReyCloudSHP",
            result
        });
    } catch (err) {
        return res.status(500).json({ 
            status: false, 
            creator: "ReyCloudSHP", 
            message: err.message 
        });
    }
});


// ==========================================
// 🎬 CATEGORY: NUNODRAMA MULTI-PLATFORM SUITE
// ==========================================
const { 
    PLATFORMS, 
    getFeed, 
    searchDrama, 
    getDramaDetail, 
    getEpisodes, 
    getStream 
} = require('./scrape/nunodrama');

app.get('/nunodrama/platforms', (req, res) => {
    try {
        return res.json({
            status: true,
            creator: "ReyCloudSHP",
            total: PLATFORMS.length,
            result: PLATFORMS
        });
    } catch (err) {
        return res.status(500).json({ status: false, creator: "ReyCloudSHP", message: err.message });
    }
});

app.get('/nunodrama/feed', async (req, res) => {
    try {
        const platform = req.query.platform || 'dramaverse';
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 21;
        const lang = req.query.lang || 'in';

        const result = await getFeed(platform, { page, limit, lang });
        return res.json({ status: true, creator: "ReyCloudSHP", ...result });
    } catch (err) {
        return res.status(500).json({ status: false, creator: "ReyCloudSHP", message: err.message });
    }
});

app.get('/nunodrama/search', async (req, res) => {
    try {
        const query = req.query.q || req.query.query;
        const platform = req.query.platform || null;
        const lang = req.query.lang || 'in';

        if (!query) {
            return res.status(400).json({ status: false, creator: "ReyCloudSHP", message: "Parameter query 'q' wajib diisi!" });
        }

        const result = await searchDrama(query, { platform, lang });
        return res.json({ status: true, creator: "ReyCloudSHP", ...result });
    } catch (err) {
        return res.status(500).json({ status: false, creator: "ReyCloudSHP", message: err.message });
    }
});

app.get('/nunodrama/detail', async (req, res) => {
    try {
        const { platform, book_id, url } = req.query;
        const target = url || book_id;

        if (!target) {
            return res.status(400).json({ status: false, creator: "ReyCloudSHP", message: "Parameter 'book_id' (atau 'url') wajib diisi!" });
        }

        const result = await getDramaDetail(platform || target, target);
        return res.json({ status: true, creator: "ReyCloudSHP", ...result });
    } catch (err) {
        return res.status(500).json({ status: false, creator: "ReyCloudSHP", message: err.message });
    }
});

app.get('/nunodrama/episodes', async (req, res) => {
    try {
        const { platform, book_id, url } = req.query;
        const target = url || book_id;

        if (!target) {
            return res.status(400).json({ status: false, creator: "ReyCloudSHP", message: "Parameter 'book_id' (atau 'url') wajib diisi!" });
        }

        const result = await getEpisodes(platform || target, target);
        return res.json({ status: true, creator: "ReyCloudSHP", ...result });
    } catch (err) {
        return res.status(500).json({ status: false, creator: "ReyCloudSHP", message: err.message });
    }
});

app.get('/nunodrama/stream', async (req, res) => {
    try {
        const { platform, book_id, episode, url } = req.query;
        const target = url || book_id;
        const ep = parseInt(episode) || 1;

        if (!target) {
            return res.status(400).json({ status: false, creator: "ReyCloudSHP", message: "Parameter 'book_id' (atau 'url') wajib diisi!" });
        }

        const result = await getStream(platform || target, target, ep);
        return res.json({ status: true, creator: "ReyCloudSHP", ...result });
    } catch (err) {
        return res.status(500).json({ status: false, creator: "ReyCloudSHP", message: err.message });
    }
});

// TELEGRAM BOT
const TELEGRAM_BOT_TOKEN = "8570746379:AAEJiYBtLIANYq5imi93vxaC3yrwcW-ReK4"; 
const OWNER_TELEGRAM_ID = 2027479396;
const TESTI_CHANNEL_ID = -1002597815366;

app.post('/api/request', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message || message.trim() === "") return res.status(400).json({ status: false, message: "Pesan request tidak boleh kosong!" });
        const badWords = ["anjing", "bangsat", "kontol", "memek", "ngentot", "babi", "tolol", "goblok", "bokep", "porno"];
        const lowerText = message.toLowerCase();
        if (badWords.some(w => lowerText.includes(w))) return res.status(400).json({ status: false, message: "Request ditolak: mengandung kata tidak pantas." });
        const sent = await reqBotInstance.sendWebsiteRequest(message);
        if (sent) return res.json({ status: true, message: "Request berhasil dikirim ke Owner & Channel Telegram!" });
        return res.status(500).json({ status: false, message: "Gagal mengirim ke Telegram." });
    } catch (err) {
        return res.status(500).json({ status: false, message: err.message });
    }
});

const reqBotInstance = new TelegramReqHandler(TELEGRAM_BOT_TOKEN, OWNER_TELEGRAM_ID, TESTI_CHANNEL_ID);
reqBotInstance.startBot();

// ❌ 404 & SERVER LISTENER
app.use((req, res) => {
    res.status(404).json({ status: false, message: "Endpoint tidak ditemukan!" });
});

app.listen(config.port, config.host, () => {
    const totalMem = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2);
    const freeMem = (os.freemem() / (1024 * 1024 * 1024)).toFixed(2);
    const usedMem = (totalMem - freeMem).toFixed(2);
    const cpuInfo = os.cpus();
    const cpuModel = cpuInfo[0] ? cpuInfo[0].model.trim() : 'Unknown CPU';
    const cpuCores = cpuInfo.length;

    console.log("\x1b[1;36m");
    console.log("██████╗ ███████╗██╗   ██╗ ██████╗██╗      ██████╗ ██╗   ██║██████╗ ███████╗██╗   ██╗");
    console.log("██╔══██╗██╔════╝╚██╗ ██╔╝██╔════╝██║     ██╔═══██╗██║   ██║██╔══██╗██╔════╝██║   ██║");
    console.log("██████╔╝█████╗   ╚████╔╝ ██║     ██║     ██║   ██║██║   ██║██║  ██║█████╗  ██║   ██║");
    console.log("██╔══██╗██╔══╝    ╚██╔╝  ██║     ██║     ██║   ██║██║   ██║██║  ██║██╔══╝  ╚██   ██╔╝");
    console.log("██║  ██║███████╗   ██║   ╚██████╗███████╗╚██████╔╝╚██████╔╝██████╔╝███████╗ ╚████╔╝ ");
    console.log("╚═╝  ╚═╝╚══════╝   ╚═╝    ╚═════╝╚══════╝ ╚═════╝  ╚═════╝ ╚═════╝ ╚══════╝  ╚═══╝  ");
    console.log("\x1b[0m");
    console.log("\x1b[1;33m==================================================================\x1b[0m");
    console.log(" \x1b[1;32m🚀 " + config.name + " v" + config.version + " Successfully Online!\x1b[0m");
    console.log("\x1b[1;33m==================================================================\x1b[0m");
    console.log(" \x1b[1;34mBase URL   :\x1b[0m " + config.baseUrl);
    console.log(" \x1b[1;34mLocal Addr :\x1b[0m http://" + config.host + ":" + config.port);
    console.log("\x1b[1;33m------------------------------------------------------------------\x1b[0m");
    console.log(" \x1b[1;35m💻 CPU     :\x1b[0m " + cpuModel + " (" + cpuCores + " Cores)");
    console.log(" \x1b[1;35m🧠 RAM     :\x1b[0m " + usedMem + " GB / " + totalMem + " GB");
    console.log("\x1b[1;33m==================================================================\x1b[0m\n");
});


