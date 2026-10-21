<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

- Public backend URL/publishable key fall back to literals in vite.config.ts — `.env` is gitignored (locked), so hosted builds would otherwise ship empty keys and blank the screen. The fallback is now **loud**: every build prints which project it is bound to, and `REQUIRE_SUPABASE_CONFIG=1` makes a build with no real configuration FAIL instead of quietly falling back to production.
