// Any setup scripts you might need go here

// Load .env files
import 'dotenv/config'

// Tests run background jobs explicitly with payload.jobs.run().
process.env.PAYLOAD_JOBS_AUTORUN = 'false'
