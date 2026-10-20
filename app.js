/**
 * SONICMORPH // Rust WASM Audio Converter & Studio Frequency Monitor
 * Core Application Controller
 */

import initWasm, {
    analyze_media,
    decode_audio_for_player,
    convert_audio_file
} from './pkg/converter_engine.js';

// Application State
const state = {
    wasmReady: false,
    queue: [],
    nextId: 1,
    isConvertingBatch: false,

    // Conversion target settings
    settings: {
        format: 'wav',        // 'wav' | 'mp3' | 'ogg'
        channels: 2,          // 0 = keep, 1 = mono, 2 = stereo
        sampleRate: 48000,    // 0 = keep, or 44100, 48000, 96000, etc.
        bitDepth: 16,         // for WAV (8, 16, 24, 32)
        bitrateKbps: 192,     // for MP3 / OGG (64 to 320)
        suffix: '_converted', // user custom filename suffix
        saveToSource: false,  // save directly into source folder
        sourceDirHandle: null // FileSystemDirectoryHandle for direct disk writes
    },

    // Player State
    player: {
        audioCtx: null,
        analyser: null,
        gainNode: null,
        sourceNode: null,
        audioBuffer: null,
        isPlaying: false,
        startTime: 0,
        pauseOffset: 0,
        duration: 0,
        activeItemId: null,
        activeType: 'source', // 'source' | 'converted'
        visualMode: 'bars',   // 'bars' | 'wave' | 'radial'
        peaks: new Float32Array(128).fill(0),
        peakDecay: 0.96,
        isMuted: false,
        volume: 0.9,
    }
};

// DOM Elements
const el = {
    engineStatusIndicator: document.getElementById('engineStatusIndicator'),
    engineStatusText: document.getElementById('engineStatusText'),
    btnLoadSamples: document.getElementById('btnLoadSamples'),

    // Visualizer & Player
    visualizerCanvas: document.getElementById('visualizerCanvas'),
    btnModeBars: document.getElementById('btnModeBars'),
    btnModeWave: document.getElementById('btnModeWave'),
    btnModeRadial: document.getElementById('btnModeRadial'),
    playerTrackTypeBadge: document.getElementById('playerTrackTypeBadge'),
    nowPlayingTitle: document.getElementById('nowPlayingTitle'),
    nowPlayingDetails: document.getElementById('nowPlayingDetails'),
    btnPlayPause: document.getElementById('btnPlayPause'),
    playIcon: document.getElementById('playIcon'),
    pauseIcon: document.getElementById('pauseIcon'),
    btnStop: document.getElementById('btnStop'),
    btnListenSource: document.getElementById('btnListenSource'),
    btnListenConverted: document.getElementById('btnListenConverted'),
    scrubberSlider: document.getElementById('scrubberSlider'),
    timeCurrent: document.getElementById('timeCurrent'),
    timeTotal: document.getElementById('timeTotal'),
    btnMute: document.getElementById('btnMute'),
    volumeSlider: document.getElementById('volumeSlider'),
    dbBarFill: document.getElementById('dbBarFill'),
    dbValueText: document.getElementById('dbValueText'),

    // Workspace & Drop Zone
    dropZone: document.getElementById('dropZone'),
    fileInput: document.getElementById('fileInput'),
    folderInput: document.getElementById('folderInput'),
    btnPickFiles: document.getElementById('btnPickFiles'),
    btnPickFolder: document.getElementById('btnPickFolder'),

    // Settings
    fmtButtons: document.querySelectorAll('.fmt-btn'),
    selectChannels: document.getElementById('selectChannels'),
    selectSampleRate: document.getElementById('selectSampleRate'),
    selectBitDepth: document.getElementById('selectBitDepth'),
    selectBitrate: document.getElementById('selectBitrate'),
    groupBitDepth: document.getElementById('groupBitDepth'),
    groupBitrate: document.getElementById('groupBitrate'),
    labelBitrate: document.getElementById('labelBitrate'),
    chkSaveToSource: document.getElementById('chkSaveToSource'),
    txtFilenameSuffix: document.getElementById('txtFilenameSuffix'),
    suffixPreviewText: document.getElementById('suffixPreviewText'),
    btnConvertAll: document.getElementById('btnConvertAll'),
    btnDownloadAllZip: document.getElementById('btnDownloadAllZip'),

    // Credits Modal
    btnOpenCredits: document.getElementById('btnOpenCredits'),
    creditsModal: document.getElementById('creditsModal'),
    btnCloseCredits: document.getElementById('btnCloseCredits'),
    btnCloseCreditsFooter: document.getElementById('btnCloseCreditsFooter'),

    // Queue
    queueCountBadge: document.getElementById('queueCountBadge'),
    btnClearQueue: document.getElementById('btnClearQueue'),
    queueEmptyState: document.getElementById('queueEmptyState'),
    queueList: document.getElementById('queueList'),
};

// -----------------------------------------------------------------------------
// 1. INITIALIZATION & WASM LOADER
// -----------------------------------------------------------------------------
async function initApp() {
    setupEventListeners();
    setupCanvas();
    updateSuffixPreview();

    try {
        el.engineStatusText.textContent = 'LOADING RUST WASM...';
        await initWasm();
        state.wasmReady = true;

        el.engineStatusIndicator.classList.add('online');
        el.engineStatusText.textContent = 'RUST ENGINE ONLINE';
        console.log('SonicMorph: Rust WASM engine successfully initialized.');
    } catch (err) {
        console.error('Failed to initialize WebAssembly engine:', err);
        el.engineStatusIndicator.classList.remove('online');
        el.engineStatusText.textContent = 'WASM INIT ERROR';
        alert('Failed to initialize Rust WebAssembly engine. Please ensure your browser supports WebAssembly.');
    }
}

// -----------------------------------------------------------------------------
// 2. EVENT LISTENERS SETUP
// -----------------------------------------------------------------------------
function setupEventListeners() {
    // Drop Zone Events
    ['dragenter', 'dragover'].forEach(evtName => {
        el.dropZone.addEventListener(evtName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            el.dropZone.classList.add('drag-active');
        });
    });

    ['dragleave', 'drop'].forEach(evtName => {
        el.dropZone.addEventListener(evtName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            el.dropZone.classList.remove('drag-active');
        });
    });

    el.dropZone.addEventListener('drop', handleDrop);
    el.dropZone.addEventListener('click', (e) => {
        // If clicked on buttons inside drop-zone, let their handlers fire
        if (e.target.closest('button')) return;
        el.fileInput.click();
    });

    el.btnPickFiles.addEventListener('click', (e) => {
        e.stopPropagation();
        el.fileInput.click();
    });

    el.btnPickFolder.addEventListener('click', (e) => {
        e.stopPropagation();
        el.folderInput.click();
    });

    el.fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length) {
            handleSelectedFiles(Array.from(e.target.files));
        }
        el.fileInput.value = '';
    });

    el.folderInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length) {
            handleSelectedFiles(Array.from(e.target.files));
        }
        el.folderInput.value = '';
    });

    // Sample files quick loader
    el.btnLoadSamples.addEventListener('click', loadSampleFiles);

    // Format buttons (WAV / MP3 / OGG)
    el.fmtButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            el.fmtButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const fmt = btn.getAttribute('data-fmt');
            state.settings.format = fmt;
            updateSettingsUI();
            updateAllQueueCardsTarget();
        });
    });

    // Channels selection
    el.selectChannels.addEventListener('change', (e) => {
        state.settings.channels = parseInt(e.target.value, 10);
        updateAllQueueCardsTarget();
    });

    // Sample Rate selection
    el.selectSampleRate.addEventListener('change', (e) => {
        state.settings.sampleRate = parseInt(e.target.value, 10);
        updateAllQueueCardsTarget();
    });

    // Bit depth selection
    el.selectBitDepth.addEventListener('change', (e) => {
        state.settings.bitDepth = parseInt(e.target.value, 10);
        updateAllQueueCardsTarget();
    });

    // Bitrate selection
    el.selectBitrate.addEventListener('change', (e) => {
        state.settings.bitrateKbps = parseInt(e.target.value, 10);
        updateAllQueueCardsTarget();
    });

    // Suffix and Destination
    if (el.txtFilenameSuffix) {
        el.txtFilenameSuffix.addEventListener('input', (e) => {
            state.settings.suffix = e.target.value;
            updateSuffixPreview();
            updateAllQueueCardsTarget();
        });
    }

    if (el.chkSaveToSource) {
        el.chkSaveToSource.addEventListener('change', async (e) => {
            state.settings.saveToSource = e.target.checked;
            if (e.target.checked && window.showDirectoryPicker && !state.settings.sourceDirHandle) {
                try {
                    // Prompt user for folder access
                    state.settings.sourceDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                } catch (err) {
                    console.log('Directory selection cancelled or not supported:', err);
                }
            }
        });
    }

    // Credits Modal
    if (el.btnOpenCredits) {
        el.btnOpenCredits.addEventListener('click', () => {
            el.creditsModal.classList.remove('hidden');
        });
    }
    if (el.btnCloseCredits) {
        el.btnCloseCredits.addEventListener('click', () => {
            el.creditsModal.classList.add('hidden');
        });
    }
    if (el.btnCloseCreditsFooter) {
        el.btnCloseCreditsFooter.addEventListener('click', () => {
            el.creditsModal.classList.add('hidden');
        });
    }
    if (el.creditsModal) {
        el.creditsModal.addEventListener('click', (e) => {
            if (e.target === el.creditsModal) {
                el.creditsModal.classList.add('hidden');
            }
        });
    }

    // Global Actions
    el.btnConvertAll.addEventListener('click', convertAllQueue);
    el.btnDownloadAllZip.addEventListener('click', downloadAllAsZip);
    el.btnClearQueue.addEventListener('click', clearQueue);

    // Audio Player Controls
    el.btnPlayPause.addEventListener('click', togglePlayPause);
    el.btnStop.addEventListener('click', stopAudio);

    el.btnListenSource.addEventListener('click', () => {
        switchAudioSource('source');
    });

    el.btnListenConverted.addEventListener('click', () => {
        switchAudioSource('converted');
    });

    el.scrubberSlider.addEventListener('input', handleScrub);
    el.volumeSlider.addEventListener('input', (e) => {
        setVolume(parseFloat(e.target.value));
    });

    el.btnMute.addEventListener('click', toggleMute);

    // Visualizer mode chips
    [el.btnModeBars, el.btnModeWave, el.btnModeRadial].forEach(chip => {
        chip.addEventListener('click', () => {
            [el.btnModeBars, el.btnModeWave, el.btnModeRadial].forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            state.player.visualMode = chip.getAttribute('data-mode');
        });
    });
}

// -----------------------------------------------------------------------------
// 3. SETTINGS UI UPDATE
// -----------------------------------------------------------------------------
function updateSettingsUI() {
    const fmt = state.settings.format;
    if (fmt === 'wav') {
        el.groupBitDepth.classList.remove('hidden');
        el.groupBitrate.classList.add('hidden');
    } else {
        el.groupBitDepth.classList.add('hidden');
        el.groupBitrate.classList.remove('hidden');
        el.labelBitrate.textContent = fmt.toUpperCase() + ' Target Bitrate';
    }
}

function updateSuffixPreview() {
    if (!el.suffixPreviewText) return;
    const s = state.settings.suffix !== undefined ? state.settings.suffix : '_converted';
    const fmt = state.settings.format;
    el.suffixPreviewText.textContent = `sample${s}.${fmt}`;
}

function getSettingsSummaryText() {
    const fmt = state.settings.format.toUpperCase();
    const chStr = state.settings.channels === 1 ? 'Mono' : (state.settings.channels === 2 ? 'Stereo' : 'Keep Ch');
    const srStr = state.settings.sampleRate > 0 ? `${state.settings.sampleRate / 1000}kHz` : 'Keep Rate';
    const s = state.settings.suffix !== undefined ? state.settings.suffix : '_converted';
    let qualStr = '';
    if (state.settings.format === 'wav') {
        qualStr = `${state.settings.bitDepth}-bit`;
    } else {
        qualStr = `${state.settings.bitrateKbps}kbps`;
    }
    return `-> ${fmt} • ${srStr} • ${chStr} • ${qualStr} • "${s}"`;
}

function updateAllQueueCardsTarget() {
    const summary = getSettingsSummaryText();
    document.querySelectorAll('.target-badge-pill').forEach(pill => {
        pill.textContent = summary;
    });
    updateSuffixPreview();
    updateActionButtonsState();
}

// -----------------------------------------------------------------------------
// 4. DRAG & DROP + FOLDER TRAVERSAL
// -----------------------------------------------------------------------------
async function handleDrop(e) {
    const dt = e.dataTransfer;
    if (!dt) return;

    const files = [];

    // Support recursive folder traversal via webkitGetAsEntry
    if (dt.items && dt.items.length > 0) {
        const queueEntries = [];
        for (let i = 0; i < dt.items.length; i++) {
            const item = dt.items[i];
            if (item.webkitGetAsEntry) {
                const entry = item.webkitGetAsEntry();
                if (entry) queueEntries.push(entry);
            } else if (item.kind === 'file') {
                const f = item.getAsFile();
                if (f) files.push(f);
            }
        }

        if (queueEntries.length > 0) {
            for (const entry of queueEntries) {
                await traverseDirectoryEntry(entry, '', files);
            }
        }
    } else if (dt.files && dt.files.length > 0) {
        for (let i = 0; i < dt.files.length; i++) {
            files.push(dt.files[i]);
        }
    }

    if (files.length > 0) {
        handleSelectedFiles(files);
    }
}

async function traverseDirectoryEntry(entry, currentPath, outFiles) {
    if (entry.isFile) {
        const file = await new Promise((resolve) => entry.file(resolve));
        if (isSupportedAudioFile(file.name)) {
            // Attach relative path property for folder retention
            file.relativePath = currentPath ? `${currentPath}/${file.name}` : file.name;
            outFiles.push(file);
        }
    } else if (entry.isDirectory) {
        const dirReader = entry.createReader();
        const readEntries = async () => {
            return new Promise((resolve) => {
                dirReader.readEntries((entries) => resolve(entries));
            });
        };

        let entries;
        do {
            entries = await readEntries();
            for (const subEntry of entries) {
                const newPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
                await traverseDirectoryEntry(subEntry, newPath, outFiles);
            }
        } while (entries && entries.length > 0);
    }
}

function isSupportedAudioFile(name) {
    const exts = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma'];
    const lower = name.toLowerCase();
    return exts.some(ext => lower.endsWith(ext));
}

// -----------------------------------------------------------------------------
// 5. SAMPLE FILES QUICK LOADER
// -----------------------------------------------------------------------------
async function loadSampleFiles() {
    const samplePaths = [
        { path: 'Samples/MP3/1.mp3', name: '1.mp3' },
        { path: 'Samples/WAV/2.wav', name: '2.wav' },
        { path: 'Samples/OGG/3.ogg', name: '3.ogg' },
    ];

    el.btnLoadSamples.disabled = true;
    el.btnLoadSamples.textContent = 'Loading Samples...';

    const files = [];
    for (const s of samplePaths) {
        try {
            const resp = await fetch(s.path);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const blob = await resp.blob();
            const file = new File([blob], s.name, { type: blob.type || 'audio/*' });
            file.relativePath = s.path;
            files.push(file);
        } catch (err) {
            console.warn(`Could not fetch ${s.path}:`, err);
        }
    }

    el.btnLoadSamples.disabled = false;
    el.btnLoadSamples.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
        Load Samples
    `;

    if (files.length > 0) {
        handleSelectedFiles(files);
    } else {
        alert('Could not load sample files. Make sure the local web server is running and /Samples folder is accessible.');
    }
}

// -----------------------------------------------------------------------------
// 6. QUEUE HANDLING & METADATA ANALYSIS
// -----------------------------------------------------------------------------
async function handleSelectedFiles(fileList) {
    const audioFiles = fileList.filter(f => isSupportedAudioFile(f.name));
    if (audioFiles.length === 0) {
        alert('No supported audio files found. Supported formats include MP3, WAV, OGG, FLAC, AAC.');
        return;
    }

    for (const file of audioFiles) {
        const item = {
            id: state.nextId++,
            file: file,
            name: file.name,
            path: file.relativePath || file.name,
            size: file.size,
            sourceBytes: null,
            metadata: null,
            status: 'analyzing', // 'analyzing', 'ready', 'converting', 'converted', 'error'
            convertedBytes: null,
            convertedBlobUrl: null,
            convertedMeta: null,
            duration: 0,
            error: null,
            timeTakenMs: 0
        };

        state.queue.push(item);
        renderQueueItem(item);
        analyzeQueueItem(item);
    }

    updateQueueUI();
}

async function analyzeQueueItem(item) {
    try {
        const arrayBuf = await item.file.arrayBuffer();
        item.sourceBytes = new Uint8Array(arrayBuf);

        if (state.wasmReady) {
            // Analyze media with Rust Symphonia
            const meta = analyze_media(item.sourceBytes, item.name);
            item.metadata = meta;
            item.duration = meta.duration_seconds || 0;
            item.status = 'ready';
        } else {
            item.status = 'ready';
        }
    } catch (err) {
        console.warn(`Analysis fallback for ${item.name}:`, err);
        item.status = 'ready';
        item.metadata = {
            format: item.name.split('.').pop().toUpperCase(),
            codec: 'Audio Track',
            sample_rate: 44100,
            channels: 2,
            duration_formatted: '00:00',
            duration_seconds: 0,
            file_size_bytes: item.size
        };
    }

    updateQueueCardDOM(item);
    updateActionButtonsState();

    // Auto load first item into player if no item is currently active
    if (!state.player.activeItemId) {
        loadAudioIntoPlayer(item.id, 'source');
    }
}

// -----------------------------------------------------------------------------
// 7. QUEUE RENDERING
// -----------------------------------------------------------------------------
function renderQueueItem(item) {
    el.queueEmptyState.classList.add('hidden');

    const ext = item.name.split('.').pop().toLowerCase();
    const badgeClass = `badge-${ext}`;

    const card = document.createElement('div');
    card.className = 'queue-item-card';
    card.id = `item-card-${item.id}`;

    card.innerHTML = `
        <div class="item-format-badge ${badgeClass}">${ext.toUpperCase()}</div>
        <div class="item-main-info">
            <div class="item-name-row">
                <span class="item-filename" title="${item.path}">${item.path}</span>
                <span class="item-status-pill status-${item.status}" id="status-pill-${item.id}">${item.status}</span>
            </div>
            <div class="item-meta-details" id="meta-details-${item.id}">
                <span class="meta-chip">Analyzing file headers...</span>
            </div>
        </div>
        <div class="item-conversion-preview">
            <div class="target-badge-pill">${getSettingsSummaryText()}</div>
            <div class="item-progress-bar-wrap">
                <div class="item-progress-fill" id="progress-fill-${item.id}"></div>
            </div>
        </div>
        <div class="item-actions">
            <button class="item-action-btn btn-listen" id="btn-listen-src-${item.id}" title="Listen to original source file">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
                Listen
            </button>
            <button class="item-action-btn btn-primary" id="btn-convert-${item.id}" title="Convert this file">
                ⚡ Convert
            </button>
            <button class="item-action-btn btn-download hidden" id="btn-dl-${item.id}" title="Download converted file">
                ⬇ Download
            </button>
            <button class="btn-icon-only" id="btn-del-${item.id}" title="Remove file">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
    `;

    // Item Action Handlers
    card.querySelector(`#btn-listen-src-${item.id}`).addEventListener('click', () => {
        loadAudioIntoPlayer(item.id, 'source');
    });

    card.querySelector(`#btn-convert-${item.id}`).addEventListener('click', () => {
        convertSingleItem(item);
    });

    card.querySelector(`#btn-del-${item.id}`).addEventListener('click', () => {
        removeItemFromQueue(item.id);
    });

    el.queueList.appendChild(card);
}

function updateQueueCardDOM(item) {
    const card = document.getElementById(`item-card-${item.id}`);
    if (!card) return;

    // Status pill
    const statusPill = card.querySelector(`#status-pill-${item.id}`);
    if (statusPill) {
        statusPill.className = `item-status-pill status-${item.status}`;
        statusPill.textContent = item.status === 'converted' && item.timeTakenMs > 0
            ? `Done (${item.timeTakenMs}ms)`
            : item.status;
    }

    // Metadata details
    const metaBox = card.querySelector(`#meta-details-${item.id}`);
    if (metaBox && item.metadata) {
        const m = item.metadata;
        const sizeMb = (item.size / (1024 * 1024)).toFixed(2);
        const chText = m.channels === 1 ? 'Mono' : `${m.channels} Ch`;
        const rateText = `${(m.sample_rate / 1000).toFixed(1)} kHz`;
        const durText = m.duration_formatted || '00:00';
        const bitText = m.bits_per_sample ? `${m.bits_per_sample}-bit` : (m.bitrate_kbps ? `${m.bitrate_kbps} kbps` : '');

        metaBox.innerHTML = `
            <span class="meta-chip"><strong>Rate:</strong> ${rateText}</span>
            <span class="meta-chip"><strong>Ch:</strong> ${chText}</span>
            ${bitText ? `<span class="meta-chip"><strong>Bit:</strong> ${bitText}</span>` : ''}
            <span class="meta-chip"><strong>Dur:</strong> ${durText}</span>
            <span class="meta-chip"><strong>Size:</strong> ${sizeMb} MB</span>
        `;
    }

    // Download button
    const btnDl = card.querySelector(`#btn-dl-${item.id}`);
    const btnConvert = card.querySelector(`#btn-convert-${item.id}`);
    if (item.status === 'converted' && item.convertedBlobUrl) {
        if (btnDl) {
            btnDl.classList.remove('hidden');
            btnDl.onclick = () => {
                downloadFile(item.convertedBlobUrl, getConvertedFilename(item.name));
            };
        }
        if (btnConvert) {
            btnConvert.textContent = '⚡ Re-convert';
        }
    }
}

function updateQueueUI() {
    el.queueCountBadge.textContent = `${state.queue.length} files`;
    if (state.queue.length === 0) {
        el.queueEmptyState.classList.remove('hidden');
    } else {
        el.queueEmptyState.classList.add('hidden');
    }
    updateActionButtonsState();
}

function updateActionButtonsState() {
    const readyItems = state.queue.filter(i => i.status === 'ready' || i.status === 'converted');
    const convertedItems = state.queue.filter(i => i.status === 'converted');

    el.btnConvertAll.disabled = readyItems.length === 0 || state.isConvertingBatch;
    el.btnConvertAll.querySelector('span').textContent = `Convert All (${state.queue.length})`;
    el.btnDownloadAllZip.disabled = convertedItems.length === 0;
}

function removeItemFromQueue(itemId) {
    const index = state.queue.findIndex(i => i.id === itemId);
    if (index !== -1) {
        const item = state.queue[index];
        if (item.convertedBlobUrl) {
            URL.revokeObjectURL(item.convertedBlobUrl);
        }
        state.queue.splice(index, 1);
        const card = document.getElementById(`item-card-${itemId}`);
        if (card) card.remove();
    }

    if (state.player.activeItemId === itemId) {
        stopAudio();
        state.player.activeItemId = null;
        el.nowPlayingTitle.textContent = 'Select any audio file to listen & visualize';
        el.nowPlayingDetails.textContent = 'Frequency: -- | Channels: -- | Format: --';
        el.playerTrackTypeBadge.textContent = 'NO TRACK LOADED';
        el.btnPlayPause.disabled = true;
        el.btnStop.disabled = true;
        el.btnListenSource.disabled = true;
        el.btnListenConverted.disabled = true;
    }

    updateQueueUI();
}

function clearQueue() {
    state.queue.forEach(item => {
        if (item.convertedBlobUrl) URL.revokeObjectURL(item.convertedBlobUrl);
    });
    state.queue = [];
    el.queueList.innerHTML = '';
    stopAudio();
    state.player.activeItemId = null;
    updateQueueUI();
}

// -----------------------------------------------------------------------------
// 8. AUDIO CONVERSION EXECUTION
// -----------------------------------------------------------------------------
function getConvertedFilename(originalName) {
    const lastDot = originalName.lastIndexOf('.');
    const base = lastDot !== -1 ? originalName.slice(0, lastDot) : originalName;
    const s = state.settings.suffix !== undefined ? state.settings.suffix : '_converted';
    return `${base}${s}.${state.settings.format}`;
}

async function saveConvertedToSource(item, convertedBytes) {
    const outName = getConvertedFilename(item.name);

    // 1. If we have a FileSystemDirectoryHandle (User selected or granted permission)
    if (state.settings.sourceDirHandle) {
        try {
            const fileHandle = await state.settings.sourceDirHandle.getFileHandle(outName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(convertedBytes);
            await writable.close();
            console.log(`Saved ${outName} to selected folder via File System Access API`);
            return;
        } catch (err) {
            console.warn('File System Access API error:', err);
        }
    }

    // 2. If running via the local server/executable with path
    try {
        let targetPath = item.path || item.name;
        let parentDir = '';
        const slashIdx = Math.max(targetPath.lastIndexOf('/'), targetPath.lastIndexOf('\\'));
        if (slashIdx !== -1) {
            parentDir = targetPath.slice(0, slashIdx + 1);
        }
        const fullOutPath = parentDir + outName;

        // Convert bytes to base64
        let binary = '';
        const len = convertedBytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(convertedBytes[i]);
        }
        const base64Data = btoa(binary);

        const resp = await fetch('/api/save_file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filepath: fullOutPath,
                base64_data: base64Data
            })
        });

        if (resp.ok) {
            console.log(`Saved ${fullOutPath} directly to disk via native API.`);
            return;
        }
    } catch (_) {
        // Fallback to direct browser download
    }

    // 3. Fallback: trigger direct download
    if (item.convertedBlobUrl) {
        downloadFile(item.convertedBlobUrl, outName);
    }
}

async function convertSingleItem(item) {
    if (!state.wasmReady || !item.sourceBytes) {
        alert('Engine not ready or file data is missing.');
        return;
    }

    item.status = 'converting';
    updateQueueCardDOM(item);

    const progressFill = document.getElementById(`progress-fill-${item.id}`);
    if (progressFill) progressFill.style.width = '30%';

    // Yield to UI to show animation
    await new Promise(r => setTimeout(r, 20));

    const t0 = performance.now();
    try {
        const targetFmt = state.settings.format;
        const targetSr = state.settings.sampleRate;
        const targetCh = state.settings.channels;
        const bitDepth = state.settings.bitDepth;
        const bitrate = state.settings.bitrateKbps;

        // Perform lightning fast Rust conversion
        const convertedBytes = convert_audio_file(
            item.sourceBytes,
            item.name,
            targetFmt,
            targetSr,
            targetCh,
            bitDepth,
            bitrate
        );

        const t1 = performance.now();
        item.timeTakenMs = Math.round(t1 - t0);
        item.convertedBytes = convertedBytes;

        const mimeTypes = {
            wav: 'audio/wav',
            mp3: 'audio/mpeg',
            ogg: 'audio/ogg'
        };
        const blob = new Blob([convertedBytes], { type: mimeTypes[targetFmt] || 'application/octet-stream' });
        if (item.convertedBlobUrl) URL.revokeObjectURL(item.convertedBlobUrl);
        item.convertedBlobUrl = URL.createObjectURL(blob);

        // Analyze converted file for stats
        try {
            item.convertedMeta = analyze_media(convertedBytes, getConvertedFilename(item.name));
        } catch (_) {}

        item.status = 'converted';
        if (progressFill) progressFill.style.width = '100%';

        // Auto-save to source folder if option enabled
        if (state.settings.saveToSource) {
            await saveConvertedToSource(item, convertedBytes);
        }

        // If this item is loaded in the player, enable the "CONVERTED" A/B button!
        if (state.player.activeItemId === item.id) {
            el.btnListenConverted.disabled = false;
        }
    } catch (err) {
        console.error(`Conversion failed for ${item.name}:`, err);
        item.status = 'error';
        item.error = err.toString();
        if (progressFill) progressFill.style.width = '0%';
        alert(`Conversion error for ${item.name}: ${err}`);
    }

    updateQueueCardDOM(item);
    updateActionButtonsState();
}

async function convertAllQueue() {
    const items = state.queue.filter(i => i.status === 'ready' || i.status === 'converted');
    if (items.length === 0) return;

    state.isConvertingBatch = true;
    updateActionButtonsState();

    for (let i = 0; i < items.length; i++) {
        await convertSingleItem(items[i]);
    }

    state.isConvertingBatch = false;
    updateActionButtonsState();
}

function downloadFile(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function downloadAllAsZip() {
    const convertedItems = state.queue.filter(i => i.status === 'converted' && i.convertedBytes);
    if (convertedItems.length === 0) return;

    const zip = new window.SimpleZip();
    for (const item of convertedItems) {
        const outName = getConvertedFilename(item.path.replace(/\//g, '_'));
        zip.addFile(outName, item.convertedBytes);
    }

    const zipBytes = zip.generate();
    const zipBlob = new Blob([zipBytes], { type: 'application/zip' });
    const zipUrl = URL.createObjectURL(zipBlob);
    downloadFile(zipUrl, `Converted_Audio_${Date.now()}.zip`);
    setTimeout(() => URL.revokeObjectURL(zipUrl), 30000);
}

// -----------------------------------------------------------------------------
// 9. STUDIO AUDIO PLAYER & WEB AUDIO API
// -----------------------------------------------------------------------------
function ensureAudioContext() {
    if (!state.player.audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        state.player.audioCtx = new AudioContext();

        // Create AnalyserNode
        const analyser = state.player.audioCtx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.85;
        state.player.analyser = analyser;

        // Create GainNode
        const gainNode = state.player.audioCtx.createGain();
        gainNode.gain.setValueAtTime(state.player.volume, state.player.audioCtx.currentTime);
        state.player.gainNode = gainNode;

        // Connect Analyser -> Gain -> Destination
        analyser.connect(gainNode);
        gainNode.connect(state.player.audioCtx.destination);
    }

    if (state.player.audioCtx.state === 'suspended') {
        state.player.audioCtx.resume();
    }
}

async function loadAudioIntoPlayer(itemId, type = 'source') {
    const item = state.queue.find(i => i.id === itemId);
    if (!item) return;

    ensureAudioContext();
    stopAudio();

    state.player.activeItemId = itemId;
    state.player.activeType = type;

    // Highlight active card
    document.querySelectorAll('.queue-item-card').forEach(c => c.classList.remove('is-active-track'));
    const activeCard = document.getElementById(`item-card-${itemId}`);
    if (activeCard) activeCard.classList.add('is-active-track');

    // Update A/B buttons
    el.btnListenSource.disabled = false;
    el.btnListenConverted.disabled = !item.convertedBytes;

    if (type === 'source') {
        el.btnListenSource.classList.add('active');
        el.btnListenConverted.classList.remove('active');
        el.playerTrackTypeBadge.textContent = 'SOURCE FILE';
    } else {
        el.btnListenSource.classList.remove('active');
        el.btnListenConverted.classList.add('active');
        el.playerTrackTypeBadge.textContent = 'CONVERTED OUTPUT';
    }

    const dataToDecode = type === 'source' ? item.sourceBytes : item.convertedBytes;
    const displayName = type === 'source' ? item.name : getConvertedFilename(item.name);

    if (!dataToDecode) {
        alert('Audio data not available for playback.');
        return;
    }

    el.nowPlayingTitle.textContent = `Loading: ${displayName}...`;

    try {
        // Fast decode with Web Audio API or Rust WASM decode_audio_for_player
        const audioBuffer = await state.player.audioCtx.decodeAudioData(dataToDecode.buffer.slice(0));
        state.player.audioBuffer = audioBuffer;
        state.player.duration = audioBuffer.duration;
        state.player.pauseOffset = 0;

        const srText = `${audioBuffer.sampleRate} Hz`;
        const chText = audioBuffer.numberOfChannels === 1 ? 'Mono' : 'Stereo';
        const durText = formatTime(audioBuffer.duration);

        el.nowPlayingTitle.textContent = displayName;
        el.nowPlayingDetails.textContent = `Rate: ${srText} | Channels: ${chText} | Duration: ${durText}`;
        el.timeTotal.textContent = durText;
        el.timeCurrent.textContent = '00:00';
        el.scrubberSlider.disabled = false;
        el.scrubberSlider.value = 0;

        el.btnPlayPause.disabled = false;
        el.btnStop.disabled = false;

        // Auto play on selection
        playAudio();
    } catch (err) {
        console.error('Audio decode failed:', err);
        el.nowPlayingTitle.textContent = `Decode failed: ${displayName}`;
    }
}

function switchAudioSource(type) {
    if (!state.player.activeItemId) return;
    const currentOffset = getCurrentPlaybackTime();
    loadAudioIntoPlayer(state.player.activeItemId, type).then(() => {
        // Retain playback position when switching A/B!
        if (currentOffset > 0 && currentOffset < state.player.duration) {
            seekAudio(currentOffset);
        }
    });
}

function playAudio() {
    if (!state.player.audioBuffer) return;
    ensureAudioContext();

    if (state.player.isPlaying) {
        stopAudioSourceOnly();
    }

    const source = state.player.audioCtx.createBufferSource();
    source.buffer = state.player.audioBuffer;
    source.connect(state.player.analyser);

    const offset = state.player.pauseOffset % state.player.duration;
    source.start(0, offset);
    state.player.startTime = state.player.audioCtx.currentTime - offset;
    state.player.sourceNode = source;
    state.player.isPlaying = true;

    source.onended = () => {
        if (state.player.isPlaying && getCurrentPlaybackTime() >= state.player.duration - 0.1) {
            stopAudio();
        }
    };

    updatePlayPauseButton(true);
}

function pauseAudio() {
    if (!state.player.isPlaying) return;
    state.player.pauseOffset = state.player.audioCtx.currentTime - state.player.startTime;
    stopAudioSourceOnly();
    state.player.isPlaying = false;
    updatePlayPauseButton(false);
}

function stopAudioSourceOnly() {
    if (state.player.sourceNode) {
        try {
            state.player.sourceNode.onended = null;
            state.player.sourceNode.stop();
            state.player.sourceNode.disconnect();
        } catch (_) {}
        state.player.sourceNode = null;
    }
}

function stopAudio() {
    stopAudioSourceOnly();
    state.player.isPlaying = false;
    state.player.pauseOffset = 0;
    el.scrubberSlider.value = 0;
    el.timeCurrent.textContent = '00:00';
    updatePlayPauseButton(false);
}

function togglePlayPause() {
    if (state.player.isPlaying) {
        pauseAudio();
    } else {
        playAudio();
    }
}

function updatePlayPauseButton(isPlaying) {
    if (isPlaying) {
        el.playIcon.classList.add('hidden');
        el.pauseIcon.classList.remove('hidden');
    } else {
        el.playIcon.classList.remove('hidden');
        el.pauseIcon.classList.add('hidden');
    }
}

function getCurrentPlaybackTime() {
    if (!state.player.isPlaying) return state.player.pauseOffset;
    return state.player.audioCtx.currentTime - state.player.startTime;
}

function handleScrub(e) {
    if (!state.player.duration) return;
    const pct = parseFloat(e.target.value) / 100;
    const targetTime = pct * state.player.duration;
    seekAudio(targetTime);
}

function seekAudio(timeInSec) {
    state.player.pauseOffset = Math.max(0, Math.min(timeInSec, state.player.duration));
    if (state.player.isPlaying) {
        playAudio();
    } else {
        el.timeCurrent.textContent = formatTime(state.player.pauseOffset);
    }
}

function setVolume(val) {
    state.player.volume = val;
    if (state.player.gainNode && !state.player.isMuted) {
        state.player.gainNode.gain.setValueAtTime(val, state.player.audioCtx.currentTime);
    }
}

function toggleMute() {
    state.player.isMuted = !state.player.isMuted;
    if (state.player.gainNode) {
        const val = state.player.isMuted ? 0 : state.player.volume;
        state.player.gainNode.gain.setValueAtTime(val, state.player.audioCtx.currentTime);
    }
    el.btnMute.style.color = state.player.isMuted ? 'var(--accent-red)' : 'var(--text-secondary)';
}

function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// -----------------------------------------------------------------------------
// 10. REAL-TIME FREQUENCY VISUALIZER (60+ FPS CANVAS ENGINE)
// -----------------------------------------------------------------------------
function setupCanvas() {
    const canvas = el.visualizerCanvas;
    const ctx = canvas.getContext('2d');

    function resizeCanvas() {
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * window.devicePixelRatio;
        canvas.height = rect.height * window.devicePixelRatio;
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    const bufferLength = 256;
    const dataArray = new Uint8Array(bufferLength);
    const timeArray = new Uint8Array(bufferLength);

    function renderLoop() {
        requestAnimationFrame(renderLoop);

        const width = canvas.width / window.devicePixelRatio;
        const height = canvas.height / window.devicePixelRatio;

        ctx.clearRect(0, 0, width, height);

        // Update scrubber if playing
        if (state.player.isPlaying && state.player.duration > 0) {
            const cur = getCurrentPlaybackTime();
            const pct = (cur / state.player.duration) * 100;
            el.scrubberSlider.value = pct;
            el.timeCurrent.textContent = formatTime(cur);
        }

        if (!state.player.analyser || !state.player.isPlaying) {
            // Idle ambient animation
            renderIdleAnimation(ctx, width, height);
            return;
        }

        state.player.analyser.getByteFrequencyData(dataArray);
        state.player.analyser.getByteTimeDomainData(timeArray);

        // Calculate RMS & dB Level
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
            const val = (timeArray[i] - 128) / 128;
            sum += val * val;
        }
        const rms = Math.sqrt(sum / bufferLength);
        const db = 20 * Math.log10(Math.max(rms, 0.0001));
        const dbClamped = Math.max(-60, Math.min(0, db));
        const dbPct = ((dbClamped + 60) / 60) * 100;

        if (el.dbBarFill) el.dbBarFill.style.width = `${dbPct}%`;
        if (el.dbValueText) el.dbValueText.textContent = `${dbClamped.toFixed(1)} dB`;

        // Render chosen mode
        if (state.player.visualMode === 'bars') {
            renderSpectrumBars(ctx, dataArray, width, height);
        } else if (state.player.visualMode === 'wave') {
            renderOscilloscope(ctx, timeArray, width, height);
        } else if (state.player.visualMode === 'radial') {
            renderRadialSpectrum(ctx, dataArray, width, height);
        }
    }

    renderLoop();
}

function renderSpectrumBars(ctx, dataArray, width, height) {
    const numBars = 72;
    const barSpacing = 3;
    const totalSpacing = barSpacing * (numBars - 1);
    const barWidth = Math.max(2, (width - 32 - totalSpacing) / numBars);
    const startX = 16;

    for (let i = 0; i < numBars; i++) {
        // Non-linear frequency scaling to emphasize bass and mids
        const freqIndex = Math.floor(Math.pow(i / numBars, 1.4) * (dataArray.length * 0.75));
        const value = dataArray[freqIndex] || 0;
        const barHeight = Math.max(2, (value / 255) * (height - 24));

        const x = startX + i * (barWidth + barSpacing);
        const y = height - barHeight - 12;

        // Peak Hold logic
        if (barHeight > state.player.peaks[i]) {
            state.player.peaks[i] = barHeight;
        } else {
            state.player.peaks[i] *= state.player.peakDecay;
        }

        // Dynamic Color Gradient
        const gradient = ctx.createLinearGradient(0, height, 0, y);
        gradient.addColorStop(0, 'rgba(0, 240, 255, 0.7)');
        gradient.addColorStop(0.5, 'rgba(157, 78, 221, 0.85)');
        gradient.addColorStop(0.85, 'rgba(255, 0, 127, 0.95)');
        gradient.addColorStop(1, '#ffb703');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, [2, 2, 0, 0]);
        ctx.fill();

        // Glowing Peak Cap
        const peakY = height - state.player.peaks[i] - 14;
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 6;
        ctx.fillRect(x, Math.max(4, peakY), barWidth, 2);
        ctx.shadowBlur = 0;
    }
}

function renderOscilloscope(ctx, timeArray, width, height) {
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#00f0ff';
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 12;

    ctx.beginPath();
    const sliceWidth = width / timeArray.length;
    let x = 0;

    for (let i = 0; i < timeArray.length; i++) {
        const v = timeArray[i] / 128.0;
        const y = (v * (height / 2));

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
        x += sliceWidth;
    }

    ctx.stroke();
    ctx.shadowBlur = 0;
}

function renderRadialSpectrum(ctx, dataArray, width, height) {
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(centerX, centerY) * 0.45;
    const numPoints = 64;

    ctx.save();
    ctx.translate(centerX, centerY);

    for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * Math.PI * 2;
        const val = dataArray[i * 2] || 0;
        const len = (val / 255) * (radius * 0.9);

        const x1 = Math.cos(angle) * radius;
        const y1 = Math.sin(angle) * radius;
        const x2 = Math.cos(angle) * (radius + len);
        const y2 = Math.sin(angle) * (radius + len);

        ctx.strokeStyle = `hsl(${(i / numPoints) * 280 + 170}, 100%, 60%)`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
    }

    // Inner glowing ring
    ctx.strokeStyle = '#00f0ff';
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

function renderIdleAnimation(ctx, width, height) {
    const time = Date.now() * 0.002;
    const numBars = 72;
    const barSpacing = 3;
    const totalSpacing = barSpacing * (numBars - 1);
    const barWidth = Math.max(2, (width - 32 - totalSpacing) / numBars);
    const startX = 16;

    for (let i = 0; i < numBars; i++) {
        const wave = Math.sin(time + i * 0.15) * 0.5 + 0.5;
        const barHeight = 4 + wave * 16;
        const x = startX + i * (barWidth + barSpacing);
        const y = height - barHeight - 12;

        ctx.fillStyle = 'rgba(0, 240, 255, 0.15)';
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, [2, 2, 0, 0]);
        ctx.fill();
    }
}

// -----------------------------------------------------------------------------
// 11. BOOTSTRAP APP
// -----------------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', initApp);
