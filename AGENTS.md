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

## Repository Standards & Agent Conventions

### 1. Architectural Patterns

- **Framework**: TanStack Start (SSR) with React 19, Vite, and Tailwind CSS v4.
- **Routing**: File-based routing in `src/routes/` with `src/routes/__root.tsx` as root layout.
- **Database & RLS**: All queries against Supabase use strict Row Level Security. Sensitive data operations are encapsulated in `private.*` schema helpers or Deno Edge Functions in `supabase/functions/`.

### 2. UI/UX Principles (Zero AI Slop)

- **Heritage Aesthetic**: Linen background (`#FBF9F5`), Midnight ink (`#0F172A`), Forest green (`#14281D`), Muted brass (`#B89563`).
- **Eliminate Clutter**:
  - No decorative gradients, glassmorphism, floating blobs, or cheesy clip-art.
  - Zero decorative `<Sparkles />` icons.
  - Action-oriented button labels; eliminate redundant helper text and secondary labels when layout conveys meaning.
  - Progressive disclosure on dense filter bars (`members.tsx`) and unified action toolbars (`members.$id.tsx`).

### 3. Workflow & Quality Gates

Follow the 5-phase workflow (**Inspect → Plan → Implement → Verify → Report**) for every change. Before declaring a task complete, verify all 4 quality gates:

1. `npm run typecheck` (`tsc --noEmit`)
2. `npm run lint` (`eslint .`)
3. `npm run test` (`vitest run`)
4. `npm run build` (`vite build`)
   Do not make assumptions; report actual verification command outputs.
