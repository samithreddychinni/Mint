# MINT sign-in email

The OTP email markup is in [`supabase/templates/mint-otp.html`](../supabase/templates/mint-otp.html). It uses Supabase Auth's `{{ .Token }}` value because MINT asks students to enter a six-digit code in the app.

For the hosted Supabase project, open **Authentication → Email Templates → Magic Link**, set the subject to **Your MINT sign-in code**, and replace the message body with the contents of `supabase/templates/mint-otp.html`. Save the template, then send a test OTP to verify that the code renders and remains easy to copy on both mobile and desktop.

The repository does not have a tracked `supabase/config.toml`; adding one just for this template would not configure the hosted project. Hosted projects use the Supabase Dashboard email template settings. The app's OTP request and verification flow already uses Supabase Auth and needs no handler change.
