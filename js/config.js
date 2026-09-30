// Questions are loaded from a local JSON file instead of Google Sheets.
// Dependencies: storage-sync.js (QuestionJsonSource)

const CONFIG = {
    QUESTIONS_JSON_URL: 'data/database.json',
    // Apps Script web app (/exec) from econ-database/apps-script/README.md.
    // Leave empty until that deployment exists. This URL is not a secret.
    // The Poe API key, the allowlist, and GitHub sync settings stay in
    // Apps Script properties. Do not put a token, owner, or repository name here.
    // AI出題 and Git sync both POST to this same URL.
    POE_PROXY_WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbyWyuSs8FIpga0fwy8z8A3IGqE3T51FE24Ak3xuLawj5GmD81p3PwvDQjIRzLhIa53y/exec'
};

window.addEventListener('DOMContentLoaded', () => {
    window.questionJsonSource = new QuestionJsonSource(CONFIG.QUESTIONS_JSON_URL);
    console.log('✅ JSON question source initialized');
});
