import { z } from "zod";
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL_CA_FILE: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  APP_URL: z.url().default("http://localhost:3000"),
  RAZORPAY_KEY_ID: z.string().startsWith("rzp_test_"),
  RAZORPAY_KEY_SECRET: z.string().min(1),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(16),
});
export function env() {
  const result = schema.safeParse(process.env);
  if (!result.success)
    throw new Error(
      "Invalid server configuration: " +
        result.error.issues.map((i) => i.path.join(".")).join(", "),
    );
  return result.data;
}
