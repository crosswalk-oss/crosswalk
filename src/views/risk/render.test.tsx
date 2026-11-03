// Smoke test: every view in this module renders from the seed without throwing.
import { renderToString } from 'react-dom/server'
import { useStore } from '@/core/store'
import Risk from '@/views/project/tabs/Risk'
import Safety from '@/views/project/tabs/Safety'
import RiskPortfolio from './RiskPortfolio'
import SafetyHome from '@/views/safety/SafetyHome'
import FieldMode from '@/views/safety/FieldMode'

describe('risk & safety views render', () => {
  const ids = ['prj-1001', 'prj-1003', 'prj-1006', 'prj-1020', 'prj-1024', 'prj-1009', 'prj-1030']
  it.each(ids)('project %s', (id) => {
    expect(renderToString(<Risk projectId={id} />)).toContain('Risk register')
    expect(renderToString(<Safety projectId={id} />)).toContain('notice to proceed')
  })
  it('portfolio, safety home, field mode', () => {
    expect(renderToString(<RiskPortfolio />)).toContain('Portfolio risk')
    expect(renderToString(<SafetyHome />)).toContain('Construction safety')
    expect(renderToString(<FieldMode />)).toContain('Tailboard')
  })
  it('field mode as contractor persona', () => {
    useStore.getState().setUser('c-2')
    expect(renderToString(<FieldMode />)).toContain('Stop-work authority')
  })
})
