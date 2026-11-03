import { renderToString } from 'react-dom/server'
import { useStore } from '@/core/store'
import Catalog from './Catalog'
import Designer from './Designer'
import Inbox from '../inbox/Inbox'
import Activity from '../project/tabs/Activity'
import { TestMode } from './TestMode'
import { SopView } from './SopView'
import { VersionsPanel } from './Versions'
import { sopHtml, manualHtml } from './sop'
import { defaultTestProject, defaultValues } from './lib'

test('views render from seed', () => {
  const s = useStore.getState()
  const html = [
    renderToString(<Catalog />),
    renderToString(<Inbox />),
    renderToString(<Activity projectId="prj-1001" />),
    ...s.workflowDefs.map((d) => renderToString(<Designer id={d.key} />)),
    renderToString(<Designer id="nope" />),
  ]
  for (const d of s.workflowDefs) {
    const pv = { projectId: defaultTestProject(s), requesterId: s.currentUserId, data: defaultValues(d) }
    html.push(renderToString(<TestMode s={s} def={d} preview={pv} setPreview={() => {}} />))
    html.push(renderToString(<SopView s={s} def={d} onDownload={() => {}} />))
    html.push(renderToString(<VersionsPanel s={s} defKey={d.key} current={d} onOpen={() => {}} />))
    expect(sopHtml(s, d).length).toBeGreaterThan(3000)
  }
  expect(manualHtml(s, s.workflowDefs).length).toBeGreaterThan(20000)
  console.log(html.map((h) => h.length).join(' '))
  // persona switch: VP inbox
  useStore.getState().setUser('u-vp')
  console.log('vp inbox', renderToString(<Inbox />).length)
  useStore.getState().setUser('u-pc1')
  console.log('pc inbox', renderToString(<Inbox />).length)
})
