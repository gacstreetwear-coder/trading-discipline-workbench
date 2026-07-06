const STORAGE_KEY = "trading-discipline-workbench:v1";
const SNAPSHOT_KEY = "trading-discipline-workbench:snapshots:v1";
const API_BASE = window.location.origin.startsWith("http") ? window.location.origin : "http://127.0.0.1:5173";
const EVENT_CACHE_TTL = 60 * 60 * 6;
const CANDLE_HISTORY_DAYS = 10000;
const FALLBACK_CANDLE_COUNT = 3600;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const todayISO = () => new Date().toISOString().slice(0, 10);
const addDaysISO = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const num = (value) => {
  const normalized = String(value ?? "").replaceAll(",", "").trim();
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const money = (value) =>
  new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value || 0);

const price = (value) =>
  formatPrice(value);

const percent = (value, digits = 1) => `${Number(value || 0).toFixed(digits)}%`;
const signedPercent = (value, digits = 2) => `${num(value) > 0 ? "+" : ""}${percent(value, digits)}`;

function formatPrice(value) {
  const number = num(value);
  const hasFourDecimalPrecision = Math.abs(number * 100 - Math.round(number * 100)) > 0.000001;
  const digits = hasFourDecimalPrecision ? 4 : 2;
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(number);
}
const EVENT_CATEGORIES = ["宏观经济数据", "重大会议", "重点公司事件"];
const MANAGED_OFFICIAL_EVENT_SOURCES = new Set([
  "nbs",
  "bea",
  "bea-pce",
  "bls",
  "bls-cpi",
  "adp",
  "fed",
  "fomc",
  "fiscaldata",
  "treasury-tic",
]);
const CRITICAL_US_EVENT_GROUPS = [
  { key: "pce", label: "PCE/核心PCE", match: (event) => /PCE|个人收入与支出|个人消费支出|核心PCE/i.test(`${event.title} ${event.note}`) },
  { key: "cpi", label: "CPI/核心CPI", match: (event) => /CPI|消费者价格指数|核心CPI|Consumer Price Index/i.test(`${event.title} ${event.note}`) },
  { key: "nfp", label: "非农", match: (event) => /非农|Employment Situation|Nonfarm/i.test(`${event.title} ${event.note}`) },
  { key: "adp", label: "ADP小非农", match: (event) => /ADP|小非农/i.test(`${event.title} ${event.note}`) },
  { key: "fomc", label: "美联储FOMC", match: (event) => /FOMC|美联储|Federal Reserve/i.test(`${event.title} ${event.note}`) },
  { key: "treasury", label: "美国财政部", match: (event) => /财政部|TIC|Treasury|fiscal/i.test(`${event.title} ${event.note} ${event.source}`) },
];
const CHART_PERIOD_LABELS = {
  day: "日线",
  week: "周线",
  month: "月线",
};
const CHART_ZOOM_LIMITS = {
  day: { min: 30, max: 10000, step: 80 },
  week: { min: 8, max: 2600, step: 16 },
  month: { min: 4, max: 600, step: 6 },
};
const CHART_DEFAULT_WINDOWS = {
  day: 160,
  week: 120,
  month: 60,
};
const MAIN_INDICATORS = {
  ma: { label: "MA均线" },
  bbi: { label: "BBI多空线" },
};
const SUB_INDICATORS = {
  volume: { label: "成交量" },
  amount: { label: "成交额" },
  macd: { label: "MACD" },
  kdj: { label: "KDJ" },
  rsi: { label: "RSI" },
};
const MAX_SUB_INDICATORS = 4;
const PLAN_ITEM_CONFIG = {
  weeklyFocusItems: {
    title: "本周方向",
    addLabel: "添加周方向",
    placeholder: "例如：只做计划内趋势延续，不追高。",
    types: ["方向判断", "主线机会", "仓位安排", "风险观察", "自定义"],
  },
  weeklyAvoidItems: {
    title: "本周禁止事项",
    addLabel: "添加周禁止",
    placeholder: "例如：重要数据发布前不追涨。",
    types: ["不开新仓", "不追涨", "不补仓", "不逆纪律", "自定义"],
  },
  dailyStrategyItems: {
    title: "今日策略",
    addLabel: "添加策略",
    placeholder: "例如：指数未放量突破前，只观察不进攻。",
    types: ["市场策略", "持仓策略", "开仓策略", "事件策略", "自定义"],
  },
  dailyTaskItems: {
    title: "今日任务",
    addLabel: "添加任务",
    placeholder: "例如：检查持仓是否触及第一止盈位。",
    types: ["持仓检查", "观察标的", "减仓执行", "事件跟踪", "复盘记录", "自定义"],
  },
  dailyAvoidItems: {
    title: "今日禁止事项",
    addLabel: "添加禁止事项",
    placeholder: "例如：盘中临时起意不下单。",
    types: ["不追涨", "不补仓", "不超仓位", "不计划外交易", "自定义"],
  },
};
const EVENT_SCOPE_GROUPS = {
  all: [
    { label: "全部范围", value: "all" },
    { label: "全球", value: "全球" },
    { label: "中国/大中华", value: "中国大中华" },
    { label: "美国", value: "美国" },
    { label: "欧洲", value: "欧洲" },
    { label: "日本", value: "日本" },
    { label: "韩国", value: "韩国" },
    { label: "其他", value: "其他" },
  ],
  macro: [
    { label: "全部范围", value: "all" },
    { label: "全球", value: "全球" },
    { label: "中国/大中华", value: "中国大中华" },
    { label: "美国", value: "美国" },
    { label: "欧洲", value: "欧洲" },
    { label: "日本", value: "日本" },
    { label: "韩国", value: "韩国" },
    { label: "其他", value: "其他" },
  ],
  company: [
    { label: "全部范围", value: "all" },
    { label: "中国/大中华", value: "中国大中华" },
    { label: "美国", value: "美国" },
    { label: "欧洲", value: "欧洲" },
    { label: "日本", value: "日本" },
    { label: "韩国", value: "韩国" },
    { label: "其他", value: "其他" },
  ],
};
const EVENT_TRANSLATION_REPLACEMENTS = [
  ["Gross Domestic Product by Industry", "分行业国内生产总值"],
  ["Gross Domestic Product", "国内生产总值（GDP）"],
  ["Personal Income and Outlays", "个人收入与支出"],
  ["Personal Consumption Expenditures", "个人消费支出（PCE）"],
  ["PCE Price Index", "PCE物价指数"],
  ["Real Personal Consumption Expenditures", "实际个人消费支出"],
  ["Real Personal Consumption Expenditures by State and Real Personal Income by State", "各州实际个人消费支出和实际个人收入"],
  ["U.S. International Trade in Goods and Services", "美国商品和服务国际贸易"],
  ["International Trade in Goods and Services", "商品和服务国际贸易"],
  ["U.S. International Transactions and Investment Position", "美国国际交易和国际投资头寸"],
  ["U.S. Trade in Services, Expanded Detail", "美国服务贸易（扩展明细）"],
  ["Trade in Services, Expanded Detail", "服务贸易（扩展明细）"],
  ["U.S. Trade in Services", "美国服务贸易"],
  ["Trade in Services", "服务贸易"],
  ["Trade in Goods", "货物贸易"],
  ["U.S. Trade", "美国贸易"],
  ["Activities of U.S. Affiliates of Foreign Multinational Enterprises", "外资跨国企业在美国附属机构经营活动"],
  ["Activities of U.S. Multinational Enterprises", "美国跨国企业经营活动"],
  ["Services Supplied Through Affiliates", "通过附属机构提供的服务"],
  ["Direct Investment by Country and Industry", "按国家和行业划分的直接投资"],
  ["GDP by County and Personal Income by County", "县级GDP和县级个人收入"],
  ["GDP by County", "县级GDP"],
  ["Personal Income by County", "县级个人收入"],
  ["Expanded Detail", "扩展明细"],
  ["Advance Economic Indicators", "前瞻经济指标"],
  ["Goods and Services", "商品和服务"],
  ["Services", "服务"],
  ["U.S.", "美国"],
  ["US", "美国"],
  ["Corporate Profits", "企业利润"],
  ["Industries", "行业数据"],
  ["State Personal Income", "州个人收入"],
  ["State GDP", "州GDP"],
  ["State PCE", "州PCE"],
  ["Consumer Price Index", "消费者价格指数（CPI）"],
  ["Core CPI", "核心CPI"],
  ["Producer Price Index", "生产者价格指数（PPI）"],
  ["Import and Export Price Indexes", "进出口价格指数"],
  ["Employment Situation", "非农就业报告"],
  ["National Employment Report", "就业报告"],
  ["Nonfarm Payrolls", "非农就业人数"],
  ["Unemployment Rate", "失业率"],
  ["Average Hourly Earnings", "平均时薪"],
  ["Job Openings and Labor Turnover Survey", "JOLTS职位空缺与劳动力流动调查"],
  ["Initial Jobless Claims", "初请失业金人数"],
  ["Initial Claims", "初请失业金人数"],
  ["Continuing Claims", "续请失业金人数"],
  ["Retail Sales", "零售销售"],
  ["Industrial Production", "工业产出"],
  ["Capacity Utilization", "产能利用率"],
  ["Business Inventories", "商业库存"],
  ["Wholesale Inventories", "批发库存"],
  ["Retail Inventories", "零售库存"],
  ["Factory Orders", "工厂订单"],
  ["Durable Goods Orders", "耐用品订单"],
  ["Durable Goods", "耐用品"],
  ["Construction Spending", "建筑支出"],
  ["Housing Starts", "新屋开工"],
  ["Building Permits", "营建许可"],
  ["New Residential Construction", "新屋开工与营建许可"],
  ["New Residential Sales", "新屋销售"],
  ["Existing Home Sales", "成屋销售"],
  ["Consumer Confidence", "消费者信心"],
  ["Consumer Sentiment", "消费者信心"],
  ["University of Michigan", "密歇根大学"],
  ["ISM Manufacturing", "ISM制造业"],
  ["ISM Services", "ISM服务业"],
  ["Manufacturing PMI", "制造业PMI"],
  ["Services PMI", "服务业PMI"],
  ["Composite PMI", "综合PMI"],
  ["FOMC Meeting", "美联储FOMC议息会议"],
  ["FOMC Minutes", "美联储FOMC会议纪要"],
  ["Federal Open Market Committee", "美联储FOMC"],
  ["Federal Reserve", "美联储"],
  ["Interest Rate Decision", "利率决议"],
  ["Monetary Policy", "货币政策"],
  ["Summary of Economic Projections", "经济预测摘要"],
  ["Press Conference", "新闻发布会"],
  ["Beige Book", "褐皮书"],
  ["Treasury Budget", "财政预算"],
  ["Monthly Treasury Statement", "月度财政收支"],
  ["Treasury International Capital", "美国财政部TIC资本流动"],
  ["Average Interest Rates on U.S. Treasury Securities", "美国国债平均利率"],
  ["Crude Oil Inventories", "原油库存"],
  ["Earnings Release", "财报发布"],
  ["Earnings Call", "业绩电话会"],
  ["Conference Call", "电话会议"],
  ["Quarterly Results", "季度业绩"],
  ["Annual Results", "年度业绩"],
  ["Quarterly Report", "季报"],
  ["Annual Report", "年报"],
  ["NVIDIA", "英伟达"],
  ["Apple", "苹果"],
  ["Microsoft", "微软"],
  ["Tesla", "特斯拉"],
  ["TSMC", "台积电"],
  ["Meta Platforms", "Meta"],
  ["Alphabet", "谷歌母公司"],
  ["Amazon", "亚马逊"],
  ["Advanced Estimate", "预估值"],
  ["Advance Estimate", "预估值"],
  ["Second Estimate", "第二次估算"],
  ["Third Estimate", "第三次估算"],
  ["Preliminary Estimate", "初步估算"],
  ["Final Estimate", "最终估算"],
  ["Preliminary", "初值"],
  ["Revised", "修正值"],
  ["Revision", "修正"],
  ["Annual Update", "年度更新"],
  ["Monthly", "月度"],
  ["Quarterly", "季度"],
  ["Release", "发布"],
  ["Report", "报告"],
  ["Estimate", "估算"],
  ["Data", "数据"],
  ["Index", "指数"],
  ["Price", "价格"],
  ["Prices", "价格"],
  ["Income", "收入"],
  ["Outlays", "支出"],
  ["Spending", "支出"],
  ["Inflation", "通胀"],
  ["Core", "核心"],
  ["Final", "终值"],
  ["Advance", "预估"],
  ["Seasonally Adjusted", "季调后"],
  ["Not Seasonally Adjusted", "未季调"],
  ["Month over Month", "环比"],
  ["Year over Year", "同比"],
  ["MoM", "环比"],
  ["YoY", "同比"],
  ["GDP", "GDP"],
  ["PCE", "PCE"],
  ["CPI", "CPI"],
  ["PPI", "PPI"],
  ["PMI", "PMI"],
  ["JOLTS", "JOLTS职位空缺"],
  ["FOMC", "FOMC"],
];
const EVENT_MONTH_TRANSLATIONS = {
  january: "1月",
  february: "2月",
  march: "3月",
  april: "4月",
  may: "5月",
  june: "6月",
  july: "7月",
  august: "8月",
  september: "9月",
  october: "10月",
  november: "11月",
  december: "12月",
};

const formatDateTime = (value) => {
  if (!value) return "";
  return String(value).replace("T", " ").slice(0, 16);
};

const todayDisplayParts = () => {
  const date = new Date();
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  return {
    short: `${date.getMonth() + 1}月${date.getDate()}日`,
    date: `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`,
    weekday: `星期${weekdays[date.getDay()]}`,
    full: `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 星期${weekdays[date.getDay()]}`,
  };
};

function monthDay(dateString) {
  if (!dateString) return "";
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function disciplineCycleRange() {
  const start = state.market.cycleStart;
  const endMode = state.market.cycleEndMode || "fixed";
  const end = state.market.cycleEndDate;
  if (!start) return "";
  if (endMode === "open") return `${monthDay(start)}-待定`;
  if (end) return `${monthDay(start)}-${monthDay(end)}`;
  return `${monthDay(start)}起`;
}

function disciplineTitleText() {
  return "交易纪律";
}

function isDisciplineCycleExpired() {
  if (state.market.cycleEndMode !== "fixed" || !state.market.cycleEndDate) return false;
  return todayISO() > state.market.cycleEndDate;
}

function disciplineCycleDescription() {
  const range = disciplineCycleRange();
  if (!range) return "未设置交易纪律周期，当前按当天纪律执行。";
  const status = isDisciplineCycleExpired() ? "已截止，及时更新" : "未截止，请遵守纪律";
  const note = state.market.cycleNote ? ` · ${state.market.cycleNote}` : "";
  return `周期：${range} · ${status}${note}`;
}

const daysBetween = (a, b) => {
  const one = new Date(a + "T00:00:00");
  const two = new Date(b + "T00:00:00");
  return Math.round((two - one) / 86400000);
};

const currentWeekStart = () => {
  const now = new Date();
  const day = now.getDay() || 7;
  now.setDate(now.getDate() - day + 1);
  now.setHours(0, 0, 0, 0);
  return now;
};

const isThisWeek = (dateString) => {
  const date = new Date(dateString + "T00:00:00");
  return date >= currentWeekStart();
};

const defaultState = () => ({
  settings: {
    accountEquity: 1000000,
  },
  customIndicators: [],
  market: {
    regime: "观察",
    positionCap: 50,
    allowNew: "cautious",
    weeklyBuyLimit: 3,
    cycleStart: "",
    cycleEndMode: "fixed",
    cycleEndDate: "",
    cycleNote: "",
    notes: "指数仍处在方向选择阶段，短线不追高，优先处理已到计划位的持仓。",
  },
  routine: {
    weeklyFocus: "只做计划内的趋势延续和放量突破，单票仓位不超过 25%。",
    weeklyAvoid: "不在重要数据发布前追涨，不因为单日亏损加码。",
    dailyStrategy: "谨慎观察，优先处理持仓到位动作，不做计划外追涨。",
    dailyTasks: "检查持仓是否到止盈位；只观察强势板块中的计划标的。",
    dailyAvoid: "盘中临时起意、无止损开仓、连续亏损后补仓。",
    weeklyFocusItems: [{ type: "方向判断", text: "只做计划内的趋势延续和放量突破，单票仓位不超过 25%。" }],
    weeklyAvoidItems: [{ type: "不追涨", text: "不在重要数据发布前追涨，不因为单日亏损加码。" }],
    dailyStrategyItems: [{ type: "市场策略", text: "谨慎观察，优先处理持仓到位动作，不做计划外追涨。" }],
    dailyTaskItems: [{ type: "持仓检查", text: "检查持仓是否到止盈位；只观察强势板块中的计划标的。" }],
    dailyAvoidItems: [{ type: "不计划外交易", text: "盘中临时起意、无止损开仓、连续亏损后补仓。" }],
  },
  positions: [],
  trades: [],
  journal: [],
  events: [],
  imports: {
    brokerStatements: [],
  },
  marketData: {
    selectedSymbol: "",
    lastScanAt: "",
    lastEventSyncAt: "",
    quotes: {},
    candles: {},
  },
});

let state = loadState();
ensureStateShape();
let marketSyncing = false;
const viewState = {
  positionFilter: "open",
  calendarMode: "month",
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth(),
  eventCategory: "all",
  eventMarket: "all",
  selectedEventDate: "",
  chartPeriod: "day",
  chartWindow: 80,
  chartWindows: { ...CHART_DEFAULT_WINDOWS },
  statsPeriodMode: "all",
  statsStart: "",
  statsEnd: "",
  mainIndicator: "ma",
  maPeriods: [5, 10, 25, 60],
  subIndicators: ["volume", "macd", "kdj"],
  expandedSubIndicator: "",
  mainChartExpanded: false,
};

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return defaultState();
    const parsed = JSON.parse(saved);
    if (parsed.marketData) parsed.marketData.candles = {};
    return { ...defaultState(), ...parsed };
  } catch {
    return defaultState();
  }
}

function normalizePlanItems(items, fallbackText = "", fallbackType = "") {
  const list = Array.isArray(items) ? items : fallbackText ? [{ type: fallbackType, text: fallbackText }] : [];
  return list
    .map((item) => {
      if (typeof item === "string") return { type: fallbackType, text: item.trim() };
      return {
        type: String(item?.type || fallbackType || "自定义").trim(),
        text: String(item?.text || "").trim(),
      };
    })
    .filter((item) => item.text);
}

function planItemsToText(items) {
  return normalizePlanItems(items)
    .map((item, index) => `${index + 1}. ${item.type ? `【${item.type}】` : ""}${item.text}`)
    .join("\n");
}

function splitLegacySupportResistance(value) {
  const text = String(value || "").trim();
  if (!text) return { support: "", resistance: "" };
  const supportMatch = text.match(/支撑(?:位)?[：:\s]*([^，,；;]+(?:[，,；;]\s*[^压阻]+)?)/);
  const resistanceMatch = text.match(/(?:压力|阻力)(?:位)?[：:\s]*([^，,；;]+)/);
  return {
    support: (supportMatch?.[1] || (!resistanceMatch ? text : "")).trim(),
    resistance: (resistanceMatch?.[1] || "").trim(),
  };
}

function ensureStateShape() {
  const defaults = defaultState();
  state.settings = state.settings || {};
  state.settings.accountEquity = num(state.settings.accountEquity) || defaults.settings.accountEquity;
  state.market = { ...defaults.market, ...(state.market || {}) };
  state.routine = { ...defaults.routine, ...(state.routine || {}) };
  state.routine.weeklyFocusItems = normalizePlanItems(
    state.routine.weeklyFocusItems,
    state.routine.weeklyFocus || defaults.routine.weeklyFocus,
    "方向判断",
  );
  state.routine.weeklyAvoidItems = normalizePlanItems(
    state.routine.weeklyAvoidItems,
    state.routine.weeklyAvoid || defaults.routine.weeklyAvoid,
    "不追涨",
  );
  state.routine.dailyStrategyItems = normalizePlanItems(
    state.routine.dailyStrategyItems,
    state.routine.dailyStrategy || defaults.routine.dailyStrategy,
    "市场策略",
  );
  state.routine.dailyTaskItems = normalizePlanItems(
    state.routine.dailyTaskItems,
    state.routine.dailyTasks || defaults.routine.dailyTasks,
    "持仓检查",
  );
  state.routine.dailyAvoidItems = normalizePlanItems(
    state.routine.dailyAvoidItems,
    state.routine.dailyAvoid || defaults.routine.dailyAvoid,
    "不计划外交易",
  );
  state.routine.weeklyFocus = planItemsToText(state.routine.weeklyFocusItems);
  state.routine.weeklyAvoid = planItemsToText(state.routine.weeklyAvoidItems);
  state.routine.dailyStrategy = planItemsToText(state.routine.dailyStrategyItems);
  state.routine.dailyTasks = planItemsToText(state.routine.dailyTaskItems);
  state.routine.dailyAvoid = planItemsToText(state.routine.dailyAvoidItems);
  state.customIndicators = Array.isArray(state.customIndicators) ? state.customIndicators : [];
  state.positions = Array.isArray(state.positions) ? state.positions : [];
  state.trades = Array.isArray(state.trades) ? state.trades : [];
  state.journal = Array.isArray(state.journal) ? state.journal : [];
  state.events = Array.isArray(state.events) ? state.events : [];
  state.events = state.events.filter((event) => !isDemoEvent(event));
  state.imports = state.imports || {};
  state.imports.brokerStatements = Array.isArray(state.imports.brokerStatements)
    ? state.imports.brokerStatements
    : [];
  state.marketData = state.marketData || {};
  state.marketData.quotes = state.marketData.quotes || {};
  state.marketData.candles = state.marketData.candles || {};
  state.marketData.selectedSymbol =
    state.marketData.selectedSymbol || state.positions[0]?.symbol || defaults.marketData.selectedSymbol;
  state.marketData.lastScanAt = state.marketData.lastScanAt || "";
  state.marketData.lastEventSyncAt = state.marketData.lastEventSyncAt || "";
  state.positions.forEach((position) => {
    position.targets = Array.isArray(position.targets) ? position.targets : [];
    position.status = position.status || "open";
    if (!position.supportLevel && !position.resistanceLevel && position.supportResistance) {
      const levels = splitLegacySupportResistance(position.supportResistance);
      position.supportLevel = levels.support;
      position.resistanceLevel = levels.resistance;
    }
  });
  state.events.forEach((event) => {
    event.category = normalizeEventCategory(event.category);
    event.market = normalizeEventScope(event.market, event.category);
  });
}

function saveState() {
  const snapshot = {
    ...state,
    marketData: {
      ...state.marketData,
      candles: {},
    },
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

function isDemoEvent(event) {
  const title = String(event?.title || "").trim();
  return /^示例[:：]/.test(title) || event?.source === "demo";
}

function normalizeEventCategory(category) {
  const value = String(category || "");
  if (EVENT_CATEGORIES.includes(value)) return value;
  if (value.includes("财报") || value.includes("公司") || value.includes("个股")) return "重点公司事件";
  if (value.includes("会议") || value.includes("政策") || value.includes("央行") || value.includes("美联储")) {
    return "重大会议";
  }
  return "宏观经济数据";
}

function normalizeEventScope(scope, category) {
  const value = String(scope || "");
  if (value === "all") return category === "重点公司事件" ? "中国大中华" : "全球";
  if (value.includes("美股") || value.includes("美国")) return "美国";
  if (
    value.includes("中国") ||
    value.includes("大中华") ||
    value.includes("A股") ||
    value.includes("港") ||
    value.includes("台湾") ||
    value.includes("台股") ||
    value.includes("台积电") ||
    value.includes("个股")
  ) {
    return "中国大中华";
  }
  if (value.includes("欧洲")) return "欧洲";
  if (value.includes("日本")) return "日本";
  if (value.includes("韩国")) return "韩国";
  if (value.includes("全球")) return "全球";
  return value && value !== "个股" ? value : "全球";
}

function eventScopeOptions(category, includeAll = true) {
  const options =
    category === "重点公司事件"
      ? EVENT_SCOPE_GROUPS.company
      : category === "宏观经济数据" || category === "重大会议"
        ? EVENT_SCOPE_GROUPS.macro
        : EVENT_SCOPE_GROUPS.all;
  return includeAll ? options : options.filter((item) => item.value !== "all");
}

function setSelectOptions(select, options, value) {
  select.innerHTML = options.map((item) => `<option value="${item.value}">${item.label}</option>`).join("");
  select.value = options.some((item) => item.value === value) ? value : options[0].value;
}

function eventScopeLabel(scope) {
  const option = EVENT_SCOPE_GROUPS.all.find((item) => item.value === scope);
  return option?.label || scope || "全球";
}

function eventDisplayTitle(event) {
  return translateEventText(event?.title || "");
}

function eventDisplayNote(event) {
  return translateEventText(event?.note || "");
}

function eventDisplaySource(source) {
  const value = String(source || "");
  const map = {
    official: "官方来源",
    bea: "美国经济分析局",
    "bea-pce": "美国经济分析局",
    BEA: "美国经济分析局",
    "美国BEA": "美国经济分析局",
    bls: "美国劳工统计局",
    "bls-cpi": "美国劳工统计局",
    "美国BLS非农": "美国劳工统计局",
    BLS: "美国劳工统计局",
    "美国BLS": "美国劳工统计局",
    adp: "ADP就业报告",
    "美国ADP小非农": "ADP就业报告",
    fomc: "美联储FOMC",
    fed: "美联储FOMC",
    FOMC: "美联储FOMC",
    "美联储FOMC": "美联储FOMC",
    fiscaldata: "美国财政部",
    "treasury-tic": "美国财政部TIC",
    treasury: "美国财政部",
    NBS: "国家统计局",
    "国家统计局": "国家统计局",
  };
  return map[value] || translateEventText(value);
}

function translateEventText(value) {
  let output = String(value || "").trim();
  if (!/[A-Za-z]/.test(output)) return output;

  output = output
    .replace(/\b(\d{1,2})[:：](\d{2})\s*(AM|PM)\s*ET\b/gi, (_, hour, minute, ampm) => {
      let h = Number(hour);
      if (ampm.toLowerCase() === "pm" && h !== 12) h += 12;
      if (ampm.toLowerCase() === "am" && h === 12) h = 0;
      return `美东时间 ${String(h).padStart(2, "0")}:${minute}`;
    })
    .replace(/\bUTC\b/g, "协调世界时")
    .replace(/\b(1st|first)\s+quarter\b/gi, "第一季度")
    .replace(/\b(2nd|second)\s+quarter\b/gi, "第二季度")
    .replace(/\b(3rd|third)\s+quarter\b/gi, "第三季度")
    .replace(/\b(4th|fourth)\s+quarter\b/gi, "第四季度")
    .replace(/\bQ1\b/gi, "第一季度")
    .replace(/\bQ2\b/gi, "第二季度")
    .replace(/\bQ3\b/gi, "第三季度")
    .replace(/\bQ4\b/gi, "第四季度")
    .replace(/\bFY\s?(\d{4})\b/gi, "$1财年")
    .replace(/\b(\d{4})\s+Fiscal Year\b/gi, "$1财年")
    .replace(/\b((?:19|20)\d{2})(?!年)\b/g, (match) => `${match}年`);

  Object.entries(EVENT_MONTH_TRANSLATIONS).forEach(([month, label]) => {
    output = output.replace(new RegExp(`\\b${month}\\b`, "gi"), label);
  });

  EVENT_TRANSLATION_REPLACEMENTS.sort((a, b) => b[0].length - a[0].length).forEach(([from, to]) => {
    output = output.replace(new RegExp(escapeRegExp(from), "gi"), to);
  });

  return output
    .replace(/(第一季度|第二季度|第三季度|第四季度)\s+((?:19|20)\d{2})年/g, "$2年$1")
    .replace(/(1[0-2]|[1-9])月\s+((?:19|20)\d{2})年/g, "$2年$1月")
    .replace(/\s*:\s*/g, "：")
    .replace(/\s*,\s*/g, "，")
    .replace(/\s*;\s*/g, "；")
    .replace(/\s*&\s*/g, "和")
    .replace(/\s+/g, " ")
    .replace(/（\s+/g, "（")
    .replace(/\s+）/g, "）")
    .trim();
}

function getOpenPositions() {
  return state.positions.filter((position) => position.status !== "closed" && position.shares > 0);
}

function getPosition(id) {
  return state.positions.find((position) => position.id === id);
}

function positionPnl(position) {
  return (num(position.currentPrice) - num(position.entryPrice)) * num(position.shares);
}

function positionPnlPct(position) {
  if (!position.entryPrice) return 0;
  return ((num(position.currentPrice) - num(position.entryPrice)) / num(position.entryPrice)) * 100;
}

function levelReturnPct(position, levelPrice) {
  const entry = num(position?.entryPrice);
  if (!entry) return 0;
  return ((num(levelPrice) - entry) / entry) * 100;
}

function realizedPnl() {
  return state.trades
    .filter((trade) => trade.type === "sell")
    .reduce((sum, trade) => {
      const position = getPosition(trade.positionId);
      if (!position) return sum;
      return sum + (num(trade.price) - num(position.entryPrice)) * num(trade.quantity);
    }, 0);
}

function floatingPnl() {
  return getOpenPositions().reduce((sum, position) => sum + positionPnl(position), 0);
}

function currentExposure() {
  return getOpenPositions().reduce((sum, position) => sum + num(position.positionPct), 0);
}

function weekTrades(type) {
  return state.trades.filter((trade) => trade.type === type && isThisWeek(trade.date));
}

function computeAlerts() {
  const alerts = [];
  const exposure = currentExposure();

  if (isDisciplineCycleExpired()) {
    alerts.push({
      level: "high",
      title: "交易纪律周期已截止",
      body: `${disciplineCycleRange()}已结束，请更新下一交易周期的市场状态、仓位纪律和开仓纪律。`,
    });
  }

  if (exposure > num(state.market.positionCap)) {
    alerts.push({
      level: "high",
      title: "总仓位超过计划上限",
      body: `当前仓位 ${percent(exposure)}，计划上限 ${percent(state.market.positionCap)}。优先减仓或暂停新仓。`,
    });
  }

  const buyCount = weekTrades("buy").length;
  const sellCount = weekTrades("sell").length;
  if (buyCount > num(state.market.weeklyBuyLimit)) {
    alerts.push({
      level: "medium",
      title: "本周开仓次数偏多",
      body: `本周买入 ${buyCount} 次，超过上限 ${state.market.weeklyBuyLimit} 次。`,
    });
  }

  if (buyCount > sellCount && buyCount > 0) {
    alerts.push({
      level: "low",
      title: "本周买入动作多于卖出动作",
      body: `买入 ${buyCount} 次，卖出 ${sellCount} 次。复盘是否有足够的分批止盈动作。`,
    });
  }

  if (state.market.allowNew === "false") {
    alerts.push({
      level: "medium",
      title: "计划状态为暂停新仓",
      body: "当前风控计划不允许开新仓，优先执行持仓管理。",
    });
  }

  getOpenPositions().forEach((position) => {
    const current = num(position.currentPrice);
    const stop = num(position.stopLoss);

    if (stop > 0 && current <= stop) {
      alerts.push({
        level: "high",
        title: `${position.name} 触发止损`,
        body: `当前价 ${price(current)}，止损价 ${price(stop)}。按计划处理，不临场犹豫。`,
      });
    } else if (stop > 0 && current <= stop * 1.03) {
      alerts.push({
        level: "medium",
        title: `${position.name} 接近止损`,
        body: `当前价距离止损约 ${percent(((current - stop) / stop) * 100)}。`,
      });
    }

    position.targets
      .filter((target) => target.status !== "done")
      .forEach((target) => {
        const targetPrice = num(target.price);
        if (!targetPrice) return;

        if (current >= targetPrice) {
          alerts.push({
            level: "high",
            title: `${position.name} 到达${target.name}`,
            body: `当前价 ${price(current)}，计划价 ${price(targetPrice)}，计划减仓 ${target.pct}%。`,
          });
        } else if (current >= targetPrice * 0.98) {
          alerts.push({
            level: "low",
            title: `${position.name} 接近${target.name}`,
            body: `距离计划价 ${price(targetPrice)} 不到 2%。`,
          });
        }
      });

    const summary = position.techSummary || {};
    if (summary.trend === "跌破20日线") {
      alerts.push({
        level: "medium",
        title: `${position.name} 技术面转弱`,
        body: `最新扫描显示跌破20日线，当前价相对20日线 ${percent(summary.closeVsMa20Pct)}。检查是否要减仓或收紧止损。`,
      });
    }
    if (summary.macd === "MACD绿柱放大") {
      alerts.push({
        level: "low",
        title: `${position.name} MACD动能走弱`,
        body: "绿柱放大，趋势仓需要观察是否继续恶化。",
      });
    }
    if (summary.kdj === "KDJ高位") {
      alerts.push({
        level: "low",
        title: `${position.name} KDJ进入高位`,
        body: "若同时接近压力位或止盈位，优先按计划分批处理。",
      });
    }

    technicalRiskAlerts(position).forEach((alert) => alerts.push(alert));
  });

  const today = todayISO();
  state.events.forEach((event) => {
    const diff = daysBetween(today, event.date);
    if (diff >= 0 && diff <= 2 && event.impact !== "低") {
      alerts.push({
        level: event.impact === "高" ? "high" : "medium",
        title: `${diff === 0 ? "今日" : `${diff} 天后`}有${event.impact}影响事件`,
        body: `${eventDisplayTitle(event)}。事件前检查仓位和新仓计划。`,
      });
    }
  });

  return alerts;
}

function showView(viewId) {
  const currentViewId = $(".view.active")?.id || "";
  if (viewId === "trade" && currentViewId !== "trade" && shouldConfirmBeforeEntry()) {
    const confirmed = confirm(entryGuardConfirmText());
    if (!confirmed) {
      toast("已取消开仓，先回到计划和持仓检查");
      return false;
    }
  }

  $$(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === viewId));
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (viewId === "positions" && shouldRefreshMarketData(60000)) {
    syncMarketData({ silent: true });
  }
  if (viewId === "trade") {
    renderEntryGuard();
  }
  return true;
}

function focusPlanSection(section) {
  if (section !== "routine") return;
  const target = $("#routinePlanForm");
  if (!target) return;
  window.setTimeout(() => {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 120);
}

function entryGuardState() {
  const exposure = currentExposure();
  const cap = num(state.market.positionCap);
  const buyCount = weekTrades("buy").length;
  const sellCount = weekTrades("sell").length;
  const weeklyLimit = num(state.market.weeklyBuyLimit);
  const permission = permissionLabel(state.market.allowNew);
  const checks = [];

  if (isDisciplineCycleExpired()) {
    checks.push({
      level: "high",
      blocking: true,
      title: "交易纪律周期已截止",
      body: `${disciplineCycleRange()}已经结束，先更新下一交易周期的市场状态、仓位纪律和开仓纪律。`,
    });
  }
  if (state.market.allowNew === "false") {
    checks.push({
      level: "high",
      blocking: true,
      title: "当前计划暂停新仓",
      body: "纪律总控里的开仓纪律为暂停。除非这是明确的例外交易，否则应该先处理持仓和复盘。",
    });
  } else if (state.market.allowNew === "cautious") {
    checks.push({
      level: "medium",
      blocking: false,
      title: "当前计划为谨慎开仓",
      body: "只允许计划内、高质量、仓位受控的机会；不适合临时起意。",
    });
  }
  if (state.market.regime === "防守") {
    checks.push({
      level: "high",
      blocking: true,
      title: "市场状态为防守",
      body: "防守阶段默认少开仓、多止盈，现金和回撤控制优先。",
    });
  }
  if (cap <= 0 || exposure >= cap) {
    checks.push({
      level: "high",
      blocking: true,
      title: cap <= 0 ? "仓位纪律禁止新仓" : "总仓位已达到上限",
      body: `当前仓位 ${percent(exposure)}，计划上限 ${percent(cap)}。继续开仓会突破当前交易计划。`,
    });
  } else if (exposure >= cap * 0.85) {
    checks.push({
      level: "medium",
      blocking: false,
      title: "仓位接近上限",
      body: `当前仓位 ${percent(exposure)}，距离计划上限 ${percent(cap)} 已经很近。`,
    });
  }
  if (weeklyLimit <= 0 || buyCount >= weeklyLimit) {
    checks.push({
      level: "high",
      blocking: true,
      title: weeklyLimit <= 0 ? "本周计划不允许开仓" : "本周开仓次数已达上限",
      body: `本周已开仓 ${buyCount} 次，计划上限 ${weeklyLimit} 次。继续开仓需要被记录为纪律偏离。`,
    });
  } else if (buyCount + 1 >= weeklyLimit) {
    checks.push({
      level: "medium",
      blocking: false,
      title: "本周只剩最后一次开仓额度",
      body: `本周已开仓 ${buyCount} 次，计划上限 ${weeklyLimit} 次。下一笔会用掉最后的开仓额度。`,
    });
  }
  if (buyCount > sellCount && buyCount > 0) {
    checks.push({
      level: "low",
      blocking: false,
      title: "本周买入多于卖出",
      body: `本周买入 ${buyCount} 次，卖出 ${sellCount} 次。检查是否存在买得太多、退出太少的问题。`,
    });
  }

  return {
    exposure,
    cap,
    buyCount,
    sellCount,
    weeklyLimit,
    permission,
    checks,
    blockingChecks: checks.filter((item) => item.blocking),
    warningChecks: checks.filter((item) => item.level === "medium"),
  };
}

function shouldConfirmBeforeEntry() {
  return entryGuardState().blockingChecks.length > 0;
}

function entryGuardConfirmText() {
  const guard = entryGuardState();
  const lines = guard.blockingChecks.map((item) => `- ${item.title}：${item.body}`).join("\n");
  return [
    "当前开仓行为已经触发交易纪律劝阻：",
    "",
    lines,
    "",
    `当前计划：市场状态 ${state.market.regime}，仓位上限 ${percent(guard.cap)}，开仓纪律 ${guard.permission}，本周开仓 ${guard.buyCount}/${guard.weeklyLimit} 次。`,
    "",
    "取消：回去检查计划和持仓。",
    "确认：继续进入开仓页，但后续保存时仍会记录为纪律偏离样本。",
  ].join("\n");
}

function renderEntryGuard() {
  const panel = $("#entryGuardPanel");
  if (!panel) return;
  const guard = entryGuardState();
  const hasBlocking = guard.blockingChecks.length > 0;
  const hasWarning = guard.warningChecks.length > 0;
  const tone = hasBlocking ? "danger" : hasWarning ? "warn" : "calm";
  const badgeText = hasBlocking ? "需确认" : hasWarning ? "谨慎" : "可开仓";
  const summary = `当前计划：市场状态 ${state.market.regime}，仓位上限 ${percent(guard.cap)}，当前仓位 ${percent(guard.exposure)}，开仓纪律 ${guard.permission}，本周开仓 ${guard.buyCount}/${guard.weeklyLimit} 次。`;
  const planItems = [
    {
      level: guard.exposure >= guard.cap ? "high" : "low",
      title: "仓位纪律",
      body: `当前仓位 ${percent(guard.exposure)} / 上限 ${percent(guard.cap)}。`,
    },
    {
      level: guard.buyCount >= guard.weeklyLimit ? "high" : "low",
      title: "开仓频率",
      body: `本周开仓 ${guard.buyCount} 次 / 上限 ${guard.weeklyLimit} 次。`,
    },
    {
      level: state.market.allowNew === "false" ? "high" : state.market.allowNew === "cautious" ? "medium" : "low",
      title: "开仓纪律",
      body: `${guard.permission}。${permissionHint(state.market.allowNew)}`,
    },
  ];
  const items = guard.checks.length ? guard.checks : planItems;

  panel.hidden = false;
  panel.className = `entry-guard-panel ${tone}`;
  $("#entryGuardTitle").textContent = hasBlocking ? "开仓前纪律劝阻" : "开仓前纪律检查";
  $("#entryGuardSummary").textContent = summary;
  $("#entryGuardBadge").textContent = badgeText;
  $("#entryGuardBadge").className = `count-badge ${hasBlocking ? "red" : hasWarning ? "amber" : "red"}`;
  $("#entryGuardList").innerHTML = items.map(entryGuardItemTemplate).join("");
}

function entryGuardItemTemplate(item) {
  return `
    <article class="entry-guard-item ${tagClass(item.level)}">
      <strong>${escapeHTML(item.title)}</strong>
      <p>${escapeHTML(item.body)}</p>
    </article>
  `;
}

function permissionLabel(value) {
  if (value === "true") return "允许";
  if (value === "false") return "暂停";
  return "谨慎";
}

function shouldRefreshMarketData(maxAgeMs = 60000) {
  if (!getOpenPositions().length) return false;
  if (!state.marketData.lastScanAt) return true;
  const last = Date.parse(state.marketData.lastScanAt);
  if (!Number.isFinite(last)) return true;
  return Date.now() - last > maxAgeMs;
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 2300);
}

async function apiJSON(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || "行情服务请求失败");
  }
  return payload;
}

function setSyncing(isSyncing) {
  ["#refreshQuotesBtn", "#refreshChartBtn"].forEach((selector) => {
    const button = $(selector);
    if (!button) return;
    button.disabled = isSyncing;
  });
  if ($("#refreshQuotesBtn")) $("#refreshQuotesBtn").textContent = isSyncing ? "刷新中" : "刷新";
  if ($("#positionMarketStatus")) {
    $("#positionMarketStatus").textContent = isSyncing
      ? "行情刷新中"
      : state.marketData.lastScanAt
        ? `行情 ${formatDateTime(state.marketData.lastScanAt)}`
        : "行情自动刷新";
  }
}

async function syncMarketData(options = {}) {
  const { silent = false } = options;
  if (marketSyncing) return null;
  const positions = getOpenPositions();
  if (!positions.length) {
    if (!silent) toast("暂无持仓需要同步");
    return null;
  }

  marketSyncing = true;
  setSyncing(true);
  try {
    const payload = await apiJSON("/api/scan", {
      method: "POST",
      body: JSON.stringify({
        positions: positions.map((position) => ({
          id: position.id,
          symbol: position.symbol,
        })),
      }),
    });

    payload.results.forEach((result) => {
      const position = getPosition(result.id);
      if (!position) return;
      position.name = result.name || position.name;
      position.currentPrice = result.currentPrice || position.currentPrice;
      position.quote = result.quote;
      position.lastQuoteAt = result.quote?.time || payload.updatedAt;
      position.lastQuoteError = "";
      position.techSummary = result.summary || {};
      position.latestIndicator = result.latestIndicator || {};
      state.marketData.quotes[result.symbol] = result.quote;
    });
    (payload.errors || []).forEach((error) => {
      const failed = positions.find((position) => String(position.symbol) === String(error.symbol));
      if (failed) failed.lastQuoteError = error.message || "行情同步失败";
    });
    state.marketData.lastScanAt = payload.updatedAt;

    const first = payload.results[0];
    if (first?.symbol) {
      state.marketData.selectedSymbol = first.symbol;
      try {
        await loadCandles(first.symbol, false);
      } catch {
        // 报价已经同步成功，K线失败时保留报价结果。
      }
    }

    saveState();
    render();

    const errors = payload.errors || [];
    const warnings = payload.warnings || [];
    if (!silent) {
      if (errors.length) {
        toast(`行情已同步，${errors.length} 个标的失败：${errors.map((item) => item.symbol).join("、")}`);
      } else if (warnings.length) {
        toast(`现价已同步，${warnings.length} 个标的K线待重试`);
      } else {
        toast("行情已同步");
      }
    }
    return payload;
  } catch (error) {
    if (!silent) toast(error.message || "同步失败，请确认本地服务已启动");
    if ($("#positionMarketStatus")) $("#positionMarketStatus").textContent = "行情自动刷新失败";
    return null;
  } finally {
    marketSyncing = false;
    setSyncing(false);
  }
}

async function loadCandles(symbol, shouldRender = true) {
  if (!symbol) return null;
  const payload = await apiJSON(`/api/candles?symbol=${encodeURIComponent(symbol)}&days=${CANDLE_HISTORY_DAYS}`);
  state.marketData.candles[payload.symbol] = payload;
  state.marketData.selectedSymbol = payload.symbol;
  if (shouldRender) {
    saveState();
    render();
  }
  return payload;
}

function render() {
  ensureStateShape();
  renderChartControls();
  renderDashboard();
  renderPositions();
  renderJournal();
  renderPlans();
  renderEntryGuard();
  renderEvents();
  renderStats();
  renderDataUtilities();
  populatePositionSelects();
  updateEntryCompleteness();
}

function renderDashboard() {
  const todayParts = todayDisplayParts();
  const exposure = currentExposure();
  const pnl = floatingPnl();
  const buyCount = weekTrades("buy").length;
  const sellCount = weekTrades("sell").length;
  const upcomingEvents = state.events.filter((event) => {
    const diff = daysBetween(todayISO(), event.date);
    return diff >= 0 && diff <= 7;
  });

  $("#todayDateLabel").innerHTML = `
    <span>${todayParts.date}</span>
    <strong>${todayParts.weekday}</strong>
  `;
  $("#disciplineTitle").textContent = disciplineTitleText();
  $("#disciplineCycleText").textContent = disciplineCycleDescription();
  const cycleAlert = $("#disciplineCycleAlert");
  if (isDisciplineCycleExpired()) {
    cycleAlert.hidden = false;
    cycleAlert.textContent = `${disciplineCycleRange()}已截止，请先更新下一交易周期的交易纪律。`;
  } else {
    cycleAlert.hidden = true;
    cycleAlert.textContent = "";
  }
  $("#metricExposure").textContent = percent(exposure);
  $("#metricExposureHint").textContent =
    exposure > state.market.positionCap
      ? `已超过计划上限，账户总资金 ${money(state.settings.accountEquity)}`
      : `账户总资金 ${money(state.settings.accountEquity)}，计划上限 ${percent(state.market.positionCap)}`;
  $("#metricPnl").textContent = money(pnl);
  $("#metricPnl").className = `metric-value ${pnl > 0 ? "positive" : pnl < 0 ? "negative" : ""}`;
  $("#metricPnlHint").textContent = state.marketData.lastScanAt
    ? `行情同步 ${formatDateTime(state.marketData.lastScanAt)}`
    : "按当前价估算";
  $("#metricTradeRatio").textContent = `${buyCount} / ${sellCount}`;
  $("#metricEvents").textContent = upcomingEvents.length;

  $("#marketRegime").textContent = state.market.regime;
  $("#marketCap").textContent = percent(state.market.positionCap, 0);
  $("#marketPermission").textContent =
    state.market.allowNew === "true" ? "允许" : state.market.allowNew === "false" ? "暂停" : "谨慎";
  $("#marketNotes").textContent = state.market.notes;
  $("#marketRegimeHint").textContent = regimeHint(state.market.regime);
  $("#marketCapHint").textContent =
    exposure > state.market.positionCap
      ? `当前仓位 ${percent(exposure)}，已经越过上限。`
      : `当前仓位 ${percent(exposure)}，剩余空间 ${percent(Math.max(0, state.market.positionCap - exposure))}。`;
  $("#marketPermissionHint").textContent = permissionHint(state.market.allowNew);
  $("#regimeCard").className = `discipline-card ${disciplineTone(state.market.regime)}`;
  $("#capCard").className = `discipline-card ${exposure > state.market.positionCap ? "danger" : "calm"}`;
  $("#permissionCard").className = `discipline-card ${permissionTone(state.market.allowNew)}`;
  renderPlanPreview("#dailyStrategyPreview", state.routine.dailyStrategyItems);
  renderPlanPreview("#dailyTasksPreview", state.routine.dailyTaskItems);
  renderPlanPreview("#dailyAvoidPreview", state.routine.dailyAvoidItems);

  const alerts = computeAlerts();
  $("#alertCount").textContent = alerts.length;
  $("#alertsList").innerHTML = alerts.length
    ? alerts
        .map(
          (alert) => `
            <div class="alert-item ${alert.level === "high" ? "high" : alert.level === "medium" ? "medium" : ""}">
              <div class="alert-title">
                <span>${escapeHTML(alert.title)}</span>
                <span class="tag ${tagClass(alert.level)}">${alert.level === "high" ? "优先" : alert.level === "medium" ? "注意" : "观察"}</span>
              </div>
              <div class="alert-body">${escapeHTML(alert.body)}</div>
            </div>
          `,
        )
        .join("")
    : `<div class="empty-state">暂无触发提醒</div>`;

  const cards = getOpenPositions().slice(0, 6);
  $("#positionCards").innerHTML = cards.length
    ? cards.map(positionCardTemplate).join("")
    : `
      <button class="add-position-card" data-dashboard-add-position type="button">
        <span>＋</span>
        <strong>新建开仓</strong>
        <em>还没有持仓记录，从这里开始记录第一笔交易</em>
      </button>
    `;
  $$("[data-dashboard-add-position]").forEach((button) => {
    button.addEventListener("click", () => showView("trade"));
  });
}

function renderChartControls() {
  const select = $("#chartSymbolSelect");
  if (!select) return;
  const options = state.positions
    .map((position) => `<option value="${escapeHTML(position.symbol)}">${escapeHTML(position.name)} ${escapeHTML(position.symbol)}</option>`)
    .join("");
  select.innerHTML = options || `<option value="">暂无持仓</option>`;
  select.value = state.marketData.selectedSymbol || state.positions[0]?.symbol || "";
  $$("[data-chart-period]").forEach((button) => {
    button.classList.toggle("active", button.dataset.chartPeriod === viewState.chartPeriod);
  });
  renderIndicatorSelects();
  updateChartZoomLabel();
}

function renderIndicatorSelects() {
  const mainSelect = $("#mainIndicatorSelect");
  const subSelect = $("#subIndicatorSelect");
  if (!mainSelect || !subSelect) return;

  const customMain = state.customIndicators
    .filter((item) => item.target === "main")
    .map((item) => `<option value="custom:${escapeHTML(item.id)}">${escapeHTML(item.name)}</option>`)
    .join("");
  const customSub = state.customIndicators
    .filter((item) => item.target === "sub")
    .map((item) => `<option value="custom:${escapeHTML(item.id)}">${escapeHTML(item.name)}</option>`)
    .join("");

  mainSelect.innerHTML = `
    <option value="add">添加指标</option>
    <option value="ma">MA均线</option>
    <option value="bbi">BBI多空线</option>
    ${customMain}
  `;
  mainSelect.value = viewState.mainIndicator;

  const subOptions = Object.entries(SUB_INDICATORS)
    .map(([key, item]) => `<option value="${key}">${item.label}</option>`)
    .join("");
  subSelect.innerHTML = `
    <option value="add">添加指标</option>
    ${subOptions}
    ${customSub}
  `;
  subSelect.value = "add";
}

function positionCardTemplate(position) {
  const pnl = positionPnl(position);
  const quote = position.quote || {};
  const hasSyncedPrice = Boolean(position.lastQuoteAt || quote.time || position.quote);
  return `
    <article class="position-card">
      <div class="position-card-head">
        <div>
          <h4>${escapeHTML(position.name)}</h4>
          <div class="symbol">${escapeHTML(position.symbol)} · ${escapeHTML(position.setup)}</div>
        </div>
        <span class="tag ${pnl >= 0 ? "red" : ""}">${pnl >= 0 ? "盈利" : "亏损"}</span>
      </div>
      <div class="${pnl >= 0 ? "positive" : "negative"}" style="font-weight:800;font-size:22px">${money(pnl)}</div>
      <div class="position-card-grid">
        <div><span class="mini-label">现价</span><br />${hasSyncedPrice ? price(position.currentPrice) : "待同步"}</div>
        <div><span class="mini-label">止损</span><br />${price(position.stopLoss)}</div>
        <div><span class="mini-label">仓位</span><br />${percent(position.positionPct)}</div>
      </div>
      ${position.techSummary ? `<div class="tech-summary">${techSummaryBadges(position.techSummary)}</div>` : ""}
      ${quote.time ? `<div class="soft-text" style="margin-top:8px">行情 ${formatDateTime(quote.time)} · ${escapeHTML(quote.source || "")}</div>` : ""}
    </article>
  `;
}

function techSummaryBadges(summary) {
  if (!summary) return "";
  return [summary.trend, summary.macd, summary.kdj, summary.volume]
    .filter(Boolean)
    .map((item) => `<span class="tag ${techTagClass(item)}">${escapeHTML(item)}</span>`)
    .join("");
}

function techSummaryTemplate(position) {
  if (!position.techSummary) return "";
  const indicator = position.latestIndicator || {};
  return `
    <div class="tech-summary">
      ${techSummaryBadges(position.techSummary)}
    </div>
    <span class="soft-text">
      MA20 ${indicator.ma20 ? price(indicator.ma20) : "--"} · MACD ${indicator.macd ?? "--"} · KDJ ${indicator.k ?? "--"}/${indicator.d ?? "--"}/${indicator.j ?? "--"}
    </span>
  `;
}

function techTagClass(text) {
  if (String(text).includes("跌破") || String(text).includes("绿柱") || String(text).includes("死叉")) return "";
  if (String(text).includes("高位") || String(text).includes("放量")) return "amber";
  if (String(text).includes("多头") || String(text).includes("红柱") || String(text).includes("金叉")) return "red";
  return "";
}

function renderPositions() {
  const rows = filteredPositions();
  const canAddPosition = viewState.positionFilter === "open";
  $$("[data-position-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.positionFilter === viewState.positionFilter);
  });
  if ($("#positionMarketStatus")) {
    $("#positionMarketStatus").textContent = state.marketData.lastScanAt
      ? `行情 ${formatDateTime(state.marketData.lastScanAt)}`
      : "行情自动刷新";
  }
  const addRow = `
    <tr class="add-position-row" data-position-add-row>
      <td colspan="7">
        <button type="button" class="table-add-position">
          <span>＋</span>
          <strong>新建开仓</strong>
        </button>
      </td>
    </tr>
  `;
  const emptyText =
    viewState.positionFilter === "closed"
      ? "暂无历史持仓"
      : viewState.positionFilter === "all"
        ? "暂无持仓记录"
        : "暂无持仓，先新建一笔开仓";
  const emptyHint =
    viewState.positionFilter === "closed"
      ? "卖出清仓后的记录会出现在这里"
      : viewState.positionFilter === "all"
        ? "当前和历史持仓记录会统一显示在这里"
        : "点击这里记录第一笔开仓";
  $("#positionsTable").innerHTML = rows.length
    ? `${rows
        .map((position) => {
          const pnl = positionPnl(position);
          const quoteSyncedAt = position.lastQuoteAt || position.quote?.time || "";
          const hasSyncedPrice = Boolean(quoteSyncedAt || position.quote);
          const currentPriceText = hasSyncedPrice ? price(position.currentPrice) : "待同步";
          const currentPriceHint = position.lastQuoteError
            ? `失败：${escapeHTML(position.lastQuoteError)}`
            : hasSyncedPrice
              ? quoteSyncedAt
                ? `行情 ${formatDateTime(quoteSyncedAt)}`
                : "行情已同步"
              : "点击刷新自动更新";
          const targets = position.targets
            .map(
              (target) =>
                `<span class="tag red" title="计划减仓 ${target.pct}%">${escapeHTML(target.name)} ${price(target.price)} / ${signedPercent(levelReturnPct(position, target.price))}</span>`,
            )
            .join(" ");

          return `
            <tr>
              <td>
                <strong>${escapeHTML(position.name)}</strong><br />
                <span class="soft-text">${escapeHTML(position.symbol)} · ${escapeHTML(position.setup)} · ${escapeHTML(position.riskLevel)}风险</span>
                ${position.status === "closed" ? `<div class="tag">已清仓</div>` : ""}
              </td>
              <td>
                <div class="position-price-stack">
                  <span>成本 <strong>${price(position.entryPrice)}</strong></span>
                  <span>现价 <strong>${currentPriceText}</strong></span>
                  <em class="${position.lastQuoteError ? "bad-text" : ""}">${currentPriceHint}</em>
                </div>
              </td>
              <td>${position.shares}</td>
              <td>${percent(position.positionPct)}</td>
              <td class="${pnl >= 0 ? "positive" : "negative"}">
                <strong>${money(pnl)}</strong><br />
                <span>${percent(positionPnlPct(position))}</span>
              </td>
              <td>
                <div style="display:grid;gap:8px">
                  <span class="tag stop">止损 ${price(position.stopLoss)} / ${signedPercent(levelReturnPct(position, position.stopLoss))}</span>
                  <span>${targets}</span>
                  ${techSummaryTemplate(position)}
                  <span class="soft-text">${escapeHTML(position.exitSignal || "")}</span>
                </div>
              </td>
              <td>
                <div class="table-actions">
                  ${
                    position.status === "closed"
                      ? `<button class="ghost-button" data-restore-id="${position.id}">重新加入持仓</button>`
                      : `<button class="ghost-button" data-sell-id="${position.id}">卖出</button>`
                  }
                  <button class="ghost-button" data-note-id="${position.id}">记日志</button>
                  <button class="ghost-button danger" data-delete-id="${position.id}">删除</button>
                </div>
              </td>
            </tr>
          `;
        })
        .join("")}${canAddPosition ? addRow : ""}`
    : `
      <tr class="empty-position-row">
        <td colspan="7">
          ${
            canAddPosition
              ? `<button type="button" class="empty-position-entry" data-position-add-row>
                  <span>＋</span>
                  <strong>${emptyText}</strong>
                  <em>${emptyHint}</em>
                </button>`
              : `<div class="empty-position-entry passive">
                  <strong>${emptyText}</strong>
                  <em>${emptyHint}</em>
                </div>`
          }
        </td>
      </tr>
    `;

  $$("[data-position-add-row]").forEach((row) => {
    row.addEventListener("click", () => showView("trade"));
  });

  $$("[data-sell-id]").forEach((button) => {
    button.addEventListener("click", () => openSellDialog(button.dataset.sellId));
  });

  $$("[data-restore-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const position = getPosition(button.dataset.restoreId);
      if (!position) return;
      position.status = "open";
      position.shares = position.shares || Math.max(1, position.originalShares || 1);
      saveState();
      render();
      toast("已重新加入当前持仓");
    });
  });

  $$("[data-delete-id]").forEach((button) => {
    button.addEventListener("click", () => deletePosition(button.dataset.deleteId));
  });

  $$("[data-note-id]").forEach((button) => {
    button.addEventListener("click", () => {
      showView("journal");
      $("#journalPositionSelect").value = button.dataset.noteId;
      $("#journalForm [name='date']").value = todayISO();
      $("#journalForm [name='type']").value = "持仓观察";
    });
  });

  drawMarketChart();
}

function filteredPositions() {
  if (viewState.positionFilter === "open") return getOpenPositions();
  if (viewState.positionFilter === "closed") {
    return state.positions.filter((position) => position.status === "closed" || position.shares <= 0);
  }
  return [...state.positions];
}

function deletePosition(positionId) {
  const position = getPosition(positionId);
  if (!position) return;
  if (!confirm(`确定删除 ${position.name} 的持仓、交易和关联日志吗？`)) return;
  state.positions = state.positions.filter((item) => item.id !== positionId);
  state.trades = state.trades.filter((trade) => trade.positionId !== positionId);
  state.journal = state.journal.filter((note) => note.positionId !== positionId);
  delete state.marketData.quotes[position.symbol];
  delete state.marketData.candles[position.symbol];
  state.marketData.selectedSymbol = getOpenPositions()[0]?.symbol || state.positions[0]?.symbol || "";
  saveState();
  render();
  toast("持仓已删除");
}

function renderJournal() {
  const sorted = [...state.journal].sort((a, b) => b.date.localeCompare(a.date));
  $("#journalCount").textContent = sorted.length;
  $("#journalList").innerHTML = sorted.length
    ? sorted
        .map((note) => {
          const position = getPosition(note.positionId);
          return `
            <article class="note-item">
              <div class="note-title">${escapeHTML(note.title)}</div>
              <div class="note-meta">
                ${note.date} · ${escapeHTML(note.type)}${position ? ` · ${escapeHTML(position.name)}` : ""} · 纪律分 ${note.disciplineScore}
              </div>
              <div>${escapeHTML(note.content)}</div>
              <div><span class="tag">${escapeHTML(note.mood)}</span></div>
            </article>
          `;
        })
        .join("")
    : `<div class="empty-state">暂无日志</div>`;
}

function renderPlanPreview(selector, items) {
  const node = $(selector);
  if (!node) return;
  const list = normalizePlanItems(items).slice(0, 4);
  node.innerHTML = list.length
    ? `<ol class="compact-plan-list">${list
        .map((item, index) => {
          const text = String(item.type || "").includes("事件") ? translateEventText(item.text) : item.text;
          return `
            <li>
              <strong>${index + 1}.</strong>
              <span>${item.type ? `<b>${escapeHTML(item.type)}</b>：` : ""}${escapeHTML(text)}</span>
            </li>
          `;
        })
        .join("")}</ol>`
    : `<span class="soft-text">未填写</span>`;
}

function renderPlanBuilder() {
  Object.keys(PLAN_ITEM_CONFIG).forEach((field) => {
    renderPlanItems(field, normalizePlanItems(state.routine[field]));
  });
}

function renderPlanItems(field, items = []) {
  const config = PLAN_ITEM_CONFIG[field];
  const container = $(`[data-plan-field="${field}"]`);
  if (!config || !container) return;
  const rows = items.length ? items : [{ type: config.types[0], text: "" }];
  container.innerHTML = `
    <div class="plan-list-head">
      <h4>${escapeHTML(config.title)}</h4>
      <button type="button" class="ghost-button" data-add-plan-item="${field}">＋ ${escapeHTML(config.addLabel)}</button>
    </div>
    <div class="plan-items">
      ${rows
        .map(
          (item, index) => `
            <div class="plan-item-row" data-plan-item="${field}">
              <div class="plan-item-index">${index + 1}</div>
              <select data-plan-type="${field}" aria-label="${escapeHTML(config.title)}类型">
                ${config.types
                  .map((type) => `<option ${type === item.type ? "selected" : ""}>${escapeHTML(type)}</option>`)
                  .join("")}
              </select>
              <textarea data-plan-text="${field}" rows="2" placeholder="${escapeHTML(config.placeholder)}">${escapeHTML(item.text)}</textarea>
              <button type="button" class="ghost-button plan-remove-button" data-remove-plan-item="${field}" data-index="${index}" title="删除这一条">×</button>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function readPlanItemsFromEditor(field, keepBlank = false) {
  const rows = $$(`[data-plan-item="${field}"]`);
  return rows
    .map((row) => ({
      type: row.querySelector(`[data-plan-type="${field}"]`)?.value || PLAN_ITEM_CONFIG[field]?.types[0] || "自定义",
      text: row.querySelector(`[data-plan-text="${field}"]`)?.value.trim() || "",
    }))
    .filter((item) => keepBlank || item.text);
}

function collectRoutinePlanItems() {
  return Object.keys(PLAN_ITEM_CONFIG).reduce((result, field) => {
    result[field] = readPlanItemsFromEditor(field);
    return result;
  }, {});
}

function syncRoutineLegacyFields() {
  state.routine.weeklyFocus = planItemsToText(state.routine.weeklyFocusItems);
  state.routine.weeklyAvoid = planItemsToText(state.routine.weeklyAvoidItems);
  state.routine.dailyStrategy = planItemsToText(state.routine.dailyStrategyItems);
  state.routine.dailyTasks = planItemsToText(state.routine.dailyTaskItems);
  state.routine.dailyAvoid = planItemsToText(state.routine.dailyAvoidItems);
}

function renderPlans() {
  const marketForm = $("#marketPlanForm");
  marketForm.cycleStart.value = state.market.cycleStart || "";
  marketForm.cycleEndMode.value = state.market.cycleEndMode || "fixed";
  marketForm.cycleEndDate.value = state.market.cycleEndDate || "";
  marketForm.cycleNote.value = state.market.cycleNote || "";
  marketForm.regime.value = state.market.regime;
  marketForm.accountEquity.value = state.settings.accountEquity;
  marketForm.positionCap.value = state.market.positionCap;
  marketForm.allowNew.value = state.market.allowNew;
  marketForm.weeklyBuyLimit.value = state.market.weeklyBuyLimit;
  marketForm.notes.value = state.market.notes;
  updateCycleEndField();

  renderPlanBuilder();
}

function generateDailyPlanDraft() {
  const guard = entryGuardState();
  const alerts = computeAlerts();
  const today = todayISO();
  const upcomingEvents = state.events
    .filter((event) => {
      const gap = daysBetween(today, event.date);
      return gap >= 0 && gap <= 3;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const openPositions = getOpenPositions();
  const targetNames = openPositions
    .flatMap((position) =>
      position.targets
        .filter((target) => target.status !== "done" && num(position.currentPrice) >= num(target.price) * 0.98)
        .map((target) => `${position.name}${target.name}`),
    )
    .slice(0, 3);
  const stopNames = openPositions
    .filter((position) => num(position.stopLoss) && num(position.currentPrice) <= num(position.stopLoss) * 1.03)
    .map((position) => position.name)
    .slice(0, 3);
  const highImpactEvent = upcomingEvents.find((event) => event.impact === "高") || upcomingEvents[0];

  const strategyItems = [
    {
      type: "市场策略",
      text: `${state.market.regime}环境，仓位纪律 ${percent(state.market.positionCap, 0)}，开仓纪律 ${guard.permission}；先执行纪律，再判断个股。`,
    },
    {
      type: "开仓策略",
      text:
        state.market.allowNew === "false" || guard.blockingChecks.length
          ? "暂停新增计划外仓位，任何新仓必须先回到纪律总控重新确认。"
          : state.market.allowNew === "cautious"
            ? "只允许计划内、高质量、仓位受控的机会；盘中临时信号不作为开仓理由。"
            : "允许寻找突破和趋势延续机会，但单笔必须有止损、止盈和退出条件。",
    },
  ];

  if (highImpactEvent) {
    strategyItems.push({
      type: "事件策略",
      text: `${monthDay(highImpactEvent.date)}关注${eventDisplayTitle(highImpactEvent)}，事件前降低冲动开仓，优先处理已有持仓风险。`,
    });
  }

  const taskItems = [
    {
      type: "持仓检查",
      text: openPositions.length
        ? `逐一检查 ${openPositions.length} 只持仓的止损、第一止盈、第二止盈和趋势退出信号。`
        : "当前无持仓，先更新观察标的和事件风险，不急于开第一笔仓。",
    },
    {
      type: "减仓执行",
      text: targetNames.length
        ? `优先处理接近计划位：${targetNames.join("、")}。`
        : "没有接近止盈位的持仓时，不为了交易感而交易。",
    },
  ];

  if (stopNames.length) {
    taskItems.unshift({
      type: "持仓检查",
      text: `${stopNames.join("、")}接近或触及止损，先执行风控，再讨论新机会。`,
    });
  }
  if (alerts.length) {
    taskItems.push({
      type: "复盘记录",
      text: `今日已有 ${alerts.length} 条操作提醒，盘后记录是否执行以及偏离原因。`,
    });
  }

  const avoidItems = [
    {
      type: "不超仓位",
      text: `当前仓位 ${percent(guard.exposure)}，不得突破 ${percent(guard.cap)} 的计划上限。`,
    },
    {
      type: "不计划外交易",
      text: "没有写清买入依据、止损、止盈和退出条件的机会，不进入开仓。",
    },
    {
      type: "不追涨",
      text: highImpactEvent ? "重要事件前不追涨、不赌数据落地后的方向。" : "连续上涨后不因为情绪追价。",
    },
  ];

  state.routine.dailyStrategyItems = strategyItems;
  state.routine.dailyTaskItems = taskItems;
  state.routine.dailyAvoidItems = avoidItems;
  syncRoutineLegacyFields();
  saveState();
  render();
  toast("今日执行草案已生成");
}

function updateCycleEndField() {
  const mode = $("#cycleEndModeSelect")?.value || "fixed";
  const input = $("#cycleEndDateInput");
  if (!input) return;
  input.disabled = mode === "open";
  input.required = mode === "fixed" && Boolean($("#marketPlanForm")?.cycleStart.value);
  if (mode === "open") input.value = "";
}

function renderEvents() {
  const year = viewState.calendarYear;
  const month = viewState.calendarMonth;
  $("#calendarTitle").textContent = `${year}年${month + 1}月事件日历`;
  renderCalendarControls();
  renderCalendarModeButtons();

  const visibleEvents = filteredEvents();
  const monthEvents = visibleEvents.filter((event) => {
    const date = parseLocalDate(event.date);
    return date.getFullYear() === year && date.getMonth() === month;
  });

  if (viewState.calendarMode === "year") {
    $("#calendarGrid").style.display = "none";
    $(".weekday-row").style.display = "none";
    $("#yearGrid").style.display = "grid";
    renderYearGrid();
  } else {
    $("#calendarGrid").style.display = "grid";
    $(".weekday-row").style.display = "grid";
    $("#yearGrid").style.display = "none";
    renderMonthGrid();
  }

  renderEventDetail(visibleEvents);
  attachCalendarEventClicks();
}

function renderCalendarControls() {
  const yearSelect = $("#calendarYearSelect");
  const monthSelect = $("#calendarMonthSelect");
  const categorySelect = $("#eventCategoryFilter");
  const scopeSelect = $("#eventMarketFilter");
  const currentYear = new Date().getFullYear();
  yearSelect.innerHTML = Array.from({ length: 9 }, (_, index) => currentYear - 4 + index)
    .map((year) => `<option value="${year}">${year}年</option>`)
    .join("");
  monthSelect.innerHTML = Array.from({ length: 12 }, (_, index) => `<option value="${index}">${index + 1}月</option>`).join("");
  yearSelect.value = String(viewState.calendarYear);
  monthSelect.value = String(viewState.calendarMonth);
  categorySelect.value = viewState.eventCategory;
  setSelectOptions(scopeSelect, eventScopeOptions(viewState.eventCategory), viewState.eventMarket);
  viewState.eventMarket = scopeSelect.value;
}

function renderEventFormScopeOptions(selectedValue = "") {
  const form = $("#eventForm");
  if (!form) return;
  setSelectOptions(form.market, eventScopeOptions(form.category.value, false), selectedValue || form.market.value);
}

function renderCalendarModeButtons() {
  $$("[data-calendar-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.calendarMode === viewState.calendarMode);
  });
}

function filteredEvents() {
  return state.events
    .map((event) => {
      const category = normalizeEventCategory(event.category);
      return { ...event, category, market: normalizeEventScope(event.market, category) };
    })
    .filter((event) => viewState.eventCategory === "all" || event.category === viewState.eventCategory)
    .filter((event) => viewState.eventMarket === "all" || event.market === viewState.eventMarket)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function renderMonthGrid() {
  const year = viewState.calendarYear;
  const month = viewState.calendarMonth;
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const previousDays = new Date(year, month, 0).getDate();
  const cells = [];

  for (let index = 0; index < 42; index += 1) {
    const day = index - startOffset + 1;
    let date;
    let muted = false;
    if (day < 1) {
      date = new Date(year, month - 1, previousDays + day);
      muted = true;
    } else if (day > daysInMonth) {
      date = new Date(year, month + 1, day - daysInMonth);
      muted = true;
    } else {
      date = new Date(year, month, day);
    }
    cells.push(calendarCellTemplate(date, muted));
  }
  $("#calendarGrid").innerHTML = cells.join("");
}

function calendarCellTemplate(date, muted) {
  const iso = toISODate(date);
  const events = filteredEvents().filter((event) => event.date === iso);
  const isToday = iso === todayISO();
  const isSelected = iso === viewState.selectedEventDate;
  return `
    <article class="calendar-cell ${muted ? "muted" : ""} ${isToday ? "today" : ""} ${isSelected ? "selected" : ""}">
      <div class="calendar-day">${date.getDate()}</div>
      ${
        events.length
          ? `<button type="button" class="calendar-day-summary ${dominantEventTone(events)}" data-calendar-date="${iso}">
              <strong>${events.length} 项事件</strong>
            </button>`
          : ""
      }
    </article>
  `;
}

function attachCalendarEventClicks() {
  $$("[data-calendar-date]").forEach((button) => {
    const selectDate = () => {
      viewState.selectedEventDate = button.dataset.calendarDate;
      renderEvents();
    };
    button.addEventListener("click", selectDate);
    button.addEventListener("keydown", (event) => {
      if (!["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      selectDate();
    });
  });
}

function dominantEventTone(events = []) {
  return events.length ? "high" : "";
}

function renderYearGrid() {
  const year = viewState.calendarYear;
  const events = filteredEvents();
  $("#yearGrid").innerHTML = Array.from({ length: 12 }, (_, month) => {
    const count = events.filter((event) => {
      const date = parseLocalDate(event.date);
      return date.getFullYear() === year && date.getMonth() === month;
    }).length;
    return `
      <button class="year-month ${month === viewState.calendarMonth ? "active" : ""}" data-year-month="${month}">
        <strong>${month + 1}月</strong>
        <span>${count} 个事件</span>
      </button>
    `;
  }).join("");

  $$("[data-year-month]").forEach((button) => {
    button.addEventListener("click", () => {
      viewState.calendarMonth = Number(button.dataset.yearMonth);
      viewState.calendarMode = "month";
      renderEvents();
    });
  });
}

function renderEventDetail(events) {
  const detail = $("#eventDetail");
  const badge = $("#eventDetailBadge");
  if (!detail || !badge) return;
  if (!viewState.selectedEventDate) {
    badge.textContent = "未选择";
    badge.className = "count-badge";
    detail.innerHTML = `<div class="empty-state compact">点击日期，查看当日事件详情</div>`;
    return;
  }
  const dayEvents = events.filter((event) => event.date === viewState.selectedEventDate);
  const diff = daysBetween(todayISO(), viewState.selectedEventDate);
  const diffText = diff === 0 ? "今天" : diff > 0 ? `${diff} 天后` : `${Math.abs(diff)} 天前`;
  badge.textContent = `${dayEvents.length} 项`;
  badge.className = `count-badge ${dayEvents.some((event) => event.impact === "高") ? "red" : dayEvents.some((event) => event.impact === "中") ? "amber" : ""}`;
  if (!dayEvents.length) {
    detail.innerHTML = `
      <article class="event-detail-card">
        <div class="event-date">${escapeHTML(viewState.selectedEventDate)} · ${diffText}</div>
        <h4>当天暂无匹配事件</h4>
        <p class="soft-text">可能是当前筛选条件下没有事件，或者该日期没有录入事件。</p>
      </article>
    `;
    return;
  }
  detail.innerHTML = `
    <article class="event-detail-card">
      <div class="event-date">${escapeHTML(viewState.selectedEventDate)} · ${diffText}</div>
      <h4>当天事件</h4>
      <div class="event-day-list">
        ${dayEvents
          .map(
            (event, index) => `
              <section class="event-day-item ${eventTone(event)}">
                <div class="event-day-index">${index + 1}</div>
                <div>
                  <div class="event-title">${escapeHTML(eventDisplayTitle(event))}</div>
                  <div class="event-detail-meta">
                    <span>${escapeHTML(event.impact)}影响</span>
                    <span>${escapeHTML(event.category)}</span>
                    <span>${escapeHTML(eventScopeLabel(event.market))}</span>
                    ${event.source ? `<span>${escapeHTML(eventDisplaySource(event.source))}</span>` : ""}
                  </div>
                  ${event.note ? `<p>${escapeHTML(eventDisplayNote(event))}</p>` : ""}
                  ${event.sourceUrl ? `<a class="event-source-link" href="${escapeHTML(event.sourceUrl)}" target="_blank" rel="noreferrer">查看来源</a>` : ""}
                </div>
              </section>
            `,
          )
          .join("")}
      </div>
    </article>
  `;
}

function mergeOfficialEvents(events = []) {
  let added = 0;
  let updated = 0;
  const normalizedEvents = events
    .filter((event) => event.date && event.title)
    .map((event) => ({
      id: event.id || uid(),
      sourceId: event.sourceId || "",
      source: event.source || "official",
      sourceUrl: event.sourceUrl || "",
      date: event.date,
      category: normalizeEventCategory(event.category),
      market: normalizeEventScope(event.market, event.category),
      title: event.title,
      impact: event.impact || "中",
      note: event.note || "",
    }));

  const incomingSources = new Set(normalizedEvents.map((event) => event.source).filter((source) => MANAGED_OFFICIAL_EVENT_SOURCES.has(source)));
  const incomingYears = new Set(normalizedEvents.map((event) => String(event.date || "").slice(0, 4)).filter(Boolean));
  const incomingSourceIds = new Set(normalizedEvents.map((event) => event.sourceId).filter(Boolean));
  if (incomingSources.size && incomingYears.size) {
    state.events = state.events.filter((event) => {
      const source = event.source || "";
      if (!MANAGED_OFFICIAL_EVENT_SOURCES.has(source) || !incomingSources.has(source)) return true;
      const year = String(event.date || "").slice(0, 4);
      if (!incomingYears.has(year)) return true;
      return event.sourceId && incomingSourceIds.has(event.sourceId);
    });
  }

  normalizedEvents.forEach((normalized) => {
    const existing = state.events.find(
      (item) =>
        (normalized.sourceId && item.sourceId === normalized.sourceId) ||
        (!item.sourceId && item.date === normalized.date && item.title === normalized.title),
    );
    if (existing) {
      Object.assign(existing, { ...normalized, id: existing.id || normalized.id });
      updated += 1;
    } else {
      state.events.push(normalized);
      added += 1;
    }
  });
  return { added, updated };
}

function shouldRefreshOfficialEvents(maxAgeMs = EVENT_CACHE_TTL * 1000) {
  if (!state.events.length) return true;
  if (!hasCriticalUsMacroEvents()) return true;
  if (!state.marketData.lastEventSyncAt) return true;
  const last = Date.parse(state.marketData.lastEventSyncAt);
  if (!Number.isFinite(last)) return true;
  return Date.now() - last > maxAgeMs;
}

function criticalUsEventStatus(year = new Date().getFullYear()) {
  const yearText = String(year);
  const yearlyUsEvents = state.events
    .map((event) => {
      const category = normalizeEventCategory(event.category);
      return { ...event, category, market: normalizeEventScope(event.market, category) };
    })
    .filter((event) => String(event.date || "").startsWith(yearText))
    .filter((event) => event.market === "美国" || event.market === "全球");

  return CRITICAL_US_EVENT_GROUPS.map((group) => ({
    ...group,
    ok: yearlyUsEvents.some((event) => group.match(event)),
  }));
}

function missingCriticalUsMacroEvents(year = new Date().getFullYear()) {
  return criticalUsEventStatus(year).filter((item) => !item.ok);
}

function hasCriticalUsMacroEvents(year = new Date().getFullYear()) {
  return missingCriticalUsMacroEvents(year).length === 0;
}

async function syncOfficialEvents(options = {}) {
  const { silent = false } = options;
  const button = $("#syncEventsBtn");
  if (button) {
    button.disabled = true;
    button.textContent = "更新中";
  }
  try {
    const response = await fetch(`${API_BASE}/api/events/official`);
    const payload = await response.json();
    if (!response.ok || payload.ok === false) throw new Error(payload.message || "官方事件更新失败");
    const result = mergeOfficialEvents(payload.events || []);
    state.marketData.lastEventSyncAt = payload.updatedAt || new Date().toISOString();
    saveState();
    render();
    const sourceText = (payload.sources || [])
      .map((source) => `${source.name}${source.ok ? source.count : "失败"}`)
      .join("，");
    if (!silent) toast(`事件已更新：新增 ${result.added}，刷新 ${result.updated}${sourceText ? `；${sourceText}` : ""}`);
  } catch (error) {
    if (!silent) toast(error.message || "官方事件更新失败，请稍后再试");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "在线更新";
    }
  }
}

function parseLocalDate(value) {
  return new Date(`${value}T00:00:00`);
}

function toISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function eventTone() {
  return "high";
}

function shiftCalendarMonth(delta) {
  const date = new Date(viewState.calendarYear, viewState.calendarMonth + delta, 1);
  viewState.calendarYear = date.getFullYear();
  viewState.calendarMonth = date.getMonth();
  viewState.calendarMode = "month";
  renderEvents();
}

function statsPeriodRange() {
  const mode = viewState.statsPeriodMode || "all";
  if (mode === "range") {
    const start = viewState.statsStart || "";
    const end = viewState.statsEnd || "";
    const label = start || end ? `${start || "开始"} - ${end || "今天"}` : "选择周期";
    return { mode: "range", start, end, label };
  }
  return { mode: "all", start: "", end: "", label: "开户以来" };
}

function dateInRange(date, range = statsPeriodRange()) {
  if (!date) return false;
  if (range.start && date < range.start) return false;
  if (range.end && date > range.end) return false;
  return true;
}

function tradesInStatsPeriod(range = statsPeriodRange()) {
  return state.trades.filter((trade) => dateInRange(trade.date, range));
}

function positionsInStatsPeriod(range = statsPeriodRange()) {
  return state.positions.filter((position) => dateInRange(position.openedAt, range));
}

function statsPeriodDayCount(range = statsPeriodRange()) {
  if (!range.start || !range.end) return 0;
  return Math.max(1, daysBetween(range.start, range.end) + 1);
}

function plannedBuyLimitForRange(range = statsPeriodRange()) {
  const weeklyLimit = Math.max(0, num(state.market.weeklyBuyLimit));
  if (!weeklyLimit) return 0;
  if (range.mode === "all") return 0;
  return Math.max(weeklyLimit, Math.ceil(statsPeriodDayCount(range) / 7) * weeklyLimit);
}

function renderStatsPeriodControls(range = statsPeriodRange()) {
  const mode = viewState.statsPeriodMode || "all";
  $("#statsStartInput").value = viewState.statsStart || "";
  $("#statsEndInput").value = viewState.statsEnd || "";
  $("#statsAllPeriodBtn").classList.toggle("active", mode === "all");
}

function renderStats() {
  const range = statsPeriodRange();
  renderStatsPeriodControls(range);
  const periodTrades = tradesInStatsPeriod(range);
  const buyCount = periodTrades.filter((trade) => trade.type === "buy").length;
  const sellCount = periodTrades.filter((trade) => trade.type === "sell").length;
  const periodPositions = positionsInStatsPeriod(range);
  const analytics = buildBehaviorAnalytics(range);
  const wins = analytics.records.filter((record) => record.pnl > 0);
  const losses = analytics.records.filter((record) => record.pnl < 0);
  const grossProfit = wins.reduce((sum, record) => sum + record.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, record) => sum + record.pnl, 0));
  const winRate = analytics.records.length ? (wins.length / analytics.records.length) * 100 : 0;
  const profitFactor = grossLoss ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const targetCount = periodPositions.reduce((sum, position) => sum + position.targets.length, 0);
  const doneTargetCount = periodPositions.reduce(
    (sum, position) => sum + position.targets.filter((target) => target.status === "done").length,
    0,
  );
  const targetRate = targetCount ? (doneTargetCount / targetCount) * 100 : 0;
  const totalPnl = analytics.records.reduce((sum, record) => sum + record.pnl, 0);
  const exposure = currentExposure();

  $("#statTotalPnl").textContent = money(totalPnl);
  $("#statTotalPnl").className = `metric-value ${totalPnl > 0 ? "positive" : totalPnl < 0 ? "negative" : ""}`;
  $("#statWinRate").textContent = percent(winRate, 0);
  $("#statProfitFactor").textContent = profitFactor === Infinity ? "∞" : profitFactor ? profitFactor.toFixed(2) : "--";
  $("#statMaxDrawdown").textContent = percent(analytics.maxDrawdownPct, 1);
  $("#statMaxDrawdown").className = `metric-value ${analytics.maxDrawdownPct > 8 ? "bad-text" : ""}`;
  $("#statViolationRate").textContent = percent(analytics.violationRate, 0);
  $("#statViolationRate").className = `metric-value ${analytics.violationRate > 30 ? "bad-text" : analytics.violationRate ? "neutral-text" : "good-text"}`;
  $("#statTargetRate").textContent = percent(targetRate, 0);

  const capital = [
    { label: "当前仓位", value: exposure, max: 100 },
    { label: "仓位上限", value: state.market.positionCap, max: 100 },
    { label: "现金缓冲", value: Math.max(0, 100 - exposure), max: 100 },
    { label: "单票最大仓位", value: maxPositionPct(), max: 100 },
  ];

  const execution = [
    { label: "计划完整率", value: planCompletenessRate(range), max: 100 },
    { label: "止盈执行率", value: targetRate, max: 100 },
    { label: "卖出/买入动作比", value: buyCount ? (sellCount / buyCount) * 100 : 0, max: 200 },
    { label: "纪律遵守率", value: 100 - analytics.violationRate, max: 100 },
  ];

  $("#capitalStats").innerHTML = statBars(capital);
  $("#executionStats").innerHTML = statBars(execution);
  $("#disciplineMatrixBadge").textContent = `${analytics.records.length} 笔开仓`;
  $("#behaviorSummaryBadge").textContent = analytics.summary.tone;
  $("#behaviorSummaryBadge").className = `count-badge ${analytics.summary.level}`;
  $("#behaviorSummary").innerHTML = behaviorSummaryTemplate(analytics, { totalPnl, winRate, targetRate, exposure });
  $("#disciplineMatrix").innerHTML = disciplineMatrixTemplate(analytics.stageStats);
  $("#violationTracker").innerHTML = violationTrackerTemplate(analytics);
  $("#biasSignals").innerHTML = biasSignalsTemplate(analytics.biasSignals);
  $("#correctionReport").innerHTML = correctionReportTemplate(analytics);
  drawEquityCurve(analytics.records);

  const bySetup = groupBySetup(analytics.records);
  $("#setupStats").innerHTML = bySetup.length
    ? bySetup
        .map(
          (item) => `
            <div class="setup-row">
              <div>
                <strong>${escapeHTML(item.setup)}</strong>
                <div class="soft-text">${item.count} 笔开仓 / 平均收益 ${percent(item.avgPct)}</div>
              </div>
              <span class="${item.pnl >= 0 ? "positive" : "negative"}">${money(item.pnl)}</span>
            </div>
          `,
        )
        .join("")
    : `<div class="empty-state">暂无统计</div>`;

  const risks = computeAlerts().slice(0, 6);
  $("#riskRadar").innerHTML = risks.length
    ? risks
        .map(
          (alert) => `
            <div class="setup-row">
              <div>
                <strong>${escapeHTML(alert.title)}</strong>
                <div class="soft-text">${escapeHTML(alert.body)}</div>
              </div>
              <span class="tag ${tagClass(alert.level)}">${alert.level === "high" ? "高" : alert.level === "medium" ? "中" : "低"}</span>
            </div>
          `,
        )
        .join("")
    : `<div class="empty-state">暂无风险项</div>`;
}

function renderDataUtilities() {
  const node = $("#dataUtilityStatus");
  if (!node) return;
  const snapshots = loadDataSnapshots();
  const brokerImports = state.imports.brokerStatements || [];
  const lastBrokerImport = brokerImports[0];
  const statusRows = [
    {
      label: "最近行情扫描",
      value: state.marketData.lastScanAt ? formatDateTime(state.marketData.lastScanAt) : "尚未扫描",
    },
    {
      label: "最近事件更新",
      value: state.marketData.lastEventSyncAt ? formatDateTime(state.marketData.lastEventSyncAt) : "尚未更新",
    },
    {
      label: "本地快照",
      value: snapshots.length ? `${snapshots.length} 个，最近 ${formatDateTime(snapshots[0].createdAt)}` : "暂无快照",
    },
    {
      label: "券商对账",
      value: lastBrokerImport
        ? `${lastBrokerImport.rowCount} 条，匹配系统 ${lastBrokerImport.matchedCount} 条`
        : "尚未导入",
    },
  ];
  node.innerHTML = statusRows
    .map(
      (item) => `
        <div class="data-status-row">
          <span>${escapeHTML(item.label)}</span>
          <strong>${escapeHTML(item.value)}</strong>
        </div>
      `,
    )
    .join("");
}

function loadDataSnapshots() {
  try {
    const snapshots = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "[]");
    return Array.isArray(snapshots) ? snapshots : [];
  } catch {
    return [];
  }
}

function createLocalSnapshot(label = "手动快照") {
  const snapshots = loadDataSnapshots();
  const snapshot = {
    id: uid(),
    label,
    createdAt: new Date().toISOString(),
    payload: state,
  };
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify([snapshot, ...snapshots].slice(0, 10)));
  renderDataUtilities();
  toast("本地快照已创建");
}

function downloadText(filename, content, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function generateScanReport() {
  const before = state.marketData.lastScanAt;
  await syncMarketData({ silent: true });
  const alerts = computeAlerts();
  const today = todayISO();
  const upcomingEvents = state.events
    .filter((event) => {
      const gap = daysBetween(today, event.date);
      return gap >= 0 && gap <= 7;
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 8);
  const positions = getOpenPositions();
  const reportLines = [
    `扫描时间：${formatDateTime(new Date().toISOString())}`,
    `行情状态：${state.marketData.lastScanAt && state.marketData.lastScanAt !== before ? "已刷新" : state.marketData.lastScanAt ? "使用最近行情" : "暂无可刷新持仓"}`,
    `当前纪律：${state.market.regime} / 仓位上限 ${percent(state.market.positionCap, 0)} / 开仓纪律 ${permissionLabel(state.market.allowNew)}`,
    `当前仓位：${percent(currentExposure())}，持仓数量 ${positions.length}。`,
    "",
    "操作提醒：",
    alerts.length ? alerts.map((alert, index) => `${index + 1}. 【${alert.level === "high" ? "优先" : alert.level === "medium" ? "注意" : "观察"}】${alert.title}：${alert.body}`).join("\n") : "暂无触发提醒。",
    "",
    "未来 7 天事件：",
    upcomingEvents.length
      ? upcomingEvents.map((event, index) => `${index + 1}. ${event.date} ${eventDisplayTitle(event)}（${event.impact}影响 / ${event.category} / ${eventScopeLabel(event.market)}）`).join("\n")
      : "暂无未来事件。",
  ];

  state.journal.unshift({
    id: uid(),
    date: todayISO(),
    type: "扫描报告",
    positionId: "",
    title: `${todayISO()} 晚间扫描报告`,
    content: reportLines.join("\n"),
    mood: "冷静",
    disciplineScore: alerts.some((alert) => alert.level === "high") ? 7 : 8,
  });
  saveState();
  render();
  toast("扫描报告已写入复盘日志");
}

function behaviorReportMarkdown() {
  const range = statsPeriodRange();
  const analytics = buildBehaviorAnalytics(range);
  const records = analytics.records;
  const wins = records.filter((record) => record.pnl > 0);
  const losses = records.filter((record) => record.pnl < 0);
  const totalPnl = records.reduce((sum, record) => sum + record.pnl, 0);
  const periodPositions = positionsInStatsPeriod(range);
  const targetCount = periodPositions.reduce((sum, position) => sum + position.targets.length, 0);
  const doneTargetCount = periodPositions.reduce(
    (sum, position) => sum + position.targets.filter((target) => target.status === "done").length,
    0,
  );
  const targetRate = targetCount ? (doneTargetCount / targetCount) * 100 : 0;
  const biasLines = analytics.biasSignals
    .slice(0, 5)
    .map((signal, index) => `${index + 1}. ${signal.name}：${signal.evidence} 建议：${signal.advice}`)
    .join("\n");
  const stageLines = analytics.stageStats
    .map(
      (item) =>
        `- ${item.stage}：${item.count} 笔，胜率 ${percent(item.winRate, 0)}，盈亏 ${money(item.pnl)}，平均收益 ${percent(item.avgReturnPct, 1)}，纪律偏离 ${percent(item.violationRate, 0)}`,
    )
    .join("\n");
  const violations = records.filter((record) => record.ruleBreaks.length);
  const violationLines = violations.length
    ? violations
        .slice(-10)
        .reverse()
        .map((record, index) => `${index + 1}. ${record.openedAt} ${record.name}：${record.ruleBreaks.join("、")}，结果 ${money(record.pnl)}`)
        .join("\n")
    : "暂无纪律偏离样本。";

  return [
    `# 交易行为复盘报告 ${range.label}`,
    "",
    "## 核心结论",
    `- 复盘周期：${range.label}`,
    `- 本期总盈亏：${money(totalPnl)}`,
    `- 开仓样本：${records.length} 笔`,
    `- 胜率：${percent(records.length ? (wins.length / records.length) * 100 : 0, 0)}`,
    `- 最大回撤：${percent(analytics.maxDrawdownPct, 1)}`,
    `- 纪律偏离率：${percent(analytics.violationRate, 0)}`,
    `- 止盈执行率：${percent(targetRate, 0)}`,
    "",
    "## 纪律环境表现",
    stageLines || "暂无开仓样本。",
    "",
    "## 违规开仓追踪",
    violationLines,
    "",
    "## 行为偏差信号",
    biasLines || "暂无明显行为偏差信号。",
    "",
    "## 下一步纠偏",
    analytics.biasSignals
      .filter((signal) => signal.level !== "low")
      .slice(0, 3)
      .map((signal, index) => `${index + 1}. ${signal.advice}`)
      .join("\n") || "继续积累样本，重点保持每笔开仓都有完整计划。",
  ].join("\n");
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell.trim());
      if (row.some((value) => value)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some((value) => value)) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((values) =>
    headers.reduce((result, header, index) => {
      result[header] = values[index] || "";
      return result;
    }, {}),
  );
}

function rowValue(row, keys) {
  const normalized = Object.keys(row).reduce((result, key) => {
    result[key.replace(/\s+/g, "").toLowerCase()] = row[key];
    return result;
  }, {});
  const found = keys.find((key) => normalized[key.replace(/\s+/g, "").toLowerCase()] !== undefined);
  return found ? normalized[found.replace(/\s+/g, "").toLowerCase()] : "";
}

function normalizeBrokerSide(value) {
  const text = String(value || "");
  if (text.includes("卖") || text.toLowerCase().includes("sell")) return "sell";
  return "buy";
}

function normalizeSymbol(value) {
  return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
}

function normalizeImportedDate(value, fallback = todayISO()) {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  const cleaned = raw
    .replace(/[年月.]/g, "-")
    .replace(/[日号]/g, "")
    .replace(/\//g, "-");
  const match = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return fallback;
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function importBrokerRows(rows, filename = "券商CSV") {
  const records = rows
    .map((row) => {
      const symbol = normalizeSymbol(rowValue(row, ["证券代码", "股票代码", "代码", "symbol", "ticker"]));
      const name = rowValue(row, ["证券名称", "股票名称", "名称", "name"]) || symbol;
      const date = normalizeImportedDate(rowValue(row, ["成交日期", "日期", "date", "trade_date"]));
      const side = normalizeBrokerSide(rowValue(row, ["买卖方向", "方向", "买卖", "side", "type"]));
      const quantity = num(rowValue(row, ["成交数量", "数量", "股数", "quantity", "qty", "shares"]));
      const tradePrice = num(rowValue(row, ["成交价格", "价格", "price"]));
      const amount = num(rowValue(row, ["成交金额", "金额", "amount"])) || tradePrice * quantity;
      return { symbol, name, date, side, quantity, price: tradePrice, amount };
    })
    .filter((record) => record.symbol && record.quantity);

  const matchedCount = records.filter((record) =>
    state.positions.some((position) => normalizeSymbol(position.symbol) === record.symbol),
  ).length;
  const buyCount = records.filter((record) => record.side === "buy").length;
  const sellCount = records.filter((record) => record.side === "sell").length;
  const totalAmount = records.reduce((sum, record) => sum + Math.abs(num(record.amount)), 0);
  const statement = {
    id: uid(),
    filename,
    importedAt: new Date().toISOString(),
    rowCount: records.length,
    matchedCount,
    buyCount,
    sellCount,
    totalAmount,
    rows: records.slice(0, 300),
  };
  state.imports.brokerStatements.unshift(statement);
  state.imports.brokerStatements = state.imports.brokerStatements.slice(0, 20);
  state.journal.unshift({
    id: uid(),
    date: todayISO(),
    type: "对账记录",
    positionId: "",
    title: `券商 CSV 对账导入：${filename}`,
    content: `导入 ${records.length} 条成交，买入 ${buyCount} 条，卖出 ${sellCount} 条，成交金额 ${money(totalAmount)}，与系统持仓匹配 ${matchedCount} 条。`,
    mood: "冷静",
    disciplineScore: 8,
  });
  saveState();
  render();
  toast(`券商 CSV 已导入：${records.length} 条`);
}

function importEventRows(rows, filename = "事件CSV") {
  let added = 0;
  rows.forEach((row) => {
    const date = normalizeImportedDate(rowValue(row, ["日期", "date", "发布时间", "公布日期"]), "");
    const title = rowValue(row, ["事件", "标题", "title", "name", "指标"]);
    if (!date || !title) return;
    state.events.push({
      id: uid(),
      date,
      category: normalizeEventCategory(rowValue(row, ["类型", "category", "类别"])),
      market: normalizeEventScope(rowValue(row, ["范围", "地区", "国家", "market", "region"]), rowValue(row, ["类型", "category", "类别"])),
      title,
      impact: rowValue(row, ["影响", "impact", "重要性"]) || "中",
      note: rowValue(row, ["备注", "说明", "note", "description"]),
      source: filename,
    });
    added += 1;
  });
  saveState();
  render();
  toast(`事件 CSV 已导入：${added} 条`);
}

function statBars(items) {
  return items
    .map(
      (item) => `
        <div class="bar-row">
          <strong>${item.label}</strong>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, (item.value / item.max) * 100)}%"></div></div>
          <span>${percent(item.value, 0)}</span>
        </div>
      `,
    )
    .join("");
}

function maxPositionPct() {
  return getOpenPositions().reduce((max, position) => Math.max(max, num(position.positionPct)), 0);
}

function averageDisciplineScore() {
  const scores = state.journal.map((note) => num(note.disciplineScore)).filter(Boolean);
  if (!scores.length) return 0;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function buildBehaviorAnalytics(range = statsPeriodRange()) {
  const records = entryBehaviorRecords(range);
  const stageStats = disciplineStageStats(records);
  const curvePoints = equityCurvePoints(records);
  const maxDrawdownPct = maxDrawdownPercent(curvePoints);
  const violationCount = records.filter((record) => record.ruleBreaks.length).length;
  const violationRate = records.length ? (violationCount / records.length) * 100 : 0;
  const biasSignals = buildBiasSignals(records, range);
  const summary = behaviorSummary(records, stageStats, biasSignals, violationRate);

  return {
    records,
    stageStats,
    curvePoints,
    maxDrawdownPct,
    violationCount,
    violationRate,
    biasSignals,
    summary,
  };
}

function entryBehaviorRecords(range = statsPeriodRange()) {
  return state.trades
    .filter((trade) => trade.type === "buy")
    .filter((trade) => dateInRange(trade.date, range))
    .map((trade) => {
      const position = getPosition(trade.positionId);
      if (!position) return null;
      const snapshot = normalizeEntrySnapshot(trade, position);
      const ruleBreaks = Array.isArray(trade.ruleBreaks)
        ? trade.ruleBreaks
        : entryRuleBreaks(position, snapshot, trade);
      const sellTrades = state.trades
        .filter((item) => item.type === "sell" && item.positionId === position.id)
        .sort((a, b) => a.date.localeCompare(b.date));
      const pnl = positionLifecyclePnl(position);
      const cost = num(position.entryPrice) * (num(position.originalShares) || num(trade.quantity) || num(position.shares));
      const returnPct = cost ? (pnl / cost) * 100 : positionPnlPct(position);
      const lastSell = sellTrades.at(-1);
      const closeDate = position.status === "closed" && lastSell ? lastSell.date : todayISO();

      return {
        id: trade.id,
        positionId: position.id,
        symbol: position.symbol,
        name: position.name,
        setup: position.setup,
        openedAt: trade.date || position.openedAt,
        stage: snapshot.stage,
        snapshot,
        estimated: snapshot.estimated,
        planned: trade.planned !== false,
        ruleBreaks,
        pnl,
        returnPct,
        sellCount: sellTrades.length,
        sellTrades,
        daysHeld: Math.max(0, daysBetween(position.openedAt || trade.date, closeDate)),
        positionPct: num(position.positionPct),
        originalPositionPct: num(position.originalPositionPct || position.entryPositionPct || position.positionPct),
        riskLevel: position.riskLevel || "中",
        status: position.status,
        targetCount: position.targets.length,
        doneTargetCount: position.targets.filter((target) => target.status === "done").length,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.openedAt.localeCompare(b.openedAt));
}

function normalizeEntrySnapshot(trade, position) {
  const stored = trade.disciplineSnapshot || position.entryDiscipline || null;
  const snapshot = stored ? { ...stored } : {};
  const stage = snapshot.stage || disciplineStageFromValues(snapshot.allowNew ?? state.market.allowNew, snapshot.regime ?? state.market.regime);
  const weeklyBuyLimit = num(snapshot.weeklyBuyLimit) || num(state.market.weeklyBuyLimit);
  const weeklyBuyCountBefore =
    snapshot.weeklyBuyCountBefore === undefined
      ? buyCountBeforeInWeek(trade.date || position.openedAt, trade.id)
      : num(snapshot.weeklyBuyCountBefore);
  const positionCap = num(snapshot.positionCap) || num(state.market.positionCap);
  const exposureBefore =
    snapshot.exposureBefore === undefined
      ? Math.max(0, currentExposure() - num(position.positionPct))
      : num(snapshot.exposureBefore);
  const exposureAfter =
    snapshot.exposureAfter === undefined ? exposureBefore + num(position.positionPct) : num(snapshot.exposureAfter);

  return {
    date: snapshot.date || trade.date || position.openedAt,
    regime: snapshot.regime || state.market.regime,
    allowNew: snapshot.allowNew || state.market.allowNew,
    stage,
    positionCap,
    exposureBefore,
    exposureAfter,
    weeklyBuyLimit,
    weeklyBuyCountBefore,
    cycleStart: snapshot.cycleStart || state.market.cycleStart || "",
    cycleEndMode: snapshot.cycleEndMode || state.market.cycleEndMode || "fixed",
    cycleEndDate: snapshot.cycleEndDate || state.market.cycleEndDate || "",
    cycleNote: snapshot.cycleNote || state.market.cycleNote || "",
    notes: snapshot.notes || state.market.notes || "",
    estimated: !stored,
  };
}

function currentEntrySnapshot(position) {
  const exposureBefore = currentExposure();
  const date = position.openedAt || todayISO();
  const stage = disciplineStageFromValues(state.market.allowNew, state.market.regime);
  return {
    date,
    regime: state.market.regime,
    allowNew: state.market.allowNew,
    stage,
    positionCap: num(state.market.positionCap),
    exposureBefore,
    exposureAfter: exposureBefore + num(position.positionPct),
    weeklyBuyLimit: num(state.market.weeklyBuyLimit),
    weeklyBuyCountBefore: buyCountBeforeInWeek(date),
    cycleStart: state.market.cycleStart || "",
    cycleEndMode: state.market.cycleEndMode || "fixed",
    cycleEndDate: state.market.cycleEndMode === "open" ? "" : state.market.cycleEndDate || "",
    cycleNote: state.market.cycleNote || "",
    notes: state.market.notes || "",
    estimated: false,
  };
}

function disciplineStageFromValues(allowNew, regime) {
  if (String(allowNew) === "false" || regime === "防守") return "暂停";
  if (String(allowNew) === "true" || regime === "进攻") return "进攻";
  return "谨慎";
}

function buyCountBeforeInWeek(dateString, tradeId = "") {
  const week = weekKey(dateString);
  return state.trades.filter((trade) => {
    if (trade.type !== "buy" || weekKey(trade.date) !== week) return false;
    if (trade.date < dateString) return true;
    if (trade.date > dateString) return false;
    return tradeId ? String(trade.id).localeCompare(String(tradeId)) < 0 : true;
  }).length;
}

function weekKey(dateString) {
  const date = new Date(`${dateString || todayISO()}T00:00:00`);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function entryRuleBreaks(position, snapshot, trade = {}) {
  const breaks = [];
  const exposureAfter = num(snapshot.exposureAfter);

  if (trade.planned === false) breaks.push("计划外开仓");
  if (snapshot.stage === "暂停") breaks.push("暂停期仍开仓");
  if (exposureAfter > num(snapshot.positionCap)) breaks.push("仓位超过上限");
  if (num(snapshot.weeklyBuyLimit) && num(snapshot.weeklyBuyCountBefore) >= num(snapshot.weeklyBuyLimit)) {
    breaks.push("本周开仓超限");
  }
  if (snapshot.stage === "谨慎" && entryCompletenessScore(position) < 85) {
    breaks.push("谨慎期计划不完整");
  }
  if (snapshot.stage !== "进攻" && position.riskLevel === "高") {
    breaks.push("非进攻期高风险标的");
  }

  return [...new Set(breaks)];
}

function entryCompletenessScore(position) {
  const fields = [
    "thesis",
    "kline",
    "monthlyTrend",
    "weeklyTrend",
    "dailyTrend",
    "ma",
    "macd",
    "kdj",
    "volume",
    "marketAlignment",
    "supportLevel",
    "trendHold",
    "exitSignal",
  ];
  const filled = fields.filter((field) => String(position[field] || "").trim()).length;
  const mustHave = [
    Boolean(position.stopLoss),
    Array.isArray(position.targets) && position.targets.length > 0,
    Boolean(position.setup),
  ].filter(Boolean).length;
  return ((filled + mustHave) / (fields.length + 3)) * 100;
}

function positionLifecyclePnl(position) {
  const realized = state.trades
    .filter((trade) => trade.type === "sell" && trade.positionId === position.id)
    .reduce((sum, trade) => sum + (num(trade.price) - num(position.entryPrice)) * num(trade.quantity), 0);
  const floating = position.status !== "closed" && num(position.shares) > 0 ? positionPnl(position) : 0;
  return realized + floating;
}

function disciplineStageStats(records) {
  const map = new Map(
    ["进攻", "谨慎", "暂停"].map((stage) => [
      stage,
      { stage, count: 0, wins: 0, losses: 0, pnl: 0, returnPctSum: 0, violations: 0, maxLossPct: 0 },
    ]),
  );

  records.forEach((record) => {
    const item = map.get(record.stage) || map.get("谨慎");
    item.count += 1;
    item.wins += record.pnl > 0 ? 1 : 0;
    item.losses += record.pnl < 0 ? 1 : 0;
    item.pnl += record.pnl;
    item.returnPctSum += record.returnPct;
    item.violations += record.ruleBreaks.length ? 1 : 0;
    item.maxLossPct = Math.min(item.maxLossPct, record.returnPct);
  });

  return Array.from(map.values()).map((item) => ({
    ...item,
    winRate: item.count ? (item.wins / item.count) * 100 : 0,
    avgReturnPct: item.count ? item.returnPctSum / item.count : 0,
    violationRate: item.count ? (item.violations / item.count) * 100 : 0,
  }));
}

function buildBiasSignals(records, range = statsPeriodRange()) {
  const periodTrades = tradesInStatsPeriod(range);
  const buyCount = periodTrades.filter((trade) => trade.type === "buy").length;
  const sellCount = periodTrades.filter((trade) => trade.type === "sell").length;
  const plannedLimit = plannedBuyLimitForRange(range);
  const openLosers = getOpenPositions().filter((position) => positionPnl(position) < 0);
  const overdueLosers = openLosers.filter((position) => daysBetween(position.openedAt, todayISO()) >= 5);
  const stoppedLosers = openLosers.filter((position) => num(position.stopLoss) && num(position.currentPrice) <= num(position.stopLoss));
  const pendingTargets = getOpenPositions().flatMap((position) =>
    position.targets
      .filter((target) => target.status !== "done" && num(position.currentPrice) >= num(target.price))
      .map((target) => ({ position, target })),
  );
  const manualWinnerSells = periodTrades.filter((trade) => {
    if (trade.type !== "sell" || !String(trade.reason || "").includes("手动")) return false;
    const position = getPosition(trade.positionId);
    return position && num(trade.price) > num(position.entryPrice);
  });
  const violationRecords = records.filter((record) => record.ruleBreaks.length);
  const lossThenBuy = lossSellThenBuyEvents(range);
  const signals = [
    {
      name: "过度交易",
      level:
        (plannedLimit && buyCount > plannedLimit) || buyCount > sellCount + 2
          ? "high"
          : buyCount > sellCount
            ? "medium"
            : "low",
      evidence: `本期买入 ${buyCount} 次、卖出 ${sellCount} 次${plannedLimit ? `，折算计划上限 ${plannedLimit} 次` : ""}。`,
      advice: "先把买入次数当成稀缺额度，谨慎期只允许计划内最高质量机会。",
    },
    {
      name: "处置效应",
      level: overdueLosers.length && (manualWinnerSells.length || pendingTargets.length) ? "high" : overdueLosers.length ? "medium" : "low",
      evidence: `亏损仍持有 ${overdueLosers.length} 只，手动卖出盈利 ${manualWinnerSells.length} 次，已到止盈未执行 ${pendingTargets.length} 个。`,
      advice: "盈利票按计划分批兑现，亏损票按止损处理，避免“赚小钱、扛大亏”。",
    },
    {
      name: "亏损厌恶",
      level: stoppedLosers.length ? "high" : openLosers.length ? "medium" : "low",
      evidence: stoppedLosers.length
        ? `${stoppedLosers.length} 只持仓已经触及或跌破止损。`
        : `当前亏损持仓 ${openLosers.length} 只。`,
      advice: "止损不是判断对错，而是保护下一次出手机会。",
    },
    {
      name: "纪律偏离",
      level: violationRecords.length ? (violationRecords.length / Math.max(1, records.length) > 0.3 ? "high" : "medium") : "low",
      evidence: `有 ${violationRecords.length} 笔开仓出现纪律偏离。`,
      advice: "把暂停和谨慎阶段当作硬约束，先复盘再开新仓。",
    },
    {
      name: "亏后急于翻本",
      level: lossThenBuy.length > 1 ? "high" : lossThenBuy.length ? "medium" : "low",
      evidence: `亏损卖出后 2 个交易日内再次开仓 ${lossThenBuy.length} 次。`,
      advice: "亏损后至少完成一条复盘日志，再恢复新仓权限。",
    },
  ];

  return signals.sort((a, b) => biasLevelScore(b.level) - biasLevelScore(a.level));
}

function lossSellThenBuyEvents(range = statsPeriodRange()) {
  const buys = state.trades.filter((trade) => trade.type === "buy").filter((trade) => dateInRange(trade.date, range));
  return state.trades
    .filter((trade) => trade.type === "sell")
    .filter((trade) => dateInRange(trade.date, range))
    .filter((sell) => {
      const position = getPosition(sell.positionId);
      return position && num(sell.price) < num(position.entryPrice);
    })
    .flatMap((sell) =>
      buys.filter((buy) => {
        const gap = daysBetween(sell.date, buy.date);
        return gap >= 0 && gap <= 2;
      }),
    );
}

function biasLevelScore(level) {
  if (level === "high") return 3;
  if (level === "medium") return 2;
  return 1;
}

function behaviorSummary(records, stageStats, biasSignals, violationRate) {
  const bestStage = stageStats.filter((item) => item.count).sort((a, b) => b.avgReturnPct - a.avgReturnPct)[0];
  const worstSignal = biasSignals[0];
  const tone =
    violationRate >= 40 || worstSignal?.level === "high"
      ? "需要纠偏"
      : records.length < 3
        ? "样本积累"
        : violationRate
          ? "保持警惕"
          : "纪律稳定";
  const level = tone === "需要纠偏" ? "red" : tone === "保持警惕" || tone === "样本积累" ? "amber" : "red";
  return { tone, level, bestStage, worstSignal };
}

function behaviorSummaryTemplate(analytics, stats) {
  const { bestStage, worstSignal } = analytics.summary;
  const snapshotCoverage = analytics.records.length
    ? (analytics.records.filter((record) => !record.estimated).length / analytics.records.length) * 100
    : 0;
  const summaryItems = [
    {
      label: "最有效纪律环境",
      value: bestStage ? bestStage.stage : "暂无样本",
      hint: bestStage
        ? `${bestStage.count} 笔，胜率 ${percent(bestStage.winRate, 0)}，平均收益 ${percent(bestStage.avgReturnPct, 1)}。`
        : "先记录更多开仓，系统会自动比较进攻、谨慎、暂停阶段。",
    },
    {
      label: "最需要处理的偏差",
      value: worstSignal ? worstSignal.name : "暂无",
      hint: worstSignal ? worstSignal.evidence : "当前没有明显行为偏差信号。",
    },
    {
      label: "纪律记录覆盖率",
      value: percent(snapshotCoverage, 0),
      hint: snapshotCoverage < 100 ? "旧数据没有当时纪律快照，已用当前计划做保守补算。" : "每笔开仓都已保存当时纪律快照。",
    },
    {
      label: "账户状态",
      value: money(stats.totalPnl),
      hint: `胜率 ${percent(stats.winRate, 0)}，止盈执行率 ${percent(stats.targetRate, 0)}，当前仓位 ${percent(stats.exposure)}。`,
    },
  ];

  return summaryItems
    .map(
      (item) => `
        <div class="summary-item">
          <span>${item.label}</span>
          <strong>${item.value}</strong>
          <p>${escapeHTML(item.hint)}</p>
        </div>
      `,
    )
    .join("");
}

function disciplineMatrixTemplate(stageStats) {
  const rows = stageStats.map((item) => {
    const tone = item.count && item.avgReturnPct >= 0 ? "positive" : item.count ? "negative" : "neutral-text";
    return `
      <article class="discipline-result-card ${disciplineStageClass(item.stage)}">
        <div>
          <span class="mini-label">${item.stage}阶段</span>
          <strong>${item.count} 笔</strong>
        </div>
        <div class="discipline-result-grid">
          <span>胜率<br /><strong>${percent(item.winRate, 0)}</strong></span>
          <span>盈亏<br /><strong class="${tone}">${money(item.pnl)}</strong></span>
          <span>平均<br /><strong class="${tone}">${percent(item.avgReturnPct, 1)}</strong></span>
          <span>纪律偏离<br /><strong>${percent(item.violationRate, 0)}</strong></span>
        </div>
      </article>
    `;
  });
  return rows.join("");
}

function violationTrackerTemplate(analytics) {
  const records = analytics.records.filter((record) => record.ruleBreaks.length).slice(-6).reverse();
  if (!records.length) return `<div class="empty-state">暂无纪律偏离开仓</div>`;
  return records
    .map(
      (record) => `
        <div class="setup-row behavior-row">
          <div>
            <strong>${escapeHTML(record.name)} ${escapeHTML(record.symbol)}</strong>
            <div class="soft-text">${record.openedAt} · ${record.stage}阶段 · ${record.ruleBreaks.map(escapeHTML).join(" / ")}</div>
          </div>
          <span class="${record.pnl >= 0 ? "positive" : "negative"}">${money(record.pnl)}</span>
        </div>
      `,
    )
    .join("");
}

function biasSignalsTemplate(signals) {
  return signals
    .map(
      (signal) => `
        <div class="setup-row behavior-row">
          <div>
            <strong>${signal.name}</strong>
            <div class="soft-text">${escapeHTML(signal.evidence)}</div>
            <div class="soft-text">${escapeHTML(signal.advice)}</div>
          </div>
          <span class="tag ${tagClass(signal.level)}">${signal.level === "high" ? "高" : signal.level === "medium" ? "中" : "低"}</span>
        </div>
      `,
    )
    .join("");
}

function correctionReportTemplate(analytics) {
  const actions = correctionActions(analytics).slice(0, 4);
  return actions
    .map(
      (item, index) => `
        <div class="correction-item">
          <span>${index + 1}</span>
          <div>
            <strong>${item.title}</strong>
            <p>${escapeHTML(item.body)}</p>
          </div>
        </div>
      `,
    )
    .join("");
}

function correctionActions(analytics) {
  const actions = [];
  const highSignal = analytics.biasSignals.find((signal) => signal.level === "high");
  const cautious = analytics.stageStats.find((item) => item.stage === "谨慎");
  const pause = analytics.stageStats.find((item) => item.stage === "暂停");
  const attack = analytics.stageStats.find((item) => item.stage === "进攻");

  if (highSignal) {
    actions.push({
      title: `先处理${highSignal.name}`,
      body: `${highSignal.evidence} ${highSignal.advice}`,
    });
  }
  if (analytics.violationRate) {
    actions.push({
      title: "把开仓权限变成硬门禁",
      body: `当前纪律偏离率 ${percent(analytics.violationRate, 0)}。暂停期不新开，谨慎期只允许计划完整、仓位受控的标的。`,
    });
  }
  if (cautious?.count && cautious.avgReturnPct < 0) {
    actions.push({
      title: "降低谨慎期交易频率",
      body: `谨慎阶段平均收益 ${percent(cautious.avgReturnPct, 1)}。这个阶段更适合减仓、观察和等待确认，不适合频繁试错。`,
    });
  }
  if (pause?.count) {
    actions.push({
      title: "复盘暂停期开仓",
      body: `暂停阶段仍有 ${pause.count} 笔开仓。把这些交易单独复盘，确认是计划例外还是情绪交易。`,
    });
  }
  if (attack?.count && attack.avgReturnPct > 0) {
    actions.push({
      title: "把进攻期样本固化成模板",
      body: `进攻阶段平均收益 ${percent(attack.avgReturnPct, 1)}。保留当时的市场状态、形态和仓位条件，下一次只复制高胜率场景。`,
    });
  }
  if (!actions.length) {
    actions.push({
      title: "继续积累样本",
      body: "每次开仓和卖出都按计划记录，系统会逐步找出你真正赚钱和真正亏钱的行为模式。",
    });
  }
  actions.push({
    title: "下次开仓前的固定问题",
    body: "现在属于进攻、谨慎还是暂停？这笔交易如果亏损，是否仍然符合计划？止盈后是否有分批退出动作？",
  });
  return actions;
}

function disciplineStageClass(stage) {
  if (stage === "进攻") return "attack";
  if (stage === "暂停") return "danger";
  return "warn";
}

function drawEquityCurve(records = entryBehaviorRecords()) {
  const svg = $("#equityCurveChart");
  if (!svg) return;
  const width = Math.max(620, svg.clientWidth || 720);
  const height = Math.max(240, svg.clientHeight || 260);
  const pad = { top: 24, right: 28, bottom: 30, left: 52 };
  const points = equityCurvePoints(records);
  const values = points.map((item) => item.value);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const range = max - min || 1;
  const x = (index) => pad.left + (index / Math.max(1, points.length - 1)) * (width - pad.left - pad.right);
  const y = (value) => pad.top + (1 - (value - min) / range) * (height - pad.top - pad.bottom);
  const line = points.map((item, index) => `${x(index)},${y(item.value)}`).join(" ");
  const area = `${pad.left},${y(0)} ${line} ${x(points.length - 1)},${y(0)}`;

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = `
    <rect width="${width}" height="${height}" fill="transparent" />
    <line x1="${pad.left}" y1="${y(0)}" x2="${width - pad.right}" y2="${y(0)}" stroke="#d8e0ea" />
    <polygon points="${area}" fill="rgba(20,108,148,.10)" />
    <polyline points="${line}" fill="none" stroke="#146c94" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    <text x="${pad.left}" y="18" fill="#637083" font-size="12">累计盈亏，包含当前浮动</text>
    <text x="${pad.left}" y="${height - 8}" fill="#637083" font-size="12">${points[0]?.date || ""}</text>
    <text x="${width - pad.right}" y="${height - 8}" text-anchor="end" fill="#637083" font-size="12">${points.at(-1)?.date || ""}</text>
    <text x="${width - pad.right}" y="${y(max) + 4}" fill="#637083" font-size="11">${money(max)}</text>
    <text x="${width - pad.right}" y="${y(min) + 4}" fill="#637083" font-size="11">${money(min)}</text>
  `;
}

function equityCurvePoints(records = entryBehaviorRecords()) {
  let cumulative = 0;
  const points = [{ date: "开始", value: 0 }];
  records
    .slice()
    .sort((a, b) => a.openedAt.localeCompare(b.openedAt))
    .forEach((record) => {
      cumulative += record.pnl;
      points.push({ date: record.openedAt, value: cumulative });
    });
  if (points.length === 1) points.push({ date: todayISO(), value: 0 });
  return points;
}

function maxDrawdownPercent(points) {
  let peak = points[0]?.value || 0;
  let maxDrawdown = 0;
  points.forEach((point) => {
    peak = Math.max(peak, point.value);
    maxDrawdown = Math.max(maxDrawdown, peak - point.value);
  });
  return state.settings.accountEquity ? (maxDrawdown / state.settings.accountEquity) * 100 : 0;
}

function mistakeStatsTemplate(stats) {
  const mistakes = [
    {
      name: "过度交易",
      value: Math.max(0, stats.buyCount - num(state.market.weeklyBuyLimit)),
      hint: `本周开仓上限 ${state.market.weeklyBuyLimit} 次。`,
    },
    {
      name: "买多卖少",
      value: Math.max(0, stats.buyCount - stats.sellCount),
      hint: "健康盈利票应有分批退出动作。",
    },
    {
      name: "仓位越界",
      value: Math.max(0, stats.exposure - state.market.positionCap),
      hint: `当前仓位 ${percent(stats.exposure)}，上限 ${percent(state.market.positionCap)}。`,
    },
    {
      name: "止盈拖延",
      value: Math.max(0, 100 - stats.targetRate),
      hint: "到计划位不卖，是散户常见的利润回吐来源。",
    },
    {
      name: "纪律波动",
      value: Math.max(0, 10 - stats.avgDiscipline),
      hint: "纪律分越低，越需要减少交易频率。",
    },
  ];

  return mistakes
    .map(
      (item) => `
        <div class="setup-row">
          <div>
            <strong>${item.name}</strong>
            <div class="soft-text">${item.hint}</div>
          </div>
          <span class="tag ${item.value > 20 ? "red" : item.value > 0 ? "amber" : "red"}">${item.value ? item.value.toFixed(0) : "OK"}</span>
        </div>
      `,
    )
    .join("");
}

function populatePositionSelects() {
  const options = [`<option value="">不关联标的</option>`]
    .concat(
      state.positions.map(
        (position) =>
          `<option value="${position.id}">${escapeHTML(position.name)} ${escapeHTML(position.symbol)}</option>`,
      ),
    )
    .join("");
  $("#journalPositionSelect").innerHTML = options;
}

function planCompletenessRate(range = statsPeriodRange()) {
  const positions = positionsInStatsPeriod(range);
  if (!positions.length) return 0;
  const completed = positions.filter((position) => {
    return (
      position.thesis &&
      position.kline &&
      position.ma &&
      position.macd &&
      position.kdj &&
      position.stopLoss &&
      position.targets.length
    );
  }).length;
  return (completed / positions.length) * 100;
}

function groupBySetup(records = entryBehaviorRecords()) {
  const map = new Map();
  records.forEach((record) => {
    const setup = record.setup || "未分类";
    if (!map.has(setup)) {
      map.set(setup, { setup, count: 0, pnl: 0, pct: 0 });
    }
    const item = map.get(setup);
    item.count += 1;
    item.pnl += record.pnl;
    item.pct += record.returnPct;
  });
  return Array.from(map.values()).map((item) => ({
    ...item,
    avgPct: item.count ? item.pct / item.count : 0,
  }));
}

function riskClass(regime) {
  if (regime === "进攻") return "attack";
  if (regime === "防守") return "defense";
  return "watch";
}

function disciplineTone(regime) {
  if (regime === "进攻") return "attack";
  if (regime === "防守") return "warn";
  if (regime === "震荡") return "warn";
  return "watch";
}

function permissionTone(value) {
  if (value === "true") return "attack";
  if (value === "false") return "danger";
  return "warn";
}

function regimeHint(regime) {
  const hints = {
    进攻: "允许寻找突破和趋势延续，仓位可以更积极。",
    观察: "只处理计划内机会，降低临时决策。",
    震荡: "控制追高，优先低吸和分批兑现。",
    防守: "少开仓、多止盈，现金是主动权。",
  };
  return hints[regime] || "先判断市场，再判断个股。";
}

function permissionHint(value) {
  if (value === "true") return "新仓可做，但必须通过纪律检查。";
  if (value === "false") return "暂停新仓，只做持仓管理和复盘。";
  return "只允许高质量、计划内、仓位受控的机会。";
}

function technicalRiskAlerts(position) {
  const alerts = [];
  const fields = [
    { key: "monthlyTrend", label: "月线", level: "high" },
    { key: "weeklyTrend", label: "周线", level: "high" },
    { key: "dailyTrend", label: "日线", level: "medium" },
    { key: "macd", label: "MACD", level: "medium" },
    { key: "kdj", label: "KDJ", level: "low" },
    { key: "volume", label: "量能", level: "low" },
  ];
  fields.forEach((field) => {
    const text = String(position[field.key] || "");
    const risk = technicalRiskKeyword(text);
    if (!risk) return;
    alerts.push({
      level: field.level,
      title: `${position.name} ${field.label}${risk}`,
      body:
        field.key === "monthlyTrend"
          ? `月线优先级最高：${text}。除非有明确反证，否则优先收缩仓位。`
          : `${field.label}信号：${text}。按月线 > 周线 > 日线的顺序复核。`,
    });
  });
  return alerts;
}

function technicalRiskKeyword(text) {
  const value = String(text || "");
  if (!value) return "";
  if (value.includes("顶背离")) return "顶背离";
  if (value.includes("死叉")) return "死叉";
  if (value.includes("跌破")) return "跌破关键位";
  if (value.includes("破位")) return "破位";
  if (value.includes("走弱")) return "走弱";
  if (value.includes("绿柱放大")) return "绿柱放大";
  if (value.includes("高位钝化")) return "高位钝化";
  if (value.includes("放量长阴")) return "放量长阴";
  return "";
}

function tagClass(level) {
  if (level === "high") return "red";
  if (level === "medium") return "amber";
  return "";
}

function updateEntryCompleteness() {
  const form = $("#tradeForm");
  const requiredNames = ["symbol", "name", "openedAt", "entryPrice", "shares", "positionPct", "stopLoss", "target1"];
  const filled = requiredNames.filter((name) => String(form[name].value || "").trim()).length;
  const checkboxes = $$(`#tradeForm input[type="checkbox"]`);
  const checks = checkboxes.filter((input) => input.checked).length;
  const score = Math.round(((filled / requiredNames.length) * 0.55 + (checks / Math.max(1, checkboxes.length)) * 0.45) * 100);
  const node = $("#entryCompleteness");
  node.textContent = `完整度 ${score}%`;
  node.classList.toggle("ready", score >= 90);
}

function autoFillPositionPct() {
  const form = $("#tradeForm");
  const amount = num(form.entryPrice.value) * num(form.shares.value);
  const equity = num(state.settings.accountEquity);
  if (!amount || !equity) return;
  form.positionPct.value = Number(((amount / equity) * 100).toFixed(1));
}

function openSellDialog(positionId) {
  const position = getPosition(positionId);
  if (!position) return;
  const form = $("#sellForm");
  form.positionId.value = positionId;
  form.date.value = todayISO();
  form.price.value = position.currentPrice;
  form.quantity.value = Math.max(1, Math.round(position.shares * 0.25));
  form.quantity.max = position.shares;
  $("#sellDialog").showModal();
}

function saveSell(form) {
  const position = getPosition(form.positionId.value);
  if (!position) return;

  const quantity = Math.min(num(form.quantity.value), num(position.shares));
  const oldShares = num(position.shares);
  const remaining = Math.max(0, oldShares - quantity);
  const reason = form.reason.value;

  position.shares = remaining;
  position.positionPct = oldShares ? Number((num(position.positionPct) * (remaining / oldShares)).toFixed(1)) : 0;
  position.currentPrice = num(form.price.value);
  if (remaining <= 0) {
    position.status = "closed";
    position.positionPct = 0;
  }

  if (reason.includes("第一")) {
    const target = position.targets.find((item) => item.name.includes("第一"));
    if (target) target.status = "done";
  }
  if (reason.includes("第二")) {
    const target = position.targets.find((item) => item.name.includes("第二"));
    if (target) target.status = "done";
  }

  state.trades.push({
    id: uid(),
    positionId: position.id,
    type: "sell",
    date: form.date.value,
    price: num(form.price.value),
    quantity,
    reason,
    planned: !reason.includes("手动"),
    notes: form.notes.value,
  });

  state.journal.push({
    id: uid(),
    date: form.date.value,
    type: reason.includes("止损") ? "止损复盘" : "减仓复盘",
    positionId: position.id,
    title: `${position.name} ${reason}`,
    content: form.notes.value || `按计划记录${reason}，卖出 ${quantity} 股。`,
    mood: "冷静",
    disciplineScore: reason.includes("手动") ? 6 : 8,
  });

  saveState();
  render();
  $("#sellDialog").close();
  toast("卖出记录已保存");
}

function drawMarketChart() {
  const svg = $("#marketChart");
  const width = Math.max(520, svg.clientWidth || 720);
  const height = Math.max(320, svg.clientHeight || 360);
  const pad = { top: 30, right: 58, bottom: 34, left: 42 };
  const selectedSymbol = state.marketData.selectedSymbol;
  const payload = selectedSymbol ? state.marketData.candles[selectedSymbol] : null;
  const sourceCandles = payload?.candles?.length ? payload.candles : makeCandles(FALLBACK_CANDLE_COUNT);
  const periodCandles = aggregateCandles(sourceCandles, viewState.chartPeriod);
  const candles = periodCandles.slice(-normalizedChartWindow(periodCandles.length));
  const hasRealData = Boolean(payload?.candles?.length);
  const periodLabel = CHART_PERIOD_LABELS[viewState.chartPeriod] || "日线";
  const position = state.positions.find((item) => item.symbol === selectedSymbol);
  const planLevels = chartPlanLevels(position);

  if ($("#chartTitle")) {
    $("#chartTitle").textContent = hasRealData
      ? `${position?.name || payload.name || selectedSymbol} ${periodLabel}`
      : "市场与仓位";
  }
  $(".chart-shell").classList.toggle("expanded", viewState.mainChartExpanded);
  $("#mainIndicatorName").textContent = mainIndicatorLabel();

  updateChartZoomLabel(candles.length);

  const values = candles.flatMap((item) => [item.high, item.low]).concat(planLevels.map((level) => level.value));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max((max - min) * 0.08, max * 0.01, 1);
  const lowBound = min - padding;
  const highBound = max + padding;
  const range = highBound - lowBound || 1;
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const xStep = chartWidth / candles.length;
  const y = (value) => pad.top + (1 - (value - lowBound) / range) * chartHeight;
  const x = (index) => pad.left + index * xStep + xStep * 0.5;

  const grid = [0.25, 0.5, 0.75]
    .map((ratio) => {
      const gy = pad.top + chartHeight * ratio;
      return `<line x1="${pad.left}" y1="${gy}" x2="${width - pad.right}" y2="${gy}" stroke="#d8e0ea" stroke-width="1" />`;
    })
    .join("");

  const planSvg = planLevels
    .map((level) => {
      const ly = y(level.value);
      const color = level.tone === "stop" ? "#475569" : level.tone === "target2" ? "#b42318" : "#b7791f";
      const label = `${level.label} ${price(level.value)}`;
      const labelWidth = Math.min(190, label.length * 10 + 20);
      return `
        <g class="chart-plan-line">
          <line x1="${pad.left}" y1="${ly}" x2="${width - pad.right}" y2="${ly}" stroke="${color}" stroke-width="1.7" stroke-dasharray="7 5" />
          <rect x="${pad.left + 8}" y="${Math.max(4, ly - 13)}" width="${labelWidth}" height="22" rx="5" fill="#ffffff" stroke="${color}" stroke-width="1" />
          <text x="${pad.left + 18}" y="${Math.max(19, ly + 4)}" fill="${color}" font-size="12" font-weight="800">${escapeHTML(label)}</text>
        </g>
      `;
    })
    .join("");

  const candleSvg = candles
    .map((item, index) => {
      const cx = x(index);
      const up = item.close >= item.open;
      const color = up ? "#b42318" : "#475569";
      const bodyTop = y(Math.max(item.open, item.close));
      const bodyHeight = Math.max(3, Math.abs(y(item.open) - y(item.close)));
      return `
        <g>
          <line x1="${cx}" y1="${y(item.high)}" x2="${cx}" y2="${y(item.low)}" stroke="${color}" stroke-width="1.4" />
          <rect x="${cx - xStep * 0.28}" y="${bodyTop}" width="${Math.max(2, xStep * 0.56)}" height="${bodyHeight}" rx="1.5" fill="${color}" />
        </g>
      `;
    })
    .join("");
  const tradeMarkersSvg = chartTradeMarkers(position, candles, x, y, xStep);

  const mainIndicatorLines = mainIndicatorSeries(candles);
  const mainIndicatorSvg = mainIndicatorLines
    .map((line) => {
      const points = line.values
        .map((value, index) => (Number.isFinite(value) && value ? `${x(index)},${y(value)}` : ""))
        .filter(Boolean)
        .join(" ");
      return points
        ? `<polyline points="${points}" fill="none" stroke="${line.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`
        : "";
    })
    .join("");
  const mainIndicatorLegend = mainIndicatorLines
    .map((line, index) => `<text x="${pad.left + index * 58}" y="${height - 8}" fill="${line.color}" font-size="12">${line.label}</text>`)
    .join("");
  const latest = candles[candles.length - 1];
  const chartInfoX = Math.min(width - 260, pad.left + 190);

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = `
    <rect x="0" y="0" width="${width}" height="${height}" fill="transparent" />
    ${grid}
    <text x="${chartInfoX}" y="20" fill="#637083" font-size="12" font-weight="700">${hasRealData ? `真实${periodLabel} · 前复权` : `${periodLabel}示意 · 同步行情后显示真实数据`}</text>
    <text x="${width - pad.right}" y="20" text-anchor="end" fill="#637083" font-size="12">${hasRealData ? `${latest.date} 收 ${price(latest.close)}` : ""}</text>
    ${mainIndicatorSvg}
    ${candleSvg}
    ${planSvg}
    ${tradeMarkersSvg}
    ${mainIndicatorLegend}
    <text x="${width - pad.right}" y="${y(max) + 4}" text-anchor="start" fill="#637083" font-size="11">${price(max)}</text>
    <text x="${width - pad.right}" y="${y(min) + 4}" text-anchor="start" fill="#637083" font-size="11">${price(min)}</text>
  `;

  drawSubCharts(candles);
}

function mainIndicatorLabel() {
  if (viewState.mainIndicator === "ma") return `MA(${viewState.maPeriods.join(",")})`;
  if (viewState.mainIndicator === "bbi") return "BBI";
  if (String(viewState.mainIndicator).startsWith("custom:")) {
    const id = viewState.mainIndicator.split(":")[1];
    return state.customIndicators.find((item) => item.id === id)?.name || "自定义指标";
  }
  return "主图指标";
}

function mainIndicatorSeries(candles) {
  if (viewState.mainIndicator === "ma") {
    const colors = ["#2563eb", "#7c3aed", "#b7791f", "#475569", "#b42318", "#64748b"];
    return viewState.maPeriods.slice(0, 6).map((period, index) => ({
      label: `MA${period}`,
      color: colors[index % colors.length],
      values: movingAverageSeries(candles.map((item) => num(item.close)), period),
    }));
  }
  if (viewState.mainIndicator === "bbi") {
    const closes = candles.map((item) => num(item.close));
    const ma3 = movingAverageSeries(closes, 3);
    const ma6 = movingAverageSeries(closes, 6);
    const ma12 = movingAverageSeries(closes, 12);
    const ma24 = movingAverageSeries(closes, 24);
    return [
      {
        label: "BBI",
        color: "#7c3aed",
        values: closes.map((_, index) => (ma3[index] + ma6[index] + ma12[index] + ma24[index]) / 4),
      },
    ];
  }
  return [];
}

function movingAverageSeries(values, period) {
  return values.map((_, index, all) => {
    const start = Math.max(0, index - period + 1);
    const rows = all.slice(start, index + 1);
    return rows.reduce((sum, value) => sum + num(value), 0) / rows.length;
  });
}

function aggregateCandles(candles, period) {
  const normalized = candles.map((item, index) => ({
    date: item.date || addDaysISO(index - candles.length + 1),
    open: num(item.open),
    high: num(item.high),
    low: num(item.low),
    close: num(item.close),
    volume: num(item.volume),
    amount: num(item.amount),
  }));
  if (period === "day") return withTechnicalIndicators(normalized);

  const groups = [];
  normalized.forEach((item) => {
    const key = period === "month" ? item.date.slice(0, 7) : weekKey(item.date);
    let group = groups.at(-1);
    if (!group || group.key !== key) {
      group = {
        key,
        date: item.date,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        volume: item.volume,
        amount: item.amount,
      };
      groups.push(group);
      return;
    }
    group.date = item.date;
    group.high = Math.max(group.high, item.high);
    group.low = Math.min(group.low, item.low);
    group.close = item.close;
    group.volume += item.volume;
    group.amount += item.amount;
  });
  return withTechnicalIndicators(groups);
}

function withTechnicalIndicators(candles) {
  const closes = candles.map((item) => num(item.close));
  const highs = candles.map((item) => num(item.high));
  const lows = candles.map((item) => num(item.low));
  const volumes = candles.map((item) => num(item.volume));
  const amounts = candles.map((item) => num(item.amount));
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const dif = closes.map((_, index) => ema12[index] - ema26[index]);
  const dea = emaSeries(dif, 9);
  const macd = dif.map((value, index) => (value - dea[index]) * 2);
  const kdj = kdjSeries(closes, highs, lows);
  const rsi6 = rsiSeries(closes, 6);
  const rsi12 = rsiSeries(closes, 12);
  const rsi24 = rsiSeries(closes, 24);

  return candles.map((item, index, all) => {
    const average = (size) => {
      const start = Math.max(0, index - size + 1);
      const rows = all.slice(start, index + 1);
      return rows.reduce((sum, row) => sum + num(row.close), 0) / rows.length;
    };
    const volumeAverage = (size) => {
      const start = Math.max(0, index - size + 1);
      const rows = volumes.slice(start, index + 1);
      return rows.reduce((sum, value) => sum + value, 0) / rows.length;
    };
    const amountAverage = (size) => {
      const start = Math.max(0, index - size + 1);
      const rows = amounts.slice(start, index + 1);
      return rows.reduce((sum, value) => sum + value, 0) / rows.length;
    };
    return {
      ...item,
      ma: average(5),
      ma5: average(5),
      ma10: average(10),
      ma20: average(20),
      ma60: average(60),
      volumeMa5: volumeAverage(5),
      volumeMa10: volumeAverage(10),
      amountMa5: amountAverage(5),
      amountMa10: amountAverage(10),
      dif: dif[index],
      dea: dea[index],
      macd: macd[index],
      k: kdj.k[index],
      d: kdj.d[index],
      j: kdj.j[index],
      rsi6: rsi6[index],
      rsi12: rsi12[index],
      rsi24: rsi24[index],
    };
  });
}

function emaSeries(values, span) {
  if (!values.length) return [];
  const alpha = 2 / (span + 1);
  const result = [values[0]];
  for (let index = 1; index < values.length; index += 1) {
    result.push(alpha * values[index] + (1 - alpha) * result[index - 1]);
  }
  return result;
}

function kdjSeries(closes, highs, lows) {
  const k = [];
  const d = [];
  const j = [];
  let lastK = 50;
  let lastD = 50;
  closes.forEach((close, index) => {
    const start = Math.max(0, index - 8);
    const highest = Math.max(...highs.slice(start, index + 1));
    const lowest = Math.min(...lows.slice(start, index + 1));
    const rsv = highest === lowest ? 50 : ((close - lowest) / (highest - lowest)) * 100;
    lastK = (2 / 3) * lastK + (1 / 3) * rsv;
    lastD = (2 / 3) * lastD + (1 / 3) * lastK;
    k.push(lastK);
    d.push(lastD);
    j.push(3 * lastK - 2 * lastD);
  });
  return { k, d, j };
}

function rsiSeries(closes, period) {
  return closes.map((close, index) => {
    if (index === 0) return 50;
    const start = Math.max(1, index - period + 1);
    let gains = 0;
    let losses = 0;
    for (let cursor = start; cursor <= index; cursor += 1) {
      const diff = closes[cursor] - closes[cursor - 1];
      if (diff >= 0) gains += diff;
      else losses += Math.abs(diff);
    }
    if (!losses) return 100;
    return 100 - 100 / (1 + gains / losses);
  });
}

function weekKey(dateString) {
  const date = parseLocalDate(dateString);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return toISODate(date);
}

function chartPlanLevels(position) {
  if (!position) return [];
  const levels = [];
  if (num(position.stopLoss)) {
    levels.push({ label: "止损", value: num(position.stopLoss), tone: "stop" });
  }
  position.targets.forEach((target, index) => {
    if (!num(target.price)) return;
    levels.push({
      label: target.name || `第${index + 1}止盈`,
      value: num(target.price),
      tone: index === 0 ? "target1" : "target2",
    });
  });
  return levels;
}

function chartTradeMarkers(position, candles, x, y, xStep) {
  if (!position || !candles.length) return "";
  const trades = state.trades
    .filter((trade) => trade.positionId === position.id)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!trades.length) return "";
  const visibleStart = candles[0].date;
  const visibleEnd = candles.at(-1).date;
  return trades
    .filter((trade) => trade.date >= visibleStart && trade.date <= visibleEnd)
    .map((trade) => {
      const index = tradeCandleIndex(candles, trade.date);
      if (index < 0) return "";
      const cx = x(index);
      const cy = y(num(trade.price));
      const isBuy = trade.type === "buy";
      const color = isBuy ? "#b42318" : "#475569";
      const label = isBuy ? "买" : position.status === "closed" && trade === trades.at(-1) ? "清" : "减";
      const markerSize = Math.max(7, Math.min(12, xStep * 0.42));
      const markerText = `${label} ${price(trade.price)}`;
      const labelWidth = Math.max(44, markerText.length * 7 + 12);
      const points = isBuy
        ? `${cx},${cy - markerSize} ${cx - markerSize},${cy + markerSize} ${cx + markerSize},${cy + markerSize}`
        : `${cx},${cy + markerSize} ${cx - markerSize},${cy - markerSize} ${cx + markerSize},${cy - markerSize}`;
      const labelY = isBuy ? cy - markerSize - 7 : cy + markerSize + 15;
      return `
        <g class="chart-trade-marker">
          <polygon points="${points}" fill="${color}" stroke="#ffffff" stroke-width="1.5" />
          <rect x="${cx - labelWidth / 2}" y="${labelY - 13}" width="${labelWidth}" height="18" rx="5" fill="#ffffff" stroke="${color}" stroke-width="1" />
          <text x="${cx}" y="${labelY}" text-anchor="middle" fill="${color}" font-size="11" font-weight="900">${markerText}</text>
        </g>
      `;
    })
    .join("");
}

function tradeCandleIndex(candles, date) {
  const exact = candles.findIndex((candle) => candle.date === date);
  if (exact >= 0) return exact;
  let index = -1;
  candles.forEach((candle, candleIndex) => {
    if (candle.date <= date) index = candleIndex;
  });
  return index;
}

function normalizedChartWindow(total) {
  const period = viewState.chartPeriod;
  const { min, max } = chartWindowBounds(total, period);
  const fallback = CHART_DEFAULT_WINDOWS[period] || CHART_DEFAULT_WINDOWS.day;
  const current = num(viewState.chartWindows?.[period]) || num(viewState.chartWindow) || fallback;
  const next = Math.min(max, Math.max(min, current));
  setChartWindow(period, next);
  return next;
}

function updateChartZoomLabel(visibleCount = viewState.chartWindow) {
  const node = $("#chartZoomLabel");
  if (node) {
    const periodLabel = CHART_PERIOD_LABELS[viewState.chartPeriod] || "K线";
    node.textContent = `${periodLabel} ${visibleCount} 根`;
  }
}

function changeChartZoom(direction) {
  const period = viewState.chartPeriod;
  const limits = CHART_ZOOM_LIMITS[period] || CHART_ZOOM_LIMITS.day;
  const { min, max } = chartWindowBounds(currentPeriodCandleCount(), period);
  const current = normalizedChartWindow(currentPeriodCandleCount());
  const next = Math.min(max, Math.max(min, current + direction * limits.step));
  setChartWindow(period, next);
  drawMarketChart();
}

function chartWindowBounds(total, period = viewState.chartPeriod) {
  const limits = CHART_ZOOM_LIMITS[period] || CHART_ZOOM_LIMITS.day;
  const totalCount = Math.max(1, num(total));
  const min = Math.min(limits.min, totalCount);
  const max = Math.max(min, Math.min(limits.max, totalCount));
  return { min, max };
}

function setChartWindow(period, value) {
  viewState.chartWindows = viewState.chartWindows || { ...CHART_DEFAULT_WINDOWS };
  viewState.chartWindows[period] = value;
  viewState.chartWindow = value;
}

function currentPeriodCandleCount() {
  const selectedSymbol = state.marketData.selectedSymbol;
  const payload = selectedSymbol ? state.marketData.candles[selectedSymbol] : null;
  const sourceCandles = payload?.candles?.length ? payload.candles : makeCandles(FALLBACK_CANDLE_COUNT);
  return aggregateCandles(sourceCandles, viewState.chartPeriod).length;
}

function drawSubCharts(candles) {
  const container = $("#subChartPanels");
  if (!container) return;
  const active = viewState.subIndicators.filter((key) => subIndicatorConfig(key)).slice(0, MAX_SUB_INDICATORS);
  const visible = viewState.expandedSubIndicator
    ? active.filter((key) => key === viewState.expandedSubIndicator)
    : active;
  container.innerHTML = active.length
    ? visible
        .map(
          (key) => {
            const config = subIndicatorConfig(key);
            return `
            <section class="sub-chart-card ${viewState.expandedSubIndicator === key ? "expanded" : ""}" draggable="true" data-sub-card="${key}">
              <div class="sub-chart-head">
                <div>
                  <strong>${escapeHTML(config.label)}</strong>
                  <button class="mini-icon-button" data-sub-settings="${key}" title="设置指标参数">⚙</button>
                  <button class="mini-icon-button" data-remove-sub="${key}" title="关闭指标">×</button>
                </div>
                <span>${subChartSummary(key, candles.at(-1))}</span>
              </div>
              <svg id="subChart-${safeDomId(key)}" role="img" aria-label="${escapeHTML(config.label)}指标"></svg>
            </section>
          `;
          },
        )
        .join("")
    : `<div class="empty-state">未选择副图指标</div>`;

  visible.forEach((key) => {
    const svg = $(`#subChart-${safeDomId(key)}`);
    if (svg) drawSingleSubChart(svg, key, candles);
  });
  attachSubChartWindowEvents();
}

function subIndicatorConfig(key) {
  if (SUB_INDICATORS[key]) return SUB_INDICATORS[key];
  if (String(key).startsWith("custom:")) {
    const id = key.split(":")[1];
    const custom = state.customIndicators.find((item) => item.id === id);
    if (custom) return { label: custom.name, custom };
  }
  return null;
}

function safeDomId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "-");
}

function attachSubChartWindowEvents() {
  $$("[data-remove-sub]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const key = button.dataset.removeSub;
      viewState.subIndicators = viewState.subIndicators.filter((item) => item !== key);
      if (viewState.expandedSubIndicator === key) viewState.expandedSubIndicator = "";
      drawMarketChart();
    });
  });
  $$("[data-sub-settings]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const key = button.dataset.subSettings;
      if (String(key).startsWith("custom:")) {
        openIndicatorDialog("sub", key.split(":")[1]);
        return;
      }
      toast(`${subIndicatorConfig(key)?.label || "指标"}参数设置入口已预留`);
    });
  });
  $$("[data-sub-card]").forEach((card) => {
    card.addEventListener("dblclick", () => {
      const key = card.dataset.subCard;
      viewState.expandedSubIndicator = viewState.expandedSubIndicator === key ? "" : key;
      drawMarketChart();
    });
    card.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/plain", card.dataset.subCard);
    });
    card.addEventListener("dragover", (event) => event.preventDefault());
    card.addEventListener("drop", (event) => {
      event.preventDefault();
      const source = event.dataTransfer.getData("text/plain");
      const target = card.dataset.subCard;
      if (!source || !target || source === target) return;
      const next = viewState.subIndicators.filter((item) => item !== source);
      const targetIndex = next.indexOf(target);
      next.splice(targetIndex, 0, source);
      viewState.subIndicators = next;
      drawMarketChart();
    });
  });
}

function subChartSummary(key, latest = {}) {
  if (key === "volume") return `量 ${formatCompactNumber(latest.volume)} / MA5 ${formatCompactNumber(latest.volumeMa5)}`;
  if (key === "amount") return `额 ${formatCompactNumber(latest.amount)} / MA5 ${formatCompactNumber(latest.amountMa5)}`;
  if (key === "macd") return `DIF ${numberText(latest.dif)} · DEA ${numberText(latest.dea)} · MACD ${numberText(latest.macd)}`;
  if (key === "kdj") return `K ${numberText(latest.k)} · D ${numberText(latest.d)} · J ${numberText(latest.j)}`;
  if (key === "rsi") return `RSI6 ${numberText(latest.rsi6)} · RSI12 ${numberText(latest.rsi12)}`;
  return "";
}

function drawSingleSubChart(svg, key, candles) {
  const width = Math.max(520, svg.clientWidth || 720);
  const height = Math.max(120, svg.clientHeight || 132);
  const pad = { top: 14, right: 58, bottom: 22, left: 42 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const xStep = chartWidth / Math.max(1, candles.length);
  const x = (index) => pad.left + index * xStep + xStep * 0.5;

  const customConfig = subIndicatorConfig(key)?.custom;
  if (customConfig) {
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.innerHTML = `
      ${subChartGrid(width, height, pad)}
      <text x="${pad.left}" y="${height / 2}" fill="#637083" font-size="13" font-weight="800">
        ${escapeHTML(customConfig.name)} 公式已保存，等待接入通达信公式解析
      </text>
    `;
    return;
  }

  if (key === "volume" || key === "amount") {
    const field = key === "amount" ? "amount" : "volume";
    const ma5Field = key === "amount" ? "amountMa5" : "volumeMa5";
    const ma10Field = key === "amount" ? "amountMa10" : "volumeMa10";
    const maxVolume = Math.max(1, ...candles.map((item) => num(item[field])), ...candles.map((item) => num(item[ma5Field])));
    const y = (value) => pad.top + (1 - num(value) / maxVolume) * chartHeight;
    const bars = candles
      .map((item, index) => {
        const up = item.close >= item.open;
        const color = up ? "#b42318" : "#475569";
        const top = y(item[field]);
        return `<rect x="${x(index) - xStep * 0.32}" y="${top}" width="${Math.max(2, xStep * 0.64)}" height="${Math.max(1, height - pad.bottom - top)}" fill="${color}" opacity="0.72" />`;
      })
      .join("");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.innerHTML = `
      ${subChartGrid(width, height, pad)}
      ${bars}
      ${subChartLine(candles, ma5Field, x, y, "#2563eb")}
      ${subChartLine(candles, ma10Field, x, y, "#b7791f")}
      <text x="${pad.left}" y="12" fill="#2563eb" font-size="11">${key === "amount" ? "AMO" : "VOL"} MA5</text>
      <text x="${pad.left + 76}" y="12" fill="#b7791f" font-size="11">MA10</text>
      <text x="${width - pad.right}" y="${y(maxVolume) + 4}" fill="#637083" font-size="11">${formatCompactNumber(maxVolume)}</text>
    `;
    return;
  }

  if (key === "macd") {
    const values = candles.flatMap((item) => [num(item.dif), num(item.dea), num(item.macd), 0]);
    const { y, min, max } = subChartScale(values, pad, chartHeight);
    const zeroY = y(0);
    const bars = candles
      .map((item, index) => {
        const value = num(item.macd);
        const barY = y(value);
        const color = value >= 0 ? "#b42318" : "#475569";
        return `<rect x="${x(index) - xStep * 0.28}" y="${Math.min(barY, zeroY)}" width="${Math.max(2, xStep * 0.56)}" height="${Math.max(1, Math.abs(zeroY - barY))}" fill="${color}" opacity="0.76" />`;
      })
      .join("");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.innerHTML = `
      ${subChartGrid(width, height, pad)}
      <line x1="${pad.left}" y1="${zeroY}" x2="${width - pad.right}" y2="${zeroY}" stroke="#94a3b8" stroke-width="1" />
      ${bars}
      ${subChartLine(candles, "dif", x, y, "#2563eb")}
      ${subChartLine(candles, "dea", x, y, "#b7791f")}
      <text x="${pad.left}" y="12" fill="#2563eb" font-size="11">DIF</text>
      <text x="${pad.left + 40}" y="12" fill="#b7791f" font-size="11">DEA</text>
      <text x="${width - pad.right}" y="${y(max) + 4}" fill="#637083" font-size="11">${numberText(max)}</text>
      <text x="${width - pad.right}" y="${y(min) + 4}" fill="#637083" font-size="11">${numberText(min)}</text>
    `;
    return;
  }

  const rangeFields =
    key === "kdj"
      ? [
          ["k", "#2563eb", "K"],
          ["d", "#b7791f", "D"],
          ["j", "#b42318", "J"],
        ]
      : [
          ["rsi6", "#2563eb", "RSI6"],
          ["rsi12", "#b7791f", "RSI12"],
          ["rsi24", "#64748b", "RSI24"],
        ];
  const y = (value) => pad.top + (1 - Math.max(0, Math.min(100, num(value))) / 100) * chartHeight;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = `
    ${subChartGrid(width, height, pad)}
    <line x1="${pad.left}" y1="${y(80)}" x2="${width - pad.right}" y2="${y(80)}" stroke="#f3b6b6" stroke-width="1" stroke-dasharray="5 5" />
    <line x1="${pad.left}" y1="${y(20)}" x2="${width - pad.right}" y2="${y(20)}" stroke="#b7e0c0" stroke-width="1" stroke-dasharray="5 5" />
    ${rangeFields.map(([field, color]) => subChartLine(candles, field, x, y, color)).join("")}
    ${rangeFields
      .map(([, color, label], index) => `<text x="${pad.left + index * 52}" y="12" fill="${color}" font-size="11">${label}</text>`)
      .join("")}
    <text x="${width - pad.right}" y="${y(80) + 4}" fill="#637083" font-size="11">80</text>
    <text x="${width - pad.right}" y="${y(20) + 4}" fill="#637083" font-size="11">20</text>
  `;
}

function subChartGrid(width, height, pad) {
  const chartHeight = height - pad.top - pad.bottom;
  return [0, 0.5, 1]
    .map((ratio) => {
      const gy = pad.top + chartHeight * ratio;
      return `<line x1="${pad.left}" y1="${gy}" x2="${width - pad.right}" y2="${gy}" stroke="#e2e8f0" stroke-width="1" />`;
    })
    .join("");
}

function subChartLine(candles, field, x, y, color) {
  const points = candles
    .map((item, index) => (Number.isFinite(num(item[field])) ? `${x(index)},${y(item[field])}` : ""))
    .filter(Boolean)
    .join(" ");
  return points ? `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />` : "";
}

function subChartScale(values, pad, chartHeight) {
  const clean = values.filter((value) => Number.isFinite(value));
  const minValue = Math.min(...clean);
  const maxValue = Math.max(...clean);
  const padding = Math.max((maxValue - minValue) * 0.15, Math.max(Math.abs(maxValue), Math.abs(minValue)) * 0.08, 0.1);
  const min = minValue - padding;
  const max = maxValue + padding;
  const range = max - min || 1;
  return {
    min,
    max,
    y: (value) => pad.top + (1 - (num(value) - min) / range) * chartHeight,
  };
}

function numberText(value) {
  return Number.isFinite(num(value)) ? Number(value).toFixed(2) : "--";
}

function formatCompactNumber(value) {
  const number = num(value);
  if (!number) return "--";
  if (Math.abs(number) >= 100000000) return `${(number / 100000000).toFixed(2)}亿`;
  if (Math.abs(number) >= 10000) return `${(number / 10000).toFixed(1)}万`;
  return String(Math.round(number));
}

function makeCandles(count) {
  const isAttack = state.market.regime === "进攻";
  const isDefense = state.market.regime === "防守";
  const drift = isAttack ? 0.9 : isDefense ? -0.45 : 0.18;
  let close = 100;
  const list = [];
  const start = new Date();
  start.setDate(start.getDate() - count + 1);
  for (let i = 0; i < count; i += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const wave = Math.sin(i / 2.8) * 1.6 + Math.cos(i / 5.2) * 0.9;
    const open = close + Math.sin(i) * 0.7;
    close = open + drift + wave * 0.35 + (i % 7 === 0 ? -1.1 : 0.4);
    const high = Math.max(open, close) + 1.5 + (i % 4) * 0.18;
    const low = Math.min(open, close) - 1.3 - (i % 5) * 0.15;
    const volume = 800000 + Math.round(Math.abs(close - open) * 180000 + (i % 9) * 65000);
    list.push({ date: toISODate(date), open, close, high, low, volume, amount: volume * close, ma: close });
  }
  return list.map((item, index, all) => {
    const start = Math.max(0, index - 4);
    const window = all.slice(start, index + 1);
    item.ma = window.reduce((sum, row) => sum + row.close, 0) / window.length;
    return item;
  });
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function editMaPeriods() {
  const value = prompt("设置 MA 周期，用逗号分隔", viewState.maPeriods.join(","));
  if (value === null) return;
  const periods = value
    .split(/[,\s，、]+/)
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0 && item <= 1000)
    .slice(0, 6);
  if (!periods.length) {
    toast("至少保留一个有效周期");
    return;
  }
  viewState.maPeriods = periods;
  drawMarketChart();
}

function openIndicatorDialog(target = "sub", indicatorId = "") {
  const form = $("#indicatorForm");
  const indicator = state.customIndicators.find((item) => item.id === indicatorId);
  form.reset();
  form.scope.value = target;
  form.target.value = indicator?.target || target;
  form.name.value = indicator?.name || "";
  form.params.value = indicator?.params || "";
  form.formula.value = indicator?.formula || "";
  form.dataset.editId = indicatorId;
  $("#indicatorDialog").showModal();
}

function saveIndicatorForm(form) {
  const id = form.dataset.editId || uid();
  const target = form.target.value;
  const indicator = {
    id,
    target,
    name: form.name.value.trim(),
    params: form.params.value.trim(),
    formula: form.formula.value.trim(),
  };
  if (!indicator.name) {
    toast("请填写指标名称");
    return;
  }
  const index = state.customIndicators.findIndex((item) => item.id === id);
  if (index >= 0) state.customIndicators[index] = indicator;
  else state.customIndicators.push(indicator);

  const key = `custom:${id}`;
  if (target === "main") {
    viewState.mainIndicator = key;
  } else if (!viewState.subIndicators.includes(key)) {
    if (viewState.subIndicators.length >= MAX_SUB_INDICATORS) {
      viewState.subIndicators.shift();
    }
    viewState.subIndicators.push(key);
  }
  saveState();
  renderIndicatorSelects();
  drawMarketChart();
  $("#indicatorDialog").close();
  toast("指标已保存");
}

function setupEvents() {
  $$(".nav-item").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
  $$("[data-view-shortcut]").forEach((button) => {
    button.addEventListener("click", () => {
      const changed = showView(button.dataset.viewShortcut);
      if (changed && button.dataset.planFocus) focusPlanSection(button.dataset.planFocus);
    });
  });
  $("#refreshQuotesBtn").addEventListener("click", () => syncMarketData());
  $("#syncEventsBtn").addEventListener("click", () => syncOfficialEvents());
  $("#statsAllPeriodBtn").addEventListener("click", () => {
    viewState.statsPeriodMode = "all";
    viewState.statsStart = "";
    viewState.statsEnd = "";
    renderStats();
  });
  $("#statsStartInput").addEventListener("change", (event) => {
    viewState.statsPeriodMode = "range";
    viewState.statsStart = event.target.value;
    renderStats();
  });
  $("#statsEndInput").addEventListener("change", (event) => {
    viewState.statsPeriodMode = "range";
    viewState.statsEnd = event.target.value;
    renderStats();
  });
  $$("[data-position-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      viewState.positionFilter = button.dataset.positionFilter;
      renderPositions();
    });
  });
  $("#calendarPrevBtn").addEventListener("click", () => shiftCalendarMonth(-1));
  $("#calendarNextBtn").addEventListener("click", () => shiftCalendarMonth(1));
  $("#calendarTodayBtn").addEventListener("click", () => {
    const now = new Date();
    viewState.calendarYear = now.getFullYear();
    viewState.calendarMonth = now.getMonth();
    viewState.calendarMode = "month";
    renderEvents();
  });
  $("#calendarYearSelect").addEventListener("change", (event) => {
    viewState.calendarYear = Number(event.target.value);
    renderEvents();
  });
  $("#calendarMonthSelect").addEventListener("change", (event) => {
    viewState.calendarMonth = Number(event.target.value);
    viewState.calendarMode = "month";
    renderEvents();
  });
  $("#eventCategoryFilter").addEventListener("change", (event) => {
    viewState.eventCategory = event.target.value;
    viewState.eventMarket = "all";
    renderEvents();
  });
  $("#eventMarketFilter").addEventListener("change", (event) => {
    viewState.eventMarket = event.target.value;
    renderEvents();
  });
  $$("[data-calendar-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      viewState.calendarMode = button.dataset.calendarMode;
      renderEvents();
    });
  });
  $("#refreshChartBtn").addEventListener("click", async () => {
    const symbol = $("#chartSymbolSelect").value;
    if (!symbol) return;
    setSyncing(true);
    try {
      await loadCandles(symbol);
      toast("K线已刷新");
    } catch (error) {
      toast(error.message || "K线刷新失败");
    } finally {
      setSyncing(false);
    }
  });
  $("#chartSymbolSelect").addEventListener("change", async (event) => {
    const symbol = event.target.value;
    state.marketData.selectedSymbol = symbol;
    if (!symbol) return render();
    if (state.marketData.candles[symbol]) {
      saveState();
      render();
      return;
    }
    setSyncing(true);
    try {
      await loadCandles(symbol);
    } catch (error) {
      toast(error.message || "K线加载失败");
    } finally {
      setSyncing(false);
    }
  });
  $$("[data-chart-period]").forEach((button) => {
    button.addEventListener("click", () => {
      viewState.chartPeriod = button.dataset.chartPeriod;
      viewState.chartWindows = viewState.chartWindows || { ...CHART_DEFAULT_WINDOWS };
      if (!viewState.chartWindows[viewState.chartPeriod]) {
        viewState.chartWindows[viewState.chartPeriod] = CHART_DEFAULT_WINDOWS[viewState.chartPeriod] || CHART_DEFAULT_WINDOWS.day;
      }
      viewState.chartWindow = viewState.chartWindows[viewState.chartPeriod];
      renderChartControls();
      drawMarketChart();
    });
  });
  $$("[data-chart-zoom]").forEach((button) => {
    button.addEventListener("click", () => {
      changeChartZoom(button.dataset.chartZoom === "in" ? -1 : 1);
    });
  });
  $("#mainIndicatorSelect").addEventListener("change", (event) => {
    if (event.target.value === "add") {
      openIndicatorDialog("main");
      renderIndicatorSelects();
      return;
    }
    viewState.mainIndicator = event.target.value;
    drawMarketChart();
  });
  $("#subIndicatorSelect").addEventListener("change", (event) => {
    const key = event.target.value;
    if (key === "add") {
      openIndicatorDialog("sub");
      return;
    }
    if (!viewState.subIndicators.includes(key)) {
      if (viewState.subIndicators.length >= MAX_SUB_INDICATORS) {
        toast(`副图最多显示 ${MAX_SUB_INDICATORS} 个`);
        event.target.value = "add";
        return;
      }
      viewState.subIndicators.push(key);
      viewState.expandedSubIndicator = "";
      drawMarketChart();
    }
    event.target.value = "add";
  });
  $("#mainIndicatorSettingsBtn").addEventListener("click", () => {
    if (viewState.mainIndicator === "ma") {
      editMaPeriods();
      return;
    }
    if (String(viewState.mainIndicator).startsWith("custom:")) {
      openIndicatorDialog("main", viewState.mainIndicator.split(":")[1]);
      return;
    }
    toast(`${mainIndicatorLabel()}参数设置入口已预留`);
  });
  $(".chart-shell").addEventListener("dblclick", () => {
    viewState.mainChartExpanded = !viewState.mainChartExpanded;
    drawMarketChart();
  });
  $("#indicatorForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (event.submitter && event.submitter.value === "cancel") {
      $("#indicatorDialog").close();
      return;
    }
    saveIndicatorForm(event.currentTarget);
  });
  $("#indicatorForm [name='target']").addEventListener("change", (event) => {
    $("#indicatorForm [name='scope']").value = event.target.value;
  });
  document.addEventListener("keydown", (event) => {
    if (!$("#positions").classList.contains("active")) return;
    if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
    event.preventDefault();
    changeChartZoom(event.key === "ArrowUp" ? -1 : 1);
  });

  $("#tradeForm").openedAt.value = todayISO();
  $("#journalForm").date.value = todayISO();
  $("#eventForm").date.value = todayISO();
  $("#cycleEndModeSelect").addEventListener("change", updateCycleEndField);
  $("#marketPlanForm").cycleStart.addEventListener("change", updateCycleEndField);
  renderEventFormScopeOptions("全球");
  $("#eventForm").category.addEventListener("change", () => {
    renderEventFormScopeOptions();
  });

  $("#tradeForm").addEventListener("input", (event) => {
    if (["entryPrice", "shares"].includes(event.target.name)) {
      autoFillPositionPct();
    }
    updateEntryCompleteness();
  });
  $("#tradeForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const checkboxes = $$(`#tradeForm input[type="checkbox"]`);
    const checks = checkboxes.filter((input) => input.checked).length;
    if (checks < checkboxes.length) {
      toast("投委会门禁未全部通过，开仓被打回");
      return;
    }

    const positionId = uid();
    const targets = [];
    if (num(form.target1.value)) {
      targets.push({
        id: uid(),
        name: "第一止盈",
        price: num(form.target1.value),
        pct: num(form.target1Pct.value),
        status: "pending",
      });
    }
    if (num(form.target2.value)) {
      targets.push({
        id: uid(),
        name: "第二止盈",
        price: num(form.target2.value),
        pct: num(form.target2Pct.value),
        status: "pending",
      });
    }

    const position = {
      id: positionId,
      symbol: form.symbol.value.trim(),
      name: form.name.value.trim(),
      openedAt: form.openedAt.value,
      entryPrice: num(form.entryPrice.value),
      currentPrice: num(form.entryPrice.value),
      shares: num(form.shares.value),
      originalShares: num(form.shares.value),
      positionPct: num(form.positionPct.value),
      setup: form.setup.value,
      riskLevel: form.riskLevel.value,
      thesis: form.thesis.value.trim(),
      kline: form.kline.value.trim(),
      monthlyTrend: form.monthlyTrend.value.trim(),
      weeklyTrend: form.weeklyTrend.value.trim(),
      dailyTrend: form.dailyTrend.value.trim(),
      ma: form.ma.value.trim(),
      macd: form.macd.value.trim(),
      kdj: form.kdj.value.trim(),
      volume: form.volume.value.trim(),
      marketAlignment: form.marketAlignment.value.trim(),
      supportLevel: form.supportLevel.value.trim(),
      resistanceLevel: form.resistanceLevel.value.trim(),
      supportResistance: [form.supportLevel.value.trim() && `支撑 ${form.supportLevel.value.trim()}`, form.resistanceLevel.value.trim() && `压力 ${form.resistanceLevel.value.trim()}`]
        .filter(Boolean)
        .join("，"),
      stopLoss: num(form.stopLoss.value),
      trendHold: form.trendHold.value.trim(),
      exitSignal: form.exitSignal.value.trim(),
      targets,
      status: "open",
    };
    const entrySnapshot = currentEntrySnapshot(position);
    const ruleBreaks = entryRuleBreaks(position, entrySnapshot, { planned: true });

    if (ruleBreaks.length) {
      const confirmed = confirm(
        `这笔开仓触发了纪律偏离：${ruleBreaks.join("、")}。\n\n取消则打回，确认则保存为违规开仓样本，用于后续复盘。`,
      );
      if (!confirmed) {
        toast("开仓已打回，请先调整计划或仓位");
        return;
      }
    }

    position.entryDiscipline = entrySnapshot;
    position.originalPositionPct = position.positionPct;

    state.positions.push(position);
    state.trades.push({
      id: uid(),
      positionId,
      type: "buy",
      date: position.openedAt,
      price: position.entryPrice,
      quantity: position.shares,
      reason: position.setup,
      planned: true,
      disciplineSnapshot: entrySnapshot,
      disciplineStage: entrySnapshot.stage,
      ruleBreaks,
      disciplineCompliant: !ruleBreaks.length,
      notes: form.entryNote.value.trim(),
    });

    if (form.entryNote.value.trim() || position.thesis) {
      state.journal.push({
        id: uid(),
        date: position.openedAt,
        type: "开仓日志",
        positionId,
        title: `${position.name} 开仓`,
        content: form.entryNote.value.trim() || position.thesis,
        mood: "冷静",
        disciplineScore: 8,
      });
    }

    saveState();
    form.reset();
    form.openedAt.value = todayISO();
    updateEntryCompleteness();
    render();
    showView("positions");
    toast("开仓记录已保存");
  });

  $("#journalForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    state.journal.push({
      id: uid(),
      date: form.date.value,
      type: form.type.value,
      positionId: form.positionId.value,
      title: form.title.value.trim(),
      content: form.content.value.trim(),
      mood: form.mood.value,
      disciplineScore: num(form.disciplineScore.value),
    });
    saveState();
    form.reset();
    form.date.value = todayISO();
    render();
    toast("日志已保存");
  });

  $("#marketPlanForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    state.settings.accountEquity = num(form.accountEquity.value);
    state.market = {
      cycleStart: form.cycleStart.value,
      cycleEndMode: form.cycleEndMode.value,
      cycleEndDate: form.cycleEndMode.value === "open" ? "" : form.cycleEndDate.value,
      cycleNote: form.cycleNote.value.trim(),
      regime: form.regime.value,
      positionCap: num(form.positionCap.value),
      allowNew: form.allowNew.value,
      weeklyBuyLimit: num(form.weeklyBuyLimit.value),
      notes: form.notes.value.trim(),
    };
    saveState();
    render();
    toast("交易计划已保存");
  });

  $("#routinePlanForm").addEventListener("click", (event) => {
    const addButton = event.target.closest("[data-add-plan-item]");
    const removeButton = event.target.closest("[data-remove-plan-item]");
    if (addButton) {
      const field = addButton.dataset.addPlanItem;
      const items = readPlanItemsFromEditor(field, true);
      items.push({ type: PLAN_ITEM_CONFIG[field].types[0], text: "" });
      renderPlanItems(field, items);
    }
    if (removeButton) {
      const field = removeButton.dataset.removePlanItem;
      const index = Number(removeButton.dataset.index);
      const items = readPlanItemsFromEditor(field, true);
      items.splice(index, 1);
      renderPlanItems(field, items);
    }
  });

  $("#routinePlanForm").addEventListener("submit", (event) => {
    event.preventDefault();
    state.routine = {
      ...state.routine,
      ...collectRoutinePlanItems(),
    };
    syncRoutineLegacyFields();
    saveState();
    render();
    toast("执行计划已保存");
  });

  $("#generateDailyPlanBtn").addEventListener("click", generateDailyPlanDraft);

  $("#eventForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    state.events.push({
      id: uid(),
      date: form.date.value,
      category: normalizeEventCategory(form.category.value),
      market: normalizeEventScope(form.market.value, form.category.value),
      title: form.title.value.trim(),
      impact: form.impact.value,
      note: form.note.value.trim(),
    });
    saveState();
    form.reset();
    form.date.value = todayISO();
    renderEventFormScopeOptions("全球");
    render();
    toast("事件已保存");
  });

  $("#sellForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (event.submitter && event.submitter.value === "cancel") {
      $("#sellDialog").close();
      return;
    }
    saveSell(event.currentTarget);
  });

  $("#exportDataBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `交易纪律工作台-${todayISO()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });

  $("#importDataInput").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      state = JSON.parse(await file.text());
      ensureStateShape();
      saveState();
      render();
      toast("数据已导入");
    } catch {
      toast("导入失败，请检查备份文件");
    }
  });

  $("#createSnapshotBtn").addEventListener("click", () => createLocalSnapshot());

  $("#generateScanReportBtn").addEventListener("click", () => {
    generateScanReport();
  });

  $("#exportBehaviorReportBtn").addEventListener("click", () => {
    downloadText(`交易行为复盘报告-${todayISO()}.md`, behaviorReportMarkdown(), "text/markdown;charset=utf-8");
    toast("复盘报告已导出");
  });

  $("#importEventCsvInput").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      importEventRows(parseCSV(await file.text()), file.name);
      event.target.value = "";
    } catch {
      toast("事件 CSV 导入失败，请检查表头和内容");
    }
  });

  $("#importBrokerCsvInput").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      importBrokerRows(parseCSV(await file.text()), file.name);
      event.target.value = "";
    } catch {
      toast("券商 CSV 导入失败，请检查表头和内容");
    }
  });

  $("#resetDataBtn").addEventListener("click", () => {
    if (!confirm("确定清空所有本地数据吗？")) return;
    state = { ...defaultState(), positions: [], trades: [], journal: [], events: [] };
    ensureStateShape();
    saveState();
    render();
    toast("数据已清空");
  });

  window.addEventListener("resize", () => drawMarketChart());
}

setupEvents();
render();
syncMarketData({ silent: true });
if (shouldRefreshOfficialEvents()) syncOfficialEvents({ silent: true });
setInterval(() => {
  if (document.hidden) return;
  if (shouldRefreshMarketData(120000)) syncMarketData({ silent: true });
}, 120000);
setInterval(() => {
  if (document.hidden) return;
  if (shouldRefreshOfficialEvents()) syncOfficialEvents({ silent: true });
}, EVENT_CACHE_TTL * 1000);
