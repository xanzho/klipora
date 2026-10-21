const fs = require('fs');
const path = require('path');
const publicDir = path.join(__dirname, 'public');

if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);

const template = (title, content) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>${title} — KlipOra</title><script src="https://cdn.tailwindcss.com"></script><style>body { background-color: #050811; color: #F8FAFC; font-family: sans-serif; }</style></head>
<body class="p-8 max-w-3xl mx-auto space-y-6 min-h-screen flex flex-col justify-between">
  <div class="space-y-6">
    <a href="/" class="text-red-500 font-bold bg-red-500/10 px-4 py-2 rounded-xl">← Back to KlipOra</a>
    <h1 class="text-4xl font-extrabold text-white pt-4">${title}</h1>
    <div class="bg-slate-900/80 p-8 rounded-3xl border border-white/10 text-gray-300 leading-relaxed space-y-4 text-sm">${content}</div>
  </div>
  <footer class="text-center text-xs text-gray-500 pt-10">© 2025 KlipOra App</footer>
</body></html>`;

fs.writeFileSync(path.join(publicDir, 'privacy.html'), template('Privacy Policy', 'KlipOra values your privacy. We do not store any personal data, IP addresses, or download logs.'));
fs.writeFileSync(path.join(publicDir, 'terms.html'), template('Terms of Service', 'KlipOra is a personal tool. By using this service, you agree not to download copyrighted content without owner permission.'));
fs.writeFileSync(path.join(publicDir, 'dmca.html'), template('DMCA Disclaimer', 'KlipOra does not host content on its servers. We parse media streams directly from CDNs.'));
fs.writeFileSync(path.join(publicDir, 'contact.html'), template('Contact Support', 'For support or inquiries, email us at: <b class="text-red-400">support@klipora.app</b>'));

console.log('✅ KlipOra legal pages generated successfully!');