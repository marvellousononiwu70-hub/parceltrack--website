# ParcelTrack permanent website project

This is a full-stack, independent shipment-tracking web-design project. It includes:
- Public tracking lookup
- Persistent SQLite database
- Private admin login
- Create, edit, and delete shipment records
- Shipment event history, status, origin/destination, contents, and ETA
- WhatsApp and email contact links

## Important
This project is not affiliated with UPS or any shipping carrier. It uses original ParcelTrack branding. Only enter genuine or clearly fictional educational shipment information; do not present simulated data as verified carrier tracking.

## Run locally
Requires Node.js 20 or newer.

1. Open a terminal in this folder.
2. Install packages: `npm install`
3. Set environment variables:
   - `ADMIN_USER` — admin username
   - `ADMIN_PASSWORD` — strong admin password
   - `SESSION_SECRET` — long random secret string
   - Optional: `DATA_DIR=./data`
4. Start: `npm start`
5. Visit `http://localhost:3000`

Example environment setup:
- macOS/Linux:
  `ADMIN_USER=owner ADMIN_PASSWORD='use-a-strong-password' SESSION_SECRET='a-long-random-secret' npm start`
- Windows PowerShell:
  `$env:ADMIN_USER='owner'; $env:ADMIN_PASSWORD='use-a-strong-password'; $env:SESSION_SECRET='a-long-random-secret'; npm start`

## Use the admin dashboard
Open the site and expand “Administrator dashboard” near the bottom. Sign in using the environment variables. Add a tracking number, origin, destination, current status, ETA, and events. Customers can then use the same public website link to retrieve the shipment by tracking number. Changes are saved in the database.

Events format (one per line, newest first):
`14 Oct 2026, 10:00 | Los Angeles, California | Shipment received | Package accepted at origin facility`

## Deploy online with persistent storage
The included `render.yaml` is configured for Render and a persistent disk. To publish:
1. Create a GitHub repository and upload the contents of this folder.
2. Create a Render account and connect that repository as a new Blueprint.
3. Set `ADMIN_USER` and a strong `ADMIN_PASSWORD` in the Render environment settings.
4. Deploy. Render will provide the public website URL.
5. Keep the persistent disk mounted at `/var/data`; otherwise local SQLite data may be lost during redeploys.

Hosting accounts and deployment confirmation must be handled by the site owner; this project bundle does not itself publish the website.

## Change the support contacts
The current contact details are in `public/index.html`:
- WhatsApp: `https://wa.me/17652690857`
- Email: `ups.ltd.vnd@gmail.com`
Edit those links if the project contact details change.
