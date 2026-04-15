import { Resend } from 'resend'

// Lazy-initialised so build-time import doesn't throw when RESEND_API_KEY is absent.
function getResend(): Resend {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('RESEND_API_KEY environment variable is not set')
  return new Resend(key)
}

const FROM = process.env.FROM_EMAIL ?? 'ETI <noreply@energytradeinspection.com>'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const url = `${APP_URL}/api/auth/verify-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`

  await getResend().emails.send({
    from: FROM,
    to:   email,
    subject: 'Verify your ETI email address',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <h2 style="font-size:20px;font-weight:600;margin-bottom:8px">Verify your email</h2>
        <p style="color:#6b7280;font-size:14px;margin-bottom:24px">
          Click the button below to verify your email address and activate your
          Energy Trade Inspection account. This link expires in 24 hours.
        </p>
        <a href="${url}"
           style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;
                  padding:10px 24px;border-radius:6px;font-size:14px;font-weight:500">
          Verify email address
        </a>
        <p style="color:#9ca3af;font-size:12px;margin-top:24px">
          If you didn't create an ETI account, you can safely ignore this email.
        </p>
      </div>
    `,
  })
}

export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const url = `${APP_URL}/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`

  await getResend().emails.send({
    from: FROM,
    to:   email,
    subject: 'Reset your ETI password',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <h2 style="font-size:20px;font-weight:600;margin-bottom:8px">Reset your password</h2>
        <p style="color:#6b7280;font-size:14px;margin-bottom:24px">
          Click the button below to set a new password. This link expires in 1 hour.
          If you did not request a password reset, you can safely ignore this email.
        </p>
        <a href="${url}"
           style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;
                  padding:10px 24px;border-radius:6px;font-size:14px;font-weight:500">
          Reset password
        </a>
        <p style="color:#9ca3af;font-size:12px;margin-top:24px">
          This link expires in 1 hour and can only be used once.
        </p>
      </div>
    `,
  })
}
