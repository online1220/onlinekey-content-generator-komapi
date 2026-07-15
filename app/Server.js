const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'output');

if (!fs.existsSync(OUTPUT)) fs.mkdirSync(OUTPUT, { recursive: true });

const MIME = {
  '.html': 'text/html',
  '.js':   'text/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.md':   'text/plain',
};

// ── FETCH URL ─────────────────────────────────────────────────────────
function fetchUrl(url) {
  return new Promise((resolve) => {
    try {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html' },
        timeout: 12000
      }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchUrl(res.headers.location).then(resolve); return;
        }
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          const toAbs = (src, base) => {
            try {
              if (!src || src.startsWith('data:')) return null;
              if (src.startsWith('http')) return src;
              if (src.startsWith('//')) return 'https:' + src;
              return new URL(src, base).href;
            } catch(e) { return null; }
          };
          const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
          const imgs = [];
          let m;
          while ((m = imgRegex.exec(data)) !== null) {
            const abs = toAbs(m[1], url);
            if (!abs) continue;
            if (['favicon','avatar','pixel','sprite','badge','flag','arrow','icon','logo'].some(x => abs.includes(x))) continue;
            if (['.jpg','.jpeg','.png','.webp','.gif','imgix','hubfs','cdn','media','asset','image','photo','screen','product'].some(x => abs.includes(x))) {
              imgs.push(abs);
            }
          }
          const text = data
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[\s\S]*?<\/footer>/gi, '')
            .replace(/<header[\s\S]*?<\/header>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/\s+/g, ' ').trim().slice(0, 6000);
          resolve({ url, text, imgs: [...new Set(imgs)].slice(0, 20), ok: true });
        });
      });
      req.on('error', () => resolve({ url, text: '', imgs: [], ok: false }));
      req.on('timeout', () => { req.destroy(); resolve({ url, text: '', imgs: [], ok: false }); });
    } catch(e) { resolve({ url, text: '', imgs: [], ok: false }); }
  });
}

// ── LLM PROVIDERS ───────────────────────────────────────────────────────
// Each provider config: { hostname, path, buildHeaders(apiKey), buildBody(messages,maxTokens,model), parseResponse(json) }
// "provider" is one of: "anthropic" | "openai" | "custom"
// For "custom", the caller supplies a full endpoint URL, auth style, and response
// shape — this covers OpenAI-shaped and Anthropic-shaped chat APIs generically,
// for any account you actually hold with a compatible API (Azure OpenAI,
// self-hosted vLLM/Ollama with an OpenAI-compatible front end, Kimi, MiniMax, etc).
// It intentionally does NOT special-case or whitelist any third-party resale/
// proxy service — point this only at an endpoint you have a legitimate account with.

const PROVIDERS = {
  anthropic: {
    hostname: 'api.anthropic.com',
    port: 443,
    path: '/v1/messages',
    defaultModel: 'claude-sonnet-4-6',
    buildHeaders(apiKey, bodyLen) {
      return {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': bodyLen
      };
    },
    buildBody(messages, maxTokens, model) {
      return JSON.stringify({ model: model || this.defaultModel, max_tokens: maxTokens || 16000, messages });
    },
    parseResponse(parsed) {
      if (parsed.error) throw new Error(parsed.error.message);
      return parsed.content.map(b => b.text || '').join('');
    }
  },
  openai: {
    hostname: 'api.openai.com',
    port: 443,
    path: '/v1/chat/completions',
    defaultModel: 'gpt-5.1',
    buildHeaders(apiKey, bodyLen) {
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': bodyLen
      };
    },
    buildBody(messages, maxTokens, model) {
      return JSON.stringify({ model: model || this.defaultModel, max_completion_tokens: maxTokens || 16000, messages });
    },
    parseResponse(parsed) {
      if (parsed.error) throw new Error(parsed.error.message);
      return parsed.choices.map(c => c.message?.content || '').join('');
    }
  }
};

// Builds a fully generic provider from explicit user config — no assumptions about
// path structure, auth header name, or response shape. Covers "any endpoint you have
// a legitimate account with" without guessing wrong. Use responsibly: point this only
// at an API you actually hold a real account/key for.
function customProvider(endpointUrl, model, authStyle, extraHeaderName, extraHeaderValue, responseShape) {
  const u = new URL(endpointUrl);
  return {
    hostname: u.hostname,
    port: u.port || (u.protocol === 'http:' ? 80 : 443),
    protocol: u.protocol,
    path: u.pathname + u.search,
    defaultModel: model || 'default',
    buildHeaders(apiKey, bodyLen) {
      const h = { 'Content-Type': 'application/json', 'Content-Length': bodyLen };
      if (authStyle === 'x-api-key') h['x-api-key'] = apiKey;
      else h['Authorization'] = `Bearer ${apiKey}`;
      if (extraHeaderName) h[extraHeaderName] = extraHeaderValue || '';
      return h;
    },
    buildBody(messages, maxTokens, mdl) {
      // Both OpenAI- and Anthropic-shaped chat APIs accept this same request body
      // (model/messages/max_tokens) — only the response shape actually differs.
      return JSON.stringify({ model: mdl || this.defaultModel, max_tokens: maxTokens || 16000, messages });
    },
    parseResponse(parsed) {
      if (responseShape === 'anthropic') {
        if (parsed.error) throw new Error(typeof parsed.error === 'string' ? parsed.error : (parsed.error.message || JSON.stringify(parsed.error)));
        return (parsed.content || []).map(b => b.text || '').join('');
      }
      // default: openai-style
      if (parsed.error) throw new Error(typeof parsed.error === 'string' ? parsed.error : (parsed.error.message || JSON.stringify(parsed.error)));
      return (parsed.choices || []).map(c => c.message?.content || '').join('');
    }
  };
}

function callLLM(opts, messages, maxTokens) {
  const { provider, apiKey, model, endpoint, authStyle, extraHeaderName, extraHeaderValue, responseShape } = opts;
  let cfg;
  if (provider === 'custom') {
    if (!endpoint) return Promise.reject(new Error('Custom provider requires a full endpoint URL.'));
    cfg = customProvider(endpoint, model, authStyle, extraHeaderName, extraHeaderValue, responseShape);
  } else {
    cfg = PROVIDERS[provider];
    if (!cfg) return Promise.reject(new Error(`Unknown provider: ${provider}`));
  }

  return new Promise((resolve, reject) => {
    const body = cfg.buildBody(messages, maxTokens, model);
    const lib = cfg.protocol === 'http:' ? http : https;
    const req = lib.request({
      hostname: cfg.hostname, port: cfg.port, path: cfg.path, method: 'POST',
      headers: cfg.buildHeaders(apiKey, Buffer.byteLength(body))
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        // Non-2xx: surface the real status + raw body instead of trying to parse it as a normal reply
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const snippet = data.slice(0, 500).replace(/\s+/g, ' ').trim();
          return reject(new Error(`[${provider}] HTTP ${res.statusCode} from ${cfg.hostname}${cfg.path} — ${snippet || '(empty response body)'}`));
        }
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch(e) {
          const snippet = data.slice(0, 300).replace(/\s+/g, ' ').trim();
          return reject(new Error(`[${provider}] Response wasn't valid JSON (status ${res.statusCode}). Raw response: ${snippet || '(empty)'}`));
        }
        try {
          resolve(cfg.parseResponse(parsed));
        } catch(e) {
          reject(new Error(`[${provider}] ${e.message || 'Unexpected response shape'} — raw: ${JSON.stringify(parsed).slice(0,300)}`));
        }
      });
    });
    req.on('error', e => reject(new Error(`[${provider}] Connection error to ${cfg.hostname}: ${e.message}`)));
    req.setTimeout(60000, () => {
      req.destroy(new Error(`[${provider}] Request to ${cfg.hostname} timed out after 60s — check the base URL/network.`));
    });
    req.write(body);
    req.end();
  });
}

// ── POST-PROCESS: fix all Elementor issues ────────────────────────────
function postProcess(html, slug) {

  // 1. Fix opacity:0 — only on animation classes, never on popups/overlays
  html = html.replace(/(\.(?:reveal|fade-in-up|fade-up|animate)(?![^{]*(?:popup|overlay|modal))[^{]*\{[^}]*?)opacity\s*:\s*0/g, '$1opacity:1');

  // 2. Safe animation fallback — only targets .reveal classes, NOT all elements
  //    This is the fix for the dark screen bug: querySelectorAll("[class]") was
  //    forcing opacity:1 on hidden overlays causing dark screen in Elementor
  const safeAnimFallback = '<script>setTimeout(function(){document.querySelectorAll(".reveal,.fade-up,.fade-in-up").forEach(function(e){e.classList.add("visible");e.style.opacity="1";e.style.transform="none";});},800);</script>';
  html = html.replace('</body>', safeAnimFallback + '\n</body>');

  // 3. Fix static counters — replace data-target animated counters with static values
  html = html.replace(/<div([^>]*)class="stat-num"([^>]*)data-target="([^"]*)"([^>]*)data-suffix="([^"]*)"([^>]*)data-decimal="true"[^>]*>\d*<\/div>/g,
    (m, b1, b2, target, b3, suffix) => `<div class="stat-num">${parseFloat(target).toFixed(1)}${suffix}</div>`
  );
  html = html.replace(/<div([^>]*)class="stat-num"([^>]*)data-target="([^"]*)"([^>]*)data-suffix="([^"]*)"[^>]*>\d*<\/div>/g,
    (m, b1, b2, target, b3, suffix) => {
      const num = parseFloat(target);
      const formatted = num >= 1000000 ? (num/1000000).toFixed(0)+'M' : num >= 1000 ? num.toLocaleString() : num.toString();
      return `<div class="stat-num">${formatted}${suffix}</div>`;
    }
  );
  // Remove counter JS observer
  html = html.replace(/const counters[\s\S]*?counterObs\.observe[\s\S]*?\}\);/g, '');
  html = html.replace(/\/\/\s*(?:──\s*)?COUNTERS[\s\S]*?counterObs\.observe[\s\S]*?\}\);/g, '');
  html = html.replace(/function animateCounter[\s\S]*?requestAnimationFrame\(step\);\s*\}/g, '');

  // 4. Fix gallery responsive rules — must be inside @media
  html = html.replace(/(\.gallery-grid\{grid-template-columns:repeat\(2,1fr\)\})(?!\s*})/g, '@media(max-width:768px){$1}');
  html = html.replace(/(\.gallery-grid\{grid-template-columns:1fr\})(?!\s*})/g, '@media(max-width:480px){$1}');

  // 5. Remove lightbox overlay div from DOM — it causes dark screen in Elementor
  //    because Elementor overrides display:none making it visible
  html = html.replace(/<div[^>]*class="[^"]*lightbox[^"]*overlay[^"]*"[^>]*>[\s\S]*?<\/div>\s*(?=\n|<script|<\/body>)/g, '');
  html = html.replace(/<div[^>]*id="lightbox"[^>]*>[\s\S]*?<\/div>\s*(?=\n|<script|<\/body>)/g, '');
  // Remove discount popup div (also position:fixed dark overlay)
  html = html.replace(/<div[^>]*class="[^"]*(?:popup|discount)[^"]*"[^>]*>[\s\S]*?<\/div>\s*(?=\n|<script|<\/body>)/g, '');
  // Remove chat bubble div
  html = html.replace(/<div[^>]*class="[^"]*chat[^"]*bubble[^"]*"[^>]*>[\s\S]*?<\/div>\s*(?=\n|<script|<\/body>)/g, '');

  // 6. Remove CSS for removed elements
  html = html.replace(/\.lightbox-overlay\{[^}]+\}/g, '');
  html = html.replace(/\.lightbox-overlay\.open\{[^}]+\}/g, '');
  html = html.replace(/\.lb-overlay\{[^}]+\}/g, '');
  html = html.replace(/\.lb-overlay\.open\{[^}]+\}/g, '');
  html = html.replace(/@keyframes lbIn\{[^}]+\}/g, '');

  // 7. Remove overflow-x:hidden from wrappers (causes issues in Elementor)
  html = html.replace(/;overflow-x:hidden/g, '');
  html = html.replace(/overflow-x:hidden;/g, '');

  // ── BUILD ELEMENTOR VERSION ────────────────────────────────────────
  // Extract CSS
  const cssMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  let css = cssMatch ? cssMatch[1] : '';

  // Remove rules that break Elementor editor
  css = css.replace(/(?:^|\n)\s*(?:body|html|\*|:root)[\s,][^{]*\{[^}]*\}/gm, '');
  css = css.replace(/(?:^|\n)\s*\*\s*,\s*\*[^{]*\{[^}]*\}/gm, '');

  // Extract all JS
  const jsBlocks = [];
  const jsRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let jsM;
  while ((jsM = jsRe.exec(html)) !== null) {
    if (jsM[1].trim()) jsBlocks.push(jsM[1].trim());
  }
  const js = jsBlocks.join('\n\n');

  // Extract body content only
  let body = html;
  body = body.replace(/<!DOCTYPE[^>]*>/gi, '');
  body = body.replace(/<html[^>]*>/gi, '');
  body = body.replace(/<\/html>/gi, '');
  body = body.replace(/<head[\s\S]*?<\/head>/gi, '');
  body = body.replace(/<body[^>]*>/gi, '');
  body = body.replace(/<\/body>/gi, '');
  body = body.replace(/<style[\s\S]*?<\/style>/gi, '');
  body = body.replace(/<script[\s\S]*?<\/script>/gi, '');
  body = body.trim();

  // Elementor-ready: style + body + script in one file
  const elementorHtml = `<style>\n/* Onlinekey.me Product Page — paste directly in Elementor HTML widget */\n${css}\n</style>\n\n${body}\n\n<script>\n${js}\n</script>`;

  return { html, elementorHtml };
}

// ── BUILD HTML PROMPT ──────────────────────────────────────────────────
function buildHtmlPrompt(config, fetchedContent) {
  const { product, price, original_price, prod_color, audience, language, cta, tone, mode, structure, rich, para_position, youtube_id } = config;
  const allImgs = fetchedContent.flatMap(p => p.imgs || []);

  const urlSection = fetchedContent.length > 0 ? `
════ OFFICIAL PRODUCT CONTENT (PRIMARY SOURCE) ════
RULES:
1. Use EXACT official headlines, feature names, descriptions from this content
2. Copy specs directly from this content
3. Use FAQ from this content where available
4. 150-200 word paragraph based on this content
5. Do NOT invent features not found here
6. For images: use ONLY the real URLs listed below — NO Unsplash

REAL IMAGE URLs:
${allImgs.slice(0, 20).map((img, i) => `${i+1}. ${img}`).join('\n') || 'None extracted — use emoji/icon placeholders only'}

SOURCE TEXT:
${fetchedContent.map((p, i) => `--- Source ${i+1}: ${p.url} ---\n${p.text}`).join('\n\n')}
════ END SOURCE ════
` : '';

  const richLines = [];
  if (rich.video) richLines.push(youtube_id ? `VIDEO: embed https://www.youtube.com/embed/${youtube_id}?rel=0` : `VIDEO: CSS placeholder with YouTube search link for "${product}".`);
  if (rich.animations) richLines.push('ANIMATIONS: IntersectionObserver scroll reveal. Add class="reveal" on every section. CSS: .reveal{opacity:1;transform:translateY(28px);transition:opacity 0.6s ease,transform 0.6s ease} .reveal.visible{opacity:1;transform:none} — ALWAYS start opacity at 1 not 0. JS observer adds .visible class on scroll.');
  if (rich.counters) richLines.push('COUNTERS: Show as STATIC values only — no JS animation. Just display the number directly in the div. Use real numbers from source.');
  if (rich.feature_tabs) richLines.push('FEATURE TABS: 4 tabs, #0D78F2 active underline, JS switching. Wrap in DOMContentLoaded.');
  if (rich.popup) richLines.push('DISCOUNT POPUP: DO NOT create as a fixed div in HTML. Use createElement in JS: setTimeout(3000ms), create overlay with position:fixed only when triggered, remove from DOM on close.');
  if (rich.before_after) richLines.push('BEFORE/AFTER: range input + clip-path.');
  if (rich.pricing_toggle) richLines.push('PRICING TOGGLE: monthly/yearly JS, yearly -20%.');

  const secDefs = {
    hero: mode === 'landing'
      ? `HERO: Full-width. Badge pill border+color ${prod_color}. Montserrat H1 key word in ${prod_color}. "${cta}" btn #0D78F2.`
      : `HERO: White bg. Badge pill border+color ${prod_color} Open Sans 11px uppercase. H1 Montserrat 600 clamp(28px,4vw,52px) #1a1a1a key word in ${prod_color}. Subheadline Open Sans 16px #666. NO buttons. NO images.`,
    navbar: `NAVBAR: Sticky. "Onlinekey.me" #0D78F2. "${cta}" btn.`,
    stats: `STATS: 4 STATIC counters (no animation). Show values directly as text. Montserrat #0D78F2 large. Open Sans #888 labels. Use real numbers from source.`,
    price: `PRICE: $${price} Montserrat #0D78F2 44px. Strike $${original_price||''}. Lifetime badge. 5 trust badges.`,
    social_proof: `SOCIAL PROOF: CSS ticker recent purchases. Stars + rating.`,
    bullets: `BULLETS: h2 "What ${product.split('|')[0].trim()} Does For You". 6 ✓ #0D78F2 bullets Lato 14px. Real features from source.`,
    para: `PARAGRAPH: After ${para_position} section. 150-200 words from source. Montserrat h3 heading. Open Sans 15px #555 line-height 1.85.`,
    wyg: `WHAT YOU GET: bg #EEF5FF border-left 4px #0D78F2. "What's Included". 6 items.`,
    features: `FEATURES: ${rich.feature_tabs?'4 tabs #0D78F2 active. Wrap tab JS in DOMContentLoaded.':'4-col grid.'} Icon ${prod_color}. Real feature names from source. Images from real URLs list above.`,
    benefits: `BENEFITS: 3 alternating blocks. ${prod_color} icon. Real value props from source. Images from real URLs list above.`,
    specs: `SPECS TABLE: 2-col. #888 label | #1a1a1a bold value. Hover #EEF5FF. 10-12 rows from source.`,
    testimonials: `TESTIMONIALS: ${mode==='landing'?'3':'2'} cards. #0D78F2 avatar. ${prod_color} stars. Realistic quotes.`,
    faq: `FAQ: ${mode==='landing'?'6':'3'} accordion. JS toggle wrapped in DOMContentLoaded. #0D78F2 icon. Real questions from source.`,
    comparison: `COMPARISON: vs 1 competitor. 6 rows. ✓ #0D78F2 / ✗ #bbb.`,
    gallery: `GALLERY: h2 "Explore ${product.split('|')[0].trim()}". 3-col grid, rounded card style (border-radius:14px, bg:#f4f4fb).
Images: ${fetchedContent.flatMap(p=>p.imgs||[]).slice(0,6).map((img,i)=>`${i+1}. ${img}`).join('\n')||'No images — use emoji placeholders'}

CSS:
.gallery-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.gallery-card{background:#f4f4fb;border-radius:14px;overflow:hidden;cursor:pointer;transition:transform .2s,box-shadow .2s}
.gallery-card:hover{transform:translateY(-4px);box-shadow:0 12px 32px rgba(0,0,0,0.12)}
.gallery-card img{width:100%;height:200px;object-fit:cover;display:block}
@media(max-width:768px){.gallery-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:480px){.gallery-grid{grid-template-columns:1fr}}

LIGHTBOX — CRITICAL: Do NOT add any hidden overlay div to HTML.
Create lightbox ONLY with JavaScript createElement when image is clicked:
var _imgs=[...image urls...]; var _cur=0;
function openLB(i){
  _cur=i;
  var ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px';
  var img=document.createElement('img');
  img.src=_imgs[i];
  img.style.cssText='max-width:88vw;max-height:80vh;border-radius:10px;object-fit:contain;box-shadow:0 24px 64px rgba(0,0,0,0.5)';
  var cnt=document.createElement('div');
  cnt.style.cssText='color:#fff;font-size:13px;opacity:.8';
  cnt.textContent=(i+1)+' / '+_imgs.length;
  var close=document.createElement('button');
  close.textContent='✕';
  close.style.cssText='position:absolute;top:16px;right:16px;background:#fff;border:none;border-radius:50%;width:36px;height:36px;font-size:18px;cursor:pointer;font-weight:700';
  close.onclick=function(){document.body.removeChild(ov);};
  var prev=document.createElement('button');
  prev.textContent='‹';
  prev.style.cssText='position:absolute;left:16px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.9);border:none;border-radius:50%;width:44px;height:44px;font-size:24px;cursor:pointer';
  prev.onclick=function(e){e.stopPropagation();_cur=(_cur-1+_imgs.length)%_imgs.length;img.src=_imgs[_cur];cnt.textContent=(_cur+1)+' / '+_imgs.length;};
  var next=document.createElement('button');
  next.textContent='›';
  next.style.cssText='position:absolute;right:16px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.9);border:none;border-radius:50%;width:44px;height:44px;font-size:24px;cursor:pointer';
  next.onclick=function(e){e.stopPropagation();_cur=(_cur+1)%_imgs.length;img.src=_imgs[_cur];cnt.textContent=(_cur+1)+' / '+_imgs.length;};
  ov.appendChild(img);ov.appendChild(cnt);ov.appendChild(close);ov.appendChild(prev);ov.appendChild(next);
  ov.addEventListener('click',function(e){if(e.target===ov)document.body.removeChild(ov);});
  document.body.appendChild(ov);
  document.addEventListener('keydown',function esc(e){if(!document.getElementById&&!document.body.contains(ov))return;if(e.key==='Escape'){document.body.removeChild(ov);document.removeEventListener('keydown',esc);}if(e.key==='ArrowRight'){_cur=(_cur+1)%_imgs.length;img.src=_imgs[_cur];cnt.textContent=(_cur+1)+' / '+_imgs.length;}if(e.key==='ArrowLeft'){_cur=(_cur-1+_imgs.length)%_imgs.length;img.src=_imgs[_cur];cnt.textContent=(_cur+1)+' / '+_imgs.length;}});
}
Add onclick="openLB(index)" to each gallery-card div.`,
    video: `VIDEO: h2 + subtitle. ${youtube_id?`<iframe src="https://www.youtube.com/embed/${youtube_id}?rel=0" allowfullscreen style="width:100%;height:400px;border:none;border-radius:10px">`:` CSS placeholder with YouTube search link.`}`,
    ba: `BEFORE/AFTER: range input + clip-path. Warm left, cool blue right. #0D78F2 handle.`,
    newsletter: `NEWSLETTER: #EEF5FF bg. Email input. #0D78F2 button.`,
    cta_footer: mode==='landing'
      ? `CTA FOOTER: #EEF5FF bg. Montserrat headline. Big #0D78F2 "${cta}" btn. Footer links.`
      : `FINAL BUY NOW (only CTA on page, always last): bg #EEF5FF border-radius 12px padding 48px 40px center. Montserrat headline. BIG #0D78F2 "${cta}" btn padding 16px 48px Montserrat 600 18px. Below: "🛡 30-Day Money Back · ⚡ Instant Delivery · ✅ Genuine License"`,
  };

  const sectionCount = (structure||[]).filter(s=>secDefs[s]).length;
  const sections = (structure||[]).filter(s=>secDefs[s]).map((s,i)=>`${i+1}. ${secDefs[s]}`).join('\n\n');

  return `You are a world-class UI/UX designer for Onlinekey.me software reseller store.
${urlSection}
⚠️ CRITICAL RULES:
1. Output ONLY raw HTML. Start <!DOCTYPE html> end </html>. No markdown, no fences.
2. Include ALL ${sectionCount} sections — do not skip any.
3. ELEMENTOR SAFE — VERY IMPORTANT:
   - NEVER use body{} html{} *{} :root{} CSS selectors — they break Elementor
   - NEVER put any overlay/popup/lightbox as a pre-existing div in the HTML
   - NEVER use overflow-x:hidden on wrappers
   - Create overlays ONLY via JavaScript createElement when triggered by user click
   - All JS that queries DOM must be wrapped in DOMContentLoaded or placed at end of body
   - No position:fixed elements in HTML — only create them dynamically via JS when needed
4. White background via .page-wrap class only, NOT body selector

════ BRANDING ════
Primary: #0D78F2 | Secondary: #006AA9
Fonts: Open Sans 400 (body), Montserrat 600 (headings), Lato 400 (secondary)
Google Fonts <link> in <head>. Product accent: ${prod_color} (badge, icons, stars only).

════ PRODUCT ════
"${product}" | Price: $${price}${original_price?` (was $${original_price})`:''} | ${audience} | ${language} | CTA: "${cta}" | Tone: ${tone}
${mode==='desc'?'MODE: DESCRIPTION PAGE — full width max-width:100%. ONE CTA at bottom only. No navbar.':'MODE: LANDING PAGE'}

════ SECTIONS ════
${sections}

════ RICH FEATURES ════
${richLines.join('\n')||'Standard layout.'}`;
}

function buildCopyPrompt(config, fetchedContent) {
  const { product, audience, language, cta, tone } = config;
  const src = fetchedContent.length > 0
    ? `Use this official content:\n${fetchedContent.map(p=>p.text).join('\n\n').slice(0,5000)}`
    : `Infer from product: "${product}"`;
  return `Copywriter for Onlinekey.me. ${src}\n\nWrite for: "${product}" | ${audience} | ${language} | ${tone} | CTA: "${cta}"\n\n# PRODUCT DESCRIPTION\n[hook + opening + bullets x6 + who it's for + CTA]\n\n# SEO PACK\nTitle(≤60): / Meta(≤155): / H1: / Slug: / Primary keyword: / Secondary(8): / Long-tail(4): / OG Title: / OG Desc: / Schema:\n\n# EMAIL SEQUENCE\n## Email 1 — Launch\nSubject: / Body:\n## Email 2 — Features\nSubject: / Body:\n## Email 3 — Urgency\nSubject: / Body:\n\n# SOCIAL POSTS\n## Twitter x3:\n## Facebook:\n## Instagram + hashtags:\n## LinkedIn:\n## WhatsApp:`;
}

// ── HTTP SERVER ────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, x-provider, x-model, x-endpoint, x-auth-style, x-extra-header-name, x-extra-header-value, x-response-shape');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && url.pathname === '/api/products') {
    try { res.writeHead(200,{'Content-Type':'application/json'}); res.end(fs.readFileSync(path.join(ROOT,'products.json'),'utf8')); }
    catch(e) { res.writeHead(500); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/outputs') {
    try {
      const files = fs.readdirSync(OUTPUT)
        .filter(f=>(f.endsWith('.html')||f.endsWith('.md')||f.endsWith('.css')||f.endsWith('.js'))&&f!=='README.md')
        .map(f=>{const s=fs.statSync(path.join(OUTPUT,f));return{name:f,size:s.size,modified:s.mtime};})
        .sort((a,b)=>new Date(b.modified)-new Date(a.modified));
      res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(files));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({error:e.message})); }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/file') {
    const name = url.searchParams.get('name');
    if (!name||name.includes('..')) { res.writeHead(400); res.end('Bad'); return; }
    try { res.writeHead(200,{'Content-Type':'text/plain;charset=utf-8'}); res.end(fs.readFileSync(path.join(OUTPUT,name),'utf8')); }
    catch(e) { res.writeHead(404); res.end('Not found'); }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/save-product') {
    let body='';
    req.on('data',c=>body+=c);
    req.on('end',()=>{
      try {
        const product=JSON.parse(body);
        const libPath=path.join(ROOT,'products.json');
        const lib=JSON.parse(fs.readFileSync(libPath,'utf8'));
        const idx=lib.products.findIndex(p=>p.slug===product.slug);
        if(idx>=0)lib.products[idx]=product;else lib.products.push(product);
        fs.writeFileSync(libPath,JSON.stringify(lib,null,2));
        res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true}));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({error:e.message})); }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/save-file') {
    let body='';
    req.on('data',c=>body+=c);
    req.on('end',()=>{
      try {
        const {filename,content}=JSON.parse(body);
        if(!filename||filename.includes('..')) { res.writeHead(400); res.end('Bad'); return; }
        fs.writeFileSync(path.join(OUTPUT,filename),content,'utf8');
        res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({ok:true,filename}));
      } catch(e) { res.writeHead(500); res.end(JSON.stringify({error:e.message})); }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/generate') {
    let body='';
    req.on('data',c=>body+=c);
    req.on('end',async()=>{
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});
      const send=(type,data)=>{try{res.write(`data: ${JSON.stringify({type,data})}\n\n`);}catch(e){}};

      try {
        const config=JSON.parse(body);
        const apiKey=req.headers['x-api-key'];
        const provider=(req.headers['x-provider']||'anthropic').toLowerCase();
        const model=req.headers['x-model']||undefined;
        const endpoint=req.headers['x-endpoint']||undefined;
        const authStyle=req.headers['x-auth-style']||'bearer';
        const extraHeaderName=req.headers['x-extra-header-name']||undefined;
        const extraHeaderValue=req.headers['x-extra-header-value']||undefined;
        const responseShape=req.headers['x-response-shape']||'openai';
        if(!apiKey){send('done',{success:false,error:'No API key.'});res.end();return;}
        if(provider==='custom'&&!endpoint){send('done',{success:false,error:'Custom provider selected but no endpoint URL given.'});res.end();return;}
        const llmOpts={provider,apiKey,model,endpoint,authStyle,extraHeaderName,extraHeaderValue,responseShape};
        send('log',`Provider: ${provider}${model?` | Model: ${model}`:''}${endpoint?` | Endpoint: ${endpoint}`:''}`);

        const {slug,source_urls=[]}=config;
        send('log',`Starting: ${config.product}`);
        send('log',`Mode: ${config.mode} | Price: $${config.price}`);

        // Fetch URLs
        let fetched=[];
        if(source_urls.length>0){
          send('log',`Fetching ${source_urls.length} URL(s)...`);
          const results=await Promise.all(source_urls.map(u=>fetchUrl(u)));
          fetched=results.filter(p=>p.ok&&p.text.length>100);
          fetched.forEach(p=>send('log',`  ✓ ${p.url} (${p.text.length} chars, ${(p.imgs||[]).length} images)`));
          if(fetched.length===0)send('log','  No URLs fetched — using product name only');
        }

        // Generate HTML
        send('log','');
        send('log','Generating HTML...');
        const htmlPrompt=buildHtmlPrompt(config,fetched);
        let rawHtml=await callLLM(llmOpts,[{role:'user',content:htmlPrompt}],16000);
        const htmlMatch=rawHtml.match(/<!DOCTYPE[\s\S]*<\/html>/i);
        if(htmlMatch)rawHtml=htmlMatch[0];

        // Post-process
        const {html,elementorHtml}=postProcess(rawHtml,slug);

        // Save files
        fs.writeFileSync(path.join(OUTPUT,`${slug}.html`),html,'utf8');
        fs.writeFileSync(path.join(OUTPUT,`${slug}-elementor.html`),elementorHtml,'utf8');
        send('log',`✓ HTML: output/${slug}.html (${(html.length/1024).toFixed(1)} KB)`);
        send('log',`✓ Elementor: output/${slug}-elementor.html`);

        // Generate copy
        send('log','Generating copy & SEO...');
        const copyPrompt=buildCopyPrompt(config,fetched);
        const copy=await callLLM(llmOpts,[{role:'user',content:copyPrompt}],4000);
        fs.writeFileSync(path.join(OUTPUT,`${slug}-copy.md`),copy,'utf8');
        send('log',`✓ Copy: output/${slug}-copy.md`);

        send('log','');
        send('log','✅ Done!');
        send('done',{success:true,files:[`${slug}.html`,`${slug}-elementor.html`,`${slug}-copy.md`]});

      } catch(e) {
        send('log','Error: '+e.message);
        send('done',{success:false,error:e.message});
      }
      res.end();
    });
    return;
  }

  // Static files
  let filePath=url.pathname==='/'?'/index.html':url.pathname;
  filePath=path.join(__dirname,filePath);
  if(url.pathname.startsWith('/output/'))filePath=path.join(ROOT,url.pathname);
  fs.readFile(filePath,(err,data)=>{
    if(err){res.writeHead(404);res.end('Not found');return;}
    const ext=path.extname(filePath);
    res.writeHead(200,{'Content-Type':MIME[ext]||'text/plain'});
    res.end(data);
  });
});

server.listen(PORT,()=>{
  console.log(`\n✅ Content Generator — http://localhost:${PORT}\n`);
});
