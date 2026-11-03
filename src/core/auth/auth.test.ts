import { expect, it } from 'vitest'
import { demoAuthProvider, demoGroupMap, rolesForGroups } from './index'
import { buildSeed } from '../seed'

it('groups map to roles; the demo provider exposes only id, name and groups', () => {
  const s = buildSeed()
  const me = s.people.find((p) => p.id === s.currentUserId)!
  const u = demoAuthProvider(() => me).currentUser()!
  expect(Object.keys(u).sort()).toEqual(['groups', 'id', 'name'])
  const map = demoGroupMap(s.roles.map((r) => r.id))
  expect(rolesForGroups(map, u.groups).sort()).toEqual([...me.roles].sort())
  expect(rolesForGroups(map, ['someone-elses-group'])).toEqual([])
})
