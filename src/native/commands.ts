import { commands, type Host } from '@just-apps/host-contract'

export interface ProfileInfo {
  configDir: string
  signedIn: boolean
  email?: string
  displayName?: string
  organizationName?: string
  organizationType?: string
  rateLimitTier?: string
  defaultModel?: string
  baseUrl?: string
}

// A type alias, not an interface: `CommandMap` needs the implicit index signature only aliases get.
export type NativeCommands = {
  list_profiles: { args: { extra: string[] }; result: ProfileInfo[] }
}

export const native = (host: Host) => commands<NativeCommands>(host)
