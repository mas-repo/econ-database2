// Authentication and Authorization with Cookie & LocalStorage Support
// Dependencies: None (core authentication module)
class AuthManager {
    constructor() {
        this.currentUser = null;
        this.displayName = null;
        this.userGroup = null;
        this.COOKIE_NAME = 'econ_db_auth';
        this.COOKIE_DAYS = 365; // Cookie expires after 365 days (1 year)
        this.LOCAL_STORAGE_KEY = 'econ_db_auth_storage';
        this.cookiesAvailable = this.checkCookieSupport();
    }
    
    // Check if user is logged in (from cookie or localStorage fallback)
    // Dependencies: None
    isAuthenticated() {
        const rawData = this.getPersistedAuthData();
        
        if (rawData) {
            try {
                const userData = JSON.parse(decodeURIComponent(rawData));
                this.currentUser = userData.username;
                this.displayName = userData.displayName;
                this.userGroup = userData.userGroup;
                // Re-apply the local ACL so an older cookie cannot keep Mock access
                // after a username is added to LOCAL_USERS (e.g. Vicky / Sarah).
                if (typeof this.resolveLocalUser === 'function') {
                    const profile = this.resolveLocalUser(userData.username);
                    this.displayName = profile.displayName || this.displayName;
                    this.userGroup = profile.userGroup || this.userGroup;
                    this._canViewMockTests = profile.canViewMockTests;
                } else {
                    this._canViewMockTests = userData.canViewMockTests !== false;
                }
               if (userData.username) {
                    try {
                        localStorage.setItem('username', userData.username);
                    } catch (e) {
                        console.error("Storage sync failed");
                    }
                }                
                return true;
            } catch (e) {
                this.clearPersistedAuth();
                return false;
            }
        }
        
        return false;
    }
    
    // Save user credentials to persistence layer
    // Dependencies: None
    saveUser(username, displayName, userGroup, options = {}) {
        const userData = {
            username,
            displayName,
            userGroup,
            canViewMockTests: options.canViewMockTests !== false,
            loginTime: new Date().toISOString()
        };
        
        this.currentUser = username;
        this.displayName = displayName;
        this.userGroup = userGroup;
        this._canViewMockTests = options.canViewMockTests !== false;
        
        this.persistAuthData(userData);

        try {
            localStorage.setItem('username', username);
        } catch (e) {
            console.error("Could not save username for external pages");
        }        
    }
    
    // Logout - clear persistence
    // Dependencies: None
    logout() {
        this.clearPersistedAuth();
        try {
            localStorage.removeItem('username');
            sessionStorage.removeItem('past_paper_permission'); // Clear permission cache
        } catch (e) {}        
        this.currentUser = null;
        this.displayName = null;
        this.userGroup = null;
        window.location.reload();
    }
    
    // Determine if cookies can be used
    // Dependencies: None
    checkCookieSupport() {
        try {
            const testName = '__econ_cookie_test__';
            document.cookie = `${testName}=1; SameSite=Lax; path=/`;
            const enabled = document.cookie.indexOf(`${testName}=`) !== -1;
            document.cookie = `${testName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`;
            return enabled;
        } catch (error) {
            return false;
        }
    }
    
    // Persist auth data (cookie preferred, localStorage fallback)
    // Dependencies: None
    persistAuthData(userData) {
        const serialized = encodeURIComponent(JSON.stringify(userData));
        
        if (this.cookiesAvailable) {
            const cookieSaved = this.setCookie(this.COOKIE_NAME, serialized, this.COOKIE_DAYS);
            if (cookieSaved) {
                this.safeLocalStorageRemove(this.LOCAL_STORAGE_KEY);
                return;
            }
        }
        
        this.safeLocalStorageSet(this.LOCAL_STORAGE_KEY, serialized);
    }
    
    // Retrieve persisted auth data
    // Dependencies: None
    getPersistedAuthData() {
        if (this.cookiesAvailable) {
            const fromCookie = this.getCookie(this.COOKIE_NAME);
            if (fromCookie) return fromCookie;
        }
        return this.safeLocalStorageGet(this.LOCAL_STORAGE_KEY);
    }
    
    // Clear persisted auth data
    // Dependencies: None
    clearPersistedAuth() {
        if (this.cookiesAvailable) {
            this.deleteCookie(this.COOKIE_NAME);
        }
        this.safeLocalStorageRemove(this.LOCAL_STORAGE_KEY);
    }
    
    // Cookie helper functions
    // Dependencies: None
    setCookie(name, value, days) {
        try {
            const date = new Date();
            date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
            const expires = "expires=" + date.toUTCString();
            const secureFlag = location.protocol === 'https:' ? '; Secure' : '';
            
            document.cookie = `${name}=${value}; ${expires}; path=/; SameSite=Lax${secureFlag}`;
            return document.cookie.indexOf(`${name}=`) !== -1;
        } catch (error) {
            return false;
        }
    }
    
    // Dependencies: None
    getCookie(name) {
        const nameEQ = name + "=";
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            let cookie = cookies[i].trim();
            if (cookie.indexOf(nameEQ) === 0) {
                return cookie.substring(nameEQ.length);
            }
        }
        return null;
    }
    
    // Dependencies: None
    deleteCookie(name) {
        try {
            document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/";
        } catch (error) {
            // Silent fail
        }
    }
    
    // LocalStorage helpers with fail-safe
    // Dependencies: None
    safeLocalStorageSet(key, value) {
        try {
            localStorage.setItem(key, value);
            return true;
        } catch (error) {
            return false;
        }
    }
    
    // Dependencies: None
    safeLocalStorageGet(key) {
        try {
            return localStorage.getItem(key);
        } catch (error) {
            return null;
        }
    }
    
    // Dependencies: None
    safeLocalStorageRemove(key) {
        try {
            localStorage.removeItem(key);
        } catch (error) {
            // Silent fail
        }
    }
    
    // Check permissions
    // Dependencies: None
    canEdit() {
        return this.userGroup === 'Admin';
    }

    // Mock papers (雅集 / MT…) are hidden from Colleagues such as Vicky and Sarah.
    canViewMockTests() {
        if (typeof this._canViewMockTests === 'boolean') {
            return this._canViewMockTests;
        }
        return this.userGroup !== 'Colleagues';
    }

    resolveLocalUser(username) {
        const key = String(username || '').trim().toLowerCase();
        const profile = (typeof LOCAL_USERS !== 'undefined' && LOCAL_USERS[key])
            ? LOCAL_USERS[key]
            : (typeof DEFAULT_LOCAL_USER !== 'undefined' ? DEFAULT_LOCAL_USER : { userGroup: 'Local', canViewMockTests: true });
        return {
            username: key,
            displayName: profile.displayName || username,
            userGroup: profile.userGroup || 'Local',
            canViewMockTests: profile.canViewMockTests !== false
        };
    }
}

// Initialize auth manager
// Dependencies: None
window.authManager = new AuthManager();

// Show login modal
// Dependencies: None
function showLoginModal() {
    const modal = document.createElement('div');
    modal.id = 'login-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        backdrop-filter: blur(5px);
    `;
    
    modal.innerHTML = `
        <div style="background: white; padding: 45px; border-radius: 16px; max-width: 450px; width: 90%; box-shadow: 0 10px 40px rgba(0,0,0,0.3);">
            <div style="text-align: center; margin-bottom: 30px;">
                <div style="font-size: 48px; margin-bottom: 15px;">🔐</div>
                <h2 style="margin: 0 0 10px 0; color: #2c3e50; font-size: 24px;">
                    經濟題目資料庫
                </h2>
                <p style="color: #7f8c8d; margin: 0; font-size: 14px;">
                    請輸入您的使用者名稱以繼續
                </p>
            </div>
            
            <div style="margin-bottom: 25px;">
                <label style="display: block; margin-bottom: 10px; color: #2c3e50; font-weight: 600; font-size: 14px;">
                    使用者名稱
                </label>
                <input type="text" id="username-input" 
                       placeholder="請輸入您的名稱"
                       autocomplete="username"
                       style="width: 100%; padding: 14px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 16px; box-sizing: border-box; transition: border-color 0.3s;">
                <div id="login-error" style="color: #e74c3c; margin-top: 10px; font-size: 13px; display: none; padding: 10px; background: #ffe6e6; border-radius: 6px;"></div>
            </div>
            
            <button onclick="attemptLogin()" id="login-button"
                    style="width: 100%; padding: 16px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; transition: all 0.3s; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);">
                進入系統
            </button>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Add hover effect to button
    const loginBtn = document.getElementById('login-button');
    loginBtn.addEventListener('mouseenter', function() {
        this.style.transform = 'translateY(-2px)';
        this.style.boxShadow = '0 6px 20px rgba(102, 126, 234, 0.6)';
    });
    loginBtn.addEventListener('mouseleave', function() {
        this.style.transform = 'translateY(0)';
        this.style.boxShadow = '0 4px 15px rgba(102, 126, 234, 0.4)';
    });
    
    // Add focus effect to input
    const usernameInput = document.getElementById('username-input');
    usernameInput.addEventListener('focus', function() {
        this.style.borderColor = '#667eea';
        this.style.outline = 'none';
    });
    usernameInput.addEventListener('blur', function() {
        this.style.borderColor = '#e0e0e0';
    });
    
    // Focus on input
    usernameInput.focus();
    
    // Allow Enter key to submit
    usernameInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            attemptLogin();
        }
    });
}

// Attempt login. Identity is local; the question bank comes from JSON.
// Dependencies: window.authManager
async function attemptLogin() {
    const username = document.getElementById('username-input').value.trim().toLowerCase();
    const errorDiv = document.getElementById('login-error');
    const loginBtn = document.getElementById('login-button');
    
    if (!username) {
        errorDiv.innerHTML = '⚠️ 請輸入使用者名稱';
        errorDiv.style.display = 'block';
        return;
    }
    
    loginBtn.disabled = true;
    loginBtn.textContent = '進入中...';
    loginBtn.style.background = '#95a5a6';
    loginBtn.style.cursor = 'not-allowed';
    
    try {
        const profile = window.authManager.resolveLocalUser(username);
        window.authManager.saveUser(
            profile.username,
            profile.displayName,
            profile.userGroup,
            { canViewMockTests: profile.canViewMockTests }
        );
        document.getElementById('login-modal').remove();
        showWelcomeMessage(profile.displayName);
        if (typeof init === 'function') {
            await init();
        }
    } catch (error) {
        errorDiv.innerHTML = '❌ ' + error.message;
        errorDiv.style.display = 'block';
        resetLoginButton(loginBtn);
    }
}

// Reset login button UI
// Dependencies: None
function resetLoginButton(button) {
    button.disabled = false;
    button.textContent = '進入系統';
    button.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
    button.style.cursor = 'pointer';
}

// Show welcome message
// Dependencies: None
function showWelcomeMessage(displayName) {
    const welcome = document.createElement('div');
    welcome.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: white;
        color: #2c3e50;
        padding: 20px 28px;
        border-radius: 12px;
        box-shadow: 0 8px 25px rgba(0,0,0,0.15);
        z-index: 9999;
        animation: slideIn 0.4s ease-out;
        border-left: 4px solid #667eea;
        min-width: 280px;
    `;
    
    welcome.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
            <div style="font-size: 28px;">👋</div>
            <div>
                <div style="font-weight: bold; font-size: 16px; color: #2c3e50;">驗證成功</div>
                <div style="font-size: 13px; color: #7f8c8d; margin-top: 2px;">
                    歡迎回來, ${displayName}
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(welcome);
    
    setTimeout(() => {
        welcome.style.animation = 'slideOut 0.4s ease-out';
        setTimeout(() => welcome.remove(), 400);
    }, 3000);
}

// Load authenticated data
// Dependencies: storage-core.js (window.storage), main.js (showLoading, hideLoading)
async function loadAuthenticatedData(data) {
    try {
        showLoading('正在載入題目資料...');
        
        // Parse the data
        const lines = data.split(String.fromCharCode(31)).filter(line => line.trim());
        
        if (lines.length < 1) {
            throw new Error('資料為空');
        }
        
        // Headers are already the database field names from backend
        const headers = lines[0].split(String.fromCharCode(30)).map(h => h.trim());
        const questions = [];
        
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(String.fromCharCode(30));
            const question = {
                dateAdded: new Date().toISOString(),
                dateModified: new Date().toISOString()
            };
            
            headers.forEach((fieldName, index) => {
                let value = values[index] || '';
                
                if (!value) {
                    // Initialize array fields as empty arrays
                    if (['curriculumClassification', 'AristochapterClassification', 'concepts', 'patterns', 'stemPatterns'].includes(fieldName)) {
                        question[fieldName] = [];
                    }
                    return;
                }
                
                // Restore newlines
                value = value.replace(/\\n/g, '\n');
                
                // Handle different field types
                switch (fieldName) {
                    case 'marks':
                    case 'correctPercentage':
                        const trimmedNum = value.trim();
                        const num = parseFloat(trimmedNum);
                        if (!isNaN(num)) {
                            question[fieldName] = num;
                        }
                        break;
                        
                    case 'curriculumClassification':
                    case 'AristochapterClassification':
                    case 'concepts':
                    case 'patterns':
                    case 'stemPatterns':
                        const trimmedValue = value.trim();
                        if (trimmedValue) {
                            question[fieldName] = trimmedValue.split(',').map(s => s.trim()).filter(s => s);
                        } else {
                            question[fieldName] = [];
                        }
                        break;
                        
                    case 'multipleSelectionType':
                    case 'graphType':
                    case 'tableType':
                        question[fieldName] = value.trim() || '-';
                        break;
                    
                    default:
                        question[fieldName] = value.trim();
                }
            });
            
            // Ensure array fields exist
            ['curriculumClassification', 'AristochapterClassification', 'concepts', 'patterns', 'stemPatterns'].forEach(field => {
                if (!question[field]) {
                    question[field] = [];
                }
            });
            
            // Validate required fields
            if (question.examination && question.id) {
                questions.push(question);
            }
        }
        
        // Clear and reload database
        await window.storage.clear();
        
        // === Use Batch Add ===
        await window.storage.addQuestions(questions);
        
        hideLoading();
        
    } catch (error) {
        hideLoading();
        alert('❌ 資料載入失敗: ' + error.message);
    }
}