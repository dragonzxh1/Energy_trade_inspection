import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getScoreTier, buildCompanyJsonLd, buildCompanyNarrative } from '@/lib/utils'
import SanctionBadge from '@/components/entity/SanctionBadge'
import RiskBadge from '@/components/entity/RiskBadge'
import ScoreGauge from '@/components/entity/ScoreGauge'
import TabNav from '@/components/entity/TabNav'
import ContentLock from '@/components/entity/ContentLock'
import Header from '@/components/layout/Header'
import type { Company, BeneficialOwner } from '@/lib/types'
import { applyMigrations } from '@/lib/server/migrations'
import { getEntityByKey, getIcijMatches, getIcijOfficerNetwork } from '@/lib/server/repository'
import type { IcijMatch, IcijOfficerLink } from '@/lib/server/repository'
import { consumeQuota } from '@/lib/server/quota'
import { auth } from '@/auth'
import { db } from '@/lib/server/db'
import WatchButton from '@/components/entity/WatchButton'
import IntelligencePanel from '@/components/entity/IntelligencePanel'

interface PageProps {
  params: Promise<{ slug: string }>
}

export const revalidate = 86400

async function getCompany(slug: string): Promise<Company | null> {
  await applyMigrations()
  const entity = await getEntityByKey(slug)
  if (!entity || entity.type !== 'company') return null
  return entity as Company
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const company = await getCompany(slug)
  if (!company) return { title: 'Entity Not Found' }
  const tier = getScoreTier(company.authenticityScore)
  return {
    title: `${company.name} — Sanction Status & Verification`,
    description: `${company.name} (${company.registrationNumber}) — ${tier}. Authenticity score: ${company.authenticityScore}/100. Sanction status: ${company.sanctionStatus.replace('_', ' ')}. Registered in ${company.country}.`,
    openGraph: {
      title: `${company.name} — Energy Trade Inspection`,
      description: `Sanction status, authenticity score, and risk analysis for ${company.name}.`,
    },
  }
}

// ── Shared styles ────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  backgroundColor: 'var(--bg-surface)',
  borderRadius: '10px',
  padding: 'var(--space-5)',
  border: '1px solid var(--border-subtle)',
}

const sectionTitle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '11px',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  marginBottom: 'var(--space-4)',
}

const row: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  padding: 'var(--space-3) 0',
  borderBottom: '1px solid var(--border-subtle)',
}

const rowLabel: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '13px',
  flexShrink: 0,
  marginRight: 'var(--space-4)',
  width: '160px',
}

const rowValue: React.CSSProperties = {
  color: 'var(--text-primary)',
  fontSize: '13px',
  textAlign: 'right',
  wordBreak: 'break-word',
}

const emptyState: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '14px',
  textAlign: 'center',
  padding: 'var(--space-8) 0',
}

// ── Tab panel components ─────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null
  return (
    <div style={row}>
      <span style={rowLabel}>{label}</span>
      <span style={rowValue}>{value}</span>
    </div>
  )
}

function RegistrationPanel({ company }: { company: Company }) {
  return (
    <div style={card}>
      <p style={sectionTitle}>Registration Details</p>
      <InfoRow label="Legal name" value={company.name} />
      <InfoRow label="Registration no." value={<span className="mono">{company.registrationNumber}</span>} />
      <InfoRow label="Country" value={`${company.jurisdictionFlag} ${company.country}`} />
      <InfoRow
        label="Incorporation date"
        value={
          company.incorporationDate
            ? new Date(company.incorporationDate).toLocaleDateString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric',
              })
            : undefined
        }
      />
      <InfoRow
        label="Registered address"
        value={
          company.registeredAddress
            ? (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(company.registeredAddress)}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
              >
                {company.registeredAddress}{' '}
                <span style={{ color: 'var(--accent-primary)', fontSize: '11px' }}>↗</span>
              </a>
            )
            : undefined
        }
      />
      <InfoRow
        label="Sanction status"
        value={
          <span
            style={{
              color: company.sanctionStatus === 'listed'
                ? 'var(--status-listed)'
                : company.sanctionStatus === 'not_listed'
                ? 'var(--status-clear)'
                : 'var(--text-muted)',
              fontWeight: 500,
            }}
          >
            {company.sanctionStatus === 'not_listed'
              ? 'Not Listed'
              : company.sanctionStatus === 'listed'
              ? 'Listed'
              : 'Unknown'}
          </span>
        }
      />
      <InfoRow label="Last verified" value={
        new Date(company.lastVerified).toLocaleDateString('en-US', {
          year: 'numeric', month: 'short', day: 'numeric',
        })
      } />
    </div>
  )
}

function DirectorsPanel({ company }: { company: Company }) {
  if (!company.directors?.length) {
    return (
      <div style={card}>
        <p style={sectionTitle}>Directors &amp; Officers</p>
        <p style={emptyState}>No director information available for this entity.</p>
      </div>
    )
  }

  return (
    <div style={card}>
      <p style={sectionTitle}>Directors &amp; Officers</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {company.directors.map((d) => (
          <div
            key={d.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 'var(--space-3) 0',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <div>
              <p style={{ color: 'var(--text-primary)', fontSize: '14px', fontWeight: 500 }}>
                {d.name}
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '2px' }}>
                {d.role}{d.nationality ? ` · ${d.nationality}` : ''}
              </p>
            </div>
            {d.appointedDate && (
              <span style={{ color: 'var(--text-muted)', fontSize: '12px', flexShrink: 0 }}>
                Since {new Date(d.appointedDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

const OFFSHORE_CC_SET = new Set(['VG', 'KY', 'MH', 'SC', 'BZ', 'PA', 'WS', 'VU'])

function isOffshoreCountry(s?: string): boolean {
  if (!s) return false
  return OFFSHORE_CC_SET.has(s.slice(0, 2).toUpperCase())
}

const KIND_LABEL: Record<BeneficialOwner['kind'], string> = {
  'individual':      'Individual',
  'corporate-entity': 'Corporate',
  'legal-person':    'Legal Person',
}

function formatControlType(nature: string): string {
  return nature
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function BeneficialOwnersPanel({ company }: { company: Company }) {
  const owners = company.beneficialOwners

  if (!owners || owners.length === 0) {
    return (
      <div style={card}>
        <p style={sectionTitle}>Beneficial Owners (PSC)</p>
        <p style={emptyState}>
          {company.dataSource?.includes('Companies House UK')
            ? 'No persons with significant control registered at Companies House.'
            : 'No PSC data available for non-UK entities.'}
        </p>
      </div>
    )
  }

  return (
    <div style={card}>
      <p style={sectionTitle}>Beneficial Owners (PSC) — {owners.length}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {owners.map((o, i) => {
          const offshore = isOffshoreCountry(o.countryOfResidence) ||
            isOffshoreCountry(o.addressCountry) ||
            isOffshoreCountry(o.nationality)
          return (
            <div
              key={i}
              style={{
                padding: 'var(--space-3) 0',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: '4px' }}>
                    <p style={{ color: 'var(--text-primary)', fontSize: '14px', fontWeight: 500 }}>
                      {o.name}
                    </p>
                    <span style={{
                      fontSize: '10px', fontWeight: 600, textTransform: 'uppercase',
                      letterSpacing: '0.06em', color: 'var(--text-muted)',
                      backgroundColor: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      padding: '1px 6px', borderRadius: '4px',
                    }}>
                      {KIND_LABEL[o.kind] ?? o.kind}
                    </span>
                    {offshore && (
                      <span style={{
                        fontSize: '10px', fontWeight: 600, textTransform: 'uppercase',
                        letterSpacing: '0.06em', color: '#f97316',
                        backgroundColor: 'rgba(249,115,22,0.1)',
                        padding: '1px 6px', borderRadius: '4px',
                      }}>
                        Offshore
                      </span>
                    )}
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '2px' }}>
                    {[
                      o.nationality,
                      o.countryOfResidence ? `Resident: ${o.countryOfResidence}` : null,
                      o.addressCountry ? `Address: ${o.addressCountry}` : null,
                    ].filter(Boolean).join(' · ')}
                  </p>
                  {o.naturesOfControl.length > 0 && (
                    <p style={{ color: 'var(--text-secondary)', fontSize: '11px', marginTop: '4px' }}>
                      {o.naturesOfControl.map(formatControlType).join(', ')}
                    </p>
                  )}
                </div>
                {o.notifiedOn && (
                  <span style={{ color: 'var(--text-muted)', fontSize: '12px', flexShrink: 0 }}>
                    Since {new Date(o.notifiedOn).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function VesselsPanel({ company }: { company: Company }) {
  if (!company.vessels?.length) {
    return (
      <div style={card}>
        <p style={sectionTitle}>Associated Vessels</p>
        <p style={emptyState}>No vessel associations on record.</p>
      </div>
    )
  }

  return (
    <div style={card}>
      <p style={sectionTitle}>Associated Vessels</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {company.vessels.map((v) => (
          <a
            key={v.imo}
            href={`/vessel/${v.imo}`}
            className="vessel-link"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 'var(--space-3) var(--space-3)',
              backgroundColor: 'var(--bg-elevated)',
              borderRadius: '8px',
              textDecoration: 'none',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div>
              <p style={{ color: 'var(--text-primary)', fontSize: '14px', fontWeight: 500 }}>
                {v.name}
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '2px' }}>
                {v.flag}
              </p>
            </div>
            <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
              IMO {v.imo}
            </span>
          </a>
        ))}
      </div>
    </div>
  )
}

function RiskFlagsPanel({ company }: { company: Company }) {
  const SEVERITY_COLOR: Record<string, string> = {
    critical: 'var(--status-listed)',
    high:     '#f97316',
    medium:   '#eab308',
    low:      'var(--text-muted)',
  }

  if (!company.riskFlags?.length) {
    return (
      <div style={card}>
        <p style={sectionTitle}>Risk Flags</p>
        <p style={emptyState}>No risk flags have been submitted for this entity.</p>
      </div>
    )
  }

  return (
    <div style={card}>
      <p style={sectionTitle}>Risk Flags ({company.riskFlags.length})</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {company.riskFlags.map((f) => (
          <div
            key={f.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 'var(--space-3) 0',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: SEVERITY_COLOR[f.severity] ?? 'var(--text-muted)',
                  flexShrink: 0,
                }}
              />
              <div>
                <p style={{ color: 'var(--text-primary)', fontSize: '13px', fontWeight: 500 }}>
                  {f.category}
                </p>
                <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '2px' }}>
                  {new Date(f.submittedAt).toLocaleDateString('en-US', {
                    year: 'numeric', month: 'short', day: 'numeric',
                  })}
                </p>
              </div>
            </div>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: SEVERITY_COLOR[f.severity] ?? 'var(--text-muted)',
              }}
            >
              {f.severity}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

const DATASET_LABEL: Record<string, string> = {
  panama_papers:   'Panama Papers',
  pandora_papers:  'Pandora Papers',
  offshore_leaks:  'Offshore Leaks',
  bahamas_leaks:   'Bahamas Leaks',
  paradise_papers: 'Paradise Papers',
}

const DATASET_COLOR: Record<string, string> = {
  panama_papers:   '#ef4444',
  pandora_papers:  '#f97316',
  offshore_leaks:  '#eab308',
  bahamas_leaks:   '#8b5cf6',
  paradise_papers: '#3b82f6',
}

function OffshoreLeaksPanel({ matches }: { matches: IcijMatch[] }) {
  if (matches.length === 0) {
    return (
      <div style={card}>
        <p style={sectionTitle}>Offshore Leaks</p>
        <p style={emptyState}>No matches found in ICIJ offshore leaks datasets.</p>
        <p style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', marginTop: 'var(--space-2)' }}>
          Covers Panama Papers, Pandora Papers, Offshore Leaks, Bahamas Leaks, and Paradise Papers.
        </p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={card}>
        <p style={sectionTitle}>Offshore Leaks ({matches.length} match{matches.length !== 1 ? 'es' : ''})</p>
        {matches.map((m) => (
          <div key={m.nodeId} style={{ padding: 'var(--space-3) 0', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: '4px' }}>
                  <p style={{ color: 'var(--text-primary)', fontSize: '13px', fontWeight: 500 }}>{m.name}</p>
                  <span style={{
                    fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
                    color: '#fff', backgroundColor: DATASET_COLOR[m.dataset] ?? 'var(--text-muted)',
                    padding: '1px 6px', borderRadius: '4px',
                  }}>
                    {DATASET_LABEL[m.dataset] ?? m.dataset}
                  </span>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                  {m.entityType ?? 'Entity'}
                  {m.jurisdiction ? ` · ${m.jurisdiction}` : ''}
                  {m.countries ? ` · ${m.countries}` : ''}
                  {m.incorporationDate ? ` · Inc. ${m.incorporationDate}` : ''}
                </p>
                {m.address && (
                  <p style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '4px', fontStyle: 'italic' }}>
                    {m.address}
                  </p>
                )}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <p style={{
                  fontSize: '12px', fontWeight: 600,
                  color: m.matchConfidence >= 0.8 ? 'var(--status-listed)' : 'var(--text-muted)',
                }}>
                  {Math.round(m.matchConfidence * 100)}% match
                </p>
                {m.sourceUrl && (
                  <a
                    href={m.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--accent-primary)', fontSize: '11px', textDecoration: 'none' }}
                  >
                    ICIJ ↗
                  </a>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '11px', lineHeight: '16px' }}>
        Data from the ICIJ Offshore Leaks Database. Matches are based on name similarity
        and may include different entities with similar names. Verify against primary sources.
      </p>
    </div>
  )
}

function datasetLabel(raw: string): string {
  const key = raw.toLowerCase().replace(/^(paradise_papers|pandora_papers).*/, '$1')
  return DATASET_LABEL[key] ?? raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function IcijOfficerNetworkPanel({ links }: { links: IcijOfficerLink[] }) {
  if (links.length === 0) return null

  // Group by officer node — same officer may control multiple offshore entities
  const byOfficer = new Map<string, { name: string; entities: IcijOfficerLink[] }>()
  for (const link of links) {
    if (!byOfficer.has(link.officerNodeId)) {
      byOfficer.set(link.officerNodeId, { name: link.officerName, entities: [] })
    }
    byOfficer.get(link.officerNodeId)!.entities.push(link)
  }

  return (
    <div style={{
      backgroundColor: 'var(--bg-surface)',
      borderRadius: '10px',
      padding: 'var(--space-5)',
      border: '1px solid var(--border-subtle)',
    }}>
      <p style={{
        color: 'var(--text-muted)', fontSize: '11px', fontWeight: 600,
        letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 'var(--space-4)',
      }}>
        Officer Network Connections
      </p>
      <p style={{ color: 'var(--text-secondary)', fontSize: '12px', marginBottom: 'var(--space-4)', lineHeight: '18px' }}>
        Officers linked to this entity also appear as directors or shareholders of the following
        offshore structures in leaked documents.
      </p>

      {[...byOfficer.entries()].map(([nodeId, officer]) => (
        <div key={nodeId} style={{ marginBottom: 'var(--space-5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
            <span style={{
              width: '6px', height: '6px', borderRadius: '50%',
              backgroundColor: '#f97316', flexShrink: 0,
            }} />
            <span style={{ color: 'var(--text-primary)', fontSize: '13px', fontWeight: 600 }}>
              {officer.name}
            </span>
          </div>
          <div style={{ marginLeft: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {officer.entities.map((e, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: 'var(--space-2) var(--space-3)',
                backgroundColor: 'var(--bg-elevated)', borderRadius: '6px',
              }}>
                <div>
                  <span style={{ color: 'var(--text-primary)', fontSize: '12px' }}>
                    {e.entityName}
                  </span>
                  {e.entityJurisdiction && (
                    <span style={{ color: 'var(--text-muted)', fontSize: '11px', marginLeft: '6px' }}>
                      · {e.entityJurisdiction}
                    </span>
                  )}
                </div>
                <span style={{
                  fontSize: '10px', fontWeight: 600, textTransform: 'uppercase',
                  letterSpacing: '0.06em', color: '#f97316',
                  backgroundColor: 'rgba(249,115,22,0.1)',
                  padding: '2px 6px', borderRadius: '4px', flexShrink: 0, marginLeft: '8px',
                }}>
                  {datasetLabel(e.entityDataset)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}

      <p style={{ color: 'var(--text-muted)', fontSize: '11px', lineHeight: '16px', marginTop: 'var(--space-3)' }}>
        Officer connections sourced from ICIJ Offshore Leaks Database. Same-named officers
        are identified by unique node IDs within each dataset, not name matching.
      </p>
    </div>
  )
}

function SourcesPanel({ sources }: { sources: string[] }) {
  const SOURCE_LINKS: Record<string, string> = {
    'OpenSanctions':                   'https://www.opensanctions.org',
    'ACRA Singapore':                  'https://www.acra.gov.sg',
    'IMO GISIS':                       'https://gisis.imo.org',
    'Paris MOU':                       'https://www.parismou.org',
    'OFAC':                            'https://sanctionslist.ofac.treas.gov',
    'Companies House UK':              'https://find-and-update.company-information.service.gov.uk',
    'Zefix Swiss Commercial Register': 'https://www.zefix.admin.ch',
    'GLEIF':                           'https://search.gleif.org',
    'OpenCorporates':                  'https://opencorporates.com',
  }

  return (
    <div style={card}>
      <p style={sectionTitle}>Data Sources</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {sources.map((src) => (
          <div
            key={src}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 'var(--space-3) 0',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <span style={{ color: 'var(--text-primary)', fontSize: '13px' }}>{src}</span>
            {SOURCE_LINKS[src] && (
              <a
                href={SOURCE_LINKS[src]}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--accent-primary)',
                  fontSize: '12px',
                  textDecoration: 'none',
                }}
              >
                View source ↗
              </a>
            )}
          </div>
        ))}
      </div>
      <p style={{ marginTop: 'var(--space-4)', color: 'var(--text-muted)', fontSize: '12px', lineHeight: '18px' }}>
        Data is aggregated from public registries and international sanction lists.
        Sanction screening powered by OFAC, EU FSF, and UN lists via sanctions.network.
      </p>
    </div>
  )
}

// ── Quota exceeded ────────────────────────────────────────────────────────────

function QuotaExceededPage({ resetDate }: { resetDate: string }) {
  const reset = new Date(resetDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
  return (
    <>
      <Header />
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-8) var(--space-4)' }}>
        <div style={{ maxWidth: '400px', textAlign: 'center' }}>
          <p style={{ fontSize: '32px', marginBottom: 'var(--space-5)' }}>⚠</p>
          <h2 style={{ color: 'var(--text-primary)', fontSize: '18px', fontWeight: 600, marginBottom: 'var(--space-3)' }}>
            Monthly query limit reached
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: '22px', marginBottom: 'var(--space-6)' }}>
            Your free plan includes 5 sanction checks per month.
            Your quota resets on {reset}. Upgrade for more access.
          </p>
          <Link
            href="/pricing"
            style={{
              display: 'inline-block',
              backgroundColor: 'var(--accent-primary)', color: '#fff',
              padding: 'var(--space-3) var(--space-6)', borderRadius: '8px',
              fontSize: '14px', fontWeight: 500, textDecoration: 'none',
            }}
          >
            Upgrade plan
          </Link>
          <p style={{ marginTop: 'var(--space-4)', color: 'var(--text-muted)', fontSize: '12px' }}>
            Already upgraded?{' '}
            <Link href="/" style={{ color: 'var(--accent-primary)' }}>Return home</Link>
          </p>
        </div>
      </div>
    </>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function CompanyPage({ params }: PageProps) {
  const [{ slug }, session] = await Promise.all([params, auth()])

  // Quota enforcement for authenticated users
  if (session?.user) {
    const plan  = session.user.plan ?? 'free'
    const quota = await consumeQuota(session.user.id, plan, slug, slug)
    if (quota.blocked) return <QuotaExceededPage resetDate={quota.resetDate} />
  }

  const company = await getCompany(slug)

  if (!company) notFound()

  const tier    = getScoreTier(company.authenticityScore)
  const appUrl  = process.env.NEXT_PUBLIC_APP_URL ?? 'https://energytradeinspection.com'
  const plan    = session?.user?.plan ?? 'free'
  const isExternalEntity = /^(gleif:|oc:|zefix:|acra:|ch:)/.test(company.id)
  const scoreNote = isExternalEntity
    ? `Score based on ${company.dataSource.join(' + ')} data`
    : 'Score based on Phase 1 available data (max 75)'
  // F3 unlocked for Starter+ (authenticated, paid plan)
  const f3Unlocked = !!session?.user && plan !== 'free'
  const lockReason = !session?.user ? 'guest' : 'free'

  // Watchlist check + ICIJ data (parallel)
  let isWatching = false
  const [watchlistRows, icijMatches, icijOfficerLinks] = await Promise.all([
    session?.user && (plan === 'professional' || plan === 'enterprise')
      ? db.query(`SELECT id FROM watchlist WHERE user_id = $1 AND entity_id = $2`, [session.user.id, company.id])
          .then((r) => r.rows)
      : Promise.resolve([]),
    f3Unlocked ? getIcijMatches(company.id) : Promise.resolve([]),
    f3Unlocked ? getIcijOfficerNetwork(company.id) : Promise.resolve([]),
  ])
  isWatching = watchlistRows.length > 0

  const jsonLd = buildCompanyJsonLd({
    name: company.name,
    registrationNumber: company.registrationNumber,
    country: company.country,
    score: company.authenticityScore,
    scoreTier: tier,
    sanctionStatus: company.sanctionStatus,
    slug: company.slug,
    appUrl,
  })

  const tabs = [
    { id: 'registration',       label: 'Registration' },
    { id: 'directors',          label: 'Directors' },
    { id: 'beneficial-owners',  label: 'Beneficial Owners' },
    { id: 'vessels',            label: 'Vessels' },
    { id: 'flags',              label: 'Risk Flags' },
    { id: 'offshore',           label: 'Offshore Leaks' },
    { id: 'intelligence',       label: 'Intelligence' },
    { id: 'sources',            label: 'Sources' },
  ]

  const panels = [
    <RegistrationPanel key="registration" company={company} />,
    <ContentLock key="directors" unlocked={f3Unlocked} reason={lockReason}>
      <DirectorsPanel company={company} />
    </ContentLock>,
    <ContentLock key="beneficial-owners" unlocked={f3Unlocked} reason={lockReason}>
      <BeneficialOwnersPanel company={company} />
    </ContentLock>,
    <ContentLock key="vessels" unlocked={f3Unlocked} reason={lockReason}>
      <VesselsPanel company={company} />
    </ContentLock>,
    <ContentLock key="flags" unlocked={f3Unlocked} reason={lockReason}>
      <RiskFlagsPanel company={company} />
    </ContentLock>,
    <ContentLock key="offshore" unlocked={f3Unlocked} reason={lockReason}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <OffshoreLeaksPanel matches={icijMatches} />
        <IcijOfficerNetworkPanel links={icijOfficerLinks} />
      </div>
    </ContentLock>,
    <ContentLock key="intelligence" unlocked={f3Unlocked} reason={lockReason}>
      <IntelligencePanel entityType="company" entityKey={company.slug} />
    </ContentLock>,
    <SourcesPanel key="sources" sources={company.dataSource} />,
  ]

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <Header entityName={company.name} sanctionStatus={company.sanctionStatus} />

      <div
        style={{
          maxWidth: 'var(--max-width)',
          margin: '0 auto',
          padding: 'var(--space-6) var(--space-4)',
        }}
      >
        <div className="entity-layout">
          <aside aria-label="Entity summary" className="animate-fade-in-up">
            <ScoreGauge
              score={company.authenticityScore}
              tier={tier}
              breakdown={company.scoreBreakdown}
            />
            <div style={{ marginTop: 'var(--space-4)' }}>
              <SanctionBadge status={company.sanctionStatus} />
            </div>
            <div style={{ marginTop: 'var(--space-3)' }}>
              <RiskBadge level={company.riskLevel} />
            </div>
            <p style={{ marginTop: 'var(--space-4)', color: 'var(--text-muted)', fontSize: '12px' }}>
              {scoreNote}
            </p>
            {isExternalEntity && (
              <div style={{
                marginTop: 'var(--space-3)',
                padding: 'var(--space-2) var(--space-3)',
                backgroundColor: 'rgba(59,130,246,0.08)',
                border: '1px solid rgba(59,130,246,0.2)',
                borderRadius: '6px',
              }}>
                <span style={{ color: '#3b82f6', fontSize: '11px', lineHeight: '16px', display: 'block' }}>
                  External registry — some fields may be incomplete.
                </span>
              </div>
            )}
            <p style={{ marginTop: 'var(--space-2)', color: 'var(--text-muted)', fontSize: '12px' }}>
              Last verified:{' '}
              <time dateTime={company.lastVerified}>
                {new Date(company.lastVerified).toLocaleDateString('en-US', {
                  year: 'numeric', month: 'short', day: 'numeric',
                })}
              </time>
            </p>

            {f3Unlocked ? (
              <a
                href={`/api/report/${company.slug}`}
                download
                style={{
                  display: 'block',
                  marginTop: 'var(--space-5)',
                  padding: 'var(--space-2) var(--space-3)',
                  backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  color: 'var(--accent-primary)',
                  fontSize: '12px',
                  fontWeight: 500,
                  textDecoration: 'none',
                  textAlign: 'center',
                }}
              >
                ↓ Download PDF Report
              </a>
            ) : (
              <p style={{ marginTop: 'var(--space-5)', color: 'var(--text-muted)', fontSize: '11px', textAlign: 'center' }}>
                PDF export — Starter+
              </p>
            )}

            <WatchButton
              entityId={company.id}
              entityType="company"
              entityKey={company.slug}
              entityName={company.name}
              sanctionStatus={company.sanctionStatus}
              initialWatching={isWatching}
              plan={plan}
            />
          </aside>

          <main className="animate-fade-in-up-delay-1">
            <div style={{ marginBottom: 'var(--space-2)' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                {company.jurisdictionFlag} {company.country}
              </span>
            </div>
            <h1 style={{ color: 'var(--text-primary)', marginBottom: 'var(--space-2)' }}>
              {company.name}
            </h1>
            <p
              className="mono"
              style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}
            >
              {company.registrationNumber}
            </p>

            <p
              style={{
                color: 'var(--text-secondary)',
                fontSize: '13px',
                lineHeight: '22px',
                marginBottom: 'var(--space-6)',
                maxWidth: '600px',
              }}
            >
              {buildCompanyNarrative(company)}
            </p>

            {isExternalEntity && (
              <div style={{
                marginBottom: 'var(--space-4)',
                padding: 'var(--space-3) var(--space-4)',
                backgroundColor: 'rgba(59,130,246,0.06)',
                border: '1px solid rgba(59,130,246,0.18)',
                borderRadius: '8px',
                fontSize: '12px',
                color: 'var(--text-secondary)',
                lineHeight: '18px',
              }}>
                This entity was retrieved from{' '}
                <strong style={{ color: 'var(--text-primary)' }}>
                  {company.dataSource.join(' + ')}
                </strong>{' '}
                and is not yet in our local database. Data completeness may be limited
                compared to locally verified entities.
              </div>
            )}

            <TabNav tabs={tabs} defaultTab="registration" panels={panels} />
          </main>
        </div>
      </div>
    </>
  )
}
