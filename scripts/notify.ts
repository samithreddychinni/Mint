const message = process.argv.slice(2).join(" ");
if (!message) throw new Error("Provide a verified milestone description.");
const r = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    "Content-Type": "application/json",
    "Idempotency-Key": `mint-milestone-${Buffer.from(message).toString("base64url").slice(0, 150)}`,
  },
  body: JSON.stringify({
    from: "MINT Progress <otp@mint.samithreddy.me>",
    to: ["cb.sc.u4cse24111@cb.students.amrita.edu"],
    subject: "MINT: " + message.slice(0, 90),
    text:
      message +
      "\n\nThis is a development milestone. All payments remain in test mode.",
  }),
});
console.log("Milestone email provider response:", r.status);
if (!r.ok) process.exitCode = 1;
export {};
