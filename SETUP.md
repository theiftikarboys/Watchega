# Watchega — setup guide

Read this fully before deploying. A few of these steps involve Supabase's
and Netlify's own dashboards, and their exact menu wording can change —
I'm describing them as of my knowledge, but if a label doesn't match what
you see, use their in-app search or docs rather than guessing.

## What this actually is

- A private, single-page web app (`index.html` + `app.js` + `styles.css`)
- A database + auth + file storage backend on **Supabase** (free tier is enough to start)
- Two small serverless functions on **Netlify** that let you invite/remove users
  (this has to run server-side — inviting a user requires a secret key that can
  never be shipped to the browser)

Nothing here is invented or assumed to exist — this is standard Supabase JS
client usage (`@supabase/supabase-js` v2) and standard Netlify Functions.
I'd still recommend skimming Supabase's and Netlify's current docs once
before you rely on this in production, in case either has changed something
recently.

---

## 1. Create the Supabase project

1. Go to supabase.com and create a free project.
2. In the project dashboard, go to **SQL Editor** → **New query**.
3. Paste the entire contents of `supabase-schema.sql` and run it.
4. Go to **Project Settings → API**. Copy:
   - **Project URL**
   - **anon public** key
   - **service_role** key (keep this one secret — never put it in `config.js` or any frontend file)

## 2. Create your own login (bootstrap step)

Because there's no owner yet, the app can't invite its first user — you create
yourself directly:

1. Supabase dashboard → **Authentication → Users → Add user**. Create yourself
   with your email and a password (mark email as confirmed).
2. Back in **SQL Editor**, run:
   ```sql
   update public.profiles set role = 'owner' where email = 'YOUR-EMAIL@example.com';
   ```
3. That's your one and only manual step — every user after this can be
   invited from inside the app by an owner.

## 3. Fill in `config.js`

Open `config.js` and replace the two placeholder values with your real
**Project URL** and **anon public** key from step 1. The anon key is safe
to have in frontend code — it can only do what the Row Level Security
policies in `supabase-schema.sql` allow, which is why that file matters.

Do **not** put the service_role key here.

## 4. Push this to a Git repo

Netlify deploys from a Git repository (GitHub, GitLab, or Bitbucket).
Create a new repo and push this whole folder to it.

## 5. Connect Netlify

1. In Netlify: **Add new site → Import an existing project**, and connect
   the repo you just pushed.
2. Build settings: this project has no real build step. Leave the publish
   directory as the repo root, and functions directory as `netlify/functions`
   (the included `netlify.toml` already sets both).
3. Before the first deploy (or right after), go to **Site configuration →
   Environment variables** and add:
   - `SUPABASE_URL` — same Project URL as before
   - `SUPABASE_SERVICE_ROLE_KEY` — the service_role key (this one **is**
     secret, and this is the one safe place for it — it only runs inside
     Netlify's server, never sent to the browser)
4. Deploy the site.

## 6. Point watchega.com at it

1. Netlify: **Site configuration → Domain management → Add a domain**,
   enter `watchega.com`.
2. Netlify will show you DNS records to add at wherever you registered the
   domain (usually either pointing nameservers to Netlify, or adding an
   A/CNAME record — Netlify's own instructions at that point will say which,
   and that's worth following exactly since DNS UI details do shift over time).
3. DNS changes can take anywhere from minutes to ~24 hours to propagate.

## 7. Try it

- Go to `https://watchega.com`, sign in with the account you created in step 2.
- You should see the "Manage users" and "+ Add competition" buttons — those
  only appear for the `owner` role.
- Add a competition, open it again, upload a test document, download it,
  delete it. Then try **Manage users → Invite** with a second email address
  you control, to confirm the invite email arrives (check spam).

---

## How permissions actually work (so you can verify, not just trust me)

- **Owner** (you): add/remove users, create/edit/delete competitions, and
  full document access. This is enforced in `supabase-schema.sql` — every
  policy checking `role = 'owner'` is doing real enforcement in the
  database, not just hidden in the frontend.
- **Members** (everyone you invite): can view all competitions, and can
  upload/download/delete documents on any competition. They cannot edit
  competition fields or manage users — the "Save" button and edit fields
  are hidden for them client-side, and the database would reject the write
  even if someone bypassed the UI.

If you actually want members to also edit status/results directly (you only
asked for document permissions for "this one user" — I didn't assume more
than that), tell me and I'll change the two `update`/`insert` policies on
`competitions` in the SQL file plus the `setFormDisabled` check in `app.js`.

## What I did not build

- No password-reset UI beyond Supabase's default invite/reset emails (their
  standard templates apply — check Supabase's Auth email settings if you
  want to customize the wording).
- No pagination — fine for dozens to low hundreds of competitions; if this
  ever grows into the thousands, the "load everything on open" approach in
  `app.js` would need to change to paged queries.
- I have not deployed or tested this against a live Supabase/Netlify
  project myself — I don't have network access in this environment. Please
  verify it works end-to-end before relying on it for something you can't
  afford to lose track of.
