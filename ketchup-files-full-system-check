# Ketchup Files — Full System Check

Go through this top to bottom, in order. Each section only matters if the one above it is confirmed working.

---

## 1. SUPABASE (database + storage)

- [ ] Go to Supabase → SQL Editor → run `ketchup-files-schema-migration.sql` (the whole file, safe to re-run).
- [ ] Go to Table Editor → `photos` table → confirm columns exist: `category`, `subcategory`, `guest_name`, `designer_name`, `original_file_path`, `squarespace_product_id`, `squarespace_product_url`, `published_at`.
- [ ] Go to Storage → confirm bucket `Ketchup Files UPLOADS` exists (public).
- [ ] Go to Storage → confirm bucket `Ketchup Files ORIGINALS` exists (**private** — public toggle OFF). If it doesn't exist yet, create it now.
- [ ] Go to Settings → API → confirm you have `SUPABASE_URL` and the `service_role` (secret) key handy — you'll need both in step 3.

## 2. GITHUB (the code itself)

- [ ] Confirm your repo has these files, each with the correct extension:
  - `api/publish-product.js`
  - `api/fulfill-order.js`
  - `api/lsdm-feed.js`
  - `package.json` (at the true root, NOT inside `api/`)
  - `vercel.json` (at the true root, NOT inside `api/`)
- [ ] Open `api/publish-product.js` on GitHub and Cmd+F search for `corsHeaders` and `allowPhysicalFallback` — both should be found. If not, delete the file entirely and re-create it with the latest version.

## 3. VERCEL (this is the part that's been going wrong)

- [ ] **Click the project switcher (top-left on vercel.com) and confirm it says `vercel-publish` — not `rockosky`, not `uploads`.** This has been the #1 source of confusion — you have three separate projects.
- [ ] Inside `vercel-publish` → Settings → Environment Variables → confirm these three exist: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SQUARESPACE_API_KEY`.
- [ ] Inside `vercel-publish` → Settings → Domains → confirm `vercel-publish-fawn.vercel.app` is listed with "Valid Configuration."
- [ ] Inside `vercel-publish` → Deployments → confirm the TOP entry says "Ready" (green), and its commit message/timestamp matches your latest GitHub change.
- [ ] If the top deployment is old or doesn't match your latest commit: click the three dots on it → Redeploy → uncheck "Use existing Build Cache."
- [ ] **The real test:** visit `https://vercel-publish-fawn.vercel.app/api/publish-product` directly. A small JSON message = working. A 404 or a file download = still broken, and means something above this line isn't actually correct yet — go back and re-check steps 1-3, don't skip ahead.

## 4. SQUARESPACE (the destination)

- [ ] Confirm you have at least one product with Type = **Digital**, tagged exactly `kf-template-unused`, hidden (not visible), living on `ketchupfiles.com/street-style-contributors`.
- [ ] On that product, confirm its stock is set to unlimited (or "continue selling when out of stock" is on) — do this once by hand, the code never touches it after.

## 5. THE ACTUAL TEST

- [ ] Only after step 3's direct-URL test shows JSON (not a 404): go to `ketchupfiles.com/1989`, click Approve & Publish on a pending item.
- [ ] Read the diagnostics text that comes back — send that exact text for the next fix, whatever it says.
