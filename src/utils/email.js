import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendVerificationEmail = async (email, token) => {

  const verificationUrl = `${process.env.APP_URL}/verify-email?token=${token}`;

  await resend.emails.send({
    from: "YouScan <onboarding@resend.dev>",
    to: email,
    subject: "Verify your YouScan account",
    html: `
      <h2>Verify Your Email</h2>
      <p>Click the link below to verify your account:</p>
      <a href="${verificationUrl}">${verificationUrl}</a>
      <p>If you did not register, ignore this email.</p>
    `
  });
};
