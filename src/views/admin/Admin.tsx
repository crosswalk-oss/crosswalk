// Configuration console: how an administrator tailors Crosswalk for a utility.
import { useEffect, useState } from 'react'
import { useStore } from '@/core/store'
import { fmtDateTime } from '@/core/util'
import { PageHeader, Tabs } from '@/ui/kit'
import Templates from './Templates'
import Programs from './Programs'
import Cbs from './Cbs'
import Libraries from './Libraries'
import { CustomFields, PeopleTab } from './People'
import DataTab from './Data'
import WbsFunctions from './WbsFunctions'
import InfoFields from './InfoFields'
import GisSettings from './GisSettings'
import ForecastLines from './ForecastLines'
import SapMappings from './SapMappings'
import SpreadProfiles from './SpreadProfiles'
import QuickEstimateSettings from './QuickEstimateSettings'
import AiSettings from './AiSettings'
import WorkflowSettings from './WorkflowSettings'
import Modules from './Modules'
import { lsGet, lsSet } from './common'

type Tab = 'templates' | 'programs' | 'cbs' | 'wbs' | 'lines' | 'sap' | 'profiles' | 'quick' | 'info' | 'gis' | 'ai' | 'libraries' | 'fields' | 'people' | 'data' | 'notify' | 'modules'
const CONFIG_ENTITIES = ['gis', 'forecast-line', 'sap-mapping', 'spread-profile', 'historical-cost', 'quick-estimate', 'wbs', 'info-field', 'template', 'program', 'funding', 'doa', 'cost-category', 'settings', 'risk-library', 'hazard-library', 'person', 'role', 'data']

/** Deep link to a Configuration tab, e.g. adminHref('notify') → #admin-notify. */
export const adminHref = (tab: Tab) => `#admin-${tab}`

export default function Admin({ id }: { projectId?: string; id?: string }) {
  const s = useStore()
  const [tab, setTabState] = useState<Tab>(() => (id as Tab) || lsGet<Tab>('crosswalk:admin-tab', 'templates'))
  const setTab = (t: Tab) => { setTabState(t); lsSet('crosswalk:admin-tab', t) }
  useEffect(() => { if (id) setTab(id as Tab) }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { document.getElementById('main')?.scrollTo?.({ top: 0 }) }, [tab])
  const lastConfig = [...s.audit].reverse().find((a) => CONFIG_ENTITIES.includes(a.entity))
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'templates', label: 'Lifecycle templates', count: s.templates.length },
    { id: 'programs', label: 'Programs & funding', count: s.programs.length },
    { id: 'cbs', label: 'Cost structure' },
    { id: 'wbs', label: 'WBS functions', count: s.settings.wbsFunctions.length },
    { id: 'lines', label: 'Forecast line items', count: s.settings.forecastLines.length },
    { id: 'sap', label: 'SAP mapping', count: s.settings.sapMappings.length },
    { id: 'profiles', label: 'Spread profiles', count: s.settings.spreadProfiles.length },
    { id: 'quick', label: 'Class 5 quick estimate' },
    { id: 'info', label: 'Project info fields', count: s.settings.infoFields.length },
    { id: 'gis', label: 'GIS & maps', count: s.settings.gis.layers.length },
    { id: 'notify', label: 'Workflow notifications' },
    { id: 'modules', label: 'Modules' },
    { id: 'ai', label: 'AI assist' },
    { id: 'libraries', label: 'Libraries', count: s.riskLibrary.length + s.hazards.length },
    { id: 'fields', label: 'Custom fields', count: s.settings.fieldDefs.length },
    { id: 'people', label: 'People & roles', count: s.people.length },
    { id: 'data', label: 'Data' },
  ]
  return (
    <div>
      <PageHeader eyebrow="Configure" title="Configuration"
        subtitle={`Tailor ${s.settings.orgName}'s lifecycle, programs, cost structure, libraries and people. Every change is written to the audit log; records already approved are never altered.`}
        actions={lastConfig && <a href="#audit" className="text-[12px] text-muted hover:text-ink">Last change {fmtDateTime(lastConfig.at)} · view audit log</a>} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} className="mb-4" />
      {tab === 'templates' && <Templates />}
      {tab === 'programs' && <Programs />}
      {tab === 'cbs' && <Cbs />}
      {tab === 'wbs' && <WbsFunctions />}
      {tab === 'lines' && <ForecastLines />}
      {tab === 'sap' && <SapMappings />}
      {tab === 'profiles' && <SpreadProfiles />}
      {tab === 'quick' && <QuickEstimateSettings />}
      {tab === 'info' && <InfoFields />}
      {tab === 'gis' && <GisSettings />}
      {tab === 'notify' && <WorkflowSettings />}
      {tab === 'modules' && <Modules />}
      {tab === 'ai' && <AiSettings />}
      {tab === 'libraries' && <Libraries />}
      {tab === 'fields' && <CustomFields />}
      {tab === 'people' && <PeopleTab />}
      {tab === 'data' && <DataTab />}
    </div>
  )
}
