
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const YTDlpWrap = require('yt-dlp-wrap').default;

const app = express();
const PORT = process.env.PORT || 3000;

// Use the binary downloaded during Render's build.
const binaryPath = path.join(__dirname, 'yt-dlp-binary');

let ytDlpWrap;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'Klipora API',
        downloaderReady: Boolean(ytDlpWrap)
    });
});

// Initialize yt-dlp
async function initYtDlp() {
    if (!fs.existsSync(binaryPath)) {
        throw new Error(
            `yt-dlp binary not found at ${binaryPath}. Check Render's Build Command.`
        );
    }

    fs.chmodSync(binaryPath, 0o755);

    ytDlpWrap = new YTDlpWrap(binaryPath);

    // Verify the executable actually runs.
    await ytDlpWrap.execPromise(['--version']);

    console.log('yt-dlp initialized successfully.');
}

// Fetch media information
app.post('/api/info', async (req, res) => {
    const { url } = req.body || {};

    if (!url) {
        return res.status(400).json({ error: 'URL is required.' });
    }

    let parsedUrl;

    try {
        parsedUrl = new URL(url);
    } catch {
        return res.status(400).json({ error: 'Please provide a valid URL.' });
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return res.status(400).json({ error: 'Invalid URL protocol.' });
    }

    if (!ytDlpWrap) {
        return res.status(503).json({
            error: 'Downloader is starting. Please try again shortly.'
        });
    }

    try {
        console.log(`Fetching media information: ${url}`);

        const stdout = await ytDlpWrap.execPromise([
            '--dump-single-json',
            '--no-playlist',
            '--no-warnings',
            '--no-check-certificates',
            '--user-agent',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
            url
        ]);

        const data = JSON.parse(stdout);

        return res.json({
            title: data.title || 'Shared Media',
            thumbnail: data.thumbnail ||
                (data.thumbnails && data.thumbnails.length
                    ? data.thumbnails[data.thumbnails.length - 1].url
                    : ''),
            duration: data.duration_string || 'N/A',
            uploader: data.uploader || data.channel || 'Unknown',
            url,
            formats: [
                {
                    id: 'b',
                    label: 'Best Quality Video',
                    type: 'video'
                },
                {
                    id: 'ba',
                    label: 'Audio Only',
                    type: 'audio'
                }
            ]
        });
    } catch (err) {
        console.error('Extraction Error:', err.message);

        return res.status(500).json({
            error: 'Could not fetch this media. Check the URL and Render logs.'
        });
    }
});

// Download media
app.get('/api/download', async (req, res) => {
    const { url, formatId, type } = req.query;

    if (!url) {
        return res.status(400).json({ error: 'URL is required.' });
    }

    let parsedUrl;

    try {
        parsedUrl = new URL(url);
    } catch {
        return res.status(400).json({ error: 'Invalid URL.' });
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return res.status(400).json({ error: 'Invalid URL protocol.' });
    }

    if (!ytDlpWrap) {
        return res.status(503).json({ error: 'Downloader is not ready.' });
    }

    const isAudio = type === 'audio';
    const extension = isAudio ? 'mp3' : 'mp4';

    res.setHeader(
        'Content-Disposition',
        `attachment; filename="klipora_${Date.now()}.${extension}"`
    );

    const args = [
        url,
        '-o', '-',
        '--no-playlist',
        '--no-warnings'
    ];

    if (isAudio) {
        args.push('-f', 'bestaudio', '-x', '--audio-format', 'mp3');
    } else {
        args.push('-f', 'best[ext=mp4]/best');
    }

    let stream;

    try {
        stream = ytDlpWrap.execStream(args);

        stream.on('error', (err) => {
            console.error('Download stream error:', err.message);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Download failed.' });
            } else {
                res.destroy(err);
            }
        });

        req.on('close', () => {
            if (!res.writableEnded && stream) {
                stream.destroy();
            }
        });

        stream.pipe(res);
    } catch (err) {
        console.error('Download error:', err.message);

        if (!res.headersSent) {
            res.status(500).json({ error: 'Could not start the download.' });
        }
    }
});

// Serve a basic homepage if no index.html exists.
app.get('/', (req, res, next) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');

    if (fs.existsSync(indexPath)) {
        return res.sendFile(indexPath);
    }

    next();
});

// JSON error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err.message);

    if (res.headersSent) {
        return next(err);
    }

    res.status(500).json({ error: 'Internal server error.' });
});

// Initialize first, then start listening.
initYtDlp()
    .then(() => {
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`Klipora running on port ${PORT}`);
        });
    })
    .catch((err) => {
        console.error('Failed to initialize yt-dlp:', err);
        process.exit(1);
    });
