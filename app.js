const RECORDS_KEY = "lean-journal-records-v1";
const SETTINGS_KEY = "lean-journal-settings-v1";
const META_KEY = "lean-journal-meta-v1";
const SYNC_CONFIG_KEY = "lean-journal-sync-config-v1";
const SYNC_TABLE = "weight_journal_snapshots";
const DEFAULT_SYNC_CONFIG = Object.freeze({
  supabaseUrl: "",
  supabaseAnonKey: "",
  email: "",
});

const elements = {
  form: document.querySelector("#weight-form"),
  dateInput: document.querySelector("#entry-date"),
  weightInput: document.querySelector("#entry-weight"),
  heightInput: document.querySelector("#height-cm"),
  targetWeightInput: document.querySelector("#target-weight"),
  formHint: document.querySelector("#form-hint"),
  settingsHint: document.querySelector("#settings-hint"),
  latestWeight: document.querySelector("#latest-weight"),
  latestWeightMeta: document.querySelector("#latest-weight-meta"),
  currentWeekAverage: document.querySelector("#current-week-average"),
  currentWeekMeta: document.querySelector("#current-week-meta"),
  weekChange: document.querySelector("#week-change"),
  weekChangeMeta: document.querySelector("#week-change-meta"),
  overallChange: document.querySelector("#overall-change"),
  overallChangeMeta: document.querySelector("#overall-change-meta"),
  latestBmi: document.querySelector("#latest-bmi"),
  latestBmiMeta: document.querySelector("#latest-bmi-meta"),
  targetGap: document.querySelector("#target-gap"),
  targetGapMeta: document.querySelector("#target-gap-meta"),
  chart: document.querySelector("#trend-chart"),
  chartEmpty: document.querySelector("#chart-empty"),
  chartCaption: document.querySelector("#chart-caption"),
  weeklySummaryList: document.querySelector("#weekly-summary-list"),
  recordsList: document.querySelector("#records-list"),
  installButton: document.querySelector("#install-app-button"),
  installHint: document.querySelector("#install-hint"),
  syncForm: document.querySelector("#sync-form"),
  syncUrlInput: document.querySelector("#supabase-url"),
  syncAnonKeyInput: document.querySelector("#supabase-anon-key"),
  syncEmailInput: document.querySelector("#supabase-email"),
  syncPasswordInput: document.querySelector("#supabase-password"),
  syncConnectButton: document.querySelector("#sync-connect-button"),
  syncRegisterButton: document.querySelector("#sync-register-button"),
  syncPullButton: document.querySelector("#sync-pull-button"),
  syncPushButton: document.querySelector("#sync-push-button"),
  syncSignoutButton: document.querySelector("#sync-signout-button"),
  syncStatus: document.querySelector("#sync-status"),
  syncNote: document.querySelector("#sync-note"),
};

const state = {
  records: sortRecords(loadRecords()),
  settings: loadSettings(),
  meta: loadMeta(),
  installPrompt: null,
  chartInstance: null,
  sync: {
    config: loadSyncConfig(),
    client: null,
    user: null,
    busy: false,
    lastMessageIsError: false,
    statusMessage: "当前是纯本地模式。",
    noteMessage: "填好项目配置后，可以直接注册账号并开始多设备同步。",
    unsubscribeAuth: null,
  },
};

let autoSyncTimer = null;

const chartResizeObserver = new ResizeObserver(() => {
  if (state.chartInstance) {
    state.chartInstance.resize();
  }
});

init();

function init() {
  elements.dateInput.value = formatISODate(new Date());
  hydrateSettingsInputs();
  hydrateSyncInputs();

  elements.form.addEventListener("submit", handleSubmit);
  elements.recordsList.addEventListener("click", handleRecordAction);
  elements.heightInput.addEventListener("change", handleSettingsChange);
  elements.targetWeightInput.addEventListener("change", handleSettingsChange);
  elements.installButton.addEventListener("click", handleInstallClick);
  elements.syncForm.addEventListener("submit", handleSyncConnect);
  elements.syncRegisterButton.addEventListener("click", () => {
    void handleSyncRegister();
  });
  elements.syncPullButton.addEventListener("click", () => {
    void pullRemoteSnapshot({ forceApply: true, source: "手动拉取" });
  });
  elements.syncPushButton.addEventListener("click", () => {
    void pushLocalSnapshot("手动推送");
  });
  elements.syncSignoutButton.addEventListener("click", () => {
    void signOutSync();
  });

  window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  window.addEventListener("appinstalled", handleAppInstalled);
  chartResizeObserver.observe(elements.chart);

  registerServiceWorker();
  updateInstallUI();
  render();
  void restoreSyncSession();
}

function handleSubmit(event) {
  event.preventDefault();

  const date = elements.dateInput.value;
  const weightValue = Number(elements.weightInput.value);

  if (!date) {
    setHint("请选择日期。", true);
    return;
  }

  if (!Number.isFinite(weightValue) || weightValue <= 0) {
    setHint("请输入有效体重。", true);
    return;
  }

  const normalizedWeight = roundToOne(weightValue);
  const existingIndex = state.records.findIndex((record) => record.date === date);

  if (existingIndex >= 0) {
    state.records[existingIndex] = { date, weight: normalizedWeight };
    setHint(`已更新 ${formatDisplayDate(date)} 的记录。`);
  } else {
    state.records.push({ date, weight: normalizedWeight });
    setHint(`已保存 ${formatDisplayDate(date)} 的记录。`);
  }

  persistRecords();
  elements.weightInput.value = "";
  markLocalChange();
  render();
}

function handleSettingsChange() {
  const nextSettings = {
    heightCm: parseOptionalNumber(elements.heightInput.value),
    targetWeight: parseOptionalNumber(elements.targetWeightInput.value),
  };

  if (nextSettings.heightCm !== null && (nextSettings.heightCm < 80 || nextSettings.heightCm > 260)) {
    setSettingsHint("身高请填写 80 到 260 cm 之间的数字。", true);
    return;
  }

  if (
    nextSettings.targetWeight !== null &&
    (nextSettings.targetWeight < 20 || nextSettings.targetWeight > 400)
  ) {
    setSettingsHint("目标体重请填写 20 到 400 kg 之间的数字。", true);
    return;
  }

  state.settings = {
    heightCm: nextSettings.heightCm === null ? null : roundToOne(nextSettings.heightCm),
    targetWeight: nextSettings.targetWeight === null ? null : roundToOne(nextSettings.targetWeight),
  };

  persistSettings();
  hydrateSettingsInputs();
  setSettingsHint("基础设置已自动保存到本地。");
  markLocalChange();
  render();
}

function handleRecordAction(event) {
  const deleteButton = event.target.closest("[data-action='delete']");

  if (!deleteButton) {
    return;
  }

  const { date } = deleteButton.dataset;
  const targetRecord = state.records.find((record) => record.date === date);

  if (!targetRecord) {
    return;
  }

  const confirmed = window.confirm(
    `确认删除 ${formatDisplayDate(date)} 的体重记录（${formatWeight(targetRecord.weight)}）吗？`,
  );

  if (!confirmed) {
    return;
  }

  state.records = state.records.filter((record) => record.date !== date);
  persistRecords();
  setHint(`已删除 ${formatDisplayDate(date)} 的记录。`);
  markLocalChange();
  render();
}

function handleBeforeInstallPrompt(event) {
  event.preventDefault();
  state.installPrompt = event;
  updateInstallUI();
}

async function handleInstallClick() {
  if (!state.installPrompt) {
    return;
  }

  state.installPrompt.prompt();
  await state.installPrompt.userChoice;
  state.installPrompt = null;
  updateInstallUI();
}

function handleAppInstalled() {
  state.installPrompt = null;
  elements.installHint.textContent = "已安装到主屏幕，后续可以像普通 App 一样直接打开。";
  updateInstallUI();
}

async function handleSyncConnect(event) {
  event.preventDefault();
  await authenticateSync("sign-in");
}

async function handleSyncRegister() {
  await authenticateSync("sign-up");
}

async function authenticateSync(mode) {
  const config = readSyncConfigFromInputs();
  const password = elements.syncPasswordInput.value;
  const isSignUp = mode === "sign-up";

  if (!config.supabaseUrl || !config.supabaseAnonKey || !config.email || !password) {
    setSyncMessages("请完整填写 URL、Anon Key、邮箱和密码。", true);
    return;
  }

  if (!window.supabase?.createClient) {
    setSyncMessages("同步库未加载成功，无法连接 Supabase。", true);
    return;
  }

  state.sync.config = config;
  persistSyncConfig();
  hydrateSyncInputs();

  try {
    setSyncBusy(true, isSignUp ? "正在注册 Supabase 账号并同步..." : "正在登录 Supabase 并同步...");
    const client = createSupabaseClient(config);
    const authResult = isSignUp
      ? await client.auth.signUp({
          email: config.email,
          password,
          options: {
            data: {
              app: "lean-journal",
            },
          },
        })
      : await client.auth.signInWithPassword({
          email: config.email,
          password,
        });
    const { data, error } = authResult;

    if (error) {
      throw error;
    }

    elements.syncPasswordInput.value = "";

    if (isSignUp && !data.session) {
      setSyncMessages("注册请求已提交。请先完成邮箱确认；如果这个邮箱已注册，直接点“登录并同步”。");
      return;
    }

    await restoreSyncSession();
    await resolveRemoteAndLocalOnConnect();
  } catch (error) {
    setSyncMessages(
      readErrorMessage(
        error,
        isSignUp
          ? "注册失败，请检查 Supabase 配置、邮箱格式和密码强度。"
          : "登录失败，请检查 Supabase 配置和账号密码。",
      ),
      true,
    );
  } finally {
    setSyncBusy(false);
  }
}

function render() {
  state.records = sortRecords(state.records);
  renderStats(state.records);
  renderWeeklySummaries(state.records);
  renderRecords(state.records);
  renderChart(state.records);
  renderSyncState();
}

function renderStats(records) {
  if (!records.length) {
    elements.latestWeight.textContent = "--";
    elements.latestWeightMeta.textContent = "还没有记录";
    elements.currentWeekAverage.textContent = "--";
    elements.currentWeekMeta.textContent = "等待数据";
    elements.weekChange.textContent = "--";
    elements.weekChange.className = "stat-value";
    elements.weekChangeMeta.textContent = "至少需要两周数据";
    elements.overallChange.textContent = "--";
    elements.overallChange.className = "stat-value";
    elements.overallChangeMeta.textContent = "从首条记录开始计算";
    elements.latestBmi.textContent = "--";
    elements.latestBmi.className = "stat-value";
    elements.latestBmiMeta.textContent = state.settings.heightCm
      ? "先记录体重再计算 BMI"
      : "填写身高后自动计算";
    elements.targetGap.textContent = "--";
    elements.targetGap.className = "stat-value";
    elements.targetGapMeta.textContent = state.settings.targetWeight
      ? `目标 ${formatWeight(state.settings.targetWeight)}，先记录体重再计算`
      : "填写目标体重后自动计算";
    return;
  }

  const latest = records[records.length - 1];
  const first = records[0];
  const weeklySummaries = getWeeklySummaries(records);
  const currentWeek = weeklySummaries[weeklySummaries.length - 1];
  const previousWeek = weeklySummaries[weeklySummaries.length - 2];

  elements.latestWeight.textContent = formatWeight(latest.weight);
  elements.latestWeightMeta.textContent = `${formatDisplayDate(latest.date)} 记录`;

  elements.currentWeekAverage.textContent = formatWeight(currentWeek.average);
  elements.currentWeekMeta.textContent =
    `${formatWeekRange(currentWeek.weekStart)} · 已记录 ${currentWeek.count} 天`;

  if (previousWeek) {
    const difference = roundToOne(currentWeek.average - previousWeek.average);
    elements.weekChange.textContent = formatDelta(difference);
    elements.weekChange.className = `stat-value ${statToneClass(difference)}`;
    elements.weekChangeMeta.textContent =
      `${formatWeekRange(previousWeek.weekStart)} 平均 ${formatWeight(previousWeek.average)}`;
  } else {
    elements.weekChange.textContent = "--";
    elements.weekChange.className = "stat-value";
    elements.weekChangeMeta.textContent = "至少需要两周数据";
  }

  const overallDifference = roundToOne(latest.weight - first.weight);
  elements.overallChange.textContent = formatDelta(overallDifference);
  elements.overallChange.className = `stat-value ${statToneClass(overallDifference)}`;
  elements.overallChangeMeta.textContent =
    `${formatDisplayDate(first.date)} 到 ${formatDisplayDate(latest.date)}`;

  renderBmiStat(latest.weight);
  renderTargetGapStat(latest.weight);
}

function renderBmiStat(latestWeight) {
  if (!state.settings.heightCm) {
    elements.latestBmi.textContent = "--";
    elements.latestBmi.className = "stat-value";
    elements.latestBmiMeta.textContent = "填写身高后自动计算";
    return;
  }

  const bmi = calculateBmi(latestWeight, state.settings.heightCm);
  const category = getBmiCategory(bmi);
  const tone = category === "正常" ? "stat-tone-down" : "stat-tone-up";

  elements.latestBmi.textContent = bmi.toFixed(1);
  elements.latestBmi.className = `stat-value ${tone}`;
  elements.latestBmiMeta.textContent = `${category} · 身高 ${formatMeasure(state.settings.heightCm, "cm")}`;
}

function renderTargetGapStat(latestWeight) {
  if (!state.settings.targetWeight) {
    elements.targetGap.textContent = "--";
    elements.targetGap.className = "stat-value";
    elements.targetGapMeta.textContent = "填写目标体重后自动计算";
    return;
  }

  const gap = roundToOne(latestWeight - state.settings.targetWeight);
  elements.targetGap.textContent = formatDelta(gap);
  elements.targetGap.className = `stat-value ${statToneClass(gap)}`;

  if (gap > 0) {
    elements.targetGapMeta.textContent =
      `距离 ${formatWeight(state.settings.targetWeight)} 还差 ${gap.toFixed(1)} kg`;
    return;
  }

  if (gap < 0) {
    elements.targetGapMeta.textContent =
      `已低于 ${formatWeight(state.settings.targetWeight)} ${Math.abs(gap).toFixed(1)} kg`;
    return;
  }

  elements.targetGapMeta.textContent = `已达到 ${formatWeight(state.settings.targetWeight)}`;
}

function renderWeeklySummaries(records) {
  const summaries = getWeeklySummaries(records).reverse();

  if (!summaries.length) {
    elements.weeklySummaryList.className = "summary-list empty-state";
    elements.weeklySummaryList.textContent = "还没有周统计。";
    return;
  }

  elements.weeklySummaryList.className = "summary-list";
  elements.weeklySummaryList.innerHTML = summaries
    .map((summary, index) => {
      const previous = summaries[index + 1];
      const difference = previous ? roundToOne(summary.average - previous.average) : null;

      return `
        <div class="summary-row">
          <div>
            <p class="summary-title">${formatWeekRange(summary.weekStart)}</p>
            <p class="summary-subtitle">平均 ${formatWeight(summary.average)} · 记录 ${summary.count} 天</p>
            ${
              difference === null
                ? '<span class="delta-chip delta-neutral">首个统计周</span>'
                : `<span class="delta-chip ${differenceClass(
                    difference,
                  )}">${differenceLabel(difference)}</span>`
            }
          </div>
          <p class="summary-value">${formatWeight(summary.average)}</p>
        </div>
      `;
    })
    .join("");
}

function renderRecords(records) {
  const items = [...records].reverse();

  if (!items.length) {
    elements.recordsList.className = "records-list empty-state";
    elements.recordsList.textContent = "还没有记录，先输入今天的体重。";
    return;
  }

  elements.recordsList.className = "records-list";
  elements.recordsList.innerHTML = items
    .map(
      (record) => `
        <div class="record-row">
          <div>
            <p class="record-date">${formatDisplayDate(record.date)}</p>
            <p class="record-meta">${record.date}</p>
          </div>
          <p class="record-weight">${formatWeight(record.weight)}</p>
          <button class="ghost-button" type="button" data-action="delete" data-date="${record.date}">
            删除
          </button>
        </div>
      `,
    )
    .join("");
}

function renderChart(records) {
  if (!window.echarts) {
    elements.chart.innerHTML = "";
    elements.chartEmpty.hidden = false;
    elements.chartEmpty.textContent = "图表库未加载成功，刷新页面后重试。";
    elements.chartCaption.textContent = "图表不可用";
    return;
  }

  if (!state.chartInstance) {
    state.chartInstance = window.echarts.init(elements.chart, null, { renderer: "svg" });
  }

  if (!records.length) {
    state.chartInstance.clear();
    elements.chartEmpty.hidden = false;
    elements.chartEmpty.textContent = "添加第一条记录后，这里会出现你的体重曲线。";
    elements.chartCaption.textContent = "按日期展示每日体重变化";
    return;
  }

  elements.chartEmpty.hidden = true;

  const cssVars = getComputedStyle(document.documentElement);
  const accent = cssVars.getPropertyValue("--accent").trim();
  const accentStrong = cssVars.getPropertyValue("--accent-strong").trim();
  const rose = cssVars.getPropertyValue("--rose").trim();
  const text = cssVars.getPropertyValue("--text").trim();
  const muted = cssVars.getPropertyValue("--muted").trim();
  const weeklyAverageMap = new Map(
    getWeeklySummaries(records).map((summary) => [summary.weekStart, summary.average]),
  );

  const minWeight = Math.min(...records.map((record) => record.weight));
  const maxWeight = Math.max(...records.map((record) => record.weight));
  const padding = Math.max((maxWeight - minWeight) * 0.22, 2.4);

  state.chartInstance.setOption(
    {
      animationDuration: 700,
      animationEasing: "cubicOut",
      grid: {
        top: 24,
        right: 22,
        bottom: 36,
        left: 44,
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(255, 250, 243, 0.96)",
        borderWidth: 0,
        padding: 0,
        textStyle: {
          color: text,
        },
        extraCssText:
          "border-radius: 16px; box-shadow: 0 18px 40px rgba(71, 56, 42, 0.16); overflow: hidden;",
        formatter(params) {
          const point = params[0];
          const date = point.axisValue;
          const value = Number(point.data.value);
          const weekAverage = weeklyAverageMap.get(getWeekStart(date));
          const targetGapMarkup =
            state.settings.targetWeight === null
              ? ""
              : `<div style="margin-top: 4px; color: ${muted};">距目标 ${formatDelta(
                  roundToOne(value - state.settings.targetWeight),
                )}</div>`;

          return `
            <div style="padding: 14px 16px; min-width: 168px;">
              <div style="font-weight: 700; margin-bottom: 8px;">${formatDisplayDate(date)}</div>
              <div style="display: flex; justify-content: space-between; gap: 12px;">
                <span style="color: ${muted};">体重</span>
                <strong>${formatWeight(value)}</strong>
              </div>
              <div style="display: flex; justify-content: space-between; gap: 12px; margin-top: 4px;">
                <span style="color: ${muted};">周平均</span>
                <strong>${formatWeight(weekAverage)}</strong>
              </div>
              ${targetGapMarkup}
            </div>
          `;
        },
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: records.map((record) => record.date),
        axisLine: {
          lineStyle: {
            color: "rgba(34, 49, 39, 0.14)",
          },
        },
        axisTick: {
          show: false,
        },
        axisLabel: {
          color: muted,
          formatter: (value) => shortDate(value),
        },
      },
      yAxis: {
        type: "value",
        min: roundToOne(minWeight - padding),
        max: roundToOne(maxWeight + padding),
        axisLine: {
          show: false,
        },
        axisTick: {
          show: false,
        },
        axisLabel: {
          color: muted,
          formatter: (value) => Number(value).toFixed(1),
        },
        splitLine: {
          lineStyle: {
            color: "rgba(34, 49, 39, 0.09)",
          },
        },
      },
      series: [
        {
          name: "每日体重",
          type: "line",
          smooth: 0.28,
          symbol: "circle",
          symbolSize: 8,
          showSymbol: true,
          data: records.map((record) => ({
            value: record.weight,
            date: record.date,
          })),
          lineStyle: {
            color: accent,
            width: 3,
          },
          itemStyle: {
            color: "#ffffff",
            borderColor: accent,
            borderWidth: 2,
          },
          emphasis: {
            scale: true,
            itemStyle: {
              color: accentStrong,
              borderColor: accentStrong,
            },
          },
          areaStyle: {
            color: new window.echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(45, 106, 79, 0.22)" },
              { offset: 1, color: "rgba(45, 106, 79, 0.05)" },
            ]),
          },
          markLine:
            state.settings.targetWeight === null
              ? undefined
              : {
                  symbol: "none",
                  lineStyle: {
                    color: rose,
                    type: "dashed",
                    width: 2,
                  },
                  label: {
                    color: rose,
                    formatter: `目标 ${state.settings.targetWeight.toFixed(1)} kg`,
                  },
                  data: [{ yAxis: state.settings.targetWeight }],
                },
        },
      ],
    },
    true,
  );

  state.chartInstance.resize();

  const firstDate = records[0].date;
  const lastDate = records[records.length - 1].date;
  const targetText = state.settings.targetWeight ? ` · 目标 ${formatWeight(state.settings.targetWeight)}` : "";
  elements.chartCaption.textContent =
    `${formatDisplayDate(firstDate)} 到 ${formatDisplayDate(lastDate)} · 共 ${records.length} 条记录${targetText}`;
}

function renderSyncState() {
  const configReady = isSyncConfigReady(state.sync.config);
  const loggedIn = Boolean(state.sync.user);

  elements.syncConnectButton.disabled = state.sync.busy || !window.supabase?.createClient;
  elements.syncRegisterButton.disabled = state.sync.busy || !window.supabase?.createClient;
  elements.syncPullButton.disabled = state.sync.busy || !loggedIn;
  elements.syncPushButton.disabled = state.sync.busy || !loggedIn;
  elements.syncSignoutButton.disabled = state.sync.busy || !loggedIn;

  if (state.sync.busy) {
    elements.syncStatus.textContent = state.sync.statusMessage;
    elements.syncNote.textContent = state.sync.noteMessage;
    return;
  }

  if (!window.supabase?.createClient) {
    elements.syncStatus.textContent = "同步库未加载成功。";
    elements.syncNote.textContent = "检查 vendor/supabase.min.js 是否存在，再刷新页面。";
    return;
  }

  if (state.sync.lastMessageIsError) {
    elements.syncStatus.textContent = state.sync.statusMessage;
    elements.syncNote.textContent = state.sync.noteMessage;
    return;
  }

  if (loggedIn) {
    const email = state.sync.user.email ?? state.sync.config.email;
    const syncedAt = state.meta.lastSuccessfulSyncAt
      ? `上次同步 ${formatDateTime(state.meta.lastSuccessfulSyncAt)}`
      : "已连接，等待首次同步";
    const pending = state.meta.lastLocalChangeAt > (state.meta.lastSuccessfulSyncAt ?? 0) ? " · 本地有未同步修改" : "";

    elements.syncStatus.textContent = state.sync.statusMessage || `已连接 ${email}`;
    elements.syncNote.textContent = `${syncedAt}${pending}`;
    return;
  }

  if (configReady) {
    elements.syncStatus.textContent = "已保存 Supabase 配置，等待登录。";
    elements.syncNote.textContent = "如果还没有账号，直接点“注册并同步”；密码不会单独保存在浏览器。";
    return;
  }

  elements.syncStatus.textContent = "当前是纯本地模式。";
  elements.syncNote.textContent = "填好项目配置后，可以直接注册账号并开始多设备同步。";
}

function hydrateSettingsInputs() {
  elements.heightInput.value = state.settings.heightCm === null ? "" : String(state.settings.heightCm);
  elements.targetWeightInput.value =
    state.settings.targetWeight === null ? "" : String(state.settings.targetWeight);
}

function hydrateSyncInputs() {
  elements.syncUrlInput.value = state.sync.config.supabaseUrl ?? "";
  elements.syncAnonKeyInput.value = state.sync.config.supabaseAnonKey ?? "";
  elements.syncEmailInput.value = state.sync.config.email ?? "";
}

function readSyncConfigFromInputs() {
  return {
    supabaseUrl: elements.syncUrlInput.value.trim(),
    supabaseAnonKey: elements.syncAnonKeyInput.value.trim(),
    email: elements.syncEmailInput.value.trim(),
  };
}

function updateInstallUI() {
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);

  if (isStandalone) {
    elements.installButton.disabled = true;
    elements.installHint.textContent = "已安装到主屏幕，后续可以像普通 App 一样直接打开。";
    return;
  }

  if (state.installPrompt) {
    elements.installButton.disabled = false;
    elements.installHint.textContent = "这个设备支持直接安装，点按钮即可加入主屏幕。";
    return;
  }

  elements.installButton.disabled = true;
  elements.installHint.textContent = isIos
    ? "iPhone 请在 Safari 里点“分享”，再选“添加到主屏幕”。"
    : "如果手机浏览器支持安装，打开后会自动出现安装入口。";
}

function markLocalChange() {
  state.meta.lastLocalChangeAt = Date.now();
  persistMeta();
  scheduleAutoSync();
}

function scheduleAutoSync() {
  if (!state.sync.user) {
    renderSyncState();
    return;
  }

  window.clearTimeout(autoSyncTimer);
  autoSyncTimer = window.setTimeout(() => {
    void pushLocalSnapshot("自动同步");
  }, 800);
  renderSyncState();
}

async function restoreSyncSession() {
  if (!isSyncConfigReady(state.sync.config) || !window.supabase?.createClient) {
    renderSyncState();
    return;
  }

  try {
    const client = createSupabaseClient(state.sync.config);
    const { data, error } = await client.auth.getSession();

    if (error) {
      throw error;
    }

    state.sync.user = data.session?.user ?? null;

    if (state.sync.user) {
      setSyncMessages(`已恢复 ${state.sync.user.email ?? "当前账号"} 的登录状态。`);
    }
  } catch (error) {
    setSyncMessages(readErrorMessage(error, "恢复 Supabase 会话失败。"), true);
  }

  renderSyncState();
}

function createSupabaseClient(config) {
  const existingConfig = state.sync.client?._leanJournalConfig;
  if (
    state.sync.client &&
    existingConfig &&
    existingConfig.supabaseUrl === config.supabaseUrl &&
    existingConfig.supabaseAnonKey === config.supabaseAnonKey
  ) {
    return state.sync.client;
  }

  if (state.sync.unsubscribeAuth) {
    state.sync.unsubscribeAuth();
    state.sync.unsubscribeAuth = null;
  }

  const storageKey = `lean-journal-supabase-${hashString(config.supabaseUrl)}`;
  const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey,
    },
  });

  client._leanJournalConfig = { ...config };
  const { data } = client.auth.onAuthStateChange((event, session) => {
    state.sync.user = session?.user ?? null;

    if (event === "SIGNED_OUT") {
      state.sync.statusMessage = "已退出 Supabase 同步。";
    }

    renderSyncState();
  });

  state.sync.client = client;
  state.sync.unsubscribeAuth = () => data.subscription.unsubscribe();
  return client;
}

async function resolveRemoteAndLocalOnConnect() {
  const remote = await fetchRemoteSnapshot();
  const remoteTimestamp = remote ? getRemoteSnapshotTimestamp(remote) : 0;
  const localTimestamp = state.meta.lastLocalChangeAt ?? 0;

  if (!remote && hasLocalSnapshot()) {
    await pushLocalSnapshot("首次上传本地数据");
    return;
  }

  if (!remote && !hasLocalSnapshot()) {
    setSyncMessages("已登录，但云端和本地都还没有数据。");
    return;
  }

  if (remote && !hasLocalSnapshot()) {
    applyRemoteSnapshot(remote, "已拉取云端数据到当前设备。");
    return;
  }

  if (remoteTimestamp > localTimestamp) {
    applyRemoteSnapshot(remote, "云端数据更新，已覆盖到当前设备。");
    return;
  }

  await pushLocalSnapshot("本地数据较新，已推送到云端");
}

async function fetchRemoteSnapshot() {
  const client = state.sync.client;

  if (!client || !state.sync.user) {
    throw new Error("尚未登录 Supabase。");
  }

  const { data, error } = await client
    .from(SYNC_TABLE)
    .select("user_id, payload, updated_at")
    .eq("user_id", state.sync.user.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function pullRemoteSnapshot({ forceApply = false, source = "拉取云端" } = {}) {
  try {
    setSyncBusy(true, `${source}中...`);
    const remote = await fetchRemoteSnapshot();

    if (!remote) {
      setSyncMessages("云端还没有数据，可先把本地记录推送上去。");
      return;
    }

    if (forceApply || getRemoteSnapshotTimestamp(remote) >= (state.meta.lastLocalChangeAt ?? 0)) {
      applyRemoteSnapshot(remote, "已用云端数据刷新当前设备。");
      return;
    }

    setSyncMessages("云端数据比当前本地更旧，未自动覆盖。");
  } catch (error) {
    setSyncMessages(readErrorMessage(error, "拉取云端数据失败。"), true);
  } finally {
    setSyncBusy(false);
  }
}

async function pushLocalSnapshot(source = "推送本地") {
  if (!state.sync.client || !state.sync.user) {
    renderSyncState();
    return;
  }

  try {
    setSyncBusy(true, `${source}中...`);
    const payload = createSnapshotPayload();
    const { error } = await state.sync.client.from(SYNC_TABLE).upsert(
      {
        user_id: state.sync.user.id,
        payload,
      },
      { onConflict: "user_id" },
    );

    if (error) {
      throw error;
    }

    state.meta.lastSuccessfulSyncAt = Date.now();
    persistMeta();
    setSyncMessages(`${source}完成。`);
  } catch (error) {
    setSyncMessages(readErrorMessage(error, "推送本地数据失败。"), true);
  } finally {
    setSyncBusy(false);
  }
}

async function signOutSync() {
  if (!state.sync.client) {
    return;
  }

  try {
    setSyncBusy(true, "正在退出同步...");
    const { error } = await state.sync.client.auth.signOut();

    if (error) {
      throw error;
    }

    state.sync.user = null;
    state.sync.statusMessage = "已退出 Supabase 同步。";
  } catch (error) {
    setSyncMessages(readErrorMessage(error, "退出同步失败。"), true);
  } finally {
    setSyncBusy(false);
  }
}

function applyRemoteSnapshot(remote, successMessage) {
  const payload = normalizeRemotePayload(remote?.payload);
  state.records = sortRecords(payload.records);
  state.settings = payload.settings;
  state.meta.lastLocalChangeAt = getRemoteSnapshotTimestamp(remote) || Date.now();
  state.meta.lastSuccessfulSyncAt = Date.now();

  persistRecords();
  persistSettings();
  persistMeta();
  hydrateSettingsInputs();
  render();
  setSyncMessages(successMessage);
}

function createSnapshotPayload() {
  return {
    records: state.records.map((record) => ({
      date: record.date,
      weight: roundToOne(record.weight),
    })),
    settings: {
      heightCm: state.settings.heightCm,
      targetWeight: state.settings.targetWeight,
    },
    meta: {
      updatedAt: new Date(state.meta.lastLocalChangeAt ?? Date.now()).toISOString(),
      app: "lean-journal",
      version: 2,
    },
  };
}

function normalizeRemotePayload(payload) {
  const records = Array.isArray(payload?.records)
    ? payload.records
        .filter((item) => item && typeof item.date === "string" && Number.isFinite(item.weight))
        .map((item) => ({
          date: item.date,
          weight: roundToOne(Number(item.weight)),
        }))
    : [];

  return {
    records,
    settings: {
      heightCm: Number.isFinite(payload?.settings?.heightCm)
        ? roundToOne(Number(payload.settings.heightCm))
        : null,
      targetWeight: Number.isFinite(payload?.settings?.targetWeight)
        ? roundToOne(Number(payload.settings.targetWeight))
        : null,
    },
  };
}

function getRemoteSnapshotTimestamp(remote) {
  const payloadTimestamp = Date.parse(remote?.payload?.meta?.updatedAt ?? "");
  if (Number.isFinite(payloadTimestamp)) {
    return payloadTimestamp;
  }

  const rowTimestamp = Date.parse(remote?.updated_at ?? "");
  return Number.isFinite(rowTimestamp) ? rowTimestamp : 0;
}

function hasLocalSnapshot() {
  return state.records.length > 0 || state.settings.heightCm !== null || state.settings.targetWeight !== null;
}

function isSyncConfigReady(config) {
  return Boolean(config.supabaseUrl && config.supabaseAnonKey && config.email);
}

function setSyncBusy(isBusy, statusMessage = state.sync.statusMessage) {
  state.sync.busy = isBusy;
  state.sync.statusMessage = statusMessage;
  state.sync.lastMessageIsError = false;
  if (isBusy) {
    state.sync.noteMessage = "请保持页面打开，完成后会自动更新状态。";
  }
  renderSyncState();
}

function setSyncMessages(statusMessage, isError = false) {
  state.sync.statusMessage = statusMessage;
  state.sync.lastMessageIsError = isError;
  state.sync.noteMessage = isError
    ? "检查 Supabase 表、RLS 策略、Anon Key 以及登录账号后重试。"
    : state.sync.user
      ? `上次同步 ${state.meta.lastSuccessfulSyncAt ? formatDateTime(state.meta.lastSuccessfulSyncAt) : "刚刚"}`
      : "默认仍可离线、本地单独使用。";
  renderSyncState();
}

function setHint(message, isError = false) {
  elements.formHint.textContent = message;
  elements.formHint.style.color = isError ? "#8c4232" : "";
}

function setSettingsHint(message, isError = false) {
  elements.settingsHint.textContent = message;
  elements.settingsHint.style.color = isError ? "#8c4232" : "";
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      elements.installHint.textContent = "离线缓存注册失败，但页面仍可正常使用。";
    });
  });
}

function loadRecords() {
  try {
    const raw = window.localStorage.getItem(RECORDS_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item) => item && typeof item.date === "string" && Number.isFinite(item.weight))
      .map((item) => ({
        date: item.date,
        weight: roundToOne(Number(item.weight)),
      }));
  } catch {
    return [];
  }
}

function loadSettings() {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return { heightCm: null, targetWeight: null };
    }

    const parsed = JSON.parse(raw);
    return {
      heightCm: Number.isFinite(parsed?.heightCm) ? roundToOne(Number(parsed.heightCm)) : null,
      targetWeight: Number.isFinite(parsed?.targetWeight)
        ? roundToOne(Number(parsed.targetWeight))
        : null,
    };
  } catch {
    return { heightCm: null, targetWeight: null };
  }
}

function loadMeta() {
  try {
    const raw = window.localStorage.getItem(META_KEY);
    if (!raw) {
      return {
        lastLocalChangeAt: Date.now(),
        lastSuccessfulSyncAt: null,
      };
    }

    const parsed = JSON.parse(raw);
    return {
      lastLocalChangeAt: Number.isFinite(parsed?.lastLocalChangeAt)
        ? Number(parsed.lastLocalChangeAt)
        : Date.now(),
      lastSuccessfulSyncAt: Number.isFinite(parsed?.lastSuccessfulSyncAt)
        ? Number(parsed.lastSuccessfulSyncAt)
        : null,
    };
  } catch {
    return {
      lastLocalChangeAt: Date.now(),
      lastSuccessfulSyncAt: null,
    };
  }
}

function loadSyncConfig() {
  try {
    const raw = window.localStorage.getItem(SYNC_CONFIG_KEY);
    if (!raw) {
      return { ...DEFAULT_SYNC_CONFIG };
    }

    const parsed = JSON.parse(raw);
    return {
      supabaseUrl:
        typeof parsed?.supabaseUrl === "string" ? parsed.supabaseUrl : DEFAULT_SYNC_CONFIG.supabaseUrl,
      supabaseAnonKey:
        typeof parsed?.supabaseAnonKey === "string"
          ? parsed.supabaseAnonKey
          : DEFAULT_SYNC_CONFIG.supabaseAnonKey,
      email: typeof parsed?.email === "string" ? parsed.email : DEFAULT_SYNC_CONFIG.email,
    };
  } catch {
    return { ...DEFAULT_SYNC_CONFIG };
  }
}

function persistRecords() {
  window.localStorage.setItem(RECORDS_KEY, JSON.stringify(sortRecords(state.records)));
}

function persistSettings() {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

function persistMeta() {
  window.localStorage.setItem(META_KEY, JSON.stringify(state.meta));
}

function persistSyncConfig() {
  window.localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(state.sync.config));
}

function getWeeklySummaries(records) {
  const weeklyMap = new Map();

  for (const record of records) {
    const weekStart = getWeekStart(record.date);
    const bucket = weeklyMap.get(weekStart) ?? [];
    bucket.push(record.weight);
    weeklyMap.set(weekStart, bucket);
  }

  return [...weeklyMap.entries()]
    .map(([weekStart, weights]) => ({
      weekStart,
      average: roundToOne(weights.reduce((sum, weight) => sum + weight, 0) / weights.length),
      count: weights.length,
    }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

function getWeekStart(dateString) {
  const date = parseDate(dateString);
  const day = date.getDay();
  const offset = day === 0 ? 6 : day - 1;
  date.setDate(date.getDate() - offset);
  return formatISODate(date);
}

function calculateBmi(weight, heightCm) {
  const heightM = heightCm / 100;
  return weight / (heightM * heightM);
}

function getBmiCategory(bmi) {
  if (bmi < 18.5) {
    return "偏瘦";
  }
  if (bmi < 24) {
    return "正常";
  }
  if (bmi < 28) {
    return "超重";
  }
  return "肥胖";
}

function parseDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function parseOptionalNumber(value) {
  if (value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(parseDate(value));
}

function shortDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(parseDate(value));
}

function formatWeekRange(weekStartString) {
  const startDate = parseDate(weekStartString);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);
  return `${shortDate(formatISODate(startDate))} - ${shortDate(formatISODate(endDate))}`;
}

function formatWeight(weight) {
  return `${weight.toFixed(1)} kg`;
}

function formatMeasure(value, unit) {
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

function formatDelta(delta) {
  if (delta === 0) {
    return "0.0 kg";
  }
  return `${delta > 0 ? "+" : ""}${delta.toFixed(1)} kg`;
}

function formatDateTime(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function differenceLabel(delta) {
  if (delta === 0) {
    return "与上一周持平";
  }
  return delta < 0 ? `较上一周下降 ${Math.abs(delta).toFixed(1)} kg` : `较上一周上升 ${delta.toFixed(1)} kg`;
}

function differenceClass(delta) {
  if (delta === 0 || Number.isNaN(delta)) {
    return "delta-neutral";
  }
  return delta < 0 ? "delta-down" : "delta-up";
}

function statToneClass(delta) {
  if (delta === 0 || Number.isNaN(delta)) {
    return "stat-tone-neutral";
  }
  return delta < 0 ? "stat-tone-down" : "stat-tone-up";
}

function sortRecords(records) {
  return [...records].sort((a, b) => a.date.localeCompare(b.date));
}

function roundToOne(value) {
  return Math.round(value * 10) / 10;
}

function hashString(input) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function readErrorMessage(error, fallback) {
  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message;
  }
  return fallback;
}
