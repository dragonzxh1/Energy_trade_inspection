const c = []
process.stdin.on('data', d => c.push(d))
process.stdin.on('end', () => {
  const data = JSON.parse(Buffer.concat(c).toString())
  console.log('Overall Risk :', data.overallRisk.toUpperCase())
  console.log('Entities     :', data.entities.length)
  console.log()
  data.entities.forEach(e => {
    const ex = e.extracted
    const icij = e.icijConnections ? ` | ICIJ:${e.icijConnections.length}` : ''
    const psc  = (e.pscDeficiencyRate != null) ? ` | PSC:${Math.round(e.pscDeficiencyRate * 100)}%` : ''
    const imo  = ex.imo ? ` | IMO:${ex.imo}` : ''
    console.log(
      `[${e.riskLevel.toUpperCase().padEnd(8)}]`,
      `[${e.sanctionStatus.padEnd(10)}]`,
      `[${ex.type.padEnd(7)}]`,
      ex.name.slice(0, 45) + imo + icij + psc
    )
  })
})
