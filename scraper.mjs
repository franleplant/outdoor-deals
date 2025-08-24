// scraper.mjs — no API keys, JSON-LD first, gentle crawl, CSV out
import fs from "fs/promises";
import { readFile } from "fs/promises";
import Papa from "papaparse";
import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import { setTimeout as wait } from "timers/promises";
import pLimit from "p-limit";
import { request } from "undici";
import { gunzip, inflate, brotliDecompress } from "zlib";
import { promisify } from "util";

const MAX_PAGES_PER_DOMAIN = 5;
const MAX_SITEMAP_URLS_PER_DOMAIN = 400;
const CONCURRENCY = 6;
const MIN_DISCOUNT = 0.30; // 30% off
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DEBUG_MODE = false; // Enable debugging
const TEST_MODE = false; // Process only first seed for debugging

console.log("🏔️  Starting outdoor deals scraper...");
console.log(`📊 Settings: MIN_DISCOUNT=${MIN_DISCOUNT*100}%, MAX_PAGES=${MAX_PAGES_PER_DOMAIN}, MAX_SITEMAP_URLS=${MAX_SITEMAP_URLS_PER_DOMAIN}, CONCURRENCY=${CONCURRENCY}`);
console.log("─".repeat(60));

function normUrl(u) { try { return new URL(u).toString(); } catch { return null; } }
function pctOff(list, sale) {
  if (!list || !sale || list <= 0 || sale <= 0 || sale > list) return 0;
  return 1 - sale / list;
}

async function fetchText(url) {
  console.log(`🌐 Fetching: ${url}`);
  
  // Add random delay to appear more human-like
  const delay = 500 + Math.random() * 1000; // 500-1500ms delay
  await wait(delay);
  
  const res = await request(url, {
    headers: { 
      "user-agent": USER_AGENT,
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "accept-encoding": "gzip, deflate, br",
      "dnt": "1",
      "connection": "keep-alive",
      "upgrade-insecure-requests": "1",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "none",
      "cache-control": "max-age=0"
    }
  });
  if (res.statusCode >= 400) {
    console.log(`❌ HTTP ${res.statusCode} for ${url}`);
    throw new Error(`HTTP ${res.statusCode} ${url}`);
  }
  
  // Get content encoding to handle decompression manually if needed
  const contentEncoding = res.headers["content-encoding"];
  if (DEBUG_MODE) {
    console.log(`🔍 DEBUG: Content-Encoding: ${contentEncoding || 'none'}`);
    console.log(`🔍 DEBUG: Content-Type: ${res.headers["content-type"] || 'unknown'}`);
  }
  
  // Get raw body as buffer first
  let bodyBuffer;
  try {
    bodyBuffer = Buffer.concat(await res.body.arrayBuffer().then(ab => [new Uint8Array(ab)]));
  } catch (err) {
    console.log(`❌ Failed to read response body: ${err.message}`);
    throw new Error(`Failed to read response: ${err.message}`);
  }
  
  // Create promisified decompression functions
  const gunzipAsync = promisify(gunzip);
  const inflateAsync = promisify(inflate);
  const brotliAsync = promisify(brotliDecompress);
  
  // Decompress manually if needed
  let text;
  try {
    if (contentEncoding === 'gzip') {
      const decompressed = await gunzipAsync(bodyBuffer);
      text = decompressed.toString('utf-8');
    } else if (contentEncoding === 'deflate') {
      const decompressed = await inflateAsync(bodyBuffer);
      text = decompressed.toString('utf-8');
    } else if (contentEncoding === 'br') {
      const decompressed = await brotliAsync(bodyBuffer);
      text = decompressed.toString('utf-8');
    } else {
      // No compression or unsupported compression
      text = bodyBuffer.toString('utf-8');
    }
    if (DEBUG_MODE) {
      console.log(`🔍 DEBUG: Successfully decompressed ${contentEncoding || 'uncompressed'} content`);
    }
  } catch (err) {
    // Fallback to treating as plain text
    console.log(`⚠️  Decompression failed, treating as plain text: ${err.message}`);
    text = bodyBuffer.toString('utf-8');
  }
  
  console.log(`✅ Retrieved ${Math.round(text.length / 1024)}KB from ${new URL(url).hostname}`);
  
  // Debug: Save HTML for inspection and check if it's valid HTML
  if (DEBUG_MODE && text.length > 1000) {
    try {
      const hostname = new URL(url).hostname.replace(/[^a-zA-Z0-9]/g, '_');
      await fs.mkdir("./debug", { recursive: true });
      const sample = text.substring(0, 50000);
      await fs.writeFile(`./debug/${hostname}_sample.html`, sample, "utf8");
      console.log(`🔍 DEBUG: Saved sample HTML to ./debug/${hostname}_sample.html`);
      
      // Check if it looks like HTML
      const isHtml = sample.toLowerCase().includes('<!doctype html') || sample.toLowerCase().includes('<html');
      console.log(`🔍 DEBUG: Content appears to be HTML: ${isHtml}`);
      if (!isHtml) {
        console.log(`🔍 DEBUG: First 200 chars: ${sample.substring(0, 200)}`);
      }
    } catch {}
  }
  
  return text;
}

function parseJsonLdProducts(html, base) {
  const $ = cheerio.load(html);
  const out = [];
  const jsonLdScripts = $('script[type="application/ld+json"]');
  
  if (DEBUG_MODE) {
    console.log(`🔍 DEBUG: Found ${jsonLdScripts.length} JSON-LD scripts in HTML`);
  }
  
  jsonLdScripts.each((_, el) => {
    let txt = $(el).contents().text();
    if (DEBUG_MODE && txt.length > 100) {
      console.log(`🔍 DEBUG: JSON-LD snippet: ${txt.substring(0, 200)}...`);
    }
    try {
      const data = JSON.parse(txt);
      const nodes = Array.isArray(data) ? data : [data];
      if (DEBUG_MODE) {
        console.log(`🔍 DEBUG: Parsed JSON-LD with ${nodes.length} nodes, types: ${nodes.map(n => n["@type"]).join(", ")}`);
      }
      for (const node of nodes) {
        // Handle Product or ItemList
        if ((node["@type"] || "").toLowerCase() === "itemlist" && Array.isArray(node.itemListElement)) {
          for (const it of node.itemListElement) {
            const p = it.item || it;
            if (p && (p["@type"] || "").toLowerCase() === "product") out.push(p);
          }
        } else if ((node["@type"] || "").toLowerCase() === "product") {
          out.push(node);
        }
      }
    } catch (e) {
      if (DEBUG_MODE) {
        console.log(`🔍 DEBUG: Failed to parse JSON-LD: ${e.message}`);
      }
    }
  });

  // Map to flat products
  const flat = [];
  console.log(`🔍 Found ${out.length} JSON-LD product structures`);
  for (const p of out) {
    const name = p.name || p.title || "";
    const brand = (typeof p.brand === "string" ? p.brand : p.brand?.name) || "";
    const url = normUrl(p.url || p["@id"] || base) || base;
    const image = Array.isArray(p.image) ? p.image[0] : p.image || "";
    // Offers could be object or array
    const offers = Array.isArray(p.offers) ? p.offers : (p.offers ? [p.offers] : []);
    if (offers.length === 0) {
      flat.push({ name, brand, url, image, currency: "", listPrice: null, salePrice: null, availability: "", from: "jsonld" });
      continue;
    }
    for (const o of offers) {
      const currency = o.priceCurrency || o.priceSpecification?.priceCurrency || "";
      const listPrice = Number(o.priceSpecification?.price || o.highPrice || o.price || NaN);
      // Try to read sale through priceValidUntil or priceSpecification (not always present)
      const salePrice = Number(o.lowPrice || o.salePrice || o.price || NaN);
      const availability = o.availability || "";
      flat.push({ name, brand, url, image, currency, listPrice: isFinite(listPrice)?listPrice:null, salePrice: isFinite(salePrice)?salePrice:null, availability, from: "jsonld" });
    }
  }
  console.log(`📦 Extracted ${flat.length} products from JSON-LD`);
  return flat;
}

// Dumb fallback scraping for common price/selectors (best effort; still no API keys)
function heuristicExtract(html, base) {
  const $ = cheerio.load(html);
  const items = [];
  
  // Look for common e-commerce selectors first
  const commonSelectors = [
    ".product", ".product-item", ".product-card", ".item", ".product-tile",
    "[data-product]", "[data-item]", ".grid-item", ".product-grid-item"
  ];
  
  let candidates = $();
  for (const selector of commonSelectors) {
    const found = $(selector);
    if (found.length > 0) {
      candidates = candidates.add(found);
      if (DEBUG_MODE) {
        console.log(`🔍 DEBUG: Found ${found.length} elements with selector "${selector}"`);
      }
    }
  }
  
  // Fallback to text-based search if no common selectors found
  if (candidates.length === 0) {
    candidates = $("a,article,li,div").filter((_, el) => {
      const t = $(el).text().toLowerCase();
      return t.includes("% off") || t.includes("sale") || t.includes("clearance") || t.includes("was") || t.includes("reg.") || t.includes("compare at");
    });
    if (DEBUG_MODE && candidates.length > 0) {
      console.log(`🔍 DEBUG: Using text-based fallback, found ${candidates.length} elements`);
    }
  }
  
  candidates = candidates.slice(0, 400);
  console.log(`🔍 Found ${candidates.length} potential product elements via heuristic`);

  candidates.each((i, el) => {
    const $el = $(el);
    
    // Try multiple selectors for URL first
    let url = $el.find("a").first().attr("href") || $el.attr("href") || "";
    try { 
      url = new URL(url, base).toString(); 
    } catch {
      url = "";
    }
    
    // Try multiple selectors for name - Shopify specific
    const nameSelectors = [
      "h3", "h2", ".product-title", ".title", ".product-name", "[data-title]", ".card-title",
      ".product-item__title", ".product-card__title", "a[href*='/products/']"
    ];
    let name = "";
    for (const sel of nameSelectors) {
      const found = $el.find(sel).first();
      name = found.text().trim() || found.attr("title") || found.attr("data-title") || "";
      if (name) break;
    }
    // Try extracting from URL as fallback
    if (!name && url) {
      const urlMatch = url.match(/\/products\/([^\/\?]+)/);
      if (urlMatch) {
        name = urlMatch[1].replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase());
      }
    }
    
    // Shopify-specific price parsing
    let salePrice = null;
    let listPrice = null;
    let priceTxt = "";
    let wasTxt = "";
    
    // Get all price text from the element
    const allPriceText = $el.find(".price, .product-price, .money, [class*='price']").text();
    priceTxt = allPriceText;
    
    if (allPriceText) {
      // Extract all dollar amounts from the text
      const priceMatches = allPriceText.match(/\$[\d,]+\.?\d*/g) || [];
      
      if (priceMatches.length >= 2) {
        // Multiple prices found - likely sale price and regular price
        const prices = priceMatches.map(p => parseFloat(p.replace(/[\$,]/g, '')));
        salePrice = Math.min(...prices); // Sale price is typically the lowest
        listPrice = Math.max(...prices);  // Regular price is typically the highest
      } else if (priceMatches.length === 1) {
        // Single price - might be sale price or regular price
        const price = parseFloat(priceMatches[0].replace(/[\$,]/g, ''));
        // Check if there's a sale indicator
        if (allPriceText.toLowerCase().includes('sale') || $el.find('.product-label--on-sale, [class*="sale"]').length > 0) {
          salePrice = price;
        } else {
          listPrice = price;
        }
      }
    }
    
    // Fallback to individual selectors if needed
    if (!salePrice && !listPrice) {
      const priceSelectors = [".price", ".sale", ".discount", ".now", ".current-price", "[data-price]", ".money"];
      const wasSelectors = [".was", ".compare-at", ".list-price", ".original-price", ".compare-price"];
      
      for (const sel of priceSelectors) {
        priceTxt = $el.find(sel).first().text().trim();
        if (priceTxt) break;
      }
      
      for (const sel of wasSelectors) {
        wasTxt = $el.find(sel).first().text().trim();
        if (wasTxt) break;
      }
      
      const priceNums = (s) => {
        const match = (s || "").match(/\$?[\d,]+\.?\d*/);
        return match ? parseFloat(match[0].replace(/[\$,]/g, '')) : NaN;
      };
      
      if (!salePrice) salePrice = priceNums(priceTxt);
      if (!listPrice) listPrice = priceNums(wasTxt);
    }
    
    // Clean up NaN values
    salePrice = isFinite(salePrice) ? salePrice : null;
    listPrice = isFinite(listPrice) ? listPrice : null;
    
    // Debug: Show what we found for first few items
    if (DEBUG_MODE && i < 3) {
      console.log(`🔍 DEBUG: Product ${i+1}: name="${name}" url="${url}" price="${priceTxt}" was="${wasTxt}" salePrice=${salePrice} listPrice=${listPrice}`);
      if (!name || !url) {
        console.log(`🔍 DEBUG: Element HTML sample: ${$el.html().substring(0, 200)}...`);
      }
    }
    
    if (name && url && (salePrice || listPrice)) {
      items.push({
        name, brand: "", url, image: $el.find("img").attr("src") || "",
        currency: "USD", listPrice, salePrice, availability: "", from: "heuristic"
      });
    }
  });
  console.log(`📦 Extracted ${items.length} products from heuristic`);
  return items;
}

function uniqBy(arr, keyFn) {
  const seen = new Set(); const out = [];
  for (const x of arr) {
    const k = keyFn(x);
    if (!seen.has(k)) { seen.add(k); out.push(x); }
  }
  return out;
}

async function crawlList(url, seenPages = new Set()) {
  console.log(`🕷️  Crawling list starting from: ${url}`);
  const results = [];
  let nexts = [url];
  while (nexts.length && seenPages.size < MAX_PAGES_PER_DOMAIN) {
    const cur = nexts.shift();
    if (!cur || seenPages.has(cur)) continue;
    seenPages.add(cur);
    console.log(`📄 Page ${seenPages.size}/${MAX_PAGES_PER_DOMAIN}: ${cur}`);

    let html;
    try {
      html = await fetchText(cur);
    } catch { continue; }

    results.push(...parseJsonLdProducts(html, cur));
    // Fallback
    if (results.length < 10) results.push(...heuristicExtract(html, cur));

    // discover pagination
    const $ = cheerio.load(html);
    const candidates = new Set([
      $('link[rel="next"]').attr("href"),
      ...$("a").map((_, a) => $(a).attr("href")).get().filter(Boolean)
    ]);
    for (const href of candidates) {
      try {
        const absolute = new URL(href, cur).toString();
        // simple “page=” or "/page/" style
        if (absolute.includes("page=") || /\/page\/\d+/.test(absolute) || absolute !== cur) {
          const u = new URL(absolute);
          if (u.hostname === new URL(url).hostname) nexts.push(absolute);
        }
      } catch {}
    }
    // polite pause
    await wait(400);
  }
  return results;
}

async function trySitemaps(base) {
  console.log(`🗺️  Checking sitemaps for ${base}`);
  // Try common sitemap locations for extra coverage
  const roots = [
    "/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml", "/siteindex.xml", "/robot.txt" // last one is purposeful typo guard
  ];
  const out = [];
  for (const r of roots) {
    const probe = new URL(r, base).toString().replace("/robot.txt", "/robots.txt");
    try {
      const xml = await fetchText(probe);
      if (!xml.trim().startsWith("<")) continue;
      const parser = new XMLParser({ ignoreAttributes: false });
      const doc = parser.parse(xml);
      const urls = [];
      if (doc.urlset?.url) {
        for (const u of [].concat(doc.urlset.url)) urls.push(u.loc);
      } else if (doc.sitemapindex?.sitemap) {
        for (const s of [].concat(doc.sitemapindex.sitemap)) urls.push(s.loc);
      }
      const productLike = urls.filter(u =>
        /product|prod|item|shop|sku|outlet|clear|sale/i.test(u || "")
      ).slice(0, 200);
      for (const u of productLike) out.push({ url: u });
    } catch {}
  }
  return out;
}

function toCSV(rows) {
  return Papa.unparse(rows, { quotes: true });
}

// New sitemap helpers
const xmlParser = new XMLParser({ ignoreAttributes: false });

function unique(arr) { 
  return Array.from(new Set(arr)); 
}

function extractLinksFromHtmlSitemap(html, base) {
  console.log(`🔗 Extracting links from HTML sitemap at ${base}`);
  const $ = cheerio.load(html);
  const links = $("a[href]").map((_, a) => {
    try { 
      return new URL($(a).attr("href"), base).toString(); 
    } catch { 
      return null; 
    }
  }).get().filter(Boolean);
  const filtered = unique(links).filter(u => /product|prod|item|sku|shop|sale|clear|outlet/i.test(u));
  console.log(`🔗 Found ${filtered.length} product links from HTML sitemap`);
  return filtered;
}

function extractUrlsFromXml(xml) {
  console.log(`📋 Parsing XML sitemap data`);
  let doc; 
  try { 
    doc = xmlParser.parse(xml); 
  } catch { 
    console.log(`❌ Failed to parse XML sitemap`);
    return []; 
  }
  const urls = [];
  if (doc.urlset?.url) { 
    for (const u of [].concat(doc.urlset.url)) urls.push(u.loc); 
  } else if (doc.sitemapindex?.sitemap) { 
    for (const s of [].concat(doc.sitemapindex.sitemap)) urls.push(s.loc); 
  }
  const filtered = urls.filter(Boolean);
  console.log(`📋 Extracted ${filtered.length} URLs from XML sitemap`);
  return filtered;
}

async function gatherProductPagesFromSitemap(smapUrl) {
  console.log(`🗺️  Gathering product pages from sitemap: ${smapUrl}`);
  let txt; 
  try { 
    txt = await fetchText(smapUrl); 
  } catch { 
    console.log(`❌ Failed to fetch sitemap: ${smapUrl}`);
    return []; 
  }
  const isXml = txt.trim().startsWith("<");
  console.log(`📄 Sitemap type: ${isXml ? 'XML' : 'HTML'}`);
  
  if (!isXml) return extractLinksFromHtmlSitemap(txt, smapUrl);
  
  const firstLevel = extractUrlsFromXml(txt);
  const leaves = [];
  const limit = pLimit(CONCURRENCY);
  console.log(`🔄 Processing ${Math.min(firstLevel.length, 200)} sitemap URLs concurrently`);
  
  const tasks = firstLevel.slice(0, 200).map(u => limit(async () => {
    let t; 
    try { 
      t = await fetchText(u); 
    } catch { 
      return; 
    }
    if (t.trim().startsWith("<")) { 
      const inner = extractUrlsFromXml(t); 
      for (const x of inner) leaves.push(x); 
    }
  }));
  await Promise.all(tasks);
  
  const all = leaves.length ? leaves : firstLevel;
  const filtered = unique(all).filter(u => /product|prod|item|sku|shop|sale|clear|outlet/i.test(u));
  console.log(`🎯 Found ${filtered.length} product page URLs from sitemap`);
  return filtered;
}

async function fetchProductsFromUrls(urls) {
  console.log(`📦 Fetching products from ${Math.min(urls.length, MAX_SITEMAP_URLS_PER_DOMAIN)} URLs`);
  const limit = pLimit(CONCURRENCY);
  const tasks = urls.slice(0, MAX_SITEMAP_URLS_PER_DOMAIN).map(u => limit(async () => {
    try { 
      const html = await fetchText(u); 
      const j = parseJsonLdProducts(html, u); 
      if (j.length) return j; 
      return heuristicExtract(html, u);
    } catch { 
      return []; 
    }
  }));
  const results = (await Promise.all(tasks)).flat();
  console.log(`📦 Extracted ${results.length} products from sitemap URLs`);
  return results;
}

(async function main() {
  const seeds = (await readFile("./seeds.txt", "utf8")).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  console.log(`📋 Found ${seeds.length} seed URLs to crawl`);
  
  let sitemaps = [];
  try {
    sitemaps = (await readFile("./sitemaps.txt", "utf8")).split(/\r?\n/).map(s => s.trim()).filter(l => l && !l.startsWith("#"));
    console.log(`📋 Found ${sitemaps.length} sitemap URLs to process`);
  } catch {
    console.log(`⚠️  No sitemaps.txt file found, skipping sitemap processing`);
  }
  
  const all = [];
  
  // Process seed URLs
  console.log(`\n🌱 Processing seed URLs...`);
  const seedsToProcess = TEST_MODE ? seeds.slice(0, 1) : seeds;
  if (TEST_MODE) {
    console.log(`🧪 TEST MODE: Only processing first seed for debugging`);
  }
  
  for (let i = 0; i < seedsToProcess.length; i++) {
    const seed = seedsToProcess[i];
    console.log(`\n🌱 Processing seed ${i+1}/${seedsToProcess.length}: ${seed}`);
    const seen = new Set();
    const batch = await crawlList(seed, seen);
    console.log(`   ➜ Found ${batch.length} products from seed crawl`);
    all.push(...batch);
  }

  // Skip sitemap processing - we only need deals from listing pages
  console.log(`\n🗺️  Skipping sitemap processing (only processing seed listing pages)`);
  
  // Uncomment below if you want to enable individual product page scraping from sitemaps:
  /*
  if (!TEST_MODE) {
    console.log(`\n🗺️  Processing sitemaps...`);
    const byDomain = new Map();
    for (const url of sitemaps) {
      try {
        const d = new URL(url).origin;
        if (!byDomain.has(d)) byDomain.set(d, []);
        byDomain.get(d).push(url);
      } catch {
        console.log(`❌ Invalid sitemap URL: ${url}`);
      }
    }
    
    console.log(`🏢 Processing ${byDomain.size} domains with sitemaps`);
    let domainIndex = 0;
    for (const [domain, list] of byDomain.entries()) {
      domainIndex++;
      console.log(`\n🏢 Domain ${domainIndex}/${byDomain.size}: ${domain} (${list.length} sitemaps)`);
      
      const limit = pLimit(2);
      const productPagesSets = await Promise.all(list.map(u => limit(() => gatherProductPagesFromSitemap(u))));
      const productPages = unique(productPagesSets.flat());
      console.log(`   🎯 Total unique product pages found: ${productPages.length}`);
      
      const picked = productPages.slice(0, MAX_SITEMAP_URLS_PER_DOMAIN);
      console.log(`   📦 Processing first ${picked.length} URLs (max: ${MAX_SITEMAP_URLS_PER_DOMAIN})`);
      
      const prods = await fetchProductsFromUrls(picked);
      console.log(`   ➜ Found ${prods.length} products from sitemap pages`);
      all.push(...prods);
    }
  }
  */

  console.log(`\n📊 Processing ${all.length} total products found...`);

  // Normalize + filter (with verbose logging preserved)
  const mapped = all.map(p => {
    const list = p.listPrice ?? null;
    const sale = p.salePrice ?? null;
    const off = pctOff(list, sale);
    let merchant = "";
    try {
      merchant = new URL(p.url).hostname.replace(/^www\./, "");
    } catch {}
    return {
      merchant,
      name: (p.name || "").trim(),
      brand: (p.brand || "").trim(),
      url: p.url || "",
      image: p.image || "",
      currency: p.currency || "",
      list_price: list,
      sale_price: sale,
      discount_pct: Number(off.toFixed(4)),
      availability: p.availability || "",
      source: p.from || "unknown"
    };
  });

  const dedup = uniqBy(mapped, x => `${x.merchant}|${x.name}|${x.url}`);
  console.log(`📝 After deduplication: ${dedup.length} unique products`);
  
  // Filter for deals only
  const filtered = dedup.filter(x => x.discount_pct >= MIN_DISCOUNT && x.name && x.url);
  
  // Also filter all products that have names and URLs (but no discount requirement)
  const allValidProducts = dedup.filter(x => x.name && x.url);

  await fs.mkdir("./out", { recursive: true });
  
  // Save both files
  await fs.writeFile("./out/deals.csv", toCSV(filtered), "utf8");
  await fs.writeFile("./out/all_products.csv", toCSV(allValidProducts), "utf8");

  console.log(`\n✅ Results saved:`);
  console.log(`   📈 ./out/deals.csv: ${filtered.length} deals (>= ${MIN_DISCOUNT*100}% off)`);
  console.log(`   📋 ./out/all_products.csv: ${allValidProducts.length} total products`);
  
  // Show some sample products for debugging
  if (allValidProducts.length > 0) {
    console.log(`\n🔍 Sample products found:`);
    allValidProducts.slice(0, 3).forEach((p, i) => {
      console.log(`   ${i+1}. ${p.name} - $${p.sale_price || p.list_price || 'N/A'} (${p.discount_pct > 0 ? `${(p.discount_pct*100).toFixed(1)}% off` : 'no discount'}) from ${p.merchant}`);
    });
  }
  
  console.log(`\n🏁 Scraping completed!`);
  process.exit(0);
})();
