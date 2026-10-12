const assert = require('node:assert/strict')
const { test } = require('node:test')
const { buildUsageState } = require('./usage-state.cjs')

test('multi-bucket rate limits warn at 80 percent and retain honest account labels', () => {
  const state = buildUsageState({ rateLimitsByLimitId: {
    codex: { limitName: null, primary: { usedPercent: 79, windowDurationMins: 300, resetsAt: 2000000000 },
      secondary: { usedPercent: 80, windowDurationMins: 10080, resetsAt: 2000500000 } },
    extra: { limitName: 'Other Codex', primary: { usedPercent: 100, windowDurationMins: 60, resetsAt: 2000000000 } },
  } }, { summary: { lifetimeTokens: 12345 }, dailyUsageBuckets: [{ startDate: '2026-10-08', tokens: 321 }] },
  {}, '2026-10-08T00:00:00.000Z')
  assert.equal(state.status, 'ready')
  assert.equal(state.buckets.length, 2)
  assert.deepEqual(state.warnings.map(item => [item.bucketId, item.kind, item.usedPercent]),
    [['codex', 'secondary', 80], ['extra', 'primary', 100]])
  assert.deepEqual(state.tokenActivity, { lifetimeTokens: 12345, latestDay: { date: '2026-10-08', tokens: 321 } })
  assert.equal(state.thresholdPercent, 80)
})

test('legacy rate-limit bucket and unavailable token activity are distinct', () => {
  const state = buildUsageState({ rateLimits: { limitId: 'codex', primary: { usedPercent: 40,
    windowDurationMins: 300, resetsAt: 2000000000 } } }, null, { tokens: 'Unsupported account mode' })
  assert.equal(state.status, 'ready')
  assert.equal(state.buckets[0].name, 'codex')
  assert.equal(state.tokenActivity, null)
  assert.equal(state.tokenError, 'Unsupported account mode')
  assert.deepEqual(state.warnings, [])
})

test('invalid or unavailable data is not shown as zero usage', () => {
  const state = buildUsageState({ rateLimits: { primary: { usedPercent: -1 } } },
    { summary: { lifetimeTokens: null }, dailyUsageBuckets: null },
    { rate: 'Not signed in', tokens: 'Not signed in' })
  assert.equal(state.status, 'unavailable')
  assert.deepEqual(state.buckets, [])
  assert.equal(state.tokenActivity, null)
  assert.equal(state.rateError, 'Not signed in')
})
