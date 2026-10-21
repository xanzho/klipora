const express = require('express');
const cors = require('cors');
const path = require('path');
const YTDlpWrap = require('yt-dlp-wrap').default;
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const binaryPath = path.join(__dirname, 'yt-dlp-binary');
let ytDlpWrap;

// Initialize the Downloader Engine
async function initYtDlp() {
    if (!fs.existsSync(binaryPath)) {
        console.log('Installing Downloader Engine...');
        await YTDlpWrap.downloadFromGithub(binaryPath);
        fs.chmodSync(binaryPath, '755');
    }
    ytDlpWrap = new YTDlpWrap(binaryPath);
}

// Powerful Headers to bypass TikTok/Instagram blocks
const AUTH_HEADERS = [
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    '--add-header', 'Accept-Language: en-US,en;q=0.9',
    '--add-header', 'Sec-Fetch-Mode: navigate',
    '--no-check-certificates',
    '--prefer-free-formats',
    '--no-warnings'
];

app.post('/api/info', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    try {
        console.log(`Fetching: ${url}`);
        
        // Use -j (JSON) to get all metadata without downloading
        const stdout = await ytDlpWrap.execPromise([
            url,
            '-j',
            '--no-playlist', // Don't download whole channels
            ...AUTH_HEADERS
        ]);

        const data = JSON.parse(stdout);

        res.json({
            title: data.title || 'Shared Media',
            thumbnail: data.thumbnail || (data.thumbnails && data.thumbnails[0].url) || '',
            duration: data.duration_string || 'N/A',
            uploader: data.uploader || data.webpage_url_domain || 'Unknown',
            url: url,
            formats: [
                { id: 'b', label: 'Best Quality Video (MP4)', type: 'video' },
                { id: 'ba', label: 'Audio Only (MP3)', type: 'audio' }
            ]
        });
    } catch (err) {
        console.error('Extraction Error:', err.message);
        res.status(500).json({ error: 'This link is protected or private. Try another link.' });
    }
});

app.get('/api/download', (req, res) => {
    const { url, formatId, type } = req.query;
    if (!url) return res.status(400).send('URL missing');

    const ext = type === 'audio' ? 'mp3' : 'mp4';
    res.setHeader('Content-Disposition', `attachment; filename="media_${Date.now()}.${ext}"`);

    const stream = ytDlpWrap.execStream([
        url,
        '-f', formatId === 'ba' ? 'bestaudio' : 'best',
        '-o', '-',
        ...AUTH_HEADERS
    ]);

    stream.pipe(res);
    req.on('close', () => stream.destroy());
});

initYtDlp().then(() => {
    app.listen(PORT, () => console.log(`✅ Downloader active on port ${PORT}`));
});