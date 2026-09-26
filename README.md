# lectual.app

The Lectual firm workspace: the attorney dashboard for boutique IP firms. It runs on the same
Supabase backend as [`theipgirl/lectual`](https://github.com/theipgirl/lectual).

- Plan: [`docs/MVP-PLAN.md`](docs/MVP-PLAN.md)
- Design: [`design/`](design/README.md)
- Guidance for contributors and agents: [`AGENTS.md`](AGENTS.md)

```bash
pnpm install
cp .env.example .env.local   # fill in from lectual-dev
pnpm dev                     # http://localhost:3000 → /dashboard (magic-link sign-in)
pnpm test && pnpm lint && pnpm build
```
