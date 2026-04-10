const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Submission codes from env vars
const CODES = {};
const loadCodes = () => {
    for (const key of Object.keys(process.env)) {
        if (key.startsWith('SUBMIT_CODE_')) {
            const code = process.env[key];
            if (code) CODES[code] = { name: key, uses: 0 };
        }
    }
};
loadCodes();

// Max uses per code (test code unlimited, winner codes max 5)
const maxUses = (name) => name === 'SUBMIT_CODE_TEST' ? 999 : 5;

// Submissions directory
const SUBMIT_DIR = path.join(__dirname, 'submissions');
if (!fs.existsSync(SUBMIT_DIR)) fs.mkdirSync(SUBMIT_DIR, { recursive: true });

// Multer config — save to submissions/
const storage = multer.diskStorage({
    destination: SUBMIT_DIR,
    filename: (req, file, cb) => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const codeName = req._codeName || 'unknown';
        cb(null, codeName + '_' + timestamp + '.glb');
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 60 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!file.originalname.toLowerCase().endsWith('.glb')) {
            return cb(new Error('Only .glb files accepted'));
        }
        cb(null, true);
    }
});

// Rate limiting (simple in-memory)
const lastSubmit = {};
const RATE_LIMIT_MS = 60 * 1000; // 1 minute between submits per IP

// Submit endpoint
app.post('/api/submit-biome', (req, res, next) => {
    const code = req.headers['x-submit-code'] || '';

    if (!CODES[code]) {
        return res.status(403).json({ error: 'Invalid submission code' });
    }

    const entry = CODES[code];
    if (entry.uses >= maxUses(entry.name)) {
        return res.status(403).json({ error: 'Submission code has been used too many times' });
    }

    // Rate limit by IP
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    if (lastSubmit[ip] && now - lastSubmit[ip] < RATE_LIMIT_MS) {
        const wait = Math.ceil((RATE_LIMIT_MS - (now - lastSubmit[ip])) / 1000);
        return res.status(429).json({ error: 'Please wait ' + wait + 's before submitting again' });
    }

    req._codeName = entry.name;
    lastSubmit[ip] = now;

    upload.single('biome')(req, res, (err) => {
        if (err) {
            return res.status(400).json({ error: err.message });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        entry.uses++;
        const remaining = maxUses(entry.name) - entry.uses;
        console.log('[SUBMIT]', entry.name, '— file:', req.file.filename, 'size:', (req.file.size / 1024 / 1024).toFixed(1) + 'MB', 'uses:', entry.uses + '/' + maxUses(entry.name));

        res.json({
            success: true,
            filename: req.file.filename,
            size: req.file.size,
            remaining: remaining
        });
    });
});

// Serve static files
app.use(express.static('.'));

app.listen(PORT, () => {
    console.log('Server running on port', PORT);
    console.log('Submission codes loaded:', Object.keys(CODES).length);
    console.log('Submissions dir:', SUBMIT_DIR);
});
