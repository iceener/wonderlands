export interface SandboxLoHostPathMap {
  input: string
  output: string
  vault?: string
  work: string
}

export interface SandboxLoHostApiConfig {
  paths: SandboxLoHostPathMap
}
