// Login through a swappable OIDC interface (AGENT_RULES rule 20). The app uses only the user's ID, name and
// group claims; groups map to Crosswalk roles. The demo uses the persona switcher (no login, fictional people).
// A production OIDC provider (e.g. the company identity provider) implements the same interface — not built yet.
import type { Person, RoleId } from '../types'

export interface AuthUser { id: string; name: string; groups: string[] }

export interface AuthProvider {
  readonly kind: 'demo' | 'oidc'
  /** The signed-in user, or null when nobody is signed in. */
  currentUser(): AuthUser | null
  signIn(): Promise<void>
  signOut(): Promise<void>
}

/** Group claim → Crosswalk roles. Configured per deployment; the demo maps `crosswalk-<role>` to `<role>`. */
export type GroupRoleMap = Record<string, RoleId[]>

export function rolesForGroups(map: GroupRoleMap, groups: string[]): RoleId[] {
  return Array.from(new Set(groups.flatMap((g) => map[g] ?? [])))
}

export const demoGroupMap = (roles: RoleId[]): GroupRoleMap => Object.fromEntries(roles.map((r) => [`crosswalk-${r}`, [r]]))

/** Demo provider: the persona switcher picks one of the fictional people; their roles become group claims. */
export function demoAuthProvider(getPerson: () => Person | undefined): AuthProvider {
  return {
    kind: 'demo',
    currentUser() {
      const p = getPerson()
      return p ? { id: p.id, name: p.name, groups: p.roles.map((r) => `crosswalk-${r}`) } : null
    },
    async signIn() { /* demo: nothing to do */ },
    async signOut() { /* demo: nothing to do */ },
  }
}
