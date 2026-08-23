declare module '@firecrawl/agent-core' {
  export interface AgentRunResult {
    data?: unknown
    text?: string
    usage: { totalTokens: number }
  }

  export interface FirecrawlAgent {
    run(input: Record<string, unknown>): Promise<AgentRunResult>
  }

  export function createAgent(options: Record<string, unknown>): FirecrawlAgent
}
