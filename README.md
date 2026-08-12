# Ketchup Files — Contributor Pipeline — Master Guide (Updated)

Complete current state of everything built. Run the SQL in order — later
numbers assume earlier ones already ran. All are safe to re-run if unsure.

## 1. Database (Supabase SQL Editor, in this exact order)

| # | File | What it does |
|---|---|---|
| 01 | `01-supabase-policies.sql` | Creates `photos` table + core security rules |
| 04 | `04-add-product-fields.sql` | Adds title/description/price/city/season/product fields |
| 06 | `06-add-social-fields.sql` | Adds hashtags, social link, photographer name |
| 08 | `08-fix-public-visibility.sql` | Fixes public read access for published photos |
| 09 | `09-payout-ledger.sql` | Creates `creator_profiles` + `payout_ledger` (Stripe payouts — built, currently hidden from UI) |
| 10 | `10-allow-contributor-edits.sql` | Lets contributors edit their own uploads |
| 11 | `11-fix-live-photos-table.sql` | Consolidated repair — missing columns + all policies re-applied |
| 12 | `12-contributor-location-and-contract.sql` | Location, equipment fields, contract agreement |
| 14 | `14-media-type-support.sql` | Adds video/audio support (`media_type`) |
| 15 | `15-fix-admin-visibility.sql` | Diagnostic + fix for admin not seeing pending uploads |
| 16 | `16-categories-and-profile-photo.sql` | Upload categories + profile photo support |
| 18 | `18-drop-category-constraint.sql` | Removes overly strict category validation |
| 19 | `19-fix-status-default.sql` | Diagnostic + fix so new uploads default to `pending` |
| 20 | `20-rejection-reason.sql` | Lets admin explain why a photo was rejected |
| 21 | `21-stripe-checkout-fields.sql` | Adds Stripe product/checkout fields |
| 22 | `22-display-name-and-bio.sql` | Contributor display name + bio |

**Skip `17-fix-category-constraint.sql`** — superseded by `18` which fully removes the constraint instead.

**One-off fixes, run only if the specific issue applies:**
- `23-diagnose-missing-uploads.sql` — checks if a photo got saved under the wrong account
- `24-fix-misattributed-photos.sql` — reassigns felipe's 2 photos to his real account (already covers that specific case)

## 2. Squarespace pages (Code Blocks)

| File | Where it goes |
|---|---|
| **`02-kf-upload-widget.html`** | Your public contributor page — Gallery / Upload / Recent Uploads. **This is the real current version** (renamed from the CLEAN working copy) |
| `03-kf-admin-dashboard.html` | Your private, unlisted admin review page |
| `05-browse-archive-with-supabase.html` | Wherever your Browse Archive search widget lives |
| `13-contributor-agreement.html` | A page at `/contributor-agreement`, linked from the upload form's required checkbox |
| `07-youtube-banner.html` | Optional standalone banner (superseded by the one built into `02`) |
| `interfaz-studio-full-updated.html` | The full Interfaz Studio, if you're hosting it separately (2.2MB — Squarespace Code Block size may reject it; see earlier notes on the fallback approach) |

## 3. Vercel backend (`vercel-publish/api/`, deployed via GitHub → Vercel)

| File | What it does |
|---|---|
| `publish-product-stripe.js` | **Current publish flow** — Approve & Publish now creates a Stripe Product + Payment Link |
| `publish-product.js` | Old Squarespace-based publish (superseded, kept for reference) |
| `stripe-connect-onboard.js` | Contributor Stripe Connect onboarding (built, not wired to any UI button currently) |
| `squarespace-order-webhook.js` | Logs sales into payout ledger (unused currently) |
| `payout-contributor.js` | Sends batched Stripe payouts (unused currently) |

**Environment variables needed on Vercel:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `SITE_URL`

## What the system does, end to end

1. Someone lands on your upload page, creates an account and submits their first photo/video/audio in one step (or logs in if returning)
2. First-timers also set: location, equipment, profile photo, agree to the contributor agreement, pick a category
3. Photos get auto-cropped and watermarked with your real logo; video gets the same treatment via in-browser processing; audio uploads as-is
4. It lands on your admin page as pending, tagged with its category
5. You review, edit any field, approve (or reject with a reason the contributor will see) — approving creates a real Stripe Product + Payment Link
6. It shows up across Gallery, Browse Archive, and the contributor's own Recent Uploads
7. Contributors can edit their own submissions, change their name/bio/profile photo anytime, use the built-in Photo Editor, and share to Pinterest/LinkedIn/native share sheet

## Known open items

- **Stripe Connect payouts** — built, hidden from UI. Say the word to re-enable.
- **Who's-online / recently-approved panel** — not started
- **Installable app / PWA icon** — not started
- **"Now Drop It" full audio player** — code extracted, not yet wired in as the MP3 playback experience
- **Multi-account browser sessions** — one browser = one active session at a time (this is how Supabase auth works, not a bug); use separate browsers or Incognito windows to test multiple accounts side by side
