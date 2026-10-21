
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const YTDlpWrap = require('yt-dlp-wrap').default;

const app = express();
const PORT = process.env.PORT || 3000;
const binaryPath = path.join(__dirname, 'yt-dlp-binary');

let ytDlpWrap;
let ytDlpVersion = 'unknown';

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'Klipora API',
        downloaderReady: Boolean(ytDlpWrap),
        ytDlpVersion
    });
});

// Validate URL
function validateUrl(value) {
    if (typeof value !== 'string' || !value.trim()) {
        return { error: 'URL is required.' };
    }

    let parsed;

    try {
        parsed = new URL(value);
    } catch {
        return { error: 'Please provide a valid URL.' };
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { error: 'Only HTTP and HTTPS URLs are supported.' };
    }

    if (parsed.username || parsed.password) {
        return { error: 'URLs containing login credentials are not supported.' };
    }

    const hostname = parsed.hostname.toLowerCase();

    if (
        hostname === 'localhost' ||
        hostname.endsWith('.localhost') ||
        hostname.endsWith('.local') ||
        hostname === '0.0.0.0' ||
        hostname === '::1' ||
        hostname.startsWith('127.') ||
        hostname.startsWith('10.') ||
        hostname.startsWith('192.168.') ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    ) {
        return { error: 'This URL is not allowed.' };
    }

    return { url: parsed.href };
}

// Initialize yt-dlp
async function initYtDlp() {
    if (!fs.existsSync(binaryPath)) {
        throw new Error(
            `yt-dlp binary not found at ${binaryPath}. Check Render's Build Command.`
        );
    }

    fs.chmodSync(binaryPath, 0o755);

    ytDlpWrap = new YTDlpWrap(binaryPath);

    try {
        ytDlpVersion = (
            await ytDlpWrap.execPromise(['--version'])
        ).trim();

        console.log(`yt-dlp version: ${ytDlpVersion}`);
        console.log('yt-dlp initialized successfully.');
    } catch (err) {
        ytDlpWrap = undefined;
        throw new Error(
            `yt-dlp executable failed: ${err.stderr || err.message || err}`
        );
    }
}

// Shared extraction arguments
function extractionArgs(url) {
    return [
        '--dump-single-json',
        '--no-playlist',
        '--no-warnings',
        '--extractor-args',
        ''youtube:player_client=web,mweb,tv',
        url
    ];
}

// Fetch media information
app.post('/api/info', async (req, res) => {
    const result = validateUrl(req.body?.url);

    if (result.error) {
        return res.status(400).json({ error: result.error });
    }

    if (!ytDlpWrap) {
        return res.status(503).json({
            error: 'Downloader is not ready. Please try again shortly.'
        });
    }

    const url = result.url;

    try {
        console.log(`Fetching media information: ${url}`);

        const stdout = await ytDlpWrap.execPromise([
            '--verbose',
            ...extractionArgs(url)
        ]);

        const data = JSON.parse(stdout);

        return res.json({
            title: data.title || 'Shared Media',
            thumbnail:
                data.thumbnail ||
                data.thumbnails?.[data.thumbnails.length - 1]?.url ||
                '',
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
                    label: 'Audio Only (MP3)',
                    type: 'audio'
                }
            ]
        });
    } catch (err) {
        console.error('Extraction Error:', err.message);
        console.error('yt-dlp stderr:', err.stderr || 'No stderr available');

        return res.status(500).json({
            error: 'Could not fetch this media. Check the URL and try again.'
        });
    }
});

// Download media
app.get('/api/download', async (req, res) => {
    const result = validateUrl(req.query.url);

    if (result.error) {
        return res.status(400).json({ error: result.error });
    }

    if (!ytDlpWrap) {
        return res.status(503).json({
            error: 'Downloader is not ready.'
        });
    }

    const isAudio = req.query.type === 'audio';
    const formatId = req.query.formatId;
    const extension = isAudio ? 'mp3' : 'mp4';

    const args = [
        '--no-playlist',
        '--no-warnings',
        '--extractor-args',
        'youtube:player_client=tv,mweb',
        '-o',
        '-'
    ];

    if (isAudio) {
        args.push('-f', 'bestaudio', '-x', '--audio-format', 'mp3');
    } else if (formatId === 'b' || !formatId) {
        args.push('-f', 'best[ext=mp4]/best');
    } else {
        return res.status(400).json({
            error: 'Unsupported format selection.'
        });
    }

    args.push(result.url);

    let stream;

    try {
        console.log(`Starting ${extension} download: ${result.url}`);

        res.setHeader(
            'Content-Disposition',
            `attachment; filename="klipora_${Date.now()}.${extension}"`
        );

        res.setHeader('Content-Type', isAudio ? 'audio/mpeg' : 'video/mp4');

        stream = ytDlpWrap.execStream(args);

        stream.on('error', (err) => {
            console.error('Download stream error:', err.message);

            if (!res.headersSent) {
                res.status(500).json({ error: 'Download failed.' });
            } else {
                res.destroy(err);
            }
        });

        stream.on('close', (code) => {
            if (code !== null && code !== 0) {
                console.error(`yt-dlp download process exited with code ${code}`);
            }
        });

        stream.pipe(res);

        req.on('close', () => {
            if (!res.writableEnded && stream) {
                stream.destroy();
            }
        });
    } catch (err) {
        console.error('Download error:', err.message);

        if (!res.headersSent) {
            res.status(500).json({
                error: 'Could not start the download.'
            });
        }
    }
});

// Serve homepage
app.get('/', (req, res, next) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');

    if (fs.existsSync(indexPath)) {
        return res.sendFile(indexPath);
    }

    return res.status(404).send('Klipora homepage not found.');
});

// General error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err.stack || err.message || err);

    if (res.headersSent) {
        return next(err);
    }

    return res.status(500).json({
        error: 'Internal server error.'
    });
});

// Start server after yt-dlp is verified
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
