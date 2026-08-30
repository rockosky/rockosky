// api/system-monitor.js
//
// Full-pipeline health check for Ketchup Files.
// Visit this endpoint any time (GET) to get a JSON snapshot of:
//   - Supabase: reachability + row counts on key tables (a failed/slow
//     query here is often the first symptom of hitting usage limits)
//   - Vercel: status of the latest production deployment
//   - GitHub: status of the fix/publish-upload-and-rls branch/PR
//   - Squarespace product pool: how many products are claimed vs.
//     available, so you can see at a glance if the pool is running dry
//
// Drop this in /api/system-monitor.js in the same Vercel project as
// your other functions (rockosky/api). It reuses env vars already in
// your project where possible and falls back across the different
// naming variants I saw in your Environment Variables screenshot.
//
// ADDITIONAL ENV VARS NEEDED (add these in Vercel):
//   VERCEL_MONITOR_TOKEN   - a Vercel API token (https://vercel.com/account/tokens)
//   VERCEL_PROJECT_ID      - the project ID for this Vercel project
//   GITHUB_TOKEN           - a GitHub personal access token (repo read scope)
//   GITHUB_OWNER           - e.g. "rockosky"
//   GITHUB_REPO            - e.g. "api"  (adjust if the repo name differs)
//
// Everything else (Supabase URL/key) is auto-detected from whichever
// of your existing env var names is present.

export default async function handler(req, res) {
  const startedAt = Date.now();
  const results = {
    checked_at: new Date().toISOString(),
    overall: "unknown",
    supabase: null,
    vercel: null,
    github: null,
    squarespace_pool: null,
  };

  const [supabase, vercel, github, pool] = await Promise.all([
    checkSupabase(),
    checkVercel(),
    checkGithub(),
    checkSquarespacePool(),
  ]);

  results.supabase = supabase;
  results.vercel = vercel;
  results.github = github;
  results.squarespace_pool = pool;

  const allOk = [supabase, vercel, github, pool].every(
    (r) => r.status === "ok" || r.status === "skipped"
  );
  const anyError = [supabase, vercel, github, pool].some(
    (r) => r.status === "error"
  );

  results.overall = anyError ? "degraded" : allOk ? "healthy" : "unknown";
  results.duration_ms = Date.now() - startedAt;

  res.status(200).json(results);
}

// ---------- Supabase ----------

function getSupabaseCreds() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPBASE_URL; // legacy typo'd name, kept as last-resort fallback

  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPBASE_SERVICE_ROLE_KEY; // legacy typo'd name

  return { url, key };
}

async function checkSupabase() {
  const { url, key } = getSupabaseCreds();
  if (!url || !key) {
    return {
      status: "error",
      message: "Missing Supabase URL or service role key in env vars.",
    };
  }

  const tables = [
    "photos",
    "creator_profiles",
    "order_deliveries",
    "order_fulfillments",
    "community_messages",
  ];

  const tableResults = {};
  let hadError = false;
  let hadUsageLimitSignal = false;

  for (const table of tables) {
    try {
      const start = Date.now();
      const resp = await fetch(
        `${url}/rest/v1/${table}?select=id&limit=1`,
        {
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            Prefer: "count=exact",
          },
        }
      );
      const ms = Date.now() - start;
      const countHeader = resp.headers.get("content-range"); // e.g. "0-0/123"
      const count = countHeader ? countHeader.split("/")[1] : null;

      if (!resp.ok) {
        hadError = true;
        if (resp.status === 429 || resp.status >= 500) {
          hadUsageLimitSignal = true;
        }
        tableResults[table] = {
          ok: false,
          http_status: resp.status,
          response_ms: ms,
        };
      } else {
        tableResults[table] = { ok: true, row_count: count, response_ms: ms };
      }
    } catch (err) {
      hadError = true;
      tableResults[table] = { ok: false, error: String(err) };
    }
  }

  return {
    status: hadError ? "error" : "ok",
    possible_usage_limit_issue: hadUsageLimitSignal,
    tables: tableResults,
  };
}

// ---------- Vercel ----------

async function checkVercel() {
  const token = process.env.VERCEL_MONITOR_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;

  if (!token || !projectId) {
    return {
      status: "skipped",
      message:
        "Set VERCEL_MONITOR_TOKEN and VERCEL_PROJECT_ID to enable this check.",
    };
  }

  try {
    const resp = await fetch(
      `https://api.vercel.com/v6/deployments?projectId=${projectId}&limit=1&target=production`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!resp.ok) {
      return { status: "error", http_status: resp.status };
    }

    const data = await resp.json();
    const latest = data.deployments && data.deployments[0];
    if (!latest) {
      return { status: "error", message: "No deployments found." };
    }

    return {
      status: latest.readyState === "READY" ? "ok" : "error",
      ready_state: latest.readyState,
      url: latest.url,
      created: new Date(latest.createdAt).toISOString(),
    };
  } catch (err) {
    return { status: "error", error: String(err) };
  }
}

// ---------- GitHub ----------

async function checkGithub() {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_WATCH_BRANCH || "fix/publish-upload-and-rls";

  if (!token || !owner || !repo) {
    return {
      status: "skipped",
      message: "Set GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO to enable this check.",
    };
  }

  try {
    const prResp = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls?head=${owner}:${branch}&state=open`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      }
    );

    if (!prResp.ok) {
      return { status: "error", http_status: prResp.status };
    }

    const prs = await prResp.json();
    if (!prs.length) {
      return {
        status: "ok",
        message: `No open PR found for ${branch} (may already be merged, or branch name changed).`,
      };
    }

    const pr = prs[0];
    return {
      status: "ok",
      branch,
      pr_number: pr.number,
      pr_state: pr.state,
      mergeable: pr.mergeable,
      mergeable_state: pr.mergeable_state,
      checks_passed: pr.mergeable_state === "clean",
      url: pr.html_url,
    };
  } catch (err) {
    return { status: "error", error: String(err) };
  }
}

// ---------- Squarespace product pool ----------

async function checkSquarespacePool() {
  const { url, key } = getSupabaseCreds();
  if (!url || !key) {
    return { status: "skipped", message: "Supabase creds not available." };
  }

  try {
    const [totalResp, claimedResp] = await Promise.all([
      fetch(`${url}/rest/v1/squarespace_product_pool?select=squarespace_product_id`, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Prefer: "count=exact",
          Range: "0-0",
        },
      }),
      fetch(
        `${url}/rest/v1/squarespace_product_pool?select=squarespace_product_id&claimed_by_photo_id=not.is.null`,
        {
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            Prefer: "count=exact",
            Range: "0-0",
          },
        }
      ),
    ]);

    if (!totalResp.ok || !claimedResp.ok) {
      return {
        status: "error",
        http_status: [totalResp.status, claimedResp.status],
      };
    }

    const total = parseInt(
      (totalResp.headers.get("content-range") || "0/0").split("/")[1] || "0",
      10
    );
    const claimed = parseInt(
      (claimedResp.headers.get("content-range") || "0/0").split("/")[1] || "0",
      10
    );
    const available = total - claimed;

    return {
      status: "ok",
      total_products_in_pool: total,
      claimed,
      available,
      low_pool_warning: available <= 2,
    };
  } catch (err) {
    return { status: "error", error: String(err) };
  }
}
