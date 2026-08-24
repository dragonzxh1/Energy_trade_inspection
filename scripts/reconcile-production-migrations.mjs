const MIGRATION_LOCK_ID = 402601

const reconciliationSpecs = [
  {
    filename: '045_intelligence_content.sql',
    tables: ['seo_content', 'content_ingestion_queue'],
    columns: {
      seo_content: [
        'commodity', 'subcommodity', 'region', 'content_subtype', 'source_channel',
        'source_message_id', 'source_file_hash', 'source_file_name', 'source_published_at',
        'parser_confidence', 'review_status', 'distribution_status', 'language_variants',
        'source_document_json', 'key_facts', 'why_it_matters', 'internal_only',
      ],
      content_ingestion_queue: [
        'source_channel', 'source_message_id', 'media_type', 'file_name',
        'message_timestamp', 'processing_status', 'raw_payload_json',
      ],
    },
    indexes: [
      'idx_seo_content_commodity', 'idx_seo_content_region', 'idx_seo_content_subtype',
      'idx_seo_content_review_status', 'idx_seo_content_distribution_status',
      'idx_seo_content_source_message_id', 'idx_seo_content_source_file_hash',
      'idx_content_ingestion_status', 'idx_content_ingestion_commodity',
      'idx_content_ingestion_file_hash',
    ],
    constraints: [
      ['seo_content', 'seo_content_content_type_check'],
      ['seo_content', 'seo_content_source_level_check'],
      ['seo_content', 'seo_content_source_kind_check'],
      ['seo_content', 'seo_content_review_status_check'],
      ['seo_content', 'seo_content_distribution_status_check'],
    ],
  },
  {
    filename: '055_historical_rollout_isolation.sql',
    tables: ['editorial_views', 'published_articles'],
    columns: {
      editorial_views: ['is_historical'],
      published_articles: ['is_historical'],
    },
    indexes: ['idx_editorial_views_rollout_eligible', 'idx_published_articles_review_eligible'],
    constraints: [],
  },
  {
    filename: '056_pipeline_readiness_states.sql',
    tables: ['pipeline_daily_runs'],
    columns: {
      pipeline_daily_runs: [
        'content_ready', 'quality_gate_passed', 'publish_execution_allowed',
      ],
    },
    indexes: ['idx_pipeline_daily_runs_readiness'],
    constraints: [],
  },
  {
    filename: '057_fact_extraction_update_counts.sql',
    tables: ['fact_extraction_runs'],
    columns: { fact_extraction_runs: ['facts_updated'] },
    indexes: [],
    constraints: [
      ['fact_extraction_runs', 'fact_extraction_runs_facts_updated_check', ['facts_updated']],
    ],
  },
  {
    filename: '063_summary_image_draft_closure.sql',
    tables: ['summary_publication_states', 'processing_runs'],
    columns: {
      summary_publication_states: [
        'source_attachment_id', 'source_sha256', 'output_sha256', 'draft_content_hash',
        'draft_verified_at', 'attempts', 'last_error', 'idempotency_key',
      ],
    },
    indexes: [
      'uq_summary_publication_source_sha256',
      'uq_summary_publication_idempotency_key',
      'idx_summary_image_processing_runs',
    ],
    constraints: [
      [
        'summary_publication_states',
        'summary_publication_states_image_quote_status_check',
        ['draft_created', 'draft_verified', 'failed_terminal'],
      ],
      [
        'summary_publication_states',
        'summary_publication_states_source_sha256_check',
        ['source_sha256'],
      ],
      [
        'processing_runs',
        'processing_runs_processing_status_check',
        ['failed_retryable', 'failed_terminal', 'needs_review'],
      ],
    ],
  },
]

function usage() {
  console.log(`Usage: node scripts/reconcile-production-migrations.mjs [--dry-run|--apply]

Validates the exact schema signatures for migrations known to exist on the
2026-08-24 production database without corresponding schema_migrations rows.
The default mode is --dry-run. --apply only records migrations after every
missing migration passes validation.`)
}

function parseMode(args) {
  if (args.includes('--help') || args.includes('-h')) return 'help'
  const unknown = args.filter((arg) => arg !== '--dry-run' && arg !== '--apply')
  if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown[0]}`)
  if (args.includes('--dry-run') && args.includes('--apply')) {
    throw new Error('Choose exactly one of --dry-run or --apply')
  }
  return args.includes('--apply') ? 'apply' : 'dry-run'
}

async function relationExists(client, relation) {
  const result = await client.query('SELECT to_regclass($1) IS NOT NULL AS ok', [relation])
  return result.rows[0].ok
}

async function missingColumns(client, table, requiredColumns) {
  const result = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = $1
       AND column_name = ANY($2::text[])`,
    [table, requiredColumns],
  )
  const present = new Set(result.rows.map((row) => row.column_name))
  return requiredColumns.filter((column) => !present.has(column))
}

async function constraintDefinition(client, table, constraint) {
  const result = await client.query(
    `SELECT pg_get_constraintdef(constraint_row.oid) AS definition
     FROM pg_constraint AS constraint_row
     JOIN pg_class AS table_row ON table_row.oid = constraint_row.conrelid
     JOIN pg_namespace AS namespace_row ON namespace_row.oid = table_row.relnamespace
     WHERE namespace_row.nspname = current_schema()
       AND table_row.relname = $1
       AND constraint_row.conname = $2`,
    [table, constraint],
  )
  return result.rows[0]?.definition ?? null
}

async function validateSpec(client, spec) {
  const failures = []

  for (const table of spec.tables) {
    if (!(await relationExists(client, table))) failures.push(`missing table ${table}`)
  }

  for (const [table, requiredColumns] of Object.entries(spec.columns)) {
    const missing = await missingColumns(client, table, requiredColumns)
    if (missing.length > 0) failures.push(`missing columns ${table}.${missing.join(',')}`)
  }

  for (const index of spec.indexes) {
    if (!(await relationExists(client, index))) failures.push(`missing index ${index}`)
  }

  for (const [table, constraint, fragments = []] of spec.constraints) {
    const definition = await constraintDefinition(client, table, constraint)
    if (!definition) {
      failures.push(`missing constraint ${table}.${constraint}`)
      continue
    }
    const normalized = definition.toLowerCase()
    for (const fragment of fragments) {
      if (!normalized.includes(fragment.toLowerCase())) {
        failures.push(`constraint ${table}.${constraint} lacks ${fragment}`)
      }
    }
  }

  return failures
}

async function run(mode) {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is required; no database fallback is permitted')
  }

  const { default: pg } = await import('pg')
  const { Client } = pg
  const client = new Client({ connectionString })
  let transactionOpen = false
  await client.connect()

  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID])
    await client.query('BEGIN')
    transactionOpen = true
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    const verified = []
    let blocked = false
    for (const spec of reconciliationSpecs) {
      const recorded = await client.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [spec.filename],
      )
      if (recorded.rowCount > 0) {
        console.log(`RECORDED ${spec.filename}`)
        continue
      }

      const failures = await validateSpec(client, spec)
      if (failures.length > 0) {
        blocked = true
        console.error(`BLOCKED ${spec.filename}: ${failures.join('; ')}`)
      } else {
        verified.push(spec.filename)
        console.log(`VERIFIED ${spec.filename}`)
      }
    }

    if (blocked) {
      throw new Error('Schema reconciliation blocked; no migration records were written')
    }

    if (mode === 'apply') {
      for (const filename of verified) {
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
          [filename],
        )
        console.log(`RECORDED ${filename}`)
      }
      await client.query('COMMIT')
      transactionOpen = false
      console.log(`Reconciliation complete: ${verified.length} migration record(s) added`)
    } else {
      await client.query('ROLLBACK')
      transactionOpen = false
      console.log(`Dry run complete: ${verified.length} migration record(s) eligible; none written`)
    }
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {})
    await client.end()
  }
}

let mode
try {
  mode = parseMode(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  usage()
  process.exit(2)
}

if (mode === 'help') {
  usage()
} else {
  run(mode).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
