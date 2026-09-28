# Bambini

A South African parent-focused marketplace for buying and selling baby and
children's products — free collection, dynamically priced delivery,
controlled cash collection, and verified business storefronts.

This repository currently holds the **project foundation**: tooling,
folder structure, database schema, and the core architectural
abstractions. See [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) for what's
built and what's next.

## Start here

- [ARCHITECTURE.md](ARCHITECTURE.md) — auth, authorization/RLS, payments,
  delivery, cash collection, audit trail, location privacy.
- [DATABASE.md](DATABASE.md) — schema, conventions, migration index.
- [ENVIRONMENT.md](ENVIRONMENT.md) — every environment variable and what
  it's for.
- [DECISIONS.md](DECISIONS.md) — why things are built the way they are,
  and open decisions that need input.
- [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) — phased build plan.
- [DEPLOYMENT.md](DEPLOYMENT.md) — production deployment runbook, with
  every dashboard-only step explicitly labelled.
- [SMOKE_TESTS.md](SMOKE_TESTS.md) — the checklist to run after a
  deployment, split into sandbox/read-only/real-transaction tests.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in Supabase values — see ENVIRONMENT.md
supabase start                 # requires the Supabase CLI + Docker
supabase db reset               # applies migrations + seed data
npm run dev
```

```bash
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm run test          # Vitest
npm run format        # Prettier (write)
```

Built with Next.js, TypeScript, Tailwind CSS, PostgreSQL via Supabase,
deployed on Vercel.
