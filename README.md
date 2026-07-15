# Onlinekey.me — Content Generator

AI-powered product page generator using Claude Code.
Fetches real content from official product URLs and builds complete HTML pages + marketing copy.

---

## Setup

### 1. Install Claude Code
```bash
npm install -g @anthropic-ai/claude-code
```

### 2. Open this folder in VS Code
```
File → Open Folder → content-generator
```

### 3. Open terminal in VS Code
`Ctrl + `` ` `` ` or Terminal → New Terminal

### 4. Start Claude Code
```bash
claude
```

---

## Usage

### Step 1 — Edit input.json
Fill in your product details:

```json
{
  "product": "Adobe Acrobat Pro | PDF Software | For Windows 1-Device Lifetime",
  "slug": "adobe-acrobat-pro",
  "price": "50.99",
  "original_price": "239.99",
  "prod_color": "#FF0000",
  "mode": "desc",
  "source_urls": [
    "https://www.adobe.com/acrobat/acrobat-pro.html",
    "https://helpx.adobe.com/acrobat/using/whats-new.html"
  ]
}
```

### Step 2 — Run in Claude Code
Type in the Claude Code terminal:
```
generate
```

Or be specific:
```
Generate the product page for Nitro Pro 14 using input.json
```

### Step 3 — Get your files
Claude Code saves to the `output/` folder:
- `nitro-pro-14.html` — open in browser to preview
- `nitro-pro-14-copy.md` — copy for WooCommerce, SEO, emails, social

---

## input.json Reference

| Field | Description | Example |
|-------|-------------|---------|
| `product` | Full product name | `"Adobe Acrobat Pro..."` |
| `slug` | URL-safe filename | `"adobe-acrobat-pro"` |
| `price` | Your selling price | `"50.99"` |
| `original_price` | Strike-through price | `"239.99"` |
| `prod_color` | Product brand color | `"#FF0000"` |
| `audience` | Target audience | `"general consumers"` |
| `language` | Output language | `"English"` |
| `cta` | Button text | `"Buy Now"` |
| `tone` | Writing tone | `"professional"` |
| `mode` | Page type | `"desc"` or `"landing"` |
| `source_urls` | Official pages to fetch | Array of URLs |
| `youtube_id` | YouTube video ID | `"dQw4w9WgXcQ"` or `""` |
| `para_position` | Where to insert paragraph | `"bullets"` |
| `structure` | Section order | Array of section names |
| `rich` | Feature toggles | Object of booleans |

---

## Mode: "desc" vs "landing"

### desc — Product Description Page
Embeds inside WooCommerce product page.
- No navbar
- No sticky/fixed elements
- Max-width 860px centered
- ONE Buy Now button — at the very bottom only

### landing — Full Landing Page
Standalone page outside WooCommerce.
- Sticky navbar with Onlinekey.me logo
- Hero with Unsplash background
- All sections

---

## Available Sections

| Section ID | Description |
|------------|-------------|
| `hero` | Badge + H1 + subheadline |
| `stats` | 4 animated counters |
| `price` | Price + trust badges |
| `social_proof` | Purchase ticker + rating |
| `bullets` | 6 feature checkmarks |
| `para` | Auto-generated paragraph (from URLs) |
| `wyg` | "What's Included" box |
| `features` | 4-tab feature showcase |
| `benefits` | 3 alternating benefit blocks |
| `specs` | Technical specs table |
| `testimonials` | Review cards |
| `faq` | Accordion Q&A |
| `comparison` | vs competitor table |
| `gallery` | 6-image grid |
| `video` | YouTube embed |
| `ba` | Before/After slider |
| `newsletter` | Email signup |
| `navbar` | Top navigation (landing only) |
| `cta_footer` | Final Buy Now CTA |

---

## Rich Features

Toggle in `input.json` under `"rich"`:

| Key | What it adds |
|-----|-------------|
| `unsplash` | Auto Unsplash images in all sections |
| `video` | YouTube embed or placeholder |
| `animations` | Scroll-reveal fadeInUp on every section |
| `counters` | Animated number counters |
| `feature_tabs` | Clickable JS tab interface |
| `popup` | 10% OFF discount popup after 3s |
| `chat` | Live chat bubble (fake support panel) |
| `before_after` | Before/After drag slider |
| `pricing_toggle` | Monthly/Yearly price toggle |
| `sticky_bar` | Sticky buy bar at bottom |

---

## Store Branding (auto-applied)

Always uses:
- **Fonts:** Open Sans (body), Montserrat (headings), Lato (secondary)
- **Primary:** #0D78F2 (buttons, links, highlights)
- **Secondary:** #006AA9 (hover states)
- **Background:** White #ffffff
- Product color = small accents only (badge, icons, stars)

---

## Example Products

**Microsoft Office 2024:**
```json
{
  "product": "Microsoft Office 2024 Professional Plus Activation Key",
  "slug": "microsoft-office-2024-pro",
  "price": "30.99",
  "original_price": "249.99",
  "prod_color": "#D83B01",
  "source_urls": [
    "https://www.microsoft.com/en-us/microsoft-365/get-started-with-office-2024",
    "https://support.microsoft.com/en-US/Office/what-s-new-in-office-2024-and-office-ltsc-2024"
  ]
}
```

**Adobe Acrobat Pro:**
```json
{
  "product": "Adobe Acrobat Pro | PDF Software | For Windows 1-Device Lifetime",
  "slug": "adobe-acrobat-pro",
  "price": "50.99",
  "original_price": "239.99",
  "prod_color": "#FF0000",
  "source_urls": [
    "https://www.adobe.com/acrobat/acrobat-pro.html"
  ]
}
```

**Malwarebytes Premium:**
```json
{
  "product": "Malwarebytes Premium V4 1PC Lifetime License Key Worldwide",
  "slug": "malwarebytes-premium-v4",
  "price": "35.99",
  "original_price": "119.99",
  "prod_color": "#1254A1",
  "source_urls": [
    "https://www.malwarebytes.com/premium",
    "https://www.malwarebytes.com/solutions/antivirus"
  ]
}
```
