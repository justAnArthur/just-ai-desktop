import { List } from '@justanarthur/modo-ui'
import { ProfileTile } from '@justanarthur/modo-ui-ai/blocks/profiles/profile-switcher'
import { useProfiles } from './use-profiles'

export default function Home() {
  const { profiles, defaultId, loading } = useProfiles()
  if (loading) return null

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 p-6">
      <h1 className="text-title">Profiles</h1>
      <List>
        <List.Section title="Claude config dirs" aside={`${profiles.length}`}>
          {profiles.map(profile => (
            <List.Row
              key={profile.id}
              label={
                <span className="flex items-center gap-2">
                  <ProfileTile profile={profile} />
                  {profile.name}
                  {profile.id === defaultId && <span className="text-caption text-muted-foreground">default</span>}
                </span>
              }
              description={[profile.account, profile.baseUrl ?? profile.configDir, profile.defaultModel].filter(Boolean).join(' · ')}
            >
              <span className="pr-3 text-caption text-muted-foreground">{profile.plan}</span>
            </List.Row>
          ))}
        </List.Section>
      </List>
    </main>
  )
}
