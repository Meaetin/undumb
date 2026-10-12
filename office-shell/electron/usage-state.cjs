const WARNING_PERCENT = 80

function finiteNumber(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null
}

function normalizeWindow(value, kind) {
  if (!value || typeof value !== 'object') return null
  const usedPercent = finiteNumber(value.usedPercent, 0, 100)
  if (usedPercent === null) return null
  return {
    kind,
    usedPercent,
    windowDurationMins: finiteNumber(value.windowDurationMins),
    resetsAt: finiteNumber(value.resetsAt),
  }
}

function normalizeRateLimits(result) {
  if (!result || typeof result !== 'object') return null
  const byId = result.rateLimitsByLimitId && typeof result.rateLimitsByLimitId === 'object'
    ? Object.entries(result.rateLimitsByLimitId) : []
  const entries = byId.length ? byId : result.rateLimits ? [[result.rateLimits.limitId || 'codex', result.rateLimits]] : []
  const buckets = entries.slice(0, 20).flatMap(([id, value]) => {
    if (!value || typeof value !== 'object') return []
    const windows = [normalizeWindow(value.primary, 'primary'), normalizeWindow(value.secondary, 'secondary')].filter(Boolean)
    if (!windows.length && !value.rateLimitReachedType) return []
    return [{ id: String(id).slice(0, 100), name: typeof value.limitName === 'string' && value.limitName.trim()
      ? value.limitName.slice(0, 100) : String(id).slice(0, 100),
    windows, reached: Boolean(value.rateLimitReachedType) }]
  })
  return buckets.length ? buckets : null
}

function normalizeTokenActivity(result) {
  if (!result || typeof result !== 'object') return null
  const lifetimeTokens = finiteNumber(result.summary?.lifetimeTokens)
  const daily = Array.isArray(result.dailyUsageBuckets) ? result.dailyUsageBuckets
    .filter(item => typeof item?.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.startDate) && finiteNumber(item.tokens) !== null)
    .sort((a, b) => b.startDate.localeCompare(a.startDate))[0] : null
  if (lifetimeTokens === null && !daily) return null
  return { lifetimeTokens, latestDay: daily ? { date: daily.startDate, tokens: daily.tokens } : null }
}

function buildUsageState(rateResult, tokenResult, errors = {}, fetchedAt = new Date().toISOString()) {
  const buckets = normalizeRateLimits(rateResult)
  const tokenActivity = normalizeTokenActivity(tokenResult)
  const warnings = (buckets || []).flatMap(bucket => bucket.windows
    .filter(window => window.usedPercent >= WARNING_PERCENT)
    .map(window => ({ bucketId: bucket.id, name: bucket.name, kind: window.kind, usedPercent: window.usedPercent })))
  for (const bucket of buckets || []) {
    if (bucket.reached && !warnings.some(item => item.bucketId === bucket.id)) {
      warnings.push({ bucketId: bucket.id, name: bucket.name, kind: 'limit', usedPercent: null })
    }
  }
  return {
    status: buckets !== null || tokenActivity !== null ? 'ready' : 'unavailable',
    source: 'Codex app-server account endpoints',
    fetchedAt,
    thresholdPercent: WARNING_PERCENT,
    buckets: buckets || [],
    tokenActivity,
    warnings,
    rateError: errors.rate || (buckets === null ? 'Rate-limit data unavailable' : null),
    tokenError: errors.tokens || (tokenActivity === null ? 'Token activity unavailable' : null),
  }
}

module.exports = { WARNING_PERCENT, normalizeRateLimits, normalizeTokenActivity, buildUsageState }
