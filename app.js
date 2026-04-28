const STORAGE_KEY = 'civet-wegovy-tracker-v1';
const HALF_LIFE_DAYS = 7;
const HALF_LIFE_MS = HALF_LIFE_DAYS * 24 * 60 * 60 * 1000;
const WEGOVY_DOSES = [0.25, 0.5, 1, 1.7, 2.4];
const CARTRIDGE_TOTAL_MG = 9.6;
const CARTRIDGE_TOTAL_ML = 3;
const MG_PER_ML = CARTRIDGE_TOTAL_MG / CARTRIDGE_TOTAL_ML;
const GOOGLE_SYNC_STORAGE_KEY = 'civet-wegovy-google-sync-v1';
const GOOGLE_DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const GOOGLE_SYNC_SCOPES = `openid email profile ${GOOGLE_DRIVE_APPDATA_SCOPE}`;
const GOOGLE_SYNC_FILE_NAME = 'civet-wegovy-tracker.json';

let googleTokenClient = null;
let googleTokenResolver = null;
let googleTokenRejecter = null;

const state = {
    doses: [],
    cartridges: [],
    logs: [],
    activeTab: 'home',
    logFilter: 'all',
    chart: null,
    googleSync: {
        profile: null,
        driveFileId: '',
        driveModifiedTime: '',
        lastSyncedAt: '',
        busyAction: '',
        statusTone: 'neutral',
        statusMessage: '이 기기의 기록을 Google Drive appDataFolder에 저장할 수 있습니다.'
    }
};

document.addEventListener('DOMContentLoaded', () => {
    loadState();
    loadGoogleSyncState();
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
        const editCartridgeButton = event.target.closest('[data-edit-cartridge]');
        const deleteCartridgeButton = event.target.closest('[data-delete-cartridge]');
        const useCartridgeButton = event.target.closest('[data-use-cartridge]');

        if (editDoseButton) editDose(editDoseButton.dataset.editDose);
        if (deleteDoseButton) deleteDose(deleteDoseButton.dataset.deleteDose);
        if (editLogButton) editLog(editLogButton.dataset.editLog);
        if (deleteLogButton) deleteLog(deleteLogButton.dataset.deleteLog);
        if (editCartridgeButton) editCartridge(editCartridgeButton.dataset.editCartridge);
        if (deleteCartridgeButton) deleteCartridge(deleteCartridgeButton.dataset.deleteCartridge);
        if (useCartridgeButton) openDoseModal(null, useCartridgeButton.dataset.useCartridge);
    });

    document.getElementById('add-dose-btn').addEventListener('click', () => openDoseModal());
    document.getElementById('bulk-dose-btn').addEventListener('click', openBulkModal);
    document.getElementById('add-log-btn').addEventListener('click', () => openLogModal('side_effect'));
    document.getElementById('add-cartridge-btn').addEventListener('click', () => openCartridgeModal());

    document.getElementById('dose-form').addEventListener('submit', saveDoseFromForm);
    document.getElementById('bulk-form').addEventListener('submit', saveBulkDoses);
    document.getElementById('log-form').addEventListener('submit', saveLogFromForm);
    document.getElementById('cartridge-form').addEventListener('submit', saveCartridgeFromForm);
    document.getElementById('cartridge-adjust-form').addEventListener('submit', saveCartridgeAdjustmentFromForm);

    document.getElementById('dose-amount').addEventListener('change', () => {
        updateCustomDoseVisibility();
        updateDoseVolumeInfo();
    });
    document.getElementById('custom-dose').addEventListener('input', updateDoseVolumeInfo);
    document.getElementById('dose-cartridge').addEventListener('change', updateDoseVolumeInfo);
    document.getElementById('cartridge-adjust-ml').addEventListener('input', updateCartridgeAdjustmentPreview);
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
    document.getElementById('google-connect-btn').addEventListener('click', connectGoogleSync);
    document.getElementById('google-upload-btn').addEventListener('click', uploadGoogleSync);
    document.getElementById('google-download-btn').addEventListener('click', downloadGoogleSync);
    document.getElementById('google-disconnect-btn').addEventListener('click', disconnectGoogleSync);
}

function loadState() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        state.doses = Array.isArray(saved.doses) ? saved.doses : [];
        state.cartridges = Array.isArray(saved.cartridges)
            ? saved.cartridges.map((cartridge) => ({
                ...cartridge,
                manualAdjustments: Array.isArray(cartridge.manualAdjustments) ? cartridge.manualAdjustments : []
            }))
            : [];
        state.logs = Array.isArray(saved.logs) ? saved.logs : [];
    } catch (error) {
        console.error(error);
        state.doses = [];
        state.cartridges = [];
        state.logs = [];
    }
}

function persistState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        doses: state.doses,
        cartridges: state.cartridges,
        logs: state.logs
    }));
}

function loadGoogleSyncState() {
    try {
        const saved = JSON.parse(localStorage.getItem(GOOGLE_SYNC_STORAGE_KEY) || '{}');
        state.googleSync.profile = saved.profile && typeof saved.profile === 'object' ? saved.profile : null;
        state.googleSync.driveFileId = typeof saved.driveFileId === 'string' ? saved.driveFileId : '';
        state.googleSync.driveModifiedTime = typeof saved.driveModifiedTime === 'string' ? saved.driveModifiedTime : '';
        state.googleSync.lastSyncedAt = typeof saved.lastSyncedAt === 'string' ? saved.lastSyncedAt : '';
    } catch (error) {
        console.error(error);
        state.googleSync.profile = null;
        state.googleSync.driveFileId = '';
        state.googleSync.driveModifiedTime = '';
        state.googleSync.lastSyncedAt = '';
    }

    if (!hasGoogleClientId()) {
        state.googleSync.statusTone = 'neutral';
        state.googleSync.statusMessage = 'Google Client ID가 없어서 로그인은 아직 비활성화되어 있습니다.';
    }
}

function persistGoogleSyncState() {
    localStorage.setItem(GOOGLE_SYNC_STORAGE_KEY, JSON.stringify({
        profile: state.googleSync.profile,
        driveFileId: state.googleSync.driveFileId,
        driveModifiedTime: state.googleSync.driveModifiedTime,
        lastSyncedAt: state.googleSync.lastSyncedAt
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
    renderCartridges();
    renderLogs();
    renderRangeSummary();
    renderGoogleSync();
    updateChart();
}

function renderGoogleSync() {
    const chip = document.getElementById('google-sync-chip');
    const account = document.getElementById('google-sync-account');
    const remote = document.getElementById('google-sync-remote');
    const last = document.getElementById('google-sync-last');
    const status = document.getElementById('google-sync-status');
    const connectButton = document.getElementById('google-connect-btn');
    const uploadButton = document.getElementById('google-upload-btn');
    const downloadButton = document.getElementById('google-download-btn');
    const disconnectButton = document.getElementById('google-disconnect-btn');
    const clientReady = hasGoogleClientId();
    const connected = Boolean(state.googleSync.profile);
    const busy = Boolean(state.googleSync.busyAction);

    chip.className = 'chip';
    status.className = `preview-box sync-status ${state.googleSync.statusTone}`;

    if (!clientReady) {
        chip.textContent = '설정 필요';
    } else if (busy) {
        chip.textContent = '동작 중';
    } else if (connected) {
        chip.textContent = '연결됨';
    } else {
        chip.textContent = '미연결';
    }

    account.textContent = connected
        ? [state.googleSync.profile.name, state.googleSync.profile.email].filter(Boolean).join(' · ')
        : '아직 연결되지 않았습니다';
    remote.textContent = state.googleSync.driveModifiedTime
        ? `${formatDateTime(new Date(state.googleSync.driveModifiedTime))} 백업 확인`
        : state.googleSync.driveFileId
            ? 'Drive 파일 연결됨'
            : '아직 백업 파일이 없습니다';
    last.textContent = state.googleSync.lastSyncedAt
        ? formatDateTime(new Date(state.googleSync.lastSyncedAt))
        : '아직 없음';
    status.textContent = state.googleSync.statusMessage;

    connectButton.disabled = busy || !clientReady;
    uploadButton.disabled = busy || !clientReady || !connected;
    downloadButton.disabled = busy || !clientReady || !connected;
    disconnectButton.disabled = busy || !connected;

    connectButton.textContent = state.googleSync.busyAction === 'connect' ? '연결 중...' : 'Google 로그인';
    uploadButton.textContent = state.googleSync.busyAction === 'upload' ? '백업 중...' : '지금 백업';
    downloadButton.textContent = state.googleSync.busyAction === 'download' ? '불러오는 중...' : 'Drive 불러오기';
    disconnectButton.textContent = state.googleSync.busyAction === 'disconnect' ? '해제 중...' : '이 기기 연결 해제';
}

function getGoogleSyncConfig() {
    if (window.CIVET_WEGOVY_GOOGLE_SYNC && typeof window.CIVET_WEGOVY_GOOGLE_SYNC === 'object') {
        return window.CIVET_WEGOVY_GOOGLE_SYNC;
    }
    return {};
}

function getGoogleClientId() {
    const config = getGoogleSyncConfig();
    return typeof config.clientId === 'string' ? config.clientId.trim() : '';
}

function getGoogleDriveSyncFileName() {
    const config = getGoogleSyncConfig();
    return typeof config.driveFileName === 'string' && config.driveFileName.trim()
        ? config.driveFileName.trim()
        : GOOGLE_SYNC_FILE_NAME;
}

function hasGoogleClientId() {
    return Boolean(getGoogleClientId());
}

function setGoogleSyncBusy(action) {
    state.googleSync.busyAction = action;
    renderGoogleSync();
}

function setGoogleSyncStatus(tone, message) {
    state.googleSync.statusTone = tone;
    state.googleSync.statusMessage = message;
    renderGoogleSync();
}

function clearGoogleSyncState() {
    state.googleSync.profile = null;
    state.googleSync.driveFileId = '';
    state.googleSync.driveModifiedTime = '';
    state.googleSync.lastSyncedAt = '';
    localStorage.removeItem(GOOGLE_SYNC_STORAGE_KEY);
}

function ensureGoogleTokenClient() {
    if (!hasGoogleClientId()) {
        throw new Error('Google Client ID가 설정되지 않았습니다');
    }

    if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
        throw new Error('Google 로그인 스크립트가 아직 준비되지 않았습니다');
    }

    if (!googleTokenClient) {
        googleTokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: getGoogleClientId(),
            scope: GOOGLE_SYNC_SCOPES,
            callback: (response) => {
                if (response.error || !response.access_token) {
                    googleTokenRejecter?.(new Error(response.error_description || response.error || 'Google 인증에 실패했습니다'));
                    googleTokenResolver = null;
                    googleTokenRejecter = null;
                    return;
                }
                googleTokenResolver?.(response.access_token);
                googleTokenResolver = null;
                googleTokenRejecter = null;
            },
            error_callback: (error) => {
                googleTokenRejecter?.(new Error(error.message || error.type || 'Google 인증 창을 열지 못했습니다'));
                googleTokenResolver = null;
                googleTokenRejecter = null;
            }
        });
    }

    return googleTokenClient;
}

function requestGoogleAccessToken(prompt = '', loginHint = '') {
    return new Promise((resolve, reject) => {
        googleTokenResolver = (token) => resolve(token);
        googleTokenRejecter = (error) => reject(error);

        ensureGoogleTokenClient().requestAccessToken({
            prompt,
            login_hint: loginHint || undefined
        });
    });
}

async function authorizeGoogle(forcePrompt = false) {
    const prompt = forcePrompt || !state.googleSync.profile ? 'consent' : '';
    const loginHint = prompt === '' ? state.googleSync.profile?.email || '' : '';

    try {
        const accessToken = await requestGoogleAccessToken(prompt, loginHint);
        const profile = await fetchGoogleProfile(accessToken);
        state.googleSync.profile = profile;
        persistGoogleSyncState();
        return { accessToken, profile };
    } catch (error) {
        if (!forcePrompt && state.googleSync.profile) {
            return authorizeGoogle(true);
        }
        throw normalizeGoogleSyncError(error);
    }
}

function normalizeGoogleSyncError(error) {
    const message = error instanceof Error ? error.message : String(error || '');

    if (message.includes('origin_mismatch')) {
        return new Error('이 배포 주소가 Google OAuth 허용 출처에 아직 등록되지 않았습니다');
    }
    if (message.includes('popup_closed')) {
        return new Error('Google 로그인 창이 닫혀 동기화를 완료하지 못했습니다');
    }
    if (message.includes('access_denied')) {
        return new Error('Google Drive 접근 권한이 거부되었습니다');
    }

    return error instanceof Error ? error : new Error('Google 동기화에 실패했습니다');
}

async function googleFetchJson(url, accessToken, init = {}) {
    const response = await fetch(url, {
        ...init,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(init.headers || {})
        }
    });

    if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || 'Google API 요청에 실패했습니다');
    }

    return response.json();
}

function buildGoogleMultipartBody(metadata, payload) {
    const boundary = `civet-wegovy-${crypto.randomUUID?.() || Date.now()}`;
    const body = [
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(payload)}\r\n`,
        `--${boundary}--`
    ].join('');

    return { boundary, body };
}

async function fetchGoogleProfile(accessToken) {
    return googleFetchJson('https://www.googleapis.com/oauth2/v3/userinfo', accessToken);
}

async function getGoogleDriveSyncFile(accessToken) {
    const query = encodeURIComponent(`name='${getGoogleDriveSyncFileName().replace(/'/g, "\\'")}' and trashed=false`);
    const response = await googleFetchJson(
        `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&pageSize=1&q=${query}&fields=files(id,name,modifiedTime,size)`,
        accessToken
    );

    return response.files?.[0] || null;
}

function createGoogleSyncPayload() {
    return {
        version: 1,
        exportedAt: new Date().toISOString(),
        tracker: JSON.parse(JSON.stringify({
            doses: state.doses,
            cartridges: state.cartridges,
            logs: state.logs
        }))
    };
}

function parseGoogleSyncPayload(input) {
    if (!input || typeof input !== 'object') {
        return null;
    }

    const candidate = input;
    if (candidate.version !== 1 || !candidate.exportedAt || !candidate.tracker || typeof candidate.tracker !== 'object') {
        return null;
    }

    return {
        version: 1,
        exportedAt: candidate.exportedAt,
        tracker: {
            doses: Array.isArray(candidate.tracker.doses) ? candidate.tracker.doses : [],
            cartridges: Array.isArray(candidate.tracker.cartridges) ? candidate.tracker.cartridges : [],
            logs: Array.isArray(candidate.tracker.logs) ? candidate.tracker.logs : []
        }
    };
}

async function uploadGoogleDriveSyncPayload(accessToken, payload, existingFileId = '') {
    const metadata = existingFileId
        ? { name: getGoogleDriveSyncFileName() }
        : { name: getGoogleDriveSyncFileName(), parents: ['appDataFolder'] };
    const { boundary, body } = buildGoogleMultipartBody(metadata, payload);
    const url = existingFileId
        ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart&fields=id,name,modifiedTime,size`
        : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,size';

    return googleFetchJson(url, accessToken, {
        method: existingFileId ? 'PATCH' : 'POST',
        headers: {
            'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body
    });
}

async function downloadGoogleDriveSyncPayload(accessToken) {
    const file = await getGoogleDriveSyncFile(accessToken);
    if (!file) {
        return null;
    }

    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    });

    if (!response.ok) {
        throw new Error('Google Drive 백업 파일을 읽지 못했습니다');
    }

    const payload = parseGoogleSyncPayload(await response.json());
    if (!payload) {
        throw new Error('Google Drive 백업 파일 형식이 올바르지 않습니다');
    }

    return { file, payload };
}

function applyGoogleSyncPayload(payload) {
    state.doses = Array.isArray(payload.tracker.doses) ? payload.tracker.doses : [];
    state.cartridges = Array.isArray(payload.tracker.cartridges)
        ? payload.tracker.cartridges.map((cartridge) => ({
            ...cartridge,
            manualAdjustments: Array.isArray(cartridge.manualAdjustments) ? cartridge.manualAdjustments : []
        }))
        : [];
    state.logs = Array.isArray(payload.tracker.logs) ? payload.tracker.logs : [];
    persistState();
    refreshAll();
}

async function connectGoogleSync() {
    if (!hasGoogleClientId()) {
        setGoogleSyncStatus('error', 'Google Client ID가 없어서 로그인할 수 없습니다');
        return;
    }

    try {
        setGoogleSyncBusy('connect');
        setGoogleSyncStatus('neutral', 'Google 계정과 Drive 백업 파일을 확인하는 중입니다');
        const { accessToken, profile } = await authorizeGoogle();
        const driveFile = await getGoogleDriveSyncFile(accessToken);

        state.googleSync.profile = profile;
        state.googleSync.driveFileId = driveFile?.id || '';
        state.googleSync.driveModifiedTime = driveFile?.modifiedTime || '';
        persistGoogleSyncState();

        setGoogleSyncStatus(
            'success',
            driveFile
                ? 'Google 연결이 완료되었습니다. 기존 Drive 백업 파일도 확인했습니다.'
                : 'Google 연결이 완료되었습니다. 이제 현재 데이터를 Drive에 백업할 수 있습니다.'
        );
    } catch (error) {
        setGoogleSyncStatus('error', normalizeGoogleSyncError(error).message);
    } finally {
        setGoogleSyncBusy('');
    }
}

async function uploadGoogleSync() {
    if (!state.googleSync.profile) {
        setGoogleSyncStatus('error', '먼저 Google 로그인부터 연결하세요');
        return;
    }

    try {
        setGoogleSyncBusy('upload');
        setGoogleSyncStatus('neutral', '현재 기기 데이터를 Google Drive에 저장하고 있습니다');
        const { accessToken, profile } = await authorizeGoogle();
        const payload = createGoogleSyncPayload();
        const file = await uploadGoogleDriveSyncPayload(accessToken, payload, state.googleSync.driveFileId);

        state.googleSync.profile = profile;
        state.googleSync.driveFileId = file.id;
        state.googleSync.driveModifiedTime = file.modifiedTime || '';
        state.googleSync.lastSyncedAt = payload.exportedAt;
        persistGoogleSyncState();

        setGoogleSyncStatus('success', '현재 기기 데이터를 Google Drive 숨김 앱 폴더에 백업했습니다');
    } catch (error) {
        setGoogleSyncStatus('error', normalizeGoogleSyncError(error).message);
    } finally {
        setGoogleSyncBusy('');
    }
}

async function downloadGoogleSync() {
    if (!state.googleSync.profile) {
        setGoogleSyncStatus('error', '먼저 Google 로그인부터 연결하세요');
        return;
    }

    try {
        setGoogleSyncBusy('download');
        setGoogleSyncStatus('neutral', 'Google Drive 백업을 확인하고 있습니다');
        const { accessToken, profile } = await authorizeGoogle();
        const result = await downloadGoogleDriveSyncPayload(accessToken);

        if (!result) {
            setGoogleSyncStatus('neutral', 'Google Drive에 아직 저장된 백업 파일이 없습니다');
            return;
        }

        const backupTime = result.file.modifiedTime || result.payload.exportedAt;
        const message = `Drive 백업 ${formatDateTime(new Date(backupTime))}을 현재 기기에 불러올까요? 현재 기기 데이터는 전체 교체됩니다.`;
        if (!confirm(message)) {
            setGoogleSyncStatus('neutral', 'Drive 백업 불러오기를 취소했습니다');
            return;
        }

        applyGoogleSyncPayload(result.payload);
        state.googleSync.profile = profile;
        state.googleSync.driveFileId = result.file.id;
        state.googleSync.driveModifiedTime = result.file.modifiedTime || '';
        state.googleSync.lastSyncedAt = result.payload.exportedAt;
        persistGoogleSyncState();

        setGoogleSyncStatus('success', 'Google Drive 백업을 현재 기기에 불러왔습니다');
    } catch (error) {
        setGoogleSyncStatus('error', normalizeGoogleSyncError(error).message);
    } finally {
        setGoogleSyncBusy('');
    }
}

function disconnectGoogleSync() {
    setGoogleSyncBusy('disconnect');
    clearGoogleSyncState();
    googleTokenClient = null;
    setGoogleSyncStatus('neutral', '이 기기에서만 Google 연결 정보를 지웠습니다. Drive 백업 파일은 그대로 남아 있습니다.');
    setGoogleSyncBusy('');
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
    const currentCartridge = getCurrentCartridge();
    const cartridgeInsight = currentCartridge
        ? (() => {
            const usage = getCartridgeUsage(currentCartridge);
            return `
                <div class="insight-row">
                    <span>현재 카트리지</span>
                    <strong>${escapeHtml(currentCartridge.name)} · ${formatDose(usage.remainingMg)}mg / ${formatMl(usage.remainingMl)}mL</strong>
                </div>
            `;
        })()
        : '';
    const latestLogs = [...state.logs]
        .sort((a, b) => new Date(b.datetime) - new Date(a.datetime))
        .slice(0, 1);
    const logText = latestLogs.length
        ? `${getLogTypeLabel(latestLogs[0].type)} · ${latestLogs[0].title}`
        : '아직 증상/효능 기록 없음';

    return `
        <div class="insight-row">
            <span>마지막 용량</span>
            <strong>${formatDose(lastDose.amount)}mg / ${formatMl(doseToMl(lastDose.amount))}mL · ${lastDose.site || '부위 미기록'}</strong>
        </div>
        <div class="insight-row">
            <span>다음 예정</span>
            <strong>${formatDateTime(nextDate)}</strong>
        </div>
        <div class="insight-row">
            <span>추정 잔존량</span>
            <strong>${concentration.toFixed(2)}mg</strong>
        </div>
        ${cartridgeInsight}
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
        const cartridge = dose.cartridgeId ? getCartridgeById(dose.cartridgeId) : null;
        const doseMl = doseToMl(dose.amount);

        return `
            <article class="list-item">
                <div class="item-main">
                    <div class="item-date">${formatDateTime(new Date(dose.datetime))}</div>
                    <div class="item-title-row">
                        <span class="item-title">${formatDose(dose.amount)}mg</span>
                        <span class="status-badge">${formatMl(doseMl)}mL</span>
                    </div>
                    <div class="item-meta">${intervalText} · ${dose.site || '부위 미기록'} · ${cartridge ? `${escapeHtml(cartridge.name)} 연결` : '카트리지 미연결'} · 당시 농도 ${getConcentrationAt(new Date(dose.datetime)).toFixed(2)}mg</div>
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

function renderCartridges() {
    const container = document.getElementById('cartridge-list');
    const cartridges = getSortedCartridges();
    const activeCartridges = cartridges.filter((cartridge) => getCartridgeUsage(cartridge).remainingMg > 0.000001);
    const totalRemainingMg = cartridges.reduce((sum, cartridge) => sum + getCartridgeUsage(cartridge).remainingMg, 0);
    const totalRemainingMl = cartridges.reduce((sum, cartridge) => sum + getCartridgeUsage(cartridge).remainingMl, 0);

    document.getElementById('cartridge-total-count').textContent = cartridges.length;
    document.getElementById('cartridge-active-count').textContent = activeCartridges.length;
    document.getElementById('cartridge-remaining-mg').textContent = formatDose(totalRemainingMg);
    document.getElementById('cartridge-remaining-ml').textContent = formatMl(totalRemainingMl);

    if (!cartridges.length) {
        container.innerHTML = `
            <div class="empty-state">
                <strong>등록된 카트리지가 없습니다</strong><br>
                9.6mg / 3mL 카트리지를 추가하면 투약 때마다 남은 mg와 mL가 자동 계산됩니다
            </div>
        `;
        return;
    }

    container.innerHTML = cartridges.map((cartridge) => {
        const usage = getCartridgeUsage(cartridge);
        const isEmpty = usage.remainingMg <= 0.000001;
        const statusText = isEmpty ? '소진됨' : `${usage.totalEventCount}건 기록`;
        const recentManual = usage.recentManualAdjustment
            ? `${formatDateTime(new Date(usage.recentManualAdjustment.datetime))} · ${formatMl(usage.recentManualAdjustment.amountMl)}mL${usage.recentManualAdjustment.note ? ` · ${escapeHtml(usage.recentManualAdjustment.note)}` : ''}`
            : '';

        return `
            <article class="list-item">
                <div class="item-main">
                    <div class="item-date">개봉 ${formatDateOnly(new Date(cartridge.openedDate))}</div>
                    <div class="item-title-row">
                        <span class="item-title">${escapeHtml(cartridge.name)}</span>
                        <span class="status-badge">${statusText}</span>
                    </div>
                    <div class="item-meta">남은 용량 ${formatDose(usage.remainingMg)}mg / ${formatMl(usage.remainingMl)}mL · 사용 ${usage.usagePercent.toFixed(0)}%</div>
                    <div class="cartridge-meta-grid">
                        <div class="cartridge-meta">
                            <div class="cartridge-meta-label">총 규격</div>
                            <div class="cartridge-meta-value">${CARTRIDGE_TOTAL_MG}mg / ${formatMl(CARTRIDGE_TOTAL_ML)}mL</div>
                        </div>
                        <div class="cartridge-meta">
                            <div class="cartridge-meta-label">연결 투약</div>
                            <div class="cartridge-meta-value">${usage.linkedDoseCount}건</div>
                        </div>
                        <div class="cartridge-meta">
                            <div class="cartridge-meta-label">수동 차감</div>
                            <div class="cartridge-meta-value">${usage.manualAdjustmentCount}건 / ${formatMl(usage.manualUsedMl)}mL</div>
                        </div>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" data-progress="${usage.usagePercent}"></div>
                    </div>
                    ${recentManual ? `<div class="item-notes">최근 수동 차감: ${recentManual}</div>` : ''}
                    ${cartridge.notes ? `<div class="item-notes">${escapeHtml(cartridge.notes)}</div>` : ''}
                </div>
                <div class="item-actions">
                    <button class="item-edit" data-use-cartridge="${cartridge.id}">투약</button>
                    <button class="item-edit" data-edit-cartridge="${cartridge.id}">설정</button>
                    <button class="item-delete" data-delete-cartridge="${cartridge.id}">삭제</button>
                </div>
            </article>
        `;
    }).join('');

    container.querySelectorAll('.progress-fill').forEach((fill) => {
        fill.style.width = `${fill.dataset.progress}%`;
    });
}

function getSortedCartridges() {
    return [...state.cartridges].sort((a, b) => {
        const aUsage = getCartridgeUsage(a);
        const bUsage = getCartridgeUsage(b);
        const aActive = aUsage.remainingMg > 0.000001;
        const bActive = bUsage.remainingMg > 0.000001;
        if (aActive !== bActive) return aActive ? -1 : 1;
        return new Date(b.openedDate) - new Date(a.openedDate);
    });
}

function getCartridgeById(id) {
    return state.cartridges.find((cartridge) => cartridge.id === id) || null;
}

function getCartridgeUsage(cartridge, excludedDoseId = '') {
    const linkedDoses = state.doses.filter((dose) => dose.cartridgeId === cartridge.id && dose.id !== excludedDoseId);
    const manualAdjustments = Array.isArray(cartridge.manualAdjustments) ? cartridge.manualAdjustments : [];
    const usedMg = linkedDoses.reduce((sum, dose) => sum + Number(dose.amount || 0), 0);
    const usedMl = linkedDoses.reduce((sum, dose) => sum + doseToMl(Number(dose.amount || 0)), 0);
    const manualUsedMl = manualAdjustments.reduce((sum, adjustment) => sum + Number(adjustment.amountMl || 0), 0);
    const manualUsedMg = manualUsedMl * MG_PER_ML;
    const totalUsedMg = usedMg + manualUsedMg;
    const totalUsedMl = usedMl + manualUsedMl;
    const remainingMg = Math.max(0, CARTRIDGE_TOTAL_MG - totalUsedMg);
    const remainingMl = Math.max(0, CARTRIDGE_TOTAL_ML - totalUsedMl);
    const usagePercent = Math.min(100, (totalUsedMl / CARTRIDGE_TOTAL_ML) * 100);
    const recentManualAdjustment = [...manualAdjustments].sort((a, b) => new Date(b.datetime) - new Date(a.datetime))[0] || null;

    return {
        linkedDoseCount: linkedDoses.length,
        manualAdjustmentCount: manualAdjustments.length,
        totalEventCount: linkedDoses.length + manualAdjustments.length,
        usedMg,
        usedMl,
        manualUsedMg,
        manualUsedMl,
        totalUsedMg,
        totalUsedMl,
        remainingMg,
        remainingMl,
        usagePercent,
        recentManualAdjustment
    };
}

function getCurrentCartridge() {
    const lastLinkedDose = getSortedDoses().find((dose) => dose.cartridgeId && getCartridgeById(dose.cartridgeId));
    if (lastLinkedDose) {
        const candidate = getCartridgeById(lastLinkedDose.cartridgeId);
        if (candidate) return candidate;
    }

    return getSortedCartridges()[0] || null;
}

function openDoseModal(dose = null, preferredCartridgeId = '') {
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

    renderDoseCartridgeOptions(dose?.cartridgeId || preferredCartridgeId || getDefaultCartridgeId());
    updateCustomDoseVisibility();
    updateDoseVolumeInfo();
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

    const cartridgeId = document.getElementById('dose-cartridge').value;
    if (cartridgeId) {
        const cartridge = getCartridgeById(cartridgeId);
        if (!cartridge) {
            showToast('선택한 카트리지를 찾을 수 없습니다');
            return;
        }
        const usage = getCartridgeUsage(cartridge, id);
        if (amount - usage.remainingMg > 0.000001) {
            showToast('선택한 카트리지 잔량보다 투약량이 큽니다');
            return;
        }
    }

    const dose = {
        id,
        datetime: new Date(document.getElementById('dose-date').value).toISOString(),
        amount,
        cartridgeId,
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
        시작 ${start} · 마지막 예상 용량 ${formatDose(lastDose)}mg (${formatMl(doseToMl(lastDose))}mL)
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
                cartridgeId: '',
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

function openCartridgeModal(cartridge = null) {
    document.getElementById('cartridge-form').reset();
    document.getElementById('cartridge-id').value = cartridge?.id || '';
    document.getElementById('cartridge-modal-title').textContent = cartridge ? '카트리지 설정' : '카트리지 추가';
    document.getElementById('cartridge-name').value = cartridge?.name || `카트리지 ${state.cartridges.length + 1}`;
    document.getElementById('cartridge-opened-date').value = cartridge?.openedDate || toDateInput(new Date());
    document.getElementById('cartridge-notes').value = cartridge?.notes || '';
    document.getElementById('cartridge-adjust-id').value = cartridge?.id || '';
    document.getElementById('cartridge-adjust-datetime').value = toDateTimeInput(new Date());
    document.getElementById('cartridge-adjust-ml').value = '';
    document.getElementById('cartridge-adjust-note').value = '';

    const adjustSection = document.getElementById('cartridge-adjust-section');
    if (cartridge) {
        adjustSection.classList.remove('hidden');
        updateCartridgeAdjustmentPreview(cartridge.id);
    } else {
        adjustSection.classList.add('hidden');
        document.getElementById('cartridge-adjust-summary').innerHTML = '';
        document.getElementById('cartridge-adjust-preview').innerHTML = '';
    }

    openModal('cartridge-modal');
}

function saveCartridgeFromForm(event) {
    event.preventDefault();

    const id = document.getElementById('cartridge-id').value || createId();
    const index = state.cartridges.findIndex((item) => item.id === id);
    const cartridge = {
        id,
        name: document.getElementById('cartridge-name').value.trim(),
        openedDate: document.getElementById('cartridge-opened-date').value,
        notes: document.getElementById('cartridge-notes').value.trim(),
        manualAdjustments: index >= 0
            ? (Array.isArray(state.cartridges[index].manualAdjustments) ? state.cartridges[index].manualAdjustments : [])
            : []
    };

    if (index >= 0) {
        state.cartridges[index] = cartridge;
    } else {
        state.cartridges.push(cartridge);
    }

    persistState();
    closeModals();
    refreshAll();
    showToast('카트리지가 저장되었습니다');
}

function saveCartridgeAdjustmentFromForm(event) {
    event.preventDefault();

    const cartridgeId = document.getElementById('cartridge-adjust-id').value;
    const cartridge = getCartridgeById(cartridgeId);
    if (!cartridge) {
        showToast('카트리지를 찾을 수 없습니다');
        return;
    }

    const amountMl = Number(document.getElementById('cartridge-adjust-ml').value);
    if (!Number.isFinite(amountMl) || amountMl <= 0) {
        showToast('차감할 mL를 확인하세요');
        return;
    }

    const usage = getCartridgeUsage(cartridge);
    if (amountMl - usage.remainingMl > 0.000001) {
        showToast('남아 있는 mL보다 크게 차감할 수 없습니다');
        return;
    }

    const adjustment = {
        id: createId(),
        datetime: new Date(document.getElementById('cartridge-adjust-datetime').value).toISOString(),
        amountMl,
        amountMg: amountMl * MG_PER_ML,
        note: document.getElementById('cartridge-adjust-note').value.trim()
    };

    cartridge.manualAdjustments = Array.isArray(cartridge.manualAdjustments) ? cartridge.manualAdjustments : [];
    cartridge.manualAdjustments.push(adjustment);

    persistState();
    document.getElementById('cartridge-adjust-ml').value = '';
    document.getElementById('cartridge-adjust-note').value = '';
    document.getElementById('cartridge-adjust-datetime').value = toDateTimeInput(new Date());
    updateCartridgeAdjustmentPreview(cartridge.id);
    refreshAll();
    showToast('수동 차감이 저장되었습니다');
}

function editCartridge(id) {
    const cartridge = getCartridgeById(id);
    if (cartridge) openCartridgeModal(cartridge);
}

function deleteCartridge(id) {
    const usage = getCartridgeById(id) ? getCartridgeUsage(getCartridgeById(id)) : null;
    const linkedCount = usage?.linkedDoseCount || 0;
    const manualCount = usage?.manualAdjustmentCount || 0;
    const message = linkedCount
        ? `이 카트리지를 삭제하면 연결된 투약 ${linkedCount}건의 카트리지 연결이 해제됩니다.${manualCount ? ` 수동 차감 ${manualCount}건도 함께 삭제됩니다.` : ''} 계속할까요?`
        : manualCount
            ? `이 카트리지를 삭제하면 수동 차감 ${manualCount}건도 함께 삭제됩니다. 계속할까요?`
            : '이 카트리지를 삭제할까요?';

    if (!confirm(message)) return;

    state.doses = state.doses.map((dose) => (
        dose.cartridgeId === id ? { ...dose, cartridgeId: '' } : dose
    ));
    state.cartridges = state.cartridges.filter((cartridge) => cartridge.id !== id);

    persistState();
    refreshAll();
    showToast('카트리지를 삭제했습니다');
}

function renderDoseCartridgeOptions(selectedId = '') {
    const select = document.getElementById('dose-cartridge');
    const currentDoseId = document.getElementById('dose-id').value;
    const options = [
        '<option value="">연결 안 함</option>',
        ...getSortedCartridges().map((cartridge) => {
            const usage = getCartridgeUsage(cartridge, currentDoseId);
            const selected = selectedId === cartridge.id ? ' selected' : '';
            return `<option value="${cartridge.id}"${selected}>${escapeHtml(cartridge.name)} · ${formatDose(usage.remainingMg)}mg / ${formatMl(usage.remainingMl)}mL 남음</option>`;
        })
    ];
    select.innerHTML = options.join('');
}

function updateCartridgeAdjustmentPreview(forcedCartridgeId = '') {
    const cartridgeId = forcedCartridgeId || document.getElementById('cartridge-adjust-id').value;
    const summary = document.getElementById('cartridge-adjust-summary');
    const preview = document.getElementById('cartridge-adjust-preview');
    const cartridge = getCartridgeById(cartridgeId);

    if (!cartridge) {
        summary.innerHTML = '카트리지를 찾을 수 없습니다';
        preview.innerHTML = '차감 정보를 입력하세요';
        return;
    }

    const usage = getCartridgeUsage(cartridge);
    const amountMl = Number(document.getElementById('cartridge-adjust-ml').value);

    summary.innerHTML = [
        `${escapeHtml(cartridge.name)} 현재 잔량`,
        `${formatDose(usage.remainingMg)}mg / ${formatMl(usage.remainingMl)}mL`
    ].join('<br>');

    if (!Number.isFinite(amountMl) || amountMl <= 0) {
        preview.innerHTML = '차감할 mL를 입력하면 저장 후 잔량이 표시됩니다';
        return;
    }

    const amountMg = amountMl * MG_PER_ML;
    const remainingAfterMl = usage.remainingMl - amountMl;
    const remainingAfterMg = usage.remainingMg - amountMg;
    const lines = [
        `이번 수동 차감: ${formatMl(amountMl)}mL = ${formatDose(amountMg)}mg`
    ];

    if (remainingAfterMl < -0.000001) {
        lines.push('남아 있는 mL보다 크게 차감할 수 없습니다');
    } else {
        lines.push(`저장 후 예상 잔량: ${formatDose(Math.max(remainingAfterMg, 0))}mg / ${formatMl(Math.max(remainingAfterMl, 0))}mL`);
    }

    preview.innerHTML = lines.join('<br>');
}

function updateDoseVolumeInfo() {
    const preview = document.getElementById('dose-volume-info');
    const amount = getDoseFormAmount();

    if (!Number.isFinite(amount) || amount <= 0) {
        preview.innerHTML = '용량을 선택하면 이번 투약의 mL와 카트리지 차감량이 표시됩니다';
        return;
    }

    const doseMl = doseToMl(amount);
    const cartridgeId = document.getElementById('dose-cartridge').value;
    const currentDoseId = document.getElementById('dose-id').value;
    const lines = [`이번 투약: ${formatDose(amount)}mg = ${formatMl(doseMl)}mL`];

    if (cartridgeId) {
        const cartridge = getCartridgeById(cartridgeId);
        if (cartridge) {
            const usage = getCartridgeUsage(cartridge, currentDoseId);
            const remainingAfterMg = usage.remainingMg - amount;
            const remainingAfterMl = usage.remainingMl - doseMl;
            lines.push(`저장 후 예상 잔량: ${formatDose(Math.max(remainingAfterMg, 0))}mg / ${formatMl(Math.max(remainingAfterMl, 0))}mL`);
            if (remainingAfterMg < -0.000001) {
                lines.push('선택한 카트리지 잔량보다 큽니다');
            }
        }
    } else if (state.cartridges.length) {
        lines.push('카트리지를 연결하면 남은 mg와 mL가 자동으로 차감됩니다');
    } else {
        lines.push('설정 탭에서 카트리지를 추가하면 나눠맞기 추적이 됩니다');
    }

    preview.innerHTML = lines.join('<br>');
}

function getDoseFormAmount() {
    const selectedAmount = document.getElementById('dose-amount').value;
    if (selectedAmount === 'custom') {
        return Number(document.getElementById('custom-dose').value);
    }
    return Number(selectedAmount);
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
        JSON.stringify({ doses: state.doses, cartridges: state.cartridges, logs: state.logs }, null, 2),
        'application/json'
    );
}

function exportCsv() {
    const rows = [
        ['type', 'datetime', 'amount_or_title', 'volume_ml', 'cartridge', 'detail', 'intensity', 'concentration_mg']
    ];

    getSortedDoses('asc').forEach((dose) => {
        const cartridge = dose.cartridgeId ? getCartridgeById(dose.cartridgeId) : null;
        rows.push([
            'dose',
            dose.datetime,
            `${dose.amount}mg`,
            formatMl(doseToMl(dose.amount)),
            cartridge ? cartridge.name : '',
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
            '',
            '',
            log.notes || '',
            log.intensity,
            getConcentrationAt(new Date(log.datetime)).toFixed(2)
        ]);
    });

    getSortedCartridges().forEach((cartridge) => {
        (Array.isArray(cartridge.manualAdjustments) ? cartridge.manualAdjustments : [])
            .slice()
            .sort((a, b) => new Date(a.datetime) - new Date(b.datetime))
            .forEach((adjustment) => {
                rows.push([
                    'cartridge_adjustment',
                    adjustment.datetime,
                    `${formatDose(adjustment.amountMg || (Number(adjustment.amountMl || 0) * MG_PER_ML))}mg`,
                    formatMl(adjustment.amountMl || 0),
                    cartridge.name,
                    adjustment.note || '',
                    '',
                    ''
                ]);
            });
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
    const demoCartridgeId = createId();
    const newDoses = [];

    for (let i = 0; i < 7; i += 1) {
        const date = addDays(start, i * 7);
        date.setHours(9, 0, 0, 0);
        newDoses.push({
            id: createId(),
            datetime: date.toISOString(),
            amount: doseForWeek(i),
            cartridgeId: demoCartridgeId,
            site: i % 2 ? '허벅지' : '복부',
            notes: i === 0 ? '시작 기록' : ''
        });
    }

    state.cartridges.push({
        id: demoCartridgeId,
        name: '예시 카트리지',
        openedDate: toDateInput(start),
        notes: '예시 데이터용 9.6mg / 3mL 카트리지',
        manualAdjustments: []
    });

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
    state.cartridges = [];
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
    document.getElementById('cartridge-opened-date').value = toDateInput(new Date());
    document.getElementById('cartridge-adjust-datetime').value = toDateTimeInput(new Date());
    document.getElementById('log-date').value = toDateTimeInput(new Date());
    document.getElementById('bulk-start-date').value = toDateInput(new Date());
    updateBulkPreview();
    updateDoseVolumeInfo();
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

function getDefaultCartridgeId() {
    const currentCartridge = getCurrentCartridge();
    const usage = currentCartridge ? getCartridgeUsage(currentCartridge) : null;
    return usage && usage.remainingMg > 0.000001 ? currentCartridge.id : '';
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

function formatMl(value) {
    return Number(value).toFixed(3);
}

function doseToMl(value) {
    return Number(value) / MG_PER_ML;
}

function formatDateTime(date) {
    return date.toLocaleString('ko-KR', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatDateOnly(date) {
    return date.toLocaleDateString('ko-KR', {
        month: '2-digit',
        day: '2-digit'
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
