# Automatic TestFlight uploads (no Mac needed)

The **Release to TestFlight** workflow builds Last Haven on a GitHub-hosted Mac, signs it with your Apple account, and uploads it to App Store Connect. After this one-time setup, a release is a single button press.

## One-time setup (about 10 minutes)

### 1. Create an App Store Connect API key
1. Go to appstoreconnect.apple.com → **Users and Access** → **Integrations** → **App Store Connect API** → **Team Keys**.
2. Click **+** (Generate API Key). Name it `GitHub Release` and give it the **App Manager** role.
3. **Download** the `.p8` file. Apple only lets you download it once, so keep it somewhere safe.
4. Note the **Key ID** (shown in the table) and the **Issuer ID** (shown above the table).

### 2. Find your Team ID
Go to developer.apple.com/account → **Membership details** → **Team ID** (10 characters, e.g. `A1B2C3D4E5`).

### 3. Add five secrets to GitHub
On GitHub, open the repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Add:

| Secret name | Value |
|---|---|
| `APP_BUNDLE_ID` | The bundle ID you registered in App Store Connect, e.g. `com.yourname.lasthaven` |
| `APPLE_TEAM_ID` | Your Team ID from step 2 |
| `ASC_KEY_ID` | The Key ID from step 1 |
| `ASC_ISSUER_ID` | The Issuer ID from step 1 |
| `ASC_KEY_P8` | Open the `.p8` file in TextEdit and paste the **entire** contents, including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines |

Your app record in App Store Connect must already exist with the same bundle ID.

## Releasing a build
- **From GitHub:** **Actions** tab → **Release to TestFlight** → **Run workflow**.
- **From a tag:** push a tag such as `v1.1.0`.
- **Or ask Claude** to start the workflow.

A run takes about 15–25 minutes. When it finishes, the build appears in App Store Connect → **TestFlight** after Apple's processing (usually 10–30 more minutes). Build numbers go up automatically, so you never need to edit them.

## If a run fails
Open the failed run and read the first red step:
- **Missing repository secrets**: one of the five secrets above is missing or misspelled.
- **No profiles / no account / signing errors**: check that the API key has the **App Manager** role and that `APPLE_TEAM_ID` matches the team that owns the app.
- **Bundle ID not found / app record doesn't exist**: `APP_BUNDLE_ID` must exactly match the app you created in App Store Connect.
- **Agreement errors**: accept any pending agreements under **Business** in App Store Connect.
