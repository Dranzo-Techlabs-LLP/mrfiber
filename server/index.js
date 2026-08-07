require('dotenv').config();
const express = require('express');
const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

// Safety net: a rejected async DB call that slips past a handler's try/catch
// must not take the whole server down (Node 15+ terminates on unhandled
// rejections by default). Log it and keep serving other requests. Individual
// handlers still own returning the correct HTTP error for their own path.
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason && reason.stack ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err && err.stack ? err.stack : err);
});

// Detect binary assets by magic number, independent of the (often wrong or
// missing) Content-Type header. Many embedded OLT httpds serve dynamically
// generated images — captchas especially, which are usually CGI scripts —
// with Content-Type: text/html or no type at all. A real browser hitting the
// device directly just content-sniffs the bytes and renders the image; but our
// tunnel's response interceptor keys off Content-Type, so a captcha mislabeled
// as text/html gets run through .toString('utf8') + HTML rewriting + shim
// injection, which shreds the binary and leaves a blank <img>. Sniffing the
// actual bytes here lets us pass true binaries through untouched.
function looksLikeBinaryAsset(buf) {
    if (!buf || buf.length < 4) return false;
    const b = buf;
    // PNG  89 50 4E 47
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return true;
    // JPEG FF D8 FF
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return true;
    // GIF  47 49 46 38  ("GIF8")
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return true;
    // BMP  42 4D  ("BM")
    if (b[0] === 0x42 && b[1] === 0x4D) return true;
    // ICO  00 00 01 00
    if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) return true;
    // WEBP "RIFF"...."WEBP"
    if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return true;
    // WOFF/WOFF2 fonts ("wOFF" / "wOF2")
    if (b[0] === 0x77 && b[1] === 0x4F && b[2] === 0x46 && (b[3] === 0x46 || b[3] === 0x32)) return true;
    return false;
}

// Basic Middleware
app.use(cors({ origin: '*' }));
// IMPORTANT: scope the JSON body parser to /api ONLY. If it runs globally it
// also consumes the request body of application/json POSTs bound for the
// /tunnel proxy (e.g. the OLT login) — draining the stream so the proxied
// request reaches the device with an empty body. The device then rejects it
// ("parameter error undefined data"). The tunnel must stream bodies verbatim.
app.use('/api', express.json());

// Routes
const authRoutes = require('./routes/auth');
const vpnRoutes = require('./routes/vpn');
const oltRoutes = require('./routes/olt');
const userRoutes = require('./routes/users');
const customerRoutes = require('./routes/customers');
const roleRoutes = require('./routes/roles');

app.use('/api/auth', authRoutes);
app.use('/api/vpn', vpnRoutes);
app.use('/api/olt', oltRoutes);
app.use('/api/users', userRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/roles', roleRoutes);

// WEB TUNNEL PROXY ENGINE
// Static mount with dynamic router isolates tunnel traffic from local app.
app.use('/tunnel', createProxyMiddleware({
    target: 'http://0.0.0.0:65535', // dead-end fallback; router overrides per-request
    router: (req) => {
        // Host segment allows ip + optional :port (e.g. 192.168.100.2:8080)
        const match = req.url.match(/^\/([0-9a-zA-Z\.\-]+(?::\d+)?)/);
        if (match) {
            const target = `http://${match[1]}`;
            console.log(`[PROXY] Routing to: ${target}`);
            return target;
        }
        console.error(`[PROXY] Could not extract target from URL: ${req.url}`);
        return null;
    },
    changeOrigin: true,
    selfHandleResponse: true,
    ws: true,
    proxyTimeout: 30000,
    timeout: 30000,
    pathRewrite: (urlPath) => {
        // Strip leading /<host[:port]> so the target device sees a clean path
        const match = urlPath.match(/^\/([0-9a-zA-Z\.\-]+(?::\d+)?)(.*)$/);
        return match ? (match[2] || '/') : urlPath;
    },
    on: {
        proxyReq: (proxyReq, req) => {
            // Many embedded OLT httpds return stub responses without these — force a browser-ish profile
            if (!req.headers['user-agent'] || req.headers['user-agent'].includes('node')) {
                proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36');
            }
            proxyReq.setHeader('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8');
            proxyReq.setHeader('Accept-Language', 'en-US,en;q=0.9');
            // Strip forwarded headers that might confuse simple embedded servers
            proxyReq.removeHeader('x-forwarded-for');
            proxyReq.removeHeader('x-forwarded-host');
            proxyReq.removeHeader('x-forwarded-proto');

            // CRITICAL: Embedded devices reject requests whose Origin/Referer is from an
            // unknown host. Vite SPAs load assets with crossorigin="anonymous", which makes
            // the browser send Origin: http://mrfiber.host — the device sees a foreign origin
            // and returns 403 / empty body. Strip it so the device treats the request as local.
            proxyReq.removeHeader('origin');
            proxyReq.removeHeader('sec-fetch-site');
            proxyReq.removeHeader('sec-fetch-mode');
            proxyReq.removeHeader('sec-fetch-dest');

            // Rewrite Referer from tunnel URL back to the device's own URL so embedded
            // httpds that validate Referer (CSRF protection) accept the request.
            const hostMatch = (req.originalUrl || req.url).match(/^\/(?:tunnel\/)?([0-9a-zA-Z.\-]+(?::\d+)?)/);
            const tunnelHost = hostMatch ? hostMatch[1] : null;
            if (tunnelHost && req.headers['referer']) {
                const referer = req.headers['referer'];
                const tunnelPrefix = `/tunnel/${tunnelHost}`;
                if (referer.includes(tunnelPrefix)) {
                    try {
                        const u = new URL(referer);
                        const devicePath = u.pathname.replace(tunnelPrefix, '') || '/';
                        proxyReq.setHeader('Referer', `http://${tunnelHost}${devicePath}${u.search}`);
                    } catch (_e) {
                        proxyReq.removeHeader('referer');
                    }
                } else {
                    proxyReq.removeHeader('referer');
                }
            }

            console.log(`[PROXY REQ] ${req.method} http://${proxyReq.getHeader('host')}${proxyReq.path}`);
        },
        error: (err, req, res) => {
            console.error('[PROXY ERROR]', err.message);
            if (res && !res.headersSent && typeof res.status === 'function') {
                res.status(502).send(`
                    <html>
                        <body style="background:#111;color:#ff4444;font-family:monospace;padding:2rem;">
                            <h2>Tunnel Gateway Error</h2>
                            <p><b>Target:</b> ${req.url}</p>
                            <p><b>Reason:</b> ${err.message}</p>
                            <hr style="border:0;border-top:1px solid #333;margin:1rem 0;">
                            <p style="color:#666;font-size:0.8rem;">Ensure the VPN is connected and the destination IP is reachable from the server CLI via 'ping'.</p>
                        </body>
                    </html>
                `);
            } else if (res && !res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'text/plain' });
                res.end(`Tunnel Gateway Error: ${err.message}`);
            }
        },
        proxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
            try {
                console.log(`[PROXY RES] ${proxyRes.statusCode} ${proxyRes.headers['content-type'] || '-'} bytes=${responseBuffer.length} url=${req.originalUrl || req.url}`);

                // Strip headers that block iframe embedding / inline scripts
                res.removeHeader('X-Frame-Options');
                res.removeHeader('x-frame-options');
                res.removeHeader('Content-Security-Policy');
                res.removeHeader('content-security-policy');
                res.removeHeader('Content-Security-Policy-Report-Only');
                res.removeHeader('content-security-policy-report-only');

                // Force-override caching so a change to the rewriter never gets masked by a stale
                // cached copy in the browser. Small performance cost, worth the correctness.
                res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
                res.removeHeader('ETag');
                res.removeHeader('etag');
                res.removeHeader('Last-Modified');
                res.removeHeader('last-modified');

                const match = (req.originalUrl || req.url).match(/^\/tunnel\/([0-9a-zA-Z\.\-]+(?::\d+)?)/);
                const host = match ? match[1] : '';
                const prefix = `/tunnel/${host}`;

                // Rewrite Set-Cookie Path so cookies survive the tunnel prefix.
                // responseInterceptor already copied headers from proxyRes to res — reset them here.
                const setCookie = proxyRes.headers['set-cookie'];
                if (setCookie && host) {
                    const rewritten = (Array.isArray(setCookie) ? setCookie : [setCookie]).map((c) =>
                        c.replace(/Path=\/(?!tunnel\/)([^;]*)/gi, (_m, rest) => `Path=${prefix}/${rest}`)
                         .replace(/Domain=[^;]+;?\s*/gi, '')
                    );
                    res.setHeader('set-cookie', rewritten);
                }

                // Rewrite Location redirects back through the tunnel
                if (proxyRes.headers['location'] && host) {
                    const loc = proxyRes.headers['location'];
                    if (loc.startsWith('/') && !loc.startsWith('/tunnel/')) {
                        res.setHeader('location', `${prefix}${loc}`);
                    } else if (loc.includes('://')) {
                        try {
                            const u = new URL(loc);
                            if (u.host === host.split(':')[0] || u.host === host) {
                                res.setHeader('location', `${prefix}${u.pathname}${u.search}${u.hash}`);
                            }
                        } catch (_e) { /* keep original */ }
                    }
                }

                // Binary guard: if the raw bytes are a known image/font format, pass
                // them through untouched no matter what Content-Type the device claimed.
                // This is what keeps mislabeled captcha images (served as text/html by
                // the OLT's CGI) from being mangled by the text rewriters below.
                if (looksLikeBinaryAsset(responseBuffer)) {
                    return responseBuffer;
                }

                const contentType = proxyRes.headers['content-type'] || '';

                // Sniff the actual body so a mislabeled Content-Type can't send a JSON
                // API response down the HTML path. Embedded OLT httpds routinely return
                // JSON (e.g. the login captcha: {"code":1,"data":{"captcha":"..."}}) under
                // Content-Type: text/html or no type at all. If that hits the HTML branch
                // below, we prepend the shim <script> + <base> to it, JSON.parse() throws
                // in the SPA, and the captcha (or any API-driven field) silently blanks.
                // A JS/CSS content-type is trusted over the sniff so a bundle that happens
                // to start with "{" isn't misrouted.
                let bodyPeek = responseBuffer.slice(0, 256).toString('utf8').trimStart();
                if (bodyPeek.charCodeAt(0) === 0xFEFF) bodyPeek = bodyPeek.slice(1).trimStart(); // strip UTF-8 BOM
                const startsJson = (bodyPeek.charAt(0) === '{' || bodyPeek.charAt(0) === '[') &&
                    !contentType.includes('javascript') &&
                    !contentType.includes('ecmascript') &&
                    !contentType.includes('text/css');

                // HTML: inject <base>, strip CSP meta tags, rewrite absolute attribute URLs,
                // install a runtime shim. Makes SPAs (React / Vue / Angular) work through the tunnel.
                if (contentType.includes('text/html') && host && !startsJson) {
                    let html = responseBuffer.toString('utf8');

                    // Strip CSP meta tags (would block our inline shim script)
                    html = html.replace(/<meta[^>]+http-equiv\s*=\s*['"]?Content-Security-Policy['"]?[^>]*>/gi, '');

                    // Strip integrity attributes — we rewrite paths so the original hashes
                    // would fail subresource integrity checks in the browser.
                    html = html.replace(/\s+integrity\s*=\s*["'][^"']*["']/gi, '');

                    // Rewrite absolute URLs in common HTML attributes. Skip protocol-relative (//),
                    // schemed URLs, anchors, queries, and anything already /tunnel-prefixed.
                    const rewriteAttr = (attr) => {
                        const re = new RegExp(`(${attr})\\s*=\\s*(['"])\\/(?!\\/|tunnel\\/)([^'"]*)\\2`, 'gi');
                        html = html.replace(re, (_m, a, q, rest) => `${a}=${q}${prefix}/${rest}${q}`);
                    };
                    ['href', 'src', 'action', 'data-src', 'data-href', 'poster', 'srcset', 'formaction', 'background'].forEach(rewriteAttr);

                    // Rewrite absolute URLs that point to the device itself (some SPAs hard-code device IP)
                    const hostEsc = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const absRe = new RegExp(`(['"\\s(])https?:\\/\\/${hostEsc}(\\/[^'"\\s)>]*)`, 'gi');
                    html = html.replace(absRe, (_m, pre, path) => `${pre}${prefix}${path}`);

                    const shim = `<script>(function(){try{
var P=${JSON.stringify(prefix)},H=${JSON.stringify(host)};
function fix(u){if(u==null)return u;if(typeof u!=='string')return u;if(u.indexOf(P)===0)return u;var m=u.match(/^https?:\\/\\/([^\\/]+)(\\/.*)?$/i);if(m){if(m[1]===H||m[1]===H.split(':')[0])return P+(m[2]||'/');return u;}if(u.charAt(0)!=='/'||u.charAt(1)==='/')return u;if(u.charAt(0)==='/'&&u.indexOf('/tunnel/')===0)return u;return P+u;}
var of=window.fetch;if(of){window.fetch=function(i,o){try{if(typeof i==='string')i=fix(i);else if(i&&typeof i.url==='string'){var f=fix(i.url);if(f!==i.url)i=new Request(f,i);}}catch(e){}return of.call(this,i,o);};}
var xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){try{arguments[1]=fix(u);}catch(e){}return xo.apply(this,arguments);};
var OW=window.WebSocket;if(OW){function PW(u,p){try{if(typeof u==='string'){var m=u.match(/^(wss?):\\/\\/([^\\/]+)(\\/.*)?$/i);if(m&&(m[2]===H||m[2]===H.split(':')[0]||m[2]===location.host)){var tgtHost=m[2]===location.host?location.host:location.host;u=m[1]+'://'+tgtHost+P+(m[3]||'/');}}}catch(e){}return p?new OW(u,p):new OW(u);}PW.prototype=OW.prototype;['CONNECTING','OPEN','CLOSING','CLOSED'].forEach(function(k){PW[k]=OW[k];});window.WebSocket=PW;}
var ps=history.pushState,rs=history.replaceState;history.pushState=function(s,t,u){if(typeof u==='string')u=fix(u);return ps.call(this,s,t,u);};history.replaceState=function(s,t,u){if(typeof u==='string')u=fix(u);return rs.call(this,s,t,u);};
var OU=window.URL;if(OU){var origURL=OU;window.URL=function(u,b){if(typeof u==='string'&&!b)u=fix(u);return b?new origURL(u,b):new origURL(u);};window.URL.prototype=origURL.prototype;window.URL.createObjectURL=origURL.createObjectURL.bind(origURL);window.URL.revokeObjectURL=origURL.revokeObjectURL.bind(origURL);}
var oac=Element.prototype.appendChild,oib=Element.prototype.insertBefore;function fixEl(c){if(!c||!c.tagName)return;var t=c.tagName.toUpperCase();if(t==='SCRIPT'&&c.src){var fs=fix(c.src);if(fs!==c.src)c.src=fs;}if(t==='LINK'&&c.href){var fh=fix(c.href);if(fh!==c.href)c.href=fh;}}
Element.prototype.appendChild=function(c){try{fixEl(c);}catch(e){}return oac.call(this,c);};Element.prototype.insertBefore=function(c,r){try{fixEl(c);}catch(e){}return oib.call(this,c,r);};
// Intercept img.src / HTMLMediaElement.src property setters.
// Vue/React update existing <img> elements via property assignment after the
// element is already in the DOM — appendChild won't fire, so we need this.
try{var isd=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');if(isd&&isd.set){var ois=isd.set;Object.defineProperty(HTMLImageElement.prototype,'src',{configurable:true,get:isd.get,set:function(v){try{v=fix(String(v));}catch(e){}return ois.call(this,v);}});}}catch(e){}
// Intercept setAttribute so that reactive bindings like :src="captchaUrl" in
// Vue and className/style updates that carry src/href also go through fix().
var osa=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){try{var nl=String(n).toLowerCase();if(nl==='src'||nl==='href'||nl==='action'||nl==='data-src'||nl==='poster'){v=fix(String(v));}}catch(e){}return osa.call(this,n,v);};
// Also intercept innerHTML / outerHTML setters. When a framework injects a
// chunk of HTML via innerHTML, it bypasses setAttribute entirely — the browser's
// HTML parser runs and sets attributes directly. Re-scan every element that
// was added/mutated to catch those missed rewrites.
// MutationObserver is the last safety net: it fires AFTER the DOM settles and
// re-applies fix() to any src/href that wasn't caught by the other interceptors.
// Lock flag prevents the fix-then-observe-then-fix-again infinite loop.
try{var ML=false;var MO=new MutationObserver(function(ms){if(ML)return;ML=true;try{ms.forEach(function(m){var n,cur,fxd;if(m.type==='childList'){m.addedNodes.forEach(function(nd){if(nd.nodeType!==1)return;var all=[nd].concat(Array.prototype.slice.call(nd.querySelectorAll('[src],[href],[data-src]')));all.forEach(function(el){['src','href','data-src'].forEach(function(a){cur=el.getAttribute(a);if(cur){fxd=fix(cur);if(fxd!==cur)el.setAttribute(a,fxd);}});});});}else if(m.type==='attributes'){var el=m.target;n=m.attributeName;cur=el.getAttribute(n)||'';fxd=fix(cur);if(fxd!==cur)el.setAttribute(n,fxd);}});}finally{ML=false;}});MO.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src','href','data-src']});}catch(e){}
}catch(e){console.warn('[mrfiber-tunnel-shim]',e);}})();</script>`;

                    const baseTag = `<base href="${prefix}/">`;
                    // Shim must run before any other script — place it first in <head>
                    if (/<head[^>]*>/i.test(html)) {
                        html = html.replace(/<head([^>]*)>/i, `<head$1>${shim}${baseTag}`);
                    } else if (/<html[^>]*>/i.test(html)) {
                        html = html.replace(/<html([^>]*)>/i, `<html$1><head>${shim}${baseTag}</head>`);
                    } else {
                        html = `${shim}${baseTag}${html}`;
                    }
                    return html;
                }

                // CSS: rewrite absolute url(...) references so fonts / images load through the tunnel
                if (contentType.includes('text/css') && host) {
                    let css = responseBuffer.toString('utf8');
                    css = css.replace(/url\(\s*(['"]?)\/(?!\/|tunnel\/)([^)'"]*)\1\s*\)/g,
                        (_m, q, rest) => `url(${q}${prefix}/${rest}${q})`);
                    // Also handle @import "/..."
                    css = css.replace(/@import\s+(['"])\/(?!\/|tunnel\/)([^'"]*)\1/g,
                        (_m, q, rest) => `@import ${q}${prefix}/${rest}${q}`);
                    return css;
                }

                // JSON: rewrite device-local absolute paths so embedded API responses stay
                // tunneled. Also handles JSON mislabeled as text/html / text/plain / no type
                // (startsJson) — those must be rewritten here, never shim-injected as HTML.
                if (host && (contentType.includes('application/json') || startsJson)) {
                    let text = responseBuffer.toString('utf8');
                    text = text.replace(/"(\/(?:api|static|assets|public|images|img|css|js|fonts|ws|upload|download|file)\/[^"]*)"/g,
                        (_m, p) => `"${prefix}${p}"`);
                    const hostEsc = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    text = text.replace(new RegExp(`"https?:\\/\\/${hostEsc}(\\/[^"]*)"`, 'gi'),
                        (_m, p) => `"${prefix}${p}"`);
                    return text;
                }

                // JavaScript: rewrite absolute paths baked into Webpack/Vite bundles.
                // Webpack minifies __webpack_public_path__ as a single-letter property (e.g. n.p="/").
                // Vite emits base="/" in its preload helper. Both cause dynamic chunk loads to go
                // to the wrong origin unless we patch the compiled bundle here.
                if (host && (contentType.includes('application/javascript') ||
                             contentType.includes('text/javascript') ||
                             contentType.includes('text/ecmascript'))) {
                    let js = responseBuffer.toString('utf8');
                    const hostEsc = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    // 1. Rewrite http://device-ip/path string literals
                    js = js.replace(new RegExp(`"https?://${hostEsc}(/[^"]*)"`, 'gi'), `"${prefix}$1"`);
                    js = js.replace(new RegExp(`'https?://${hostEsc}(/[^']*)'`, 'gi'), `'${prefix}$1'`);
                    // 2. Webpack public path: minified as {n,t,r,e}.p="/" or __webpack_public_path__="/"
                    js = js.replace(/([a-zA-Z_$][a-zA-Z0-9_$]*\.p\s*=\s*)(["'])\/\2/g,
                        (_m, pre, q) => `${pre}${q}${prefix}/${q}`);
                    js = js.replace(/(__webpack_public_path__\s*=\s*)(["'])\/\2/g,
                        (_m, pre, q) => `${pre}${q}${prefix}/${q}`);
                    // 3. Vite runtime base variable: base="/" → base="/tunnel/host/"
                    js = js.replace(/([\{,;(]\s*base\s*[=:]\s*)(["'])\/\2/g,
                        (_m, pre, q) => `${pre}${q}${prefix}/${q}`);
                    return Buffer.from(js, 'utf8');
                }

                return responseBuffer;
            } catch (err) {
                console.error('[PROXY INTERCEPTOR ERROR]', err.message, err.stack);
                return responseBuffer;
            }
        }),
    },
}));

// 🔥 SPA ASSET TRAP (FOR MARS OLT & WEBPACK VUE/REACT APPS)
// Modern Single Page Applications routinely ignore <base> tags by requesting absolute paths (e.g. '/static/chunk.js')
// This interceptor identifies when those requests originate from inside our iframe (via HTTP Referer) 
// and forcefully redirects them back into the tunnel path.
app.use((req, res, next) => {
    if (!req.url.startsWith('/tunnel/') && !req.url.startsWith('/api/')) {
        const referer = req.headers.referer;
        if (referer) {
            try {
                const refUrl = new URL(referer);
                const match = refUrl.pathname.match(/^\/tunnel\/([0-9a-zA-Z\.\-]+(?::\d+)?)/);
                if (match) {
                    const targetIp = match[1];
                    console.log(`[SPA Trap] Intercepted rogue Webpack request: ${req.url}. Escorting back to tunnel: /tunnel/${targetIp}`);
                    return res.redirect(302, `/tunnel/${targetIp}${req.url}`);
                }
            } catch (e) {
                // Ignore parse errors
            }
        }
    }
    next();
});

// Static frontend serving in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => {
    // This is the safety catch. If the proxy above didn't handle /tunnel, 
    // it will hit here. We should check if we should throw a 404 instead for /tunnel.
    if (req.url.startsWith('/tunnel')) {
        return res.status(404).send('Invalid Tunnel Path');
    }
    res.sendFile(path.join(__dirname, '../client/dist', 'index.html'));
  });
}

// Global error handler
app.use((err, req, res, next) => {
  console.error('[GLOBAL ERROR]', err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Only start accepting requests once the MySQL schema is ready, so no request
// can race table creation on a cold start.
db.ready
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Mr.Fiber API running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[FATAL] Database initialization failed — server not started:', err.message);
    process.exit(1);
  });
