# Releasing Last Haven on the App Store

This checklist takes the repository from code to a live App Store listing with working in-app purchases. Do these steps in order.

---

## 1. What you need

| Item | Notes |
|---|---|
| **Mac** with **Xcode 16 or newer** | iOS apps can only be built and uploaded from macOS |
| **Apple Developer Program** membership | $99/year at developer.apple.com/programs. Enroll as an organization if you want a company name as the seller (needs a D-U-N-S number). |
| **Node.js 20+** | `brew install node` |
| An iPhone for testing | Optional but strongly recommended |
| A **privacy policy URL** | Apple requires one for every app. It's ready in `docs/privacy.html`; you only need to publish it (see §7). |

---

## 2. Pick your bundle ID

1. Choose a permanent reverse-domain ID, for example `com.yourcompany.lasthaven`.
2. Put it in `capacitor.config.ts` → `appId`.
3. Run `npx cap sync ios`.

> The bundle ID **cannot be changed** after the app is created in App Store Connect.

---

## 3. Build and run on your iPhone

```bash
npm install
npm run ios:sync   # tsc + vite build + copy into ios/
npm run ios:open   # opens ios/App/App.xcodeproj in Xcode
```

In Xcode:
1. Select the **App** target → **Signing & Capabilities**.
2. Turn on **Automatically manage signing** and choose your **Team**.
3. Confirm the **Bundle Identifier** matches `appId`.
4. Click **+ Capability** → add **In-App Purchase**.
5. Choose your iPhone as the run destination and press **▶ Run**.

Xcode downloads the Swift packages (Capacitor + the purchase plugin) automatically the first time.

---

## 4. Create the app in App Store Connect

1. Go to appstoreconnect.apple.com → **Apps** → **+** → **New App**.
2. Platform **iOS**, name **Last Haven** (or your chosen name), primary language, your bundle ID, and an SKU such as `LASTHAVEN001`.
3. Go to **Business** (formerly *Agreements, Tax, and Banking*) and make sure the **Paid Apps Agreement** is **Active**, with bank and tax forms completed.

> In-app purchases **will not load at all** until the Paid Apps Agreement is active. This is the most common reason a store shows "item not available".

---

## 5. Create the in-app purchases

Go to App Store Connect → your app → **Monetization → In-App Purchases** → **+**. Create each product with **exactly** these IDs (they match `src/platform/store.ts`):

| Reference name | Product ID | Type | Suggested price |
|---|---|---|---|
| Survivor Starter Pack | `lasthaven.starter` | Non-Consumable | $2.99 |
| Pocket of Caps | `lasthaven.caps.small` | Consumable | $0.99 |
| Sack of Caps | `lasthaven.caps.medium` | Consumable | $4.99 |
| Vault of Caps | `lasthaven.caps.large` | Consumable | $9.99 |
| Scavenger's Map | `lasthaven.doubleloot` | Non-Consumable | $3.99 |

For each product:
- Add a **display name** and **description** (localization) — copy them from `PRODUCTS` in `src/platform/store.ts`.
- Set the **price** under Price Schedule.
- Upload a **Review Screenshot** of the in-game Trading Post (any 640×920 or larger screenshot of the shop works).
- Add a short **Review Note**, for example: "Open the Trading Post from the gold Caps button in the top bar."

Your **first** in-app purchases must be submitted **together with an app version**. On the version page, scroll to **In-App Purchases and Subscriptions** and select all five products.

To change prices or add products later, edit `PRODUCTS` in `src/platform/store.ts` **and** App Store Connect, keeping the IDs identical.

---

## 6. Test purchases (Sandbox)

1. App Store Connect → **Users and Access → Sandbox → Test Accounts** → create a tester with an email address you have not used for an Apple ID.
2. On your iPhone: **Settings → Developer → Sandbox Apple Account** → sign in with the tester.
3. Run the app from Xcode, open the Trading Post, and buy something. The payment sheet will show **[Environment: Sandbox]**; you are not charged.
4. Verify:
   - [ ] Caps are added after a purchase
   - [ ] Starter Pack shows "Owned ✓", and a **New Game** starts with 6 survivors + 1 guard + a gold HQ
   - [ ] Scavenger's Map doubles ruin loot
   - [ ] Delete and reinstall the app, tap **Menu → Restore Purchases**, and the non-consumables come back
   - [ ] Cancelling the payment sheet does nothing and shows no error

> **Recommended before scaling up:** add server-side receipt validation (for example [iaptic](https://www.iaptic.com), which is built for this plugin, or your own server). Set `store.validator` in `NativeStore.init()` in `src/platform/store.ts`. The game works without it, but validation blocks receipt-forgery cheats.

---

## 7. App Store listing

| Field | Suggested value |
|---|---|
| **Name** | Last Haven |
| **Subtitle** (30 chars) | Zombie Survival Base Builder |
| **Category** | Games → Strategy (secondary: Simulation) |
| **Age rating** | Answer the questionnaire honestly. The game has cartoon violence (zombies) and no blood realism, gambling, or user-generated content. Expect **9+** to **12+**. |
| **App Privacy** | **Data Not Collected.** The game has no accounts, analytics or ads, and saves only on the device. Update this if you add analytics or ads later. |
| **Privacy policy URL** | Required. Publish `docs/privacy.html` (see *Publishing the privacy policy* below) and paste its URL here. |
| **Keywords** (100 chars) | `zombie,survival,base,builder,strategy,apocalypse,tower,defense,colony,settlement,scavenge,farm` |

**Description (draft):**

> The dead walk. You build.
>
> Lead a band of survivors through the end of the world. By day, chop wood, salvage scrap from wrecked cars and grow food. Send scavengers into the ruins for supplies — and new survivors. By night, the horde comes.
>
> • Build a settlement: houses, farms, barracks and watchtowers
> • Paint walls with a swipe and watch zombies hunt for the weak spot
> • Train guards, set patrol routes and plan your killzones
> • Upgrade towers into machine-gun nests and your HQ into a Stronghold
> • Survive escalating hordes — Runners, Spitters, Brutes and the Blood Moon Abomination
> • Traders, refugees and supply caches every day
> • Hold out for 20 nights until the rescue convoy arrives
> • Dynamic day/night cycle with real-time lighting
> • Play offline, anytime
>
> How long will your Haven stand?

**Publishing the privacy policy:** the policy is written and ready in `docs/privacy.html`. It states the game collects no data, matching the **Data Not Collected** privacy label. To host it free with GitHub Pages:
1. GitHub → this repository → **Settings → Pages**.
2. **Source:** *Deploy from a branch* → branch `main`, folder `/docs` → **Save**.
3. After a minute the policy is live at `https://<your-github-username>.github.io/<repo-name>/privacy.html`. Paste that URL into App Store Connect (**App Information → Privacy Policy URL**).

GitHub Pages on a private repository needs a paid GitHub plan. If the repository is private, paste the file into any website you control instead. The contact email in the policy is the one at the bottom of `docs/privacy.html`; change it there if it should be different.

**Screenshots:** ready in `docs/screenshots/`, at Apple's exact required sizes:

| Folder | What | Use |
|---|---|---|
| `store/iphone-6.9_*.png` (1320×2868) | 5 captioned marketing shots | **6.9" iPhone** screenshot slot, in order 1→5 |
| `store/ipad-13_*.png` (2752×2064) | 5 captioned marketing shots | **13" iPad** screenshot slot, in order 1→5 |
| `raw/` | The same shots without captions | Use these instead if you prefer plain gameplay |
| `iap-review_trading-post.png` | The Trading Post | **Review Screenshot** on each in-app purchase (§5) |

Apple scales the 6.9" and 13" sets down for smaller devices automatically. To regenerate after changing the game: `npm run build && npm run screenshots` (needs Playwright: `npm i -D playwright && npx playwright install chromium`).

---

## 8. Upload and submit

1. In `ios/App/App.xcodeproj`, set **Version** (e.g. `1.0.0`) and **Build** (increase it on every upload).
2. Set the destination to **Any iOS Device (arm64)** → **Product → Archive**.
3. In the Organizer: **Distribute App → App Store Connect → Upload**.
4. After processing (10–30 minutes), the build appears under **TestFlight**. Test it there with friends first.
5. On the app version page: select the build, attach the five IAPs, fill in **App Review Information** (contact details; no login needed), and click **Submit for Review**.

Reviews usually take 24–48 hours.

---

## 9. Common App Review rejections, and how this project handles them

| Guideline | Status |
|---|---|
| 3.1.1: must use Apple IAP for digital goods | ✅ All purchases go through StoreKit |
| 3.1.1: must offer **Restore Purchases** | ✅ In the Pause menu and in the Trading Post |
| 3.1.1: loot boxes must disclose odds | ✅ Not applicable: no paid random rewards |
| 2.1: in-app purchases must work during review | ⚠️ Make sure the Paid Apps Agreement is active and the IAPs are attached to the version |
| 4.2: minimum functionality | ✅ Full native game with haptics, offline play and no external links |
| 5.1.1: privacy policy URL | ✅ Written (`docs/privacy.html`); ⚠️ publish it and paste the URL (§7) |

---

## 10. Every update after launch

```bash
# make changes…
npm test
npm run ios:sync
# Xcode: bump Build number → Archive → Upload → submit the new version
```
