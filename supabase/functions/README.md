# OCR Edge Function

This app now expects the schedule OCR request to go through a Supabase Edge Function named `ocr-schedule`.

## What it does

- Receives the uploaded image from the web app
- Calls Gemini with the server-side `GEMINI_API_KEY`
- Returns only the parsed schedule JSON to the browser

## Required secret

Set this secret in Supabase before deploying:

`GEMINI_API_KEY`

## Deploy steps

1. Install the Supabase CLI
2. Link your project
3. Set the secret
4. Deploy the function

Example commands:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set GEMINI_API_KEY=YOUR_GEMINI_API_KEY
supabase functions deploy ocr-schedule
```

After deployment, the app will call:

`https://YOUR_PROJECT_REF.supabase.co/functions/v1/ocr-schedule`

## Notes

- The Gemini API key is no longer stored in the browser
- The browser sends the image only to your Supabase Edge Function
- The function uses the server secret to talk to Gemini
