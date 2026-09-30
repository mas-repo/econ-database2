// template-form.js
// Generates the Add/Edit Question form.
// Dependencies: None (pure HTML string generator).
// Note: the curriculum checkbox helper container is "curriculum-form-options"
// (renamed from the old duplicate ID "curriculum-options" which clashed with the filter dropdown).

function renderFormTemplate() {
    return `
    <div id="form-section" class="form-container hidden">
        <h2 id="form-title">新增題目</h2>
        <form id="question-form">

            <div class="form-grid">
                <div class="form-group">
                    <label for="question-id">題目 ID *</label>
                    <input type="text" id="question-id" required>
                </div>
                <div class="form-group">
                    <label for="publisher">出版商</label>
                    <input type="text" id="publisher" value="HKEAA">
                </div>
                <div class="form-group">
                    <label for="examination">考試類型 *</label>
                    <select id="examination" required>
                        <option value="HKDSE">HKDSE</option>
                        <option value="HKCEE">HKCEE</option>
                        <option value="HKALE">HKALE</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="year">年份 *</label>
                    <input type="number" id="year" required>
                </div>
                <div class="form-group">
                    <label for="paper">試卷</label>
                    <input type="text" id="paper">
                </div>
                <div class="form-group">
                    <label for="question-type">題目類型 *</label>
                    <select id="question-type" required>
                        <option value="MC">MC</option>
                        <option value="文字題 (SQ/LQ)">文字題 (SQ/LQ)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="marks">分數</label>
                    <input type="number" id="marks" min="0" step="0.5">
                </div>
                <div class="form-group">
                    <label for="section">Section</label>
                    <input type="text" id="section" placeholder="A / B / C / -">
                </div>
                <div class="form-group">
                    <label for="question-number">題號</label>
                    <input type="text" id="question-number">
                </div>
            </div>

            <div class="form-grid">
                <div class="form-group">
                    <label for="question-text-chi">題目內容 (中文)</label>
                    <textarea id="question-text-chi"></textarea>
                </div>
                <div class="form-group">
                    <label for="question-text-eng">題目內容 (英文)</label>
                    <textarea id="question-text-eng"></textarea>
                </div>
            </div>

            <div class="form-grid">
                <div class="form-group">
                    <label for="multiple-selection-type">複選類型</label>
                    <input type="text" id="multiple-selection-type">
                </div>
                <div class="form-group">
                    <label for="graph-type">圖表類型</label>
                    <input type="text" id="graph-type">
                </div>
                <div class="form-group">
                    <label for="table-type">表格類型</label>
                    <input type="text" id="table-type">
                </div>
                <div class="form-group">
                    <label for="calculation-type">計算類型</label>
                    <input type="text" id="calculation-type">
                </div>
                <div class="form-group">
                    <label for="answer-mc">答案 (MC)</label>
                    <input type="text" id="answer-mc">
                </div>
                <div class="form-group">
                    <label for="correct-percentage">答對率 (%)</label>
                    <input type="number" id="correct-percentage" min="0" max="100" step="0.1">
                </div>
            </div>

            <div class="form-grid">
                <div class="form-group">
                    <label for="answer-chi">答案</label>
                    <textarea id="answer-chi"></textarea>
                </div>
                <div class="form-group">
                    <label for="answer-eng">Answer</label>
                    <textarea id="answer-eng"></textarea>
                </div>
                <div class="form-group">
                    <label for="markers-report-chi">評卷報告</label>
                    <textarea id="markers-report-chi"></textarea>
                </div>
                <div class="form-group">
                    <label for="markers-report-eng">Markers Report</label>
                    <textarea id="markers-report-eng"></textarea>
                </div>
            </div>

            <div class="form-grid">
                <div class="form-group">
                    <label for="curriculum-classification">課程分類 *</label>
                    <input type="text" id="curriculum-classification" placeholder="選擇課程分類...">
                    <button type="button" class="btn btn-secondary btn-sm" onclick="toggleCurriculumFormOptions()">📚 選擇課程分類</button>
                    <div id="curriculum-form-options" class="hidden" style="border: 1px solid var(--border-light); border-radius: 8px; padding: 10px; max-height: 200px; overflow-y: auto;">
                        <div class="options-list" style="display: flex; flex-direction: column; gap: 6px;"></div>
                    </div>
                </div>
                <div class="form-group">
                    <label for="chapter-classification">Aristo Chapters (用逗號分隔)</label>
                    <input type="text" id="chapter-classification" placeholder="Ch01, Ch02, ...">
                </div>
                <div class="form-group">
                    <label for="concepts">涉及概念 (標籤，用逗號分隔)</label>
                    <input type="text" id="concepts">
                </div>
                <div class="form-group">
                    <label for="patterns">題型標籤 (用逗號分隔)</label>
                    <input type="text" id="patterns">
                </div>
                <div class="form-group">
                    <label for="stemPatterns">題幹模式 (用逗號分隔)</label>
                    <input type="text" id="stemPatterns">
                </div>
                <div class="form-group">
                    <label for="option-design">選項設計</label>
                    <input type="text" id="option-design">
                </div>
                <div class="form-group">
                    <label for="ai-explanation">AI 詳解 (URL)</label>
                    <input type="text" id="ai-explanation">
                </div>
                <div class="form-group">
                    <label for="remarks">備註</label>
                    <textarea id="remarks"></textarea>
                </div>
            </div>

            <div class="form-actions">
                <button type="submit" class="btn btn-success">💾 儲存題目</button>
                <button type="button" class="btn btn-cancel" onclick="cancelEdit()">❌ 取消</button>
            </div>
        </form>
    </div>`;
}