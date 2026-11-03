// Input control for one Project Information field, chosen by field type.
import type { InfoFieldDef } from '@/core/types'
import { Input, MoneyInput, Select, TextArea } from '@/ui/kit'

export function FieldInput({ def, value, onChange, id }: { def: InfoFieldDef; value: string; onChange: (v: string) => void; id: string }) {
  switch (def.type) {
    case 'textarea':
      return <TextArea id={id} rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
    case 'select': {
      const opts = def.options ?? []
      return <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} options={[{ value: '', label: '— Select —' }, ...(value && !opts.includes(value) ? [value] : []), ...opts]} />
    }
    case 'boolean':
      return <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} options={[{ value: '', label: '— Select —' }, 'Yes', 'No']} />
    case 'date':
      return <Input id={id} type="date" value={value.slice(0, 10)} onChange={(e) => onChange(e.target.value)} />
    case 'number':
      return <Input id={id} type="number" inputMode="decimal" className="tabular-nums" value={value} onChange={(e) => onChange(e.target.value)} />
    case 'money':
      return <MoneyInput id={id} value={Number(value.replace(/[^0-9.-]/g, '')) || 0} onChange={(n) => onChange(n ? String(n) : '')} />
    default:
      return <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
  }
}
