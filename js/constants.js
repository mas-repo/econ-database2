/* ============================================
   Constants and Static Data
   ============================================ */
// Dependencies: None (core constants file)

// Printed when the page loads. Bump this on every change so a reader can
// tell whether the open tab is current. Do not keep a changelog here.
const APP_VERSION = '2026.09.30.11';
console.log('Question bank version:', APP_VERSION);

// Local username → role map for this JSON-backed bank.
// Colleagues do not see Mock Test questions (publisher 雅集 / id MT…).
const LOCAL_USERS = {
    vicky: { displayName: 'Vicky', userGroup: 'Colleagues', canViewMockTests: false },
    sarah: { displayName: 'Sarah', userGroup: 'Colleagues', canViewMockTests: false }
};

const DEFAULT_LOCAL_USER = {
    userGroup: 'Local',
    canViewMockTests: true
};

// Question-number slider (last digits of the id, e.g. …-01 → 1)
const QUESTION_NUMBER_RANGE = {
    min: 1,
    max: 60
};

// Curriculum classifications
const CURRICULUM_ITEMS = [
    'A 基本經濟概念',
    'B 廠商與生產',
    'C 市場與價格',
    'D 競爭與市場結構',
    'E 效率、公平和政府的角色',
    'F 經濟表現的量度',
    'G 國民收入決定及價格水平',
    'H 貨幣與銀行',
    'I 宏觀經濟問題和政府',
    'J 國際貿易和金融',
    'E1 選修單元一',
    'E2 選修單元二',
    '未分類'
];

// Curriculum mapping (short code to full name)
const CURRICULUM_NAMES = {
    'A 基本經濟概念': 'A',
    'B 廠商與生產': 'B',
    'C 市場與價格': 'C',
    'D 競爭與市場結構': 'D',
    'E 效率、公平和政府的角色': 'E',
    'F 經濟表現的量度': 'F',
    'G 國民收入決定及價格水平': 'G',
    'H 貨幣與銀行': 'H',
    'I 宏觀經濟問題和政府': 'I',
    'J 國際貿易和金融': 'J',
    'E1 選修單元一': 'E1',
    'E2 選修單元二': 'E2',
    '未分類': 'U',
};

// Reverse mapping (short code to full display name)
const CURRICULUM_DISPLAY = {
    'A': 'A 基本經濟概念',
    'B': 'B 廠商與生產',
    'C': 'C 市場與價格',
    'D': 'D 競爭與市場結構',
    'E': 'E 效率、公平和政府的角色',
    'F': 'F 經濟表現的量度',
    'G': 'G 國民收入決定及價格水平',
    'H': 'H 貨幣與銀行',
    'I': 'I 宏觀經濟問題和政府',
    'J': 'J 國際貿易和金融',
    'E1': 'E1 選修單元一',
    'E2': 'E2 選修單元二',
    'U': '未分類',
};

// Curriculum sort order
const CURRICULUM_ORDER = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'E1', 'E2', 'U'];

// Feature filter items
const FEATURE_ITEMS = [
    '含圖表',
    '有內嵌圖',
    '含表格',
    '含計算',
    '複選',
    '跨課題',
    '跨章節',
    '已刪除',
    'Out syl'
];

// Chapter range (1-29)
const CHAPTER_RANGE = {
    min: 1,
    max: 29
};

// Chapter Descriptions for Tooltip
const CHAPTER_DESCRIPTIONS = {
    '01': '基本經濟概念',
    '02': '三個基本經濟問題與私有產權',
    '03': '廠商的所有權形式',
    '04': '生產與分工',
    '05': '生產要素',
    '06': '生產及成本',
    '07': '廠商的目標與擴張',
    '08': '市場價格的訂定',
    '09': '市場價格的變化',
    '10': '需求和供應的價格彈性',
    '11': '市場干預',
    '12': '市場結構',
    '13': '效率、公平和政府的角色 (I)',
    '14': '效率、公平和政府的角色 (II)',
    '15': '經濟表現的量度 (I)',
    '16': '經濟表現的量度 (II)',
    '17': '總需求和總供應',
    '18': '產出和價格的決定',
    '19': '貨幣與銀行',
    '20': '貨幣供應和貨幣需求',
    '21': '經濟周期、一般物價水平的變動和失業',
    '22': '財政政策與貨幣政策',
    '23': '國際貿易',
    '24': '貿易障礙',
    '25': '國際收支平衡表與匯率',
    '26': '壟斷定價',
    '27': '反競爭行為與競爭政策',
    '28': '貿易理論的延伸',
    '29': '經濟增長及發展'
};


// Examination types
const EXAMINATION_TYPES = ['HKDSE', 'HKCEE', 'HKALE'];

// Question types
const QUESTION_TYPES = ['MC', '文字題 (SQ/LQ)'];

// Default publisher
const DEFAULT_PUBLISHER = 'HKEAA';

// Export all constants
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        CURRICULUM_ITEMS,
        CURRICULUM_NAMES,
        CURRICULUM_DISPLAY,
        CURRICULUM_ORDER,
        FEATURE_ITEMS,
        CHAPTER_RANGE,
        EXAMINATION_TYPES,
        QUESTION_TYPES,
        DEFAULT_PUBLISHER
    };
}

const SECTION_DISPLAY_NAMES = {
    'A': 'Section A',
    'B': 'Section B',
    'C': 'Section C',
    '-': 'NA'
};
