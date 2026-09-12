// ==========================================
// AKUNLAMA.COM TEMP MAIL ENGINE (/api/mail.js)
// ==========================================
const https = require('https');
const http = require('http');

// Helper native request untuk mengambil data inbox dari akunlama.com
function mailRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const client = u.protocol === 'https:' ? https : http;
        
        const reqOptions = {
            hostname: u.hostname,
            port: u.port || (u.protocol === 'https:' ? 443 : 80),
            path: u.pathname + u.search,
            method: options.method || 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                ...options.headers
            }
        };

        const req = client.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
        });

        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

// 1. Fungsi Membuat Email Sementara
async function createTempEmail() {
    const randomString = Math.random().toString(36).substring(2, 10);
    const email = `${randomString}@akunlama.com`;
    return email;
}

// 2. Fungsi Polling Inbox untuk Menangkap OTP CapCut
async function waitForVerificationCode(usernameOnly, timeoutMs = 60000, intervalMs = 3000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
        try {
            const inboxUrl = `https://akunlama.com/api/inbox?mailbox=${usernameOnly}`;
            const res = await mailRequest(inboxUrl);
            
            if (res.statusCode === 200) {
                const data = JSON.parse(res.body);
                const messages = Array.isArray(data) ? data : (data.messages || data.data || []);
                
                for (const msg of messages) {
                    const content = msg.text || msg.body || msg.subject || msg.content || '';
                    // Cari pola 6 digit angka kode verifikasi OTP dari CapCut / ByteDance
                    const otpMatch = content.match(/\b\d{6}\b/) || content.match(/code[:\s]+(\d{6})/i);
                    if (otpMatch) {
                        return otpMatch[1] || otpMatch[0];
                    }
                }
            }
        } catch (err) {
            // Abaikan error jaringan sementara saat polling inbox
        }
        
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    
    return null;
}

// Handler Endpoint Express / Serverless Vercel jika diakses langsung
module.exports = async function handler(req, res) {
    const query = req.query || {};
    const action = query.action;

    if (action === 'create') {
        try {
            const email = await createTempEmail();
            return res.status(200).json({ status: true, email });
        } catch (err) {
            return res.status(500).json({ status: false, error: err.message });
        }
    }

    if (action === 'check') {
        const username = query.username;
        if (!username) {
            return res.status(400).json({ status: false, error: 'Parameter username wajib diisi!' });
        }
        try {
            const code = await waitForVerificationCode(username, 10000, 2000);
            return res.status(200).json({ status: true, otp: code || null });
        } catch (err) {
            return res.status(500).json({ status: false, error: err.message });
        }
    }

    return res.status(200).json({
        status: true,
        creator: 'ReyCode',
        message: 'AkunLama TempMail Engine API Ready!',
        endpoints: [
            '/api/mail?action=create',
            '/api/mail?action=check&username=xxx'
        ]
    });
};

// Export juga helper function agar bisa di-require langsung di engine utama CapCut
module.exports.createTempEmail = createTempEmail;
module.exports.waitForVerificationCode = waitForVerificationCode;
