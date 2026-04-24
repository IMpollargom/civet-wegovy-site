const STORAGE_KEY = 'civet-wegovy-tracker-v1';
const HALF_LIFE_DAYS = 7;
const HALF_LIFE_MS = HALF_LIFE_DAYS * 24 * 60 * 60 * 1000;
const WEGOVY_DOSES = [0.25, 0.5, 1, 1.7, 2.4];

const state = {
    doses: [],
    logs: [],
    activeTab: 'home',
    logFilter: 'all',
    chart: null
};

document.addEventListener('DOMContentLoaded', () => {
    loadState();
    setupEvents();
    setDefaultDates();
    refreshAll();
});

function setupEvents() {
    document.querySelectorAll('.nav-item').forEach((item) => {
        item.addEventListener('click', () => switchTab(item.dataset.tab));
    });

    document.querySelectorAll('[data-open-dose]').forEach((button) => {
        button.addEventListener('click', () => openDoseModal());
    });

    document.querySelectorAll('[data-open-log]').forEach((button) => {
        button.addEventListener('click', () => openLogModal(button.dataset.openLog));
    });

    document.addEventListener('click', (event) => {
        const editDoseButton = event.target.closest('[data-edit-dose]');
        const deleteDoseButton = event.target.closest('[data-delete-dose]');
        const editLogButton = event.target.closest('[data-edit-log]');
        const deleteLogButton = event.target.closest('[data-delete-log]');

        if (editDoseButton) editDose(editDoseButton.dataset.editDose);
        if (deleteDoseButton) deleteDose(deleteDoseButton.dataset.deleteDose);
        if (editLogButton) editLog(editLogButton.dataset.editLog);
        if (deleteLogButton) deleteLog(deleteLogButton.dataset.deleteLog);
    });

    document.getElementById('add-dose-btn').addEventListener('click', () => openDoseModal());
    document.getElementById('bulk-dose-btn').addEventListener('click', openBulkModal);
    document.getElementById('add-log-btn').addEventListener('click', () => openLogModal('side_effect'));

    document.getElementById('dose-form').addEventListener('submit', saveDoseFromForm);
    document.getElementById('bulk-form').addEventListener('submit', saveBulkDoses);
    document.getElementById('log-form').addEventListener('submit', saveLogFromForm);

    document.getElementById('dose-amount').addEventListener('change', updateCustomDoseVisibility);
    document.getElementById('log-intensity').addEventListener('input', (event) => {
        document.getElementById('log-intensity-label').textContent = event.target.value;
    });

    document.querySelectorAll('[data-close-modal]').forEach((button) => {
        button.addEventListener('click', closeModals);
    });

    document.querySelectorAll('.modal').forEach((modal) => {
        modal.addEventListener('click', (event) => {
            if (event.target === modal) closeModals();
        });
    });

    document.querySelectorAll('.sub-tab-item').forEach((button) => {
        button.addEventListener('click', () => {
            state.logFilter = button.dataset.filter;
            document.querySelectorAll('.sub-tab-item').forEach((item) => item.classList.remove('active'));
            button.classList.add('active');
            renderLogs();
        });
    });

    ['bulk-start-date', 'bulk-time', 'bulk-weeks'].forEach((id) => {
        document.getElementById(id).addEventListener('input', updateBulkPreview);
    });

    document.getElementById('export-json-btn').addEventListener('click', exportJson);
    document.getElementById('export-csv-btn').addEventListener('click', exportCsv);
    document.getElementById('seed-demo-btn').addEventListener('click', seedDemoData);
    document.getElementById('reset-data-btn').addEventListener('click', resetData);
}

function loadState() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        state.doses = Array.isArray(saved.doses) ? saved.doses : [];
        state.logs = Array.isArray(saved.logs) ? saved.logs : [];
    } catch (error) {
        console.error(error);
        state.doses = [];
        state.logs = [];
    }
}

function persistState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        doses: state.doses,
        logs: state.logs
    }));
}

function refreshAll() {
    document.getElementById('today-label').textContent = new Date().toLocaleDateString('ko-KR', {
        month: 'short',
        day: 'numeric',
        weekday: 'short'
    });
    renderHome();
    renderDoses();
    renderLogs();
    renderRangeSummary();
    updateChart();
}

function switchTab(tabName) {
    state.activeTab = tabName;

    document.querySelectorAll('.tab-content').forEach((tab) => tab.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));

    document.getElementById(`tab-${tabName}`).classList.add('active');
    document.querySelector(`.nav-item[data-tab="${tabName}"]`).classList.add('active');

    if (tabName === 'graph') {
        setTimeout(updateChart, 80);
    }
}

function renderHome() {
    const now = new Date();
    const concentration = getConcentrationAt(now);
    const lastDose = getLastDose();
    const sideEffectCount = state.logs.filter((log) => log.type === 'side_effect').length;
    const effectCount = state.logs.filter((log) => log.type === 'good_effect').length;

    document.getElementById('home-concentration').textContent = concentration.toFixed(2);
    document.getElementById('total-doses').textContent = state.doses.length;
    document.getElementById('side-effect-count').textContent = sideEffectCount;
    document.getElementById('effect-count').textContent = effectCount;

    if (!lastDose) {
        document.getElementById('home-last-updated').textContent = '아직 투약 기록이 없습니다';
        document.getElementById('current-dose').textContent = '-';
        document.getElementById('next-dose-days').textContent = '-';
        document.getElementById('home-insight').innerHTML = emptyInsight();
        return;
    }

    const lastDate = new Date(lastDose.datetime);
    const nextDate = addDays(lastDate, 7);
    const daysUntilNext = Math.ceil((nextDate - now) / (24 * 60 * 60 * 1000));
    const dayText = daysUntilNext > 0 ? `D-${daysUntilNext}` : daysUntilNext === 0 ? '오늘' : `D+${Math.abs(daysUntilNext)}`;

    document.getElementById('home-last-updated').textContent =
        `마지막 ${formatDateTime(lastDate)} · 다음 ${formatDateTime(nextDate)}`;
    document.getElementById('current-dose').textContent = `${formatDose(lastDose.amount)}mg`;
    document.getElementById('next-dose-days').textContent = dayText;
    document.getElementById('home-insight').innerHTML = buildHomeInsight(lastDose, concentration, nextDate);
}

function emptyInsight() {
    return `
        <div class="insight-row">
            <span>시작</span>
            <strong>투약 기록을 추가하면 농도 곡선이 계산됩니다</strong>
        </div>
        <div class="insight-row">
            <span>기준</span>
            <strong>위고비 주 1회, 반감기 약 7일</strong>
        </div>
    `;
}

function buildHomeInsight(lastDose, concentration, nextDate) {
    const latestLogs = [...state.logs]
        .sort((a, b) => new Date(b.datetime) - new Date(a.datetime))
        .slice(0, 1);
    const logText = latestLogs.length
        ? `${getLogTypeLabel(latestLogs[0].type)} · ${latestLogs[0].title}`
        : '아직 증상/효능 기록 없음';

    return `
        <div class="insight-row">
            <span>마지막 용량</span>
            <strong>${formatDose(lastDose.amount)}mg · ${lastDose.site || '부위 미기록'}</strong>
        </div>
        <div class="insight-row">
            <span>다음 예정</span>
            <strong>${formatDateTime(nextDate)}</strong>
        </div>
        <div class="insight-row">
            <span>추정 잔존량</span>
            <strong>${concentration.toFixed(2)}mg</strong>
        </div>
        <div class="insight-row">
            <span>최근 기록</span>
            <strong>${escapeHtml(logText)}</strong>
        </div>
    `;
}

function renderDoses() {
    const container = document.getElementById('dose-list');
    const doses = getSortedDoses();

    if (!doses.length) {
        container.innerHTML = `
            <div class="empty-state">
                <strong>투약 기록이 없습니다</strong><br>
                위고비 투약 날짜와 용량을 추가하세요
            </div>
        `;
        return;
    }

    container.innerHTML = doses.map((dose, index) => {
        const previous = doses[index + 1];
        const intervalText = previous
            ? `${Math.round((new Date(dose.datetime) - new Date(previous.datetime)) / (24 * 60 * 60 * 1000))}일 간격`
            : '첫 기록';

        return `
            <article class="list-item">
                <div class="item-main">
                    <div class="item-date">${formatDateTime(new Date(dose.datetime))}</div>
                    <div class="item-title-row">
                        <span class="item-title">${formatDose(dose.amount)}mg</span>
                        <span class="status-badge">${intervalText}</span>
                    </div>
                    <div class="item-meta">${dose.site || '부위 미기록'} · 해당 시점 농도 ${getConcentrationAt(new Date(dose.datetime)).toFixed(2)}mg</div>
                    ${dose.notes ? `<div class="item-notes">${escapeHtml(dose.notes)}</div>` : ''}
                </div>
                <div class="item-actions">
                    <button class="item-edit" data-edit-dose="${dose.id}">수정</button>
                    <button class="item-delete" data-delete-dose="${dose.id}">삭제</button>
                </div>
            </article>
        `;
    }).join('');
}

function renderLogs() {
    const container = document.getElementById('log-list');
    const filtered = getSortedLogs().filter((log) => {
        return state.logFilter === 'all' || log.type === state.logFilter;
    });

    if (!filtered.length) {
        container.innerHTML = `
            <div class="empty-state">
                <strong>작성된 기록이 없습니다</strong><br>
                부작용, 효능, 효과 부족을 남기면 농도와 함께 비교됩니다
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map((log) => {
        const typeClass = log.type.replace('_', '-');
        const logDate = new Date(log.datetime);
        const concentration = getConcentrationAt(logDate);

        return `
            <article class="list-item">
                <div class="item-main">
                    <div class="item-date">${formatDateTime(logDate)}</div>
                    <div class="item-title-row">
                        <span class="tracking-type ${typeClass}">${getLogTypeLabel(log.type)}</span>
                        <span class="item-title">${escapeHtml(log.title)}</span>
                    </div>
                    <div class="item-meta">강도 ${log.intensity}/5 · 당시 농도 ${concentration.toFixed(2)}mg</div>
                    ${log.notes ? `<div class="item-notes">${escapeHtml(log.notes)}</div>` : ''}
                </div>
                <div class="item-actions">
                    <button class="item-edit" data-edit-log="${log.id}">수정</button>
                    <button class="item-delete" data-delete-log="${log.id}">삭제</button>
                </div>
            </article>
        `;
    }).join('');
}

function renderRangeSummary() {
    const container = document.getElementById('range-summary');
    const summaries = [
        ['side_effect', '부작용 평균 농도'],
        ['good_effect', '효능 좋음 평균 농도'],
        ['low_effect', '효과 적음 평균 농도']
    ].map(([type, label]) => {
        const logs = state.logs.filter((log) => log.type === type);
        if (!logs.length) {
            return { label, value: '-' };
        }
        const avg = logs.reduce((sum, log) => sum + getConcentrationAt(new Date(log.datetime)), 0) / logs.length;
        return { label, value: `${avg.toFixed(2)}mg · ${logs.length}건` };
    });

    const current = getConcentrationAt(new Date()).toFixed(2);
    container.innerHTML = [
        { label: '현재 추정 농도', value: `${current}mg` },
        ...summaries
    ].map((item) => `
        <div class="range-item">
            <span class="range-label">${item.label}</span>
            <strong class="range-value">${item.value}</strong>
        </div>
    `).join('');
}

function openDoseModal(dose = null) {
    document.getElementById('dose-form').reset();
    document.getElementById('dose-id').value = dose?.id || '';
    document.getElementById('dose-modal-title').textContent = dose ? '투약 기록 수정' : '투약 기록 추가';
    document.getElementById('dose-date').value = dose ? toDateTimeInput(new Date(dose.datetime)) : toDateTimeInput(new Date());
    document.getElementById('dose-site').value = dose?.site || '복부';
    document.getElementById('dose-notes').value = dose?.notes || '';

    if (dose && WEGOVY_DOSES.includes(Number(dose.amount))) {
        document.getElementById('dose-amount').value = String(dose.amount);
        document.getElementById('custom-dose').value = '';
    } else if (dose) {
        document.getElementById('dose-amount').value = 'custom';
        document.getElementById('custom-dose').value = dose.amount;
    } else {
        document.getElementById('dose-amount').value = getLikelyNextDose();
    }

    updateCustomDoseVisibility();
    openModal('dose-modal');
}

function saveDoseFromForm(event) {
    event.preventDefault();

    const id = document.getElementById('dose-id').value || createId();
    const selectedAmount = document.getElementById('dose-amount').value;
    const amount = selectedAmount === 'custom'
        ? Number(document.getElementById('custom-dose').value)
        : Number(selectedAmount);

    if (!Number.isFinite(amount) || amount <= 0) {
        showToast('투약량을 확인하세요');
        return;
    }

    const dose = {
        id,
        datetime: new Date(document.getElementById('dose-date').value).toISOString(),
        amount,
        site: document.getElementById('dose-site').value,
        notes: document.getElementById('dose-notes').value.trim()
    };

    const index = state.doses.findIndex((item) => item.id === id);
    if (index >= 0) {
        state.doses[index] = dose;
    } else {
        state.doses.push(dose);
    }

    persistState();
    closeModals();
    refreshAll();
    showToast('투약 기록이 저장되었습니다');
}

function editDose(id) {
    const dose = state.doses.find((item) => item.id === id);
    if (dose) openDoseModal(dose);
}

function deleteDose(id) {
    if (!confirm('이 투약 기록을 삭제할까요?')) return;
    state.doses = state.doses.filter((dose) => dose.id !== id);
    persistState();
    refreshAll();
    showToast('투약 기록을 삭제했습니다');
}

function openBulkModal() {
    document.getElementById('bulk-form').reset();
    document.getElementById('bulk-start-date').value = toDateInput(new Date());
    document.getElementById('bulk-time').value = '09:00';
    document.getElementById('bulk-weeks').value = '16';
    updateBulkPreview();
    openModal('bulk-modal');
}

function updateBulkPreview() {
    const start = document.getElementById('bulk-start-date').value;
    const weeks = Number(document.getElementById('bulk-weeks').value || 0);
    const preview = document.getElementById('bulk-preview');

    if (!start || !weeks) {
        preview.textContent = '시작일과 주 수를 입력하세요';
        return;
    }

    const lastDose = doseForWeek(weeks - 1);
    preview.innerHTML = `
        총 ${weeks}회가 7일 간격으로 추가됩니다.<br>
        시작 ${start} · 마지막 예상 용량 ${formatDose(lastDose)}mg
    `;
}

function saveBulkDoses(event) {
    event.preventDefault();

    const startDate = document.getElementById('bulk-start-date').value;
    const time = document.getElementById('bulk-time').value;
    const weeks = Number(document.getElementById('bulk-weeks').value);
    const created = [];

    for (let i = 0; i < weeks; i += 1) {
        const date = new Date(`${startDate}T${time}`);
        date.setDate(date.getDate() + i * 7);
        const amount = doseForWeek(i);
        const alreadyExists = state.doses.some((dose) => {
            const existing = new Date(dose.datetime);
            return Math.abs(existing - date) < 60 * 60 * 1000 && Number(dose.amount) === amount;
        });

        if (!alreadyExists) {
            created.push({
                id: createId(),
                datetime: date.toISOString(),
                amount,
                site: '복부',
                notes: '표준 증량 스케줄로 입력'
            });
        }
    }

    state.doses.push(...created);
    persistState();
    closeModals();
    refreshAll();
    showToast(`${created.length}개의 과거 기록을 추가했습니다`);
}

function openLogModal(type = 'side_effect', log = null) {
    document.getElementById('log-form').reset();
    document.getElementById('log-id').value = log?.id || '';
    document.getElementById('log-type').value = log?.type || type;
    document.getElementById('log-date').value = log ? toDateTimeInput(new Date(log.datetime)) : toDateTimeInput(new Date());
    document.getElementById('log-title').value = log?.title || '';
    document.getElementById('log-intensity').value = log?.intensity || 3;
    document.getElementById('log-intensity-label').textContent = log?.intensity || 3;
    document.getElementById('log-notes').value = log?.notes || '';
    document.getElementById('log-modal-title').textContent = log ? '기록 수정' : `${getLogTypeLabel(type)} 기록`;
    openModal('log-modal');
}

function saveLogFromForm(event) {
    event.preventDefault();

    const id = document.getElementById('log-id').value || createId();
    const log = {
        id,
        type: document.getElementById('log-type').value,
        datetime: new Date(document.getElementById('log-date').value).toISOString(),
        title: document.getElementById('log-title').value.trim(),
        intensity: Number(document.getElementById('log-intensity').value),
        notes: document.getElementById('log-notes').value.trim()
    };

    const index = state.logs.findIndex((item) => item.id === id);
    if (index >= 0) {
        state.logs[index] = log;
    } else {
        state.logs.push(log);
    }

    persistState();
    closeModals();
    refreshAll();
    showToast('기록이 저장되었습니다');
}

function editLog(id) {
    const log = state.logs.find((item) => item.id === id);
    if (log) openLogModal(log.type, log);
}

function deleteLog(id) {
    if (!confirm('이 기록을 삭제할까요?')) return;
    state.logs = state.logs.filter((log) => log.id !== id);
    persistState();
    refreshAll();
    showToast('기록을 삭제했습니다');
}

function getConcentrationAt(date) {
    const targetTime = date.getTime();
    return state.doses.reduce((total, dose) => {
        const doseTime = new Date(dose.datetime).getTime();
        if (Number.isNaN(doseTime) || doseTime > targetTime) return total;
        const elapsed = targetTime - doseTime;
        return total + Number(dose.amount) * Math.pow(0.5, elapsed / HALF_LIFE_MS);
    }, 0);
}

function updateChart() {
    const canvas = document.getElementById('concentration-chart');
    if (!canvas || !window.Chart) return;

    const data = buildChartData();
    const dosePoints = getSortedDoses('asc').map((dose) => ({
        x: new Date(dose.datetime),
        y: getConcentrationAt(new Date(dose.datetime))
    }));
    const logPoints = state.logs.map((log) => ({
        x: new Date(log.datetime),
        y: getConcentrationAt(new Date(log.datetime)),
        log
    }));

    const datasets = [
        {
            label: '추정 농도',
            data,
            borderColor: '#35c7a5',
            backgroundColor: 'rgba(53, 199, 165, 0.12)',
            fill: true,
            tension: 0.35,
            pointRadius: 0,
            borderWidth: 2
        },
        {
            label: '투약',
            data: dosePoints,
            borderColor: '#5da8ff',
            backgroundColor: '#5da8ff',
            pointRadius: 4,
            pointHoverRadius: 6,
            showLine: false,
            type: 'scatter'
        },
        {
            label: '기록',
            data: logPoints,
            borderColor: '#ffcd6b',
            backgroundColor: '#ffcd6b',
            pointRadius: 4,
            pointHoverRadius: 6,
            showLine: false,
            type: 'scatter'
        }
    ];

    if (!state.chart) {
        state.chart = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'nearest',
                    intersect: false
                },
                plugins: {
                    legend: {
                        labels: { color: '#cbd5e1', boxWidth: 12 }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(5, 10, 20, 0.92)',
                        callbacks: {
                            label(context) {
                                const value = context.parsed.y.toFixed(2);
                                if (context.raw?.log) {
                                    return `${getLogTypeLabel(context.raw.log.type)} · ${context.raw.log.title}: ${value}mg`;
                                }
                                return `${context.dataset.label}: ${value}mg`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: 'day', displayFormats: { day: 'MM/dd' } },
                        ticks: { color: '#aab2c4' },
                        grid: { color: 'rgba(255,255,255,0.08)' }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { color: '#aab2c4' },
                        grid: { color: 'rgba(255,255,255,0.08)' }
                    }
                }
            }
        });
    } else {
        state.chart.data.datasets = datasets;
        state.chart.update();
    }
}

function buildChartData() {
    if (!state.doses.length) {
        const now = new Date();
        return [
            { x: addDays(now, -7), y: 0 },
            { x: now, y: 0 },
            { x: addDays(now, 7), y: 0 }
        ];
    }

    const sorted = getSortedDoses('asc');
    const first = addDays(new Date(sorted[0].datetime), -1);
    const lastDose = new Date(sorted[sorted.length - 1].datetime);
    const end = addDays(new Date(Math.max(Date.now(), lastDose.getTime())), 21);
    const points = [];
    const cursor = new Date(first);

    while (cursor <= end) {
        points.push({ x: new Date(cursor), y: getConcentrationAt(cursor) });
        cursor.setHours(cursor.getHours() + 12);
    }

    return points;
}

function exportJson() {
    downloadFile(
        `wegovy-tracker-${toDateInput(new Date())}.json`,
        JSON.stringify({ doses: state.doses, logs: state.logs }, null, 2),
        'application/json'
    );
}

function exportCsv() {
    const rows = [
        ['type', 'datetime', 'amount_or_title', 'detail', 'intensity', 'concentration_mg']
    ];

    getSortedDoses('asc').forEach((dose) => {
        rows.push([
            'dose',
            dose.datetime,
            `${dose.amount}mg`,
            `${dose.site || ''} ${dose.notes || ''}`.trim(),
            '',
            getConcentrationAt(new Date(dose.datetime)).toFixed(2)
        ]);
    });

    getSortedLogs('asc').forEach((log) => {
        rows.push([
            log.type,
            log.datetime,
            log.title,
            log.notes || '',
            log.intensity,
            getConcentrationAt(new Date(log.datetime)).toFixed(2)
        ]);
    });

    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n');
    downloadFile(`wegovy-tracker-${toDateInput(new Date())}.csv`, csv, 'text/csv;charset=utf-8');
}

function seedDemoData() {
    if (state.doses.length || state.logs.length) {
        if (!confirm('현재 데이터에 예시 데이터를 추가할까요?')) return;
    }

    const now = new Date();
    const start = addDays(now, -42);
    const newDoses = [];

    for (let i = 0; i < 7; i += 1) {
        const date = addDays(start, i * 7);
        date.setHours(9, 0, 0, 0);
        newDoses.push({
            id: createId(),
            datetime: date.toISOString(),
            amount: doseForWeek(i),
            site: i % 2 ? '허벅지' : '복부',
            notes: i === 0 ? '시작 기록' : ''
        });
    }

    const newLogs = [
        {
            id: createId(),
            type: 'good_effect',
            datetime: addDays(now, -29).toISOString(),
            title: '식욕 감소',
            intensity: 4,
            notes: '저녁 식사량이 줄고 간식 생각이 적었음'
        },
        {
            id: createId(),
            type: 'side_effect',
            datetime: addDays(now, -20).toISOString(),
            title: '메스꺼움',
            intensity: 3,
            notes: '아침에 심했고 오후에는 완화'
        },
        {
            id: createId(),
            type: 'low_effect',
            datetime: addDays(now, -7).toISOString(),
            title: '야식 생각',
            intensity: 2,
            notes: '투약 전날 식욕이 다시 올라옴'
        }
    ];

    state.doses.push(...newDoses);
    state.logs.push(...newLogs);
    persistState();
    refreshAll();
    showToast('예시 데이터를 추가했습니다');
}

function resetData() {
    if (!confirm('모든 투약/기록 데이터를 삭제할까요?')) return;
    state.doses = [];
    state.logs = [];
    persistState();
    refreshAll();
    showToast('전체 데이터를 삭제했습니다');
}

function openModal(id) {
    document.getElementById(id).classList.add('open');
    document.getElementById(id).setAttribute('aria-hidden', 'false');
}

function closeModals() {
    document.querySelectorAll('.modal').forEach((modal) => {
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
    });
}

function updateCustomDoseVisibility() {
    const isCustom = document.getElementById('dose-amount').value === 'custom';
    document.getElementById('custom-dose-group').classList.toggle('hidden', !isCustom);
    document.getElementById('custom-dose').required = isCustom;
}

function setDefaultDates() {
    document.getElementById('dose-date').value = toDateTimeInput(new Date());
    document.getElementById('log-date').value = toDateTimeInput(new Date());
    document.getElementById('bulk-start-date').value = toDateInput(new Date());
    updateBulkPreview();
}

function getLastDose() {
    return getSortedDoses()[0] || null;
}

function getSortedDoses(direction = 'desc') {
    return [...state.doses].sort((a, b) => {
        const delta = new Date(a.datetime) - new Date(b.datetime);
        return direction === 'asc' ? delta : -delta;
    });
}

function getSortedLogs(direction = 'desc') {
    return [...state.logs].sort((a, b) => {
        const delta = new Date(a.datetime) - new Date(b.datetime);
        return direction === 'asc' ? delta : -delta;
    });
}

function getLikelyNextDose() {
    const count = state.doses.length;
    return String(doseForWeek(count));
}

function doseForWeek(weekIndex) {
    if (weekIndex < 4) return 0.25;
    if (weekIndex < 8) return 0.5;
    if (weekIndex < 12) return 1;
    if (weekIndex < 16) return 1.7;
    return 2.4;
}

function getLogTypeLabel(type) {
    return {
        side_effect: '부작용',
        good_effect: '효능 좋음',
        low_effect: '효과 적음'
    }[type] || '기록';
}

function formatDose(value) {
    return Number(value).toLocaleString('ko-KR', {
        minimumFractionDigits: Number(value) % 1 === 0 ? 1 : 0,
        maximumFractionDigits: 2
    });
}

function formatDateTime(date) {
    return date.toLocaleString('ko-KR', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function toDateInput(date) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
}

function toDateTimeInput(date) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
}

function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function createId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function csvCell(value) {
    const text = String(value ?? '');
    return `"${text.replace(/"/g, '""')}"`;
}

function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 1800);
}
