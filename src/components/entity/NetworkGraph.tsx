'use client'

import { useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from '@dagrejs/dagre'
import type { NetworkNode, NetworkEdge } from '@/lib/server/repository'

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  nodes: NetworkNode[]
  edges: NetworkEdge[]
  truncated: boolean
  totalNodeCount: number
}

// ── Node dimensions (must match Dagre layout values exactly) ─────────────────

const NODE_WIDTH: Record<string, number> = {
  root: 160, company: 140, vessel: 140, person: 120, icij: 130,
}
const NODE_HEIGHT: Record<string, number> = {
  root: 48, company: 40, vessel: 40, person: 36, icij: 36,
}
const NODE_RADIUS: Record<string, number> = {
  root: 10, company: 8, vessel: 8, person: 18, icij: 6,
}

// ── Node colors (from 10-UI-SPEC.md — fixed values, do not modify) ───────────

const NODE_STYLES: Record<string, React.CSSProperties> = {
  root: {
    backgroundColor: 'rgba(94,106,210,0.25)',
    border:          '2px solid #5e6ad2',
    color:           '#f7f8f8',
  },
  sanctioned: {
    backgroundColor: 'rgba(239,68,68,0.18)',
    border:          '1.5px solid #ef4444',
    color:           '#ef4444',
  },
  fraud: {
    backgroundColor: 'rgba(249,115,22,0.15)',
    border:          '1.5px solid #f97316',
    color:           '#f97316',
  },
  icij: {
    backgroundColor: 'rgba(138,143,152,0.12)',
    border:          '1px solid rgba(138,143,152,0.4)',
    color:           '#8a8f98',
  },
  normal: {
    backgroundColor: 'rgba(94,106,210,0.15)',
    border:          '1px solid rgba(94,106,210,0.5)',
    color:           '#d0d6e0',
  },
}

// ── Shared panel styles (copied from FraudAlertsPanel.tsx) ───────────────────

const card: React.CSSProperties = {
  backgroundColor: 'var(--bg-surface)',
  borderRadius:    '10px',
  padding:         'var(--space-5)',
  border:          '1px solid var(--border-subtle)',
}

const sectionTitle: React.CSSProperties = {
  color:          'var(--text-muted)',
  fontSize:       '11px',
  fontWeight:     600,
  letterSpacing:  '0.08em',
  textTransform:  'uppercase',
  marginBottom:   'var(--space-4)',
}

// ── Dagre layout (LR direction, node separation from 10-UI-SPEC.md) ──────────

function applyDagreLayout(rfNodes: Node[], rfEdges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  // LR = left-to-right; nodesep=60 (vertical gap), ranksep=80 (horizontal gap)
  g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 80 })

  rfNodes.forEach((node) => {
    const w = NODE_WIDTH[node.type ?? 'company'] ?? 140
    const h = NODE_HEIGHT[node.type ?? 'company'] ?? 40
    g.setNode(node.id, { width: w, height: h })
  })
  rfEdges.forEach((edge) => g.setEdge(edge.source, edge.target))

  dagre.layout(g)

  return rfNodes.map((node) => {
    const pos = g.node(node.id)
    const w = NODE_WIDTH[node.type ?? 'company'] ?? 140
    const h = NODE_HEIGHT[node.type ?? 'company'] ?? 40
    return {
      ...node,
      targetPosition: Position.Left,
      sourcePosition: Position.Right,
      position: { x: pos.x - w / 2, y: pos.y - h / 2 },
    }
  })
}

// ── Custom Node Component ─────────────────────────────────────────────────────

interface ETINodeData {
  label: string
  fullName: string
  etlKey: string | null
  nodeColor: NetworkNode['nodeColor']
  subtype: string
  nodeType: NetworkNode['type']
}

function ETINode({ data, type }: NodeProps) {
  const router = useRouter()
  const nodeData = data as unknown as ETINodeData
  const clickable = !!nodeData.etlKey
  const colorStyle = NODE_STYLES[nodeData.nodeColor] ?? NODE_STYLES.normal
  const radius = NODE_RADIUS[type ?? 'company'] ?? 8
  const w = NODE_WIDTH[type ?? 'company'] ?? 140
  const h = NODE_HEIGHT[type ?? 'company'] ?? 40

  function handleClick() {
    if (!nodeData.etlKey) return
    if (type === 'vessel') {
      router.push(`/vessel/${nodeData.etlKey}`)
    } else {
      router.push(`/company/${nodeData.etlKey}`)
    }
  }

  return (
    <div
      role={clickable ? 'button' : undefined}
      aria-label={clickable ? `${nodeData.fullName} \u2014 click to view entity` : undefined}
      title={nodeData.fullName}
      onClick={handleClick}
      style={{
        width:          w,
        height:         h,
        borderRadius:   radius,
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
        cursor:         clickable ? 'pointer' : 'default',
        padding:        '2px 6px',
        transition:     'filter 0.1s ease, border-color 0.1s ease',
        ...colorStyle,
      }}
      onMouseEnter={(e) => {
        if (clickable) {
          ;(e.currentTarget as HTMLDivElement).style.filter = 'brightness(1.15)'
        }
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLDivElement).style.filter = 'none'
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <span
        style={{
          fontSize:     '13px',
          fontWeight:   type === 'root' ? 600 : 400,
          lineHeight:   '18px',
          color:        colorStyle.color,
          maxWidth:     '100%',
          overflow:     'hidden',
          textOverflow: 'ellipsis',
          whiteSpace:   'nowrap',
        }}
      >
        {nodeData.label}
      </span>
      <span
        style={{
          fontSize:   '11px',
          lineHeight: '14px',
          color:      'var(--text-muted)',
          marginTop:  '1px',
        }}
      >
        {nodeData.subtype}
      </span>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  )
}

// Register all node types — each maps to the same ETINode renderer
const nodeTypes = {
  root:    ETINode,
  company: ETINode,
  vessel:  ETINode,
  person:  ETINode,
  icij:    ETINode,
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function NetworkGraph({ nodes, edges, truncated, totalNodeCount }: Props) {
  // All hooks must be called unconditionally before any early return (Rules of Hooks)
  const { layoutedNodes, rfEdges } = useMemo(() => {
    if (nodes.length <= 1) return { layoutedNodes: [], rfEdges: [] }

    const rfNodes: Node[] = nodes.map((n) => ({
      id:       n.id,
      type:     n.type,
      data:     {
        label:     n.label,
        fullName:  n.fullName,
        etlKey:    n.etlKey,
        nodeColor: n.nodeColor,
        subtype:   n.subtype,
        nodeType:  n.type,
      },
      position: { x: 0, y: 0 }, // overwritten by Dagre
    }))

    const rfEdgesBuilt: Edge[] = edges.map((e) => ({
      id:     e.id,
      source: e.source,
      target: e.target,
      label:  e.label,
      style:
        e.edgeType === 'icij'
          ? {
              stroke:          'rgba(138,143,152,0.25)',
              strokeDasharray: '4 4',
              strokeWidth:     1,
              strokeLinecap:   'round' as const,
            }
          : {
              stroke:        'rgba(255,255,255,0.12)',
              strokeWidth:   1.5,
              strokeLinecap: 'round' as const,
            },
    }))

    const layouted = applyDagreLayout(rfNodes, rfEdgesBuilt)
    return { layoutedNodes: layouted, rfEdges: rfEdgesBuilt }
  }, [nodes, edges])

  const [rfNodes, setNodes, onNodesChange] = useNodesState(layoutedNodes)
  const [rfEdgesState, setEdges, onEdgesChange] = useEdgesState(rfEdges)

  // Sync React Flow internal state when layoutedNodes/rfEdges change (e.g. after soft navigation)
  useEffect(() => { setNodes(layoutedNodes) }, [layoutedNodes, setNodes])
  useEffect(() => { setEdges(rfEdges) }, [rfEdges, setEdges])

  // Screen-reader summary (accessibility fallback)
  const directorCount = nodes.filter((n) => n.type === 'person').length
  const vesselCount   = nodes.filter((n) => n.type === 'vessel').length
  const icijCount     = nodes.filter((n) => n.type === 'icij').length
  const rootName      = nodes.find((n) => n.type === 'root')?.fullName ?? 'this entity'

  // Early return AFTER all hooks have been called
  if (nodes.length <= 1) {
    return (
      <div style={card}>
        <p style={sectionTitle}>Network Graph</p>
        <div
          style={{
            height:         640,
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ textAlign: 'center', padding: 'var(--space-8) 0' }}>
            <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
              No network connections found
            </p>
            <p
              style={{
                fontSize:   '13px',
                color:      'var(--text-muted)',
                lineHeight: '20px',
                marginTop:  '8px',
                maxWidth:   360,
              }}
            >
              This entity has no director records, vessel associations, or ICIJ offshore matches on file.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={card}>
      <p style={sectionTitle}>Network Graph</p>

      {/* Screen-reader accessible summary */}
      <p className="sr-only">
        Network graph showing {rootName}&apos;s ownership and director connections.
        {directorCount > 0 && ` ${directorCount} director${directorCount > 1 ? 's' : ''}.`}
        {vesselCount > 0 && ` ${vesselCount} vessel${vesselCount > 1 ? 's' : ''}.`}
        {icijCount > 0 && ` ${icijCount} ICIJ offshore entit${icijCount > 1 ? 'ies' : 'y'}.`}
      </p>

      <div
        role="img"
        aria-label={`Network graph showing ${rootName}'s ownership and director connections`}
        style={{
          position:     'relative',
          height:       640,
          borderRadius: 10,
          overflow:     'hidden',
          border:       '1px solid var(--border-subtle)',
        }}
      >
        {/* Truncation banner — shown when ICIJ query hit 100-node cap */}
        {truncated && (
          <div
            style={{
              position:     'absolute',
              top:          0,
              left:         0,
              right:        0,
              zIndex:       10,
              background:   'rgba(245,158,11,0.1)',
              borderBottom: '1px solid rgba(245,158,11,0.2)',
              padding:      '8px 16px',
              fontSize:     12,
              color:        '#f59e0b',
            }}
          >
            Showing 100 of {totalNodeCount} network nodes \u2014 graph truncated for performance.
          </div>
        )}

        <ReactFlow
          nodes={rfNodes}
          edges={rfEdgesState}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.3}
          maxZoom={2.0}
          proOptions={{ hideAttribution: false }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            color="rgba(255,255,255,0.04)"
            gap={20}
            size={1}
          />
          <Controls position="bottom-left" />
        </ReactFlow>

        {/* Scoped CSS overrides — React Flow dark theme adaptation */}
        <style>{`
          .react-flow__background { background-color: var(--bg-surface); }
          .react-flow__controls { background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 6px; box-shadow: none; }
          .react-flow__controls-button { background: transparent; border-bottom: 1px solid var(--border-subtle); color: var(--text-muted); }
          .react-flow__controls-button:hover { background: var(--bg-subtle); color: var(--text-primary); }
          .react-flow__controls-button:last-child { border-bottom: none; }
          .react-flow__edge-path { stroke-linecap: round; }
          .react-flow__node { outline: none; }
          .react-flow__node:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 2px; }
          .react-flow__attribution a { color: var(--text-muted) !important; }
        `}</style>
      </div>

      {/* Panel footnote */}
      <p
        style={{
          color:      'var(--text-muted)',
          fontSize:   '11px',
          lineHeight: '16px',
          marginTop:  'var(--space-4)',
        }}
      >
        Relationship data sourced from ICIJ Offshore Leaks Database and ETI corporate registries.
        Graph shows up to 3 hops of ownership and directorship connections.
      </p>
    </div>
  )
}
