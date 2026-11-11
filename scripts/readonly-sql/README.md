# Read-only diagnostic queries

Each file is a single SELECT: paste it into Supabase > SQL Editor and Run. Nothing is written.

- `market-depth-per-commune.sql` — per commune: approved public listings (rent/sale, test agents excluded),
  `market_observations` the price guide can use (same filters as `web/lib/marketGuide.js`), bedroom cells
  reaching the guide's 5-price minimum, and `market_snapshots_monthly` history. Used to decide which communes
  have enough data for a data-backed blog post.
- `blog-status.sql` — whether `blog_posts` exists, the `publicBlog` switch in `cms_settings` (`site.features`),
  post counts, and how fresh the market data is. Safe before the blog migration has run.

If a filter in `web/lib/marketGuide.js` or `web/lib/marketObservationRules.js` changes, update
`market-depth-per-commune.sql` to match.
