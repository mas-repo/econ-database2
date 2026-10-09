// AI出題 modal.
// The browser only talks to the Apps Script web app in config.js.
// Providers: Poe | OpenRouter. Script property POE_API_KEY is an admin-only
// shared fallback for Poe; optional OPENROUTER_API_KEY is the same for OpenRouter.
// Every other AI user must store their own key in localStorage and send it as
// `poeApiKey` or `openRouterApiKey` (never written to backups or logs).
// Provider, keys, models, modes, and the edited 出題指示 live in localStorage.
// API key / model / provider live in a separate settings modal (API／模型設定).
// Requests send `provider`, `model`, `instruction`, `modeId`, and the matching key.
//
// The implementation is split across js/poe-generate-*.js (order in index.html).
// This file: modes, errors, FOLLOWUP_CHIPS. Multi-turn 追問 (continueGeneration)
// runs in poe-generate-run.js. style-continue must stay identical to
// POE_INSTRUCTION_ in apps-script/Code.gs.

var PoeGenerate = {};
(function (Poe) {
    // Mode prompts live in this one object. style-continue must stay identical
    // to POE_INSTRUCTION_ in apps-script/Code.gs. Names for those ids are
    // repeated there only so the backup sheet can label a row.
    Poe.POE_GENERATION_MODES = [
        {
            id: 'style-continue',
            name: '風格延續・求新',
            prompt: '參考以下題目，撰寫全新的題目，並參考過程題目的風格、用字、句式撰寫解釋。請盡量提供最多的題目。一條題目不一定只涉及一件事件。有沒有甚麼有少許新意的問法？請同樣提供問題與解釋，並說明它創新之處。'
        },
        {
            id: 'vary-examples',
            name: '改例子／數字',
            prompt: '參考以下題目，撰寫全新的題目。這次只需要修改例子或數字，不需要在題型上作出有新意的修改。請保持與參考題相同或非常接近的題型、問法結構與考點，只更換情境、例子或數字，使題目是新的，而不是原句複製。例子必須是中學生能夠理解的日常生活情境，不可包括過於深奧的科學知識或術語。請盡量提供最多的題目。每題都要提供問題與解釋。解釋請參考所附題目的風格、用字與句式。'
        },
        {
            id: 'add-novelty',
            name: '題型加新意',
            prompt: '建基於以下所篩選題目的現有題型，撰寫全新的題目，並在問法、切入角度或情境安排上加上適度的新意。請以參考題的題型為基礎，不要只替換例子或數字，也不必完全改成另一種題型。請盡量提供最多的題目。一條題目不一定只涉及一件事件。每題都要提供問題與解釋，並說明它相對於參考題型的新意在哪裡。解釋請參考所附題目的風格、用字與句式。'
        },
        {
            id: 'different-types',
            name: '截然不同題型',
            prompt: '先辨認以下所篩選題目已經出現的題型與問法格式，然後撰寫全新的題目。每一題都必須使用所篩選題目中沒有出現過的題型或問法格式，目標是提供截然不同的題型，而不是沿用、微調或只改例子。請盡量提供最多的題目，並讓各題的題型彼此也盡量不同。每題都要提供問題與解釋，並說明該題的題型為何與參考題不同、創新之處在哪裡。解釋請使用清晰的中學經濟科用語。'
        }
    ];
    Poe.POE_INSTRUCTION = Poe.POE_GENERATION_MODES[0].prompt;
    // Matches 用戶設定 system default for Poe when no saved model.
    Poe.POE_DEFAULT_MODEL = 'GPT-6.1-Sol';
    Poe.POE_MODELS = ['Claude-Sonnet-5.5', 'GPT-6.1-Sol', 'Gemini-3.8-Flash', 'GLM-5.3-flash', 'GLM-5.3'];
    Poe.OPENROUTER_DEFAULT_MODEL = 'openai/gpt-4o-mini';
    Poe.OPENROUTER_MODELS = [
        'openai/gpt-4o-mini',
        'openai/gpt-4o',
        'google/gemini-2.0-flash-001',
        'anthropic/claude-sonnet-4',
        'google/gemini-2.0-flash-exp:free',
        'openai/gpt-oss-20b:free',
        'nvidia/nemotron-3-ultra-550b-a55b:free'
    ];
    Poe.PROVIDER_POE = 'poe';
    Poe.PROVIDER_OPENROUTER = 'openrouter';
    Poe.INSTRUCTION_MAX = 4000;
    Poe.INSTRUCTION_KEY = 'econ_ai_instruction_v1';
    Poe.MODE_KEY = 'econ_ai_mode_v1';
    Poe.PROVIDER_KEY = 'econ_ai_provider_v1';
    Poe.MODEL_KEY_POE = 'econ_ai_model_poe_v1';
    Poe.MODEL_KEY_OPENROUTER = 'econ_ai_model_openrouter_v1';
    Poe.MODEL_KEY_LEGACY = 'econ_ai_model_v1';
    Poe.API_KEY_POE = 'econ_poe_api_key_v1';
    Poe.API_KEY_OPENROUTER = 'econ_openrouter_api_key_v1';
    Poe.CLIENT_SEND_CAP = 30;
    Poe.LOCAL_KEY = 'econ_poe_generations_v1';
    // One page of personal history and of admin usage. Matches AI_BACKUP_LIST_MAX_.
    Poe.HISTORY_LIMIT = 30;
    // Apps Script runs for up to 6 minutes and only then writes the backup.
    // Aborting at 4 minutes threw away replies that were already saved.
    Poe.GENERATE_WAIT_MS = 375000;
    // Connection-style failures only. Auth, rate limits, and cancellations do not retry.
    Poe.PROXY_RETRY_MAX = 3;
    Poe.PROXY_RETRY_BASE_MS = 1200;
    // Matches AI_BACKUP_CONTENT_CHUNK_CHARS_ when loading a long backup body.
    Poe.BACKUP_CONTENT_CHUNK_CHARS = 40000;
    Poe.ERROR_TEXT = {
        feature_unavailable: '此功能暫不可用。',
        proxy_not_configured: '出題服務尚未完成設定。',
        missing_api_key: '尚未設定 API Key。請按「API／模型設定」輸入金鑰後儲存。',
        no_reference_questions: '沒有可送出的參考題目。請先篩選出含題幹的題目，或改為貼上題目。',
        empty_paste: '請先貼上至少一題題目。',
        missing_references: '找不到當時的參考題。請再選擇來源後出題。',
        rate_limited: '出題次數暫時達到上限，請稍後再試。',
        upstream_error: '出題服務暫時未能回應，請再試一次。',
        upstream_timeout: '出題時間過長而被中斷。可以縮小篩選範圍後再試。',
        bad_request: '無法送出這次請求。',
        server_error: '出題服務發生錯誤，請再試一次。',
        network: '無法連線到出題服務。',
        bad_response: '出題服務有回覆，但內容無法讀取。請再試一次。',
        empty_response: '出題服務沒有回傳內容。請再試一次。',
        save_failed: '題目已產生，但未能寫入這部瀏覽器。',
        empty_followup: '請先輸入追問內容。',
        no_active_reply: '請先完成一次出題，或從過往紀錄開啟一筆回覆。'
    };

    // Shortcut chips fill the follow-up box; user can edit before send.
    Poe.FOLLOWUP_CHIPS = [
        { id: 'same-style', label: '再出一題同風格', text: '請再出一題，風格、難度與題型盡量接近剛才那題。' },
        { id: 'harder', label: '改難啲', text: '請把剛才的題目改得難一點，保持題型與考點相近。' },
        { id: 'easier', label: '改易啲', text: '請把剛才的題目改得易一點，保持題型與考點相近。' },
        { id: 'marking', label: '補標準答案同評分', text: '請為剛才的題目補上標準答案與評分重點／評分準則。' },
        { id: 'to-mc', label: '改成 MC', text: '請把剛才的題目改成選擇題（MC），並提供選項與正確答案。' },
        { id: 'to-text', label: '改成文字題', text: '請把剛才的題目改成文字題（短答／論述），並提供參考答案。' },
        { id: 'fix-n', label: '修正第 N 題', text: '請修正第 1 題：（請說明要改什麼）' }
    ];

    Poe.poeUi = {
        overlay: null,
        settingsOverlay: null,
        busy: false,
        control: null,
        timer: null,
        startedAt: 0,
        records: [],
        activeRecord: null,
        filteredCount: 0,
        pasteCount: 0,
        counting: false,
        trigger: null,
        db: null,
        storeMode: null,
        busyAction: '',
        resultExpanded: false,
        enlargeOverlay: null,
        pinnedQuestion: null,
        pendingTrigger: null,
        defaultSubtitle: '',
        historyQuery: '',
        activeTab: 'compose',
        usageRecords: [],
        usageQuery: '',
        usageActiveId: '',
        usageLoaded: false,
        usageLoading: false,
        usageError: '',
        historyPage: 0,
        historyCursors: [''],
        historyNextAfter: '',
        historyHasMore: false,
        historyLoading: false,
        historyLoadToken: 0,
        historyError: '',
        usagePage: 0,
        usageCursors: [null],
        usageNextAfter: null,
        usageHasMore: false
    };
})(PoeGenerate);
