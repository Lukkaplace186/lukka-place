-- Lukka Place — market data depth per commune (READ ONLY: one SELECT, writes nothing)
-- Paste into Supabase > SQL Editor and Run. One row per commune.
--
-- Columns
--   lukka_live_rent / lukka_live_sale  approved public listings (status = 1 AND approve_status = 1), test agents excluded
--   lukka_rent_guide                   of those, rents the price guide can use (monthly or yearly, unfurnished, 1–5 ch.)
--   obs_rent_guide                     market_observations rents the guide can use (same rules as web/lib/marketGuide.js:
--                                      not excluded, unfurnished home, 1–5 ch., posted in the last 365 d, seen in the last 60 d,
--                                      not a group capture already counted as a Lukka listing). Before cross-site de-duplication.
--   obs_sale_live                      sale observations, not excluded, posted in the last 365 d, seen in the last 60 d
--   obs_rows_total                     every observation row for the commune, any purpose, excluded or not
--   rent_cells_5plus                   bedroom counts (1–5) with >= 5 usable rents, Lukka + market (the guide's minimum)
--   rent_cells_list                    which bedroom counts, with their count, e.g. "2ch:14, 3ch:9"
--   snap_months_rent / _sale           months in market_snapshots_monthly with at least one active listing (commune total row)
--   snap_last_month                    latest snapshot month for the commune
--   snap_last_rent_sample / _sale      ask_sample on that latest month (listings with a price)
--   snap_closed_total                  closed (sold / let) listings recorded across all months, rent + sale
--   snap_achieved_total                of those, with a recorded achieved price
WITH lukka AS (
  SELECT (
           SELECT ac.name FROM property_amenities pa
           JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = 20
           WHERE pa.property_id = p.id AND pa.amenity_id IN (SELECT amenity_id FROM location_communes)
           LIMIT 1
         ) AS commune,
         p.purpose,
         (p.purpose = 'rent' AND p.price > 0
            AND COALESCE(p.price_period, '') NOT IN ('jour', 'semaine')
            AND COALESCE((to_jsonb(p) ->> 'furnished')::boolean, false) = false
            AND p.beds BETWEEN 1 AND 5) AS rent_guide,
         p.beds::int AS beds
    FROM properties p
   WHERE p.status = 1 AND p.approve_status = 1
     AND p.purpose IN ('rent', 'sale')
     AND NOT EXISTS (SELECT 1 FROM agents t WHERE t.id = p.agent_id
                      AND COALESCE((to_jsonb(t) ->> 'is_test')::boolean, false))
),
obs_rent AS (
  SELECT o.commune, o.beds::int AS beds
    FROM market_observations o
   WHERE o.excluded_reason IS NULL
     AND o.purpose = 'rent'
     AND o.monthly_usd > 0
     AND o.furnished IS NOT TRUE
     AND o.property_kind = ANY (ARRAY['appartement','maison','villa','studio','duplex','penthouse'])
     AND o.beds BETWEEN 1 AND 5
     AND o.commune IS NOT NULL
     AND COALESCE(o.posted_at, o.first_seen_at) >= NOW() - INTERVAL '365 days'
     AND o.last_seen_at >= NOW() - INTERVAL '60 days'
     AND NOT EXISTS (
       SELECT 1 FROM properties lp
        WHERE lp.id = o.property_id
          AND ((lp.status = 1 AND lp.approve_status = 1)
               OR lp.approve_status = 2
               OR (to_jsonb(lp) ->> 'deleted_at') IS NOT NULL))
),
obs_counts AS (
  SELECT commune,
         COUNT(*) FILTER (WHERE excluded_reason IS NULL AND purpose = 'sale' AND price_usd > 0
                            AND COALESCE(posted_at, first_seen_at) >= NOW() - INTERVAL '365 days'
                            AND last_seen_at >= NOW() - INTERVAL '60 days')::int AS obs_sale_live,
         COUNT(*)::int AS obs_rows_total
    FROM market_observations
   WHERE commune IS NOT NULL
   GROUP BY commune
),
rent_cells AS (
  SELECT commune, beds, COUNT(*)::int AS n
    FROM (SELECT commune, beds FROM lukka WHERE rent_guide
          UNION ALL
          SELECT commune, beds FROM obs_rent) x
   WHERE commune IS NOT NULL
   GROUP BY commune, beds
),
snap AS (
  SELECT commune,
         COUNT(DISTINCT month) FILTER (WHERE purpose = 'rent' AND active_count > 0)::int AS snap_months_rent,
         COUNT(DISTINCT month) FILTER (WHERE purpose = 'sale' AND active_count > 0)::int AS snap_months_sale,
         MAX(month) AS snap_last_month,
         SUM(closed_count)::int AS snap_closed_total,
         SUM(achieved_sample)::int AS snap_achieved_total
    FROM market_snapshots_monthly
   WHERE category_id = -1 AND beds_bucket = 'all'
   GROUP BY commune
),
snap_last AS (
  SELECT s.commune,
         MAX(m.ask_sample) FILTER (WHERE m.purpose = 'rent') AS snap_last_rent_sample,
         MAX(m.ask_sample) FILTER (WHERE m.purpose = 'sale') AS snap_last_sale_sample
    FROM snap s
    JOIN market_snapshots_monthly m
      ON m.commune = s.commune AND m.month = s.snap_last_month
     AND m.category_id = -1 AND m.beds_bucket = 'all'
   GROUP BY s.commune
),
communes AS (
  SELECT commune FROM lukka WHERE commune IS NOT NULL
  UNION SELECT commune FROM obs_counts
  UNION SELECT commune FROM snap
)
SELECT c.commune,
       COUNT(l.*) FILTER (WHERE l.purpose = 'rent')::int AS lukka_live_rent,
       COUNT(l.*) FILTER (WHERE l.purpose = 'sale')::int AS lukka_live_sale,
       COUNT(l.*) FILTER (WHERE l.rent_guide)::int       AS lukka_rent_guide,
       (SELECT COUNT(*) FROM obs_rent r WHERE r.commune = c.commune)::int AS obs_rent_guide,
       COALESCE(MAX(oc.obs_sale_live), 0)  AS obs_sale_live,
       COALESCE(MAX(oc.obs_rows_total), 0) AS obs_rows_total,
       (SELECT COUNT(*) FROM rent_cells rc WHERE rc.commune = c.commune AND rc.n >= 5)::int AS rent_cells_5plus,
       (SELECT string_agg(rc.beds || 'ch:' || rc.n, ', ' ORDER BY rc.beds)
          FROM rent_cells rc WHERE rc.commune = c.commune) AS rent_cells_list,
       COALESCE(MAX(s.snap_months_rent), 0) AS snap_months_rent,
       COALESCE(MAX(s.snap_months_sale), 0) AS snap_months_sale,
       MAX(s.snap_last_month)               AS snap_last_month,
       MAX(sl.snap_last_rent_sample)        AS snap_last_rent_sample,
       MAX(sl.snap_last_sale_sample)        AS snap_last_sale_sample,
       COALESCE(MAX(s.snap_closed_total), 0)   AS snap_closed_total,
       COALESCE(MAX(s.snap_achieved_total), 0) AS snap_achieved_total
  FROM communes c
  LEFT JOIN lukka l       ON l.commune = c.commune
  LEFT JOIN obs_counts oc ON oc.commune = c.commune
  LEFT JOIN snap s        ON s.commune = c.commune
  LEFT JOIN snap_last sl  ON sl.commune = c.commune
 GROUP BY c.commune
 ORDER BY (COUNT(l.*) FILTER (WHERE l.rent_guide)
           + (SELECT COUNT(*) FROM obs_rent r WHERE r.commune = c.commune)) DESC, c.commune;
