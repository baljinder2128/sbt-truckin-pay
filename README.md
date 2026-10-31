# SB Truckin · Driver Pay

One app for drivers and the office: drivers photograph their runsheet every day, the app works out paid hours (start to finish as per the runsheet, breaks shown on the side but not deducted), the office gets a copy, and every week an RCTI is created for each driver. Office copies are emailed automatically; driver copies are held until the office pushes them.

It runs as a website on any computer, and on Android it installs to the home screen like a normal app (see "Android app" below).

## What each side can do

**Drivers (phone)**
- Take a photo of the runsheet. If photo reading is switched on, start, finish and break times are filled in from the photo; the driver checks and fixes them before submitting.
- See paid hours worked out live: start to finish, overnight shifts handled, breaks listed but not taken off.
- See **pending** pay (not yet paid) and **cleared** pay (paid), week by week.
- Download their RCTIs once the office pushes them.
- See the company, ABN and bank details that go on their RCTI (read only).

**Office (desktop or phone)**
- Full edit of every runsheet: date, times, breaks, rate, notes, approve or reject, delete. Edits on an unpaid RCTI re-total it automatically.
- Enter a runsheet on a driver's behalf.
- Drivers: hourly rate, business name, ABN, GST registered, address, nominated bank account (account name, BSB, account number), login and password. Optionally apply a new rate to runsheets not yet invoiced.
- Pay & RCTIs by week: create RCTIs, email office copies, push driver copies (optionally email the driver), mark paid with a payment reference, re-total, void.
- Settings: SBT company details and ABN for the RCTI, office email for copies, RCTI numbering, payment terms, RCTI agreement wording, logo, extra office logins.
- Email log of everything sent.

**Automatic**
- Each submitted runsheet is emailed to the office email with the photo attached.
- Every Sunday at 1am (Melbourne time) RCTIs are created for the week just finished (Monday to Saturday) and the office copies are emailed together.

## Run it

Needs Node.js 22.13 or newer.

```bash
npm install
npm start            # http://localhost:3000
```

The first start creates an office login: `office@sbttruckin.com.au` / `ChangeMe123!` (or set `ADMIN_EMAIL` / `ADMIN_PASSWORD`). Change the password under Settings.

To try it with sample drivers and two weeks of runsheets first:

```bash
npm run demo         # drivers: jas@example.com, mick@example.com, raj@example.com / Driver123!
npm start
```

Tests: `npm test`

All data (database, photos, RCTI PDFs, unsent emails) lives in `./data` (or `DATA_DIR`). Back that folder up.

## Settings to switch on

Copy `.env.example` to `.env`.

| What | How |
|---|---|
| Real email | Easiest: office app → Settings → Email account. Or set the `SMTP_*` values from `.env.example`. The password must be a Gmail **app password**: Google Account → Security → turn on 2-Step Verification → App passwords → create one called "SB Pay" and paste the 16 letters. Until `SMTP_HOST` is set every email is saved to `data/outbox` as an `.eml` file and nothing is sent. |
| Reading times from runsheet photos | Set `ANTHROPIC_API_KEY`. Without it drivers type the times in from their photo. |
| Security on a public server | Set a long random `JWT_SECRET` and a strong `ADMIN_PASSWORD`, and serve it over HTTPS. |

## Putting it online for free (Railway)

1. Sign in at railway.com with GitHub, **New Project → Deploy from GitHub repo → sbt-truckin-pay**. It builds from the `Dockerfile`.
2. Right-click the service box on the canvas → **Attach volume** → mount path `/data`. This keeps the database, photos and PDFs across restarts.
3. Click the service → **Settings → Networking → Generate Domain**. That https link is the app for the office and drivers.
4. Optional: **Settings → Serverless** on, so it sleeps when idle and stays inside the free $1 a month. If it's asleep at 1am Sunday, the weekly RCTIs are created as soon as anyone opens it.

No Railway variables are needed. After the first login (`office@sbttruckin.com.au` / `ChangeMe123!`), change the password and add the Gmail app password in the app under **Settings**.

The free volume holds 0.5 GB, roughly 2,000 runsheet photos.

## Other hosts

Any Node host with a persistent disk works (Render, Railway, Fly.io, a small VPS). A `Dockerfile` is included; mount a volume at `/data`.

```bash
docker build -t sbt-pay .
docker run -p 3000:3000 -v sbt-data:/data --env-file .env sbt-pay
```

It must be on HTTPS for phones to install it and use the camera.

## Android app

The app is a Progressive Web App. Once it's online over HTTPS:

1. Driver opens the link in Chrome on Android.
2. Chrome shows **Install app** (or menu ⋮ → **Add to Home screen**).
3. It installs with the SBT icon and opens full screen like any other app.

To put it in the **Google Play Store**, wrap the hosted site as a Trusted Web Activity with Google's Bubblewrap tool (`npx @bubblewrap/cli init --manifest https://YOUR-DOMAIN/manifest.webmanifest`, then `bubblewrap build`). That produces the `.aab` you upload in the Play Console. You need a Google Play developer account (one-off US$25) and to add the `assetlinks.json` file Bubblewrap gives you under `public/.well-known/`.

## Pay rules used

- Paid hours = finish minus start. A finish earlier than start is treated as running past midnight.
- Breaks are stored and shown on the runsheet, emails and RCTI, but never deducted.
- Hours are rounded to 2 decimals, amounts to cents.
- Pay week is Monday to Saturday (it was Sunday to Saturday before 24 Oct 2026).
- GST at 10% is added on the RCTI only if the driver is marked GST registered.
- Pending = everything not marked paid (uninvoiced runsheets include estimated GST). Cleared = RCTIs marked paid.

Have your accountant check the RCTI agreement wording (Settings) matches the written RCTI agreements you hold with each driver.

## Moving to another host

Settings → **Backup & moving the app** → **Download backup** gives one `.sbtbackup` file with the database and every PDF and photo
(it includes logins and the email key, so keep it private). On the new host, deploy this repo with the Dockerfile, attach a
persistent volume at `/data`, log in with the first office login (`ADMIN_EMAIL` / `ADMIN_PASSWORD`, default
`office@sbttruckin.com.au` / `ChangeMe123!`), then Settings → **Restore from backup**. After that, everyone uses their usual logins.

Northflank's free Sandbox plan (2 services, volumes, always on) runs it as is: new service from this GitHub repo, build with
the Dockerfile, public port 8080, volume mounted at `/data`.
