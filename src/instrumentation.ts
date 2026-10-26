/**
 * Runs once when the server starts. Payload runs queued and scheduled jobs (email, reminders, ZIP
 * cleanup) only when it is loaded with `cron: true`, which no request does, so nothing ran at all. Loading
 * Payload here with `cron` starts the job runner at boot, whether or not anyone visits. A failure is
 * logged; the first request still loads Payload.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    const [{ getPayload }, { default: config }] = await Promise.all([import('payload'), import('@payload-config')])
    await getPayload({ config, cron: true })
  } catch (error) {
    console.error('Payload did not start at boot; it will start on the first request instead.', error)
  }
}
