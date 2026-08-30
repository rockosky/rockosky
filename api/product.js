

import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const supabase = createClient(
  process.env.SUPBASE_URL,
  process.env.SUPBASE_SERVICE_ROLE_KEY
);

const SQUARESPACE_API = 'https://api.squarespace.com/1.0/commerce/products';
const SQUARESPACE_TOKEN = process.env.SQUARESPACE_API_KEY;

const PRIVATE_BUCKET = 'kf-originals-private';
const PUBLIC_BUCKET = 'kf-public';

// ---- category resolution -------------------------------------------------

function slugifyCity(city) {
  return city.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function buildCategory({ city, season }) {
  const citySlug = slugifyCity(city);
  const seasonSlug = season.trim().toLowerCase().replace(/\s+/g, '-');
  const slug = `${citySlug}-fashion-week-${seasonSlug}-street-style`;
  const cityTitle = city.trim().replace(/\b\w/g, (c) => c.toUpperCase());
  const display_name = `${cityTitle} Fashion Week ${season.toUpperCase()} Street Style`;
  return { slug, display_name, cityTitle };
}

async function resolveOrCreateCategory({ city, season }) {
  const { slug, display_name, cityTitle } = buildCategory({ city, season });

  const { data: existing } = await supabase
    .from('categories')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (existing) return existing;

  const store_page_url = `https://www.ketchupfiles.com/${slug}`;

  const { data: created, error } = await supabase
    .from('categories')
    .insert({
      slug,
      display_name,
      city: cityTitle,
      season: season.toUpperCase(),
      store_page_url,
      squarespace_category_name: display_name,
    })
    .select()
    .single();

  if (error) throw error;
  return created;
}

// ---- watermarking ----------------------------------------------------

async function makeWatermarkedAndThumb(originalBuffer) {
  const watermarkSvg = Buffer.from(`
    <svg width="800" height="800">
      <style>.wm { fill: rgba(255,255,255,0.55); font-size: 28px; font-family: sans-serif; }</style>
      <text x="50%" y="95%" text-anchor="middle" class="wm">KETCHUP FILES</text>
    </svg>
  `);

  const base = sharp(originalBuffer).resize(2000, null, { withoutEnlargement: true });

  const watermarked = await base
    .clone()
    .composite([{ input: watermarkSvg, gravity: 'south', tile: true, blend: 'over' }])
    .jpeg({ quality: 85 })
    .toBuffer();

  const thumbnail = await sharp(watermarked).resize(600, null).jpeg({ quality: 80 }).toBuffer();

  return { watermarked, thumbnail };
}

// ---- main handler -------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { photoId } = req.body;
    const { data: photo, error: photoErr } = await supabase
      .from('photos')
      .select('*')
      .eq('id', photoId)
      .single();
    if (photoErr || !photo) throw photoErr || new Error('photo not found');

    // 1. category (create the row if this city/season hasn't shown up before)
    const category = await resolveOrCreateCategory({
      city: photo.city,
      season: photo.season,
    });

    // 2. build watermark + thumb from the private original
    const { data: originalFile, error: dlErr } = await supabase.storage
      .from(PRIVATE_BUCKET)
      .download(photo.original_storage_path);
    if (dlErr) throw dlErr;
    const originalBuffer = Buffer.from(await originalFile.arrayBuffer());

    const { watermarked, thumbnail } = await makeWatermarkedAndThumb(originalBuffer);

    const watermarkPath = `${photo.id}/watermark.jpg`;
    const thumbPath = `${photo.id}/thumb.jpg`;

    await supabase.storage.from(PUBLIC_BUCKET).upload(watermarkPath, watermarked, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    await supabase.storage.from(PUBLIC_BUCKET).upload(thumbPath, thumbnail, {
      contentType: 'image/jpeg',
      upsert: true,
    });

    const { data: pub } = supabase.storage.from(PUBLIC_BUCKET).getPublicUrl(watermarkPath);
    const watermarkUrl = pub.publicUrl;

    // 3. Squarespace product (PHYSICAL, per existing platform constraint —
    //    DIGITAL returns 405, see /areas/ketchup-files-platform.md)
    const ssRes = await fetch(SQUARESPACE_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SQUARESPACE_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'KetchupFiles/1.0',
      },
      body: JSON.stringify({
        type: 'PHYSICAL',
        name: `${photo.title} (Digital Download)`,
        description: photo.description || '',
        categories: [category.squarespace_category_name],
        images: [{ url: watermarkUrl }],
        variants: [
          {
            sku: `KF-${photo.id.slice(0, 8)}`,
            price: { currency: 'USD', value: String(photo.price) },
            stock: { unlimited: false, quantity: 10 },
          },
        ],
      }),
    });

    if (!ssRes.ok) {
      const text = await ssRes.text();
      throw new Error(`Squarespace product create failed: ${ssRes.status} ${text}`);
    }
    const ssProduct = await ssRes.json();

    // 4. write everything back
    await supabase
      .from('photos')
      .update({
        watermark_storage_path: watermarkPath,
        thumbnail_storage_path: thumbPath,
        category_slug: category.slug,
        squarespace_product_id: ssProduct.id,
        squarespace_product_url: `https://ketchupfiles.squarespace.com/config/commerce/products/physical/${ssProduct.id}`,
      })
      .eq('id', photo.id);

    return res.status(200).json({
      ok: true,
      category,
      squarespace_product_id: ssProduct.id,
      squarespace_admin_url: `https://ketchupfiles.squarespace.com/config/commerce/products/physical/${ssProduct.id}`,
      store_page_url: category.store_page_url,
      store_page_created: category.store_page_created,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
