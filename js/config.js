// Questions are loaded from the private repository through Apps Script.
// Dependencies: storage-sync.js (QuestionJsonSource)

const CONFIG = {
    // Deployed Apps Script web app `/exec` URL (not a secret). Same endpoint for
    // checkAccess, AI出題／追問, AI解釋, 回報問題, stem review, Git sync, and
    // issueSharedReadToken. Keys, hashes, and GITHUB_* stay in Script properties
    // — never put a token, owner, or repository name here.
    POE_PROXY_WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbyWyuSs8FIpga0fwy8z8A3IGqE3T51FE24Ak3xuLawj5GmD81p3PwvDQjIRzLhIa53y/exec'
};

window.addEventListener('DOMContentLoaded', () => {
    window.questionJsonSource = new QuestionJsonSource();
    console.log('✅ JSON question source initialized');
});
