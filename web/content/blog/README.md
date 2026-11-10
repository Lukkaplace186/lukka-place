# Blog articles (source files)

One `.md` file per post, written with Claude and loaded into `/admin/blog` as a
draft by `npm run blog:import -- content/blog/<slug>.md [--write]`. The format
(header, tables, `:::chiffres`, `:::graphique`, `:::prix`, `:::annonces`…) is
documented in `scripts/blog-import.mjs` and `lib/blogRules.js`; the writing
rules are in the user-level `lukka-blog` skill. The console stays where posts
are published; these files are the history of what was written.
