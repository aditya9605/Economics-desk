# Put the Economy Desk online, free (Mac, about 15 minutes)

Everything here is free: GitHub, Render's free plan, Google's free Gemini key and UptimeRobot. No card is needed for any of them.

This is a separate app from your UPSC app. It gets its own GitHub repository and its own Render service.

## 1. Unzip
Double-click `economy-desk.zip` in Downloads, then open the `economy-desk` folder. You should see `server.js`, `render.yaml` and folders named `config`, `lib`, `public` and `seed`.

## 2. New GitHub repository
1. On github.com click **+** (top right), then **New repository**.
2. Name it `economy-desk`, choose **Private**, and click **Create repository**.
3. Click **uploading an existing file**.
4. In Finder, open the `economy-desk` folder, press **Command+A** and drag everything into the browser. Drag the contents, not the folder itself.
5. Click **Commit changes**.

## 3. Get a free Gemini key (Google)
1. Go to **aistudio.google.com** and sign in with your Google account.
2. Click **Get API key**, then **Create API key**, and copy it.
3. Do not add billing. Without billing the key stays on the free tier and can never charge you.

On the free tier Google may use what the app sends it to improve its products. The app sends only public news text, nothing personal.

## 4. Launch on Render
1. On render.com click **New**, then **Blueprint**, and pick `economy-desk`.
2. It asks for two values:
   - `GEMINI_API_KEY`: paste your Gemini key.
   - `ACCESS_KEY`: make up a password, for example `kautilya2026`. This keeps the dashboard private.
3. Click **Apply**. Then click the **economy-desk** service link and wait until it says **Live**.

Render may ask for a card to verify your account. The free plan does not charge it. If you'd rather not add a card, tell me and I'll suggest another free host.

## 5. Open it
Copy the link ending in `.onrender.com` and open it once with your password added:

`https://economy-desk-xxxx.onrender.com/?key=kautilya2026`

The browser remembers you after that.

## 6. Keep it awake (free)
Render's free plan sleeps after 15 minutes without visitors, and a sleeping server reads no news.
1. Make a free account at **uptimerobot.com**.
2. Click **Add New Monitor**, choose **HTTP(s)**, and paste your link with `/api/health` at the end, for example `https://economy-desk-xxxx.onrender.com/api/health`. Set the interval to **5 minutes**.

Do this for the Economy Desk only. Render's free plan gives about 750 running hours a month per account, enough for one app awake all month but not two. Your UPSC app can stay as it is: it sleeps and wakes when someone opens it.

## 7. Put it on your phone
- **iPhone:** open the link in Safari, tap Share, then **Add to Home Screen**. Keep **Open as Web App** on.
- **Android:** open it in Chrome, tap the three dots, then **Install app**.

## 8. Check it on day one
At the bottom of the right-hand column, **Sources** shows a green or red dot for each feed. The footer shows how many free AI requests have been used today. If anything is red, send me the error text.
