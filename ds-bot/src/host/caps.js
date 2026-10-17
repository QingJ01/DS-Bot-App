// Daily budgets: a Bot stops taking new work once it has spent its own limit for the day.
//
// DS Bot's usage ledger counts tokens, not money — the models a deployment runs and their
// prices are DSH's business, not the plugin's — so a budget is a token count for one local
// day. It is the companion of the chain and hop limits: those bound how far a Bot goes on
// its own, this bounds what it may spend while doing it.
//
// A budget is checked when work would start, not while it runs: a turn already under way
// finishes, because cutting a model call in half leaves the team with a reply that makes no
// sense. What the check sees is what the usage ledger has read (see usage.js).
const MAX_TOKENS = 100_000_000
const MAX_REACHED = 200

const invalid = message => Object.assign(new Error(message), { code: 'bot/invalid' })

export function install(rt) {
  const { state } = rt

  // The team's time zone, so "today" is the user's day and not the host's UTC one. The
  // browser and the phone send it with each team read (channel.js); the team file keeps it.
  const setTimeZone = (value) => {
    if (typeof value !== 'string' || !/^[\w+/.-]{1,64}$/.test(value) || value === state.prefs.timeZone) return
    state.prefs.timeZone = value
    void rt.save().catch(() => {})
  }

  const today = () => state.caps?.day
  // What a Bot may spend in one day, or undefined when it has no budget.
  const budgetOf = bot => {
    const value = bot?.dailyTokens
    return Number.isSafeInteger(value) && value > 0 ? value : undefined
  }

  // The day a Bot's budget ran out, as the team file keeps it: a restart in the middle of a
  // spent day must not forget that the budget was already reported. Read from the team every
  // time rather than kept beside it, so a load that brings a saved team and this module's
  // own writes can never disagree.
  const reachedDay = botId => (Array.isArray(state.caps?.reached) ? state.caps.reached : [])
    .find(item => item?.botId === botId)?.day
  const markReached = (botId, when) => {
    const rest = (Array.isArray(state.caps?.reached) ? state.caps.reached : []).filter(item => item?.botId !== botId)
    state.caps = { ...(state.caps ?? {}), reached: [...rest, { botId, day: when }].slice(-MAX_REACHED) }
  }
  const forgetReached = (botId) => {
    state.caps = { ...(state.caps ?? {}), reached: (Array.isArray(state.caps?.reached) ? state.caps.reached : []).filter(item => item?.botId !== botId) }
  }

  async function totals() {
    const view = await rt.usageToday?.({ timeZone: state.prefs.timeZone })
    if (view === undefined) return { day: undefined, totals: new Map() }
    // A new day clears the budgets that ran out in the last one.
    if (view.day !== undefined && view.day !== today()) {
      state.caps = { day: view.day, reached: [] }
      await rt.save().catch(() => {})
    }
    return view
  }

  // Whether this Bot may start work now, with what it has spent today. A Bot without a
  // budget answers without touching the ledger: a check runs on every delivery, and most
  // Bots have no budget.
  async function budgetState(bot) {
    const limit = budgetOf(bot)
    if (limit === undefined) return { cap: undefined, used: 0, day: today(), blocked: false }
    const { day: current, totals: spent } = await totals()
    const used = (spent.get(bot.id)?.tokens) ?? 0
    return { cap: limit, used, day: current, blocked: used >= limit }
  }

  // The one place a turn is refused. Returns the sentence to show, or undefined to go on.
  async function budgetBlocks(bot, { source = 'turn' } = {}) {
    if (bot === undefined) return undefined
    const entry = await budgetState(bot)
    if (entry.cap === undefined || !entry.blocked) return undefined
    const current = entry.day ?? 'today'
    if (reachedDay(bot.id) !== current) {
      markReached(bot.id, current)
      await rt.save().catch(() => {})
      rt.noteFailure?.({
        level: 'warn',
        source: 'budget',
        text: `${bot.name} reached its daily budget of ${entry.cap} tokens (${entry.used} used) at ${source}; its new work is refused until the next day`,
        bot: bot.name,
      })
    }
    return `${bot.name} has reached its daily budget of ${entry.cap} tokens (${entry.used} used on ${current}). It takes no new work until the next day; raise or clear the budget in its settings.`
  }

  // Per Bot: what it may spend, what it has spent today, and whether it is stopped.
  async function budgetsView() {
    const { day, totals: spent } = await totals()
    return {
      day,
      bots: Object.values(state.bots).map(bot => {
        const cap = budgetOf(bot)
        const used = spent.get(bot.id)?.tokens ?? 0
        return { id: bot.id, name: bot.name, ...(cap === undefined ? {} : { cap }), used, ...(cap !== undefined && used >= cap ? { blocked: true } : {}) }
      }),
    }
  }

  // The budget as the team view carries it: the setting only, so a team read stays cheap.
  const capsView = () => Object.fromEntries(Object.entries(state.bots)
    .filter(([, bot]) => budgetOf(bot) !== undefined)
    .map(([id, bot]) => [id, { cap: budgetOf(bot), ...(today() !== undefined && reachedDay(id) === today() ? { blocked: true } : {}) }]))

  const cleanBudget = (value) => {
    if (value === null || value === '' || value === undefined) return undefined
    const tokens = typeof value === 'number' ? value : Number(String(value).trim())
    if (!Number.isSafeInteger(tokens) || tokens <= 0) throw invalid('Give the daily budget in whole tokens')
    if (tokens > MAX_TOKENS) throw invalid(`Keep the daily budget under ${MAX_TOKENS} tokens`)
    return tokens
  }

  const budgetEndpoint = async (endpoint, body = {}) => {
    await rt.load()
    if (endpoint === 'budgets') return budgetsView()
    if (rt.readOnly?.() !== undefined) throw Object.assign(new Error('Use the DSH host that owns this Bot team.'), { code: 'bot/refused' })
    const bot = rt.botOf(body.id)
    if (bot === undefined) throw invalid('There is no Bot with that id')
    if (endpoint === 'budget-set') {
      // A Bot's budget is the user's to set; a Main Bot may set another Bot's, the way it
      // may change that Bot at all, but a Bot may never raise its own.
      if (body.actorId !== undefined && body.actorId === bot.id) throw invalid('A Bot cannot set its own daily budget')
      const tokens = cleanBudget(body.tokens)
      if (tokens === undefined) delete bot.dailyTokens
      else bot.dailyTokens = tokens
      forgetReached(bot.id)
      await rt.save()
      return { id: bot.id, cap: budgetOf(bot) }
    }
    if (endpoint === 'budget-clear') {
      delete bot.dailyTokens
      forgetReached(bot.id)
      await rt.save()
      return { id: bot.id, cap: undefined }
    }
    throw invalid(`Unknown budget endpoint ${endpoint}`)
  }

  // A budget is a team setting, so it travels with the team file like the rest of the Bot.
  Object.assign(rt, { budgetEndpoint, budgetsView, budgetState, budgetBlocks, capsView, setTimeZone })
}
