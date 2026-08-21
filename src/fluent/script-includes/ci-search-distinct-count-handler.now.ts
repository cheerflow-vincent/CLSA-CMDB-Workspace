import '@servicenow/sdk/global'
import { ScriptInclude } from '@servicenow/sdk/core'

export const ci_search_distinct_count_handler = ScriptInclude({
  $id: Now.ID['ci-search-distinct-count-handler'],
  name: 'CiSearchDistinctCountHandler',
  active: true,
  description: 'Distinct COUNT(DISTINCT) aggregates for CI Search summary banner',
  script: Now.include('../scripts/ci-search-distinct-count-handler.js'),
})
