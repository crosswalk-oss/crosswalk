import { expect, test } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BrandMark } from './kit'

test('the brand mark is a labelled picture with three stripes on the honey brand circle', () => {
  const html = renderToStaticMarkup(<BrandMark size={40} className="text-steel" />)
  expect(html).toContain('aria-label="Crosswalk"')
  expect(html).toContain('width="40"')
  expect(html).toContain('rgb(var(--brand))')
  expect(html.match(/<polygon/g)).toHaveLength(3)
  expect(html).toContain('text-steel')
})
