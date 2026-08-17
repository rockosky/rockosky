# Ketchup Files — Handoff Summary

Paste this whole document into a new conversation along with the files, so the next session starts with full context.

## ✅ CONFIRMED WORKING / COMPLETE

- **Login/signup** — separate step from upload, own button in 02
- **Contributor profiles** — editable name/bio/photo, public profile view (click any name), guestbook, activity heatmap
- **Privacy** — display name shown everywhere, email never shown publicly
- **Gallery visibility** — RLS policy fixed, everyone can see everyone's approved work
- **Admin dashboard** — Pending / Published / Rejected / Community tabs, RLS-aware error handling, manual Digital/Physical override selector per item
- **Live Chat + "Signed In Now"** — ONE shared room, live via Supabase Realtime, visible in: Marketplace (Interfaz Studio), Uploader (both standalone `02` and inside Interfaz Studio), and Admin (`03`, read-only view)
- **Interfaz Studio** — 37 windows, all verified decoding cleanly, no corruption. Every window titlebar has a green refresh dot (next to min/max/restore) that reloads just that window's content, confirmed wired via the same `__lazyLoaders` mechanism used by the throw-a-tomato-at-a-window feature
- **Mobile handling**: real iPhone/Android phones (detected by device, not screen width) auto-enter a restricted Mobile Mode showing ONLY Now Drop It + Upload. iPad, desktop, and laptop keep full access to everything, unaffected.

## 🔧 BUILT, NOT YET CONFIRMED LIVE

**The one real remaining blocker: Vercel deployment/connectivity for `publish-product.js`.**

This has been an extremely long-running issue across this whole build. What's confirmed:
- Code itself is correct (digital template search → patch, physical fallback, real multipart image + digital file upload to Squarespace, all products landing on `ketchupfiles.com/street-style-contributors`)
- The actual live/working Vercel project is named **`vercel`** (renamed from `rockosky`), domain **`rockosky.vercel.app`** — NOT `vercel-publish-fawn.vercel.app` (that project has "No Production Deployment," ever — a major red herring for most of this debugging)
- `PUBLISH_ENDPOINT` in both `02` and `03` already points to `https://rockosky.vercel.app/api/publish-product`
- Last action taken: replacing `SUPABASE_SERVICE_ROLE_KEY` in that project's env vars with the correct **legacy JWT-format key** (not the newer `sb_secret_...` format), since `publish-product.js` makes raw REST calls that may not accept the new key format
- **Still need to confirm**: after that key fix, does `https://rockosky.vercel.app/api/publish-product` show a small JSON message (not a 404, not a file download) when visited directly? Then does Approve & Publish actually succeed?

If still stuck: the file `api/publish-product.js` on GitHub has reverted to old content multiple times during this build — always worth a fresh Cmd+F check for `corsHeaders` and `allowPhysicalFallback` to confirm it's really the current version before debugging further.

## 📦 COMPLETE FILE PACKAGE

| File | Destination |
|---|---|
| `02-kf-upload-widget.html` | Squarespace — Upload page Code Block |
| `03-kf-admin-dashboard.html` | Squarespace — Admin page Code Block |
| `Ketchup_Files_Interfaz_Studio_v2-33.html` | Squarespace — Interfaz Studio Code Block |
| `publish-product.js` | GitHub `api/publish-product.js` (delete + recreate, not edit) |
| `fulfill-order.js`, `lsdm-feed.js` | GitHub `api/` (built, currently unused/disconnected) |
| `package.json`, `vercel.json` | GitHub repo root |
| `ketchup-files-schema-migration.sql` | Supabase SQL editor — run 1st |
| `fix-public-photo-visibility.sql` | Supabase — run 2nd |
| `community-chat.sql` | Supabase — run for Live Chat to work |
| `cleanup-unused-columns.sql` | Supabase — optional, removes unused Stripe/LSDM columns |
| `ketchup-files-full-system-check.md` | Your own step-by-step verification checklist |

## KEY FACTS FOR THE NEXT SESSION

- Supabase project: `lfbtreaojwxxwuwhssba`
- Admin email: `creators@ketchupfiles.com`
- Storage buckets: `Ketchup Files UPLOADS` (public, watermarked display copies), `Ketchup Files ORIGINALS` (private, clean files for digital delivery)
- Digital product template lives on `ketchupfiles.com/street-style-contributors`, tagged `kf-template-unused`
- Vercel project for the API: named `vercel` (was `rockosky`), domain `rockosky.vercel.app` — NOT `vercel-publish-fawn.vercel.app`
- Squarespace API constraints already discovered: can't CREATE Digital products (405), only PATCH/PUT existing ones; images/digital files need real multipart uploads, not URL references; most update endpoints want PUT not PATCH
