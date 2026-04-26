# OCR Edge Function

This app now expects the schedule OCR request to go through a Supabase Edge Function named `ocr-schedule`.

The function is now organized as a small OCR harness:

- `index.ts`: stable HTTP entrypoint
- `harness.ts`: provider selection
- `providers/*`: provider-specific adapters
- `prompt.ts`, `utils.ts`, `types.ts`: shared contract and helpers

That keeps the browser contract fixed while letting you swap OCR providers later.

## What it does

- Receives the uploaded image from the web app
- Calls Gemini with the server-side `GEMINI_API_KEY`
- Returns only the parsed schedule JSON to the browser

## Required secret

Set these secrets in Supabase before deploying:

`GEMINI_API_KEY`

Optional:

- `OCR_PROVIDER=gemini`
- `GEMINI_MODEL=gemini-2.5-flash`

## Deploy steps

1. Install the Supabase CLI
2. Link your project
3. Set the secret
4. Set the optional provider/model
5. Deploy the function

Example commands:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set GEMINI_API_KEY=YOUR_GEMINI_API_KEY
supabase secrets set OCR_PROVIDER=gemini
supabase secrets set GEMINI_MODEL=gemini-2.5-flash
supabase functions deploy ocr-schedule
```

`supabase/config.toml` already sets `verify_jwt = false` for `ocr-schedule`, so redeploy after pulling the latest changes.

After deployment, the app will call:

`https://YOUR_PROJECT_REF.supabase.co/functions/v1/ocr-schedule`

## Notes

- The Gemini API key is no longer stored in the browser
- The browser sends the image only to your Supabase Edge Function
- The function uses the server secret to talk to Gemini
- You can add another provider later without changing the browser request shape
