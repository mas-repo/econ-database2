// Dependencies: storage-core.js (extends IndexedDBStorage)

// Sentinel for "field not yet entered" (blank / "-" / empty array).
// It is filter-only — never a stored tag. Confirmed-none values (e.g. 沒有圖,
// 沒有表格, 並非複選型) are real stored options and must not use this sentinel.
const EMPTY_FIELD_SENTINEL = '__empty__';
const EMPTY_FIELD_LABELS = {
    graph: '尚未輸入',
    table: '尚未輸入',
    calculation: '尚未輸入',
    multipleSelection: '尚未輸入',
    concepts: '尚未輸入',
    patterns: '尚未輸入',
    stemPatterns: '尚未輸入'
};

function isBlankFilterValue(value) {
    if (value == null) return true;
    const text = String(value).trim();
    return text === '' || text === '-';
}

function meaningfulArrayValues(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(item => !isBlankFilterValue(item));
}

function isModalFieldEmpty(question, key) {
    const arrays = { concepts: 'concepts', patterns: 'patterns', stemPatterns: 'stemPatterns' };
    const scalars = {
        graph: 'graphType',
        table: 'tableType',
        calculation: 'calculationType',
        multipleSelection: 'multipleSelectionType'
    };
    if (arrays[key]) return meaningfulArrayValues(question[arrays[key]]).length === 0;
    if (scalars[key]) return isBlankFilterValue(question[scalars[key]]);
    return false;
}

function partitionEmptySelection(stateMap) {
    const checked = Object.keys(stateMap).filter(key => stateMap[key] === 'checked');
    const excluded = Object.keys(stateMap).filter(key => stateMap[key] === 'excluded');
    return {
        includeEmpty: checked.includes(EMPTY_FIELD_SENTINEL),
        excludeEmpty: excluded.includes(EMPTY_FIELD_SENTINEL),
        checked: checked.filter(key => key !== EMPTY_FIELD_SENTINEL),
        excluded: excluded.filter(key => key !== EMPTY_FIELD_SENTINEL)
    };
}

// Canonical year key for filters/stats matching only — does not rewrite stored
// q.year (writes use normalizeYear → MT##). Mock papers may still appear as
// legacy "39" or stored "MT39"; both become key "39" (UI label MT39 via
// yearFilterLabel). Four-digit exam years and tokens (PP / SP) stay as text.
function normalizeYearFilterKey(year) {
    if (year == null) return '';
    const text = String(year).trim();
    if (!text || text === '-') return '';
    const mt = text.match(/^MT\s*(\d{1,3})$/i);
    if (mt) return String(parseInt(mt[1], 10));
    if (/^\d{1,3}$/.test(text)) return String(parseInt(text, 10));
    if (/^\d{4}$/.test(text)) return text;
    return text;
}

// Helper to extract unique values from a dataset for a specific field
IndexedDBStorage.prototype.getUniqueValues = function(questions, field) {
    const values = new Set();
    questions.forEach(q => {
        if (q[field] && q[field] !== '-' && q[field] !== '') {
            values.add(q[field]);
        }
    });
    return Array.from(values).sort();
};

// Add filter logic to IndexedDBStorage
IndexedDBStorage.prototype.isMockQuestion = function(q) {
    const id = String(q && q.id ? q.id : '');
    if (/^MT?\d/i.test(id)) return true;
    const publisher = String(q && q.publisher ? q.publisher : '');
    return publisher !== '' && publisher !== 'HKEAA' && publisher !== '-';
};

IndexedDBStorage.prototype.applyPermissionFilter = function(questions) {
    if (!window.authManager || window.authManager.canViewMockTests()) {
        return questions;
    }
    return questions.filter(q => !this.isMockQuestion(q));
};

IndexedDBStorage.prototype.applyFilters = function(questions, filters) {
    // Mock papers are omitted unless the proxy granted mockTests.
    questions = this.applyPermissionFilter(questions);

    // Apply search filter with Scope
    if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const scope = filters.searchScope || 'all';

        questions = questions.filter(q => {
            // Helper for checking content
            const checkId = () => q.id && String(q.id).toLowerCase().includes(searchLower);
            const checkExam = () => q.examination && q.examination.toLowerCase().includes(searchLower);
            const checkSection = () => q.section && q.section.toLowerCase().includes(searchLower);
            const checkNum = () => q.questionNumber && q.questionNumber.toLowerCase().includes(searchLower);
            const checkContent = () => (q.questionTextChi && q.questionTextChi.toLowerCase().includes(searchLower)) ||
                                     (q.questionTextEng && q.questionTextEng.toLowerCase().includes(searchLower)) ||
                                     (q.plainText && q.plainText.toLowerCase().includes(searchLower)) ||
                                     (q.topic && q.topic.toLowerCase().includes(searchLower));
            const checkPublisher = () => q.publisher && q.publisher.toLowerCase().includes(searchLower);
            const checkAnswer = () => {
                return (q.answerMC && q.answerMC.toLowerCase().includes(searchLower)) ||
                       (q.answerChi && q.answerChi.toLowerCase().includes(searchLower)) ||
                       (q.answerEng && q.answerEng.toLowerCase().includes(searchLower));
            };
            const checkReport = () => {
                return (q.markersReportChi && q.markersReportChi.toLowerCase().includes(searchLower)) ||
                       (q.markersReportEng && q.markersReportEng.toLowerCase().includes(searchLower));
            };            

            switch (scope) {
                case 'id':
                    return checkId();
                case 'content':
                    return checkContent();
                case 'publisher':
                    return checkPublisher();
                case 'exam':
                    return checkExam() || checkSection() || checkNum();
                case 'answer':
                    return checkAnswer();
                case 'concepts':
                    return q.concepts && Array.isArray(q.concepts) && q.concepts.some(c => c.toLowerCase().includes(searchLower));
                case 'patterns':
                    return q.patterns && Array.isArray(q.patterns) && q.patterns.some(p => p.toLowerCase().includes(searchLower));
                case 'stemPatterns':
                    return q.stemPatterns && Array.isArray(q.stemPatterns) && q.stemPatterns.some(p => p.toLowerCase().includes(searchLower));
                case 'markersReport':
                    return checkReport();
                case 'section':
                    return checkSection();
                case 'all':
                default:
                    return checkId() || checkExam() || checkSection() || checkNum() || checkContent() || checkPublisher() || checkAnswer() || checkReport();
            }
        });
    }
    
    // Apply exam filter
    if (filters.examination) {
        questions = questions.filter(q => q.examination === filters.examination);
    }
    
    // REMOVED: Old single-value year filter
    /* if (filters.year) {
        questions = questions.filter(q => String(q.year) === String(filters.year));
    } */
    
    // Apply question type filter
    if (filters.questionType) {
        questions = questions.filter(q => q.questionType === filters.questionType);
    }

    // Percentage filter
    if (filters.percentageFilter && filters.percentageFilter.active) {
        const { min, max } = filters.percentageFilter;
        
        questions = questions.filter(q => {
            if (q.correctPercentage === undefined || 
                q.correctPercentage === null || 
                q.correctPercentage === '') {
                return false;
            }
            
            const percentage = parseFloat(q.correctPercentage);
            
            if (isNaN(percentage)) {
                return false;
            }
            
            return percentage >= min && percentage <= max;
        });
        
    }

    // Marks filter
    if (filters.marksFilter && filters.marksFilter.active) {
        const { min, max } = filters.marksFilter;
        
        questions = questions.filter(q => {
            if (q.marks === undefined || 
                q.marks === null || 
                q.marks === '') {
                return false;
            }
            
            const marks = parseFloat(q.marks);
            
            if (isNaN(marks)) {
                return false;
            }
            
            return marks >= min && marks <= max;
        });
    }

    // Question number filter — last digits of id (e.g. DSE-2026-P1-01 → 1)
    if (filters.questionNumberFilter && filters.questionNumberFilter.active) {
        const { min, max } = filters.questionNumberFilter;

        questions = questions.filter(q => {
            let num = NaN;
            if (q.id) {
                const idMatch = String(q.id).match(/(\d+)\s*$/);
                if (idMatch) num = parseInt(idMatch[1], 10);
            }
            if (isNaN(num) && q.questionNumber !== undefined && q.questionNumber !== null && q.questionNumber !== '') {
                const qnMatch = String(q.questionNumber).match(/^(\d+)/);
                if (qnMatch) num = parseInt(qnMatch[1], 10);
            }
            if (isNaN(num)) return false;
            return num >= min && num <= max;
        });
    }

    // Tri-state filters
    if (filters.triState) {
        if (filters.triState.publisher) {
            const checkedPublishers = Object.keys(filters.triState.publisher).filter(k => filters.triState.publisher[k] === 'checked');
            const excludedPublishers = Object.keys(filters.triState.publisher).filter(k => filters.triState.publisher[k] === 'excluded');

            if (checkedPublishers.length > 0) {
                questions = questions.filter(q => checkedPublishers.includes(q.publisher));
            }

            if (excludedPublishers.length > 0) {
                questions = questions.filter(q => !excludedPublishers.includes(q.publisher));
            }
        }

        // Exam type filters
        if (filters.triState.exam) {
            const checkedExams = Object.keys(filters.triState.exam).filter(k => filters.triState.exam[k] === 'checked');
            const excludedExams = Object.keys(filters.triState.exam).filter(k => filters.triState.exam[k] === 'excluded');
            
            if (checkedExams.length > 0) {
                questions = questions.filter(q => checkedExams.includes(q.examination));
            }
            
            if (excludedExams.length > 0) {
                questions = questions.filter(q => !excludedExams.includes(q.examination));
            }
        }

        // ADDED: Year tri-state filter
        if (filters.triState.year) {
            const checkedYears = Object.keys(filters.triState.year)
                .filter(k => filters.triState.year[k] === 'checked')
                .map(normalizeYearFilterKey)
                .filter(Boolean);
            const excludedYears = Object.keys(filters.triState.year)
                .filter(k => filters.triState.year[k] === 'excluded')
                .map(normalizeYearFilterKey)
                .filter(Boolean);

            if (checkedYears.length > 0) {
                // OR Logic: Question matches any of the checked years
                // (canonical keys so "39" and "MT39" are the same logical year)
                questions = questions.filter(q => checkedYears.includes(normalizeYearFilterKey(q.year)));
            }

            if (excludedYears.length > 0) {
                // Exclude if matches any of the excluded years
                questions = questions.filter(q => !excludedYears.includes(normalizeYearFilterKey(q.year)));
            }
        }

        // Question type filters
        if (filters.triState.qtype) {
            const checkedQtypes = Object.keys(filters.triState.qtype).filter(k => filters.triState.qtype[k] === 'checked');
            const excludedQtypes = Object.keys(filters.triState.qtype).filter(k => filters.triState.qtype[k] === 'excluded');
            
            if (checkedQtypes.length > 0) {
                questions = questions.filter(q => checkedQtypes.includes(q.questionType));
            }
            
            if (excludedQtypes.length > 0) {
                questions = questions.filter(q => !excludedQtypes.includes(q.questionType));
            }
        }

            // Curriculum filters
                    if (filters.triState.curriculum) {
                        const checkedCurr = Object.keys(filters.triState.curriculum).filter(k => filters.triState.curriculum[k] === 'checked');
                        const excludedCurr = Object.keys(filters.triState.curriculum).filter(k => filters.triState.curriculum[k] === 'excluded');
                        
                        // Prefer logic passed with this filter set (stats tabs).
                        // The questions tab keeps using window.filterLogic.
                        const logic = (filters.filterLogic && filters.filterLogic.curriculum)
                            || (window.filterLogic && window.filterLogic.curriculum)
                            || 'OR';

                        if (checkedCurr.length > 0) {
                            questions = questions.filter(q => {
                                if (!q.curriculumClassification || !Array.isArray(q.curriculumClassification)) return false;
                                
                                // Logic Check: AND vs OR
                                if (logic === 'AND') {
                                    // AND Logic: Question must contain ALL selected curriculum tags
                                    return checkedCurr.every(curr => q.curriculumClassification.includes(curr));
                                } else {
                                    // OR Logic (Default): Question must contain AT LEAST ONE selected tag
                                    return checkedCurr.some(curr => q.curriculumClassification.includes(curr));
                                }
                            });
                        }
                        
                        if (excludedCurr.length > 0) {
                            questions = questions.filter(q => {
                                if (!q.curriculumClassification || !Array.isArray(q.curriculumClassification)) return true;
                                // Excluded logic remains the same (exclude if ANY match found)
                                return !excludedCurr.some(curr => q.curriculumClassification.includes(curr));
                            });
                        }
                    }

        // Chapter filters
        if (filters.triState.chapter) {
            const checkedChapter = Object.keys(filters.triState.chapter).filter(k => filters.triState.chapter[k] === 'checked');
            const excludedChapter = Object.keys(filters.triState.chapter).filter(k => filters.triState.chapter[k] === 'excluded');
            
            // Prefer logic passed with this filter set (stats tabs).
            const logic = (filters.filterLogic && filters.filterLogic.chapter)
                || (window.filterLogic && window.filterLogic.chapter)
                || 'OR';

            if (checkedChapter.length > 0) {
                questions = questions.filter(q => {
                    if (!q.AristochapterClassification || !Array.isArray(q.AristochapterClassification)) return false;
                    
                    // Logic Check: AND vs OR
                    if (logic === 'AND') {
                        // AND Logic: Question must contain ALL selected chapter tags
                        return checkedChapter.every(chapter => q.AristochapterClassification.includes('Ch' + chapter));
                    } else {
                        // OR Logic (Default): Question must contain AT LEAST ONE selected chapter tag
                        return checkedChapter.some(chapter => q.AristochapterClassification.includes('Ch' + chapter));
                    }
                });
            }
            
            if (excludedChapter.length > 0) {
                questions = questions.filter(q => {
                    if (!q.AristochapterClassification || !Array.isArray(q.AristochapterClassification)) return true;
                    // Excluded logic remains the same (exclude if ANY match found)
                    return !excludedChapter.some(chapter => q.AristochapterClassification.includes('Ch' + chapter));
                });
            }
        }

        // Concept filters
        if (filters.triState.concepts) {
            const conceptPick = partitionEmptySelection(filters.triState.concepts);

            if (conceptPick.checked.length > 0 || conceptPick.includeEmpty) {
                questions = questions.filter(q => {
                    if (conceptPick.includeEmpty && isModalFieldEmpty(q, 'concepts')) return true;
                    if (!conceptPick.checked.length) return false;
                    if (!q.concepts || !Array.isArray(q.concepts)) return false;
                    return conceptPick.checked.some(c => q.concepts.includes(c));
                });
            }

            if (conceptPick.excluded.length > 0 || conceptPick.excludeEmpty) {
                questions = questions.filter(q => {
                    if (conceptPick.excludeEmpty && isModalFieldEmpty(q, 'concepts')) return false;
                    if (!q.concepts || !Array.isArray(q.concepts)) return true;
                    return !conceptPick.excluded.some(c => q.concepts.includes(c));
                });
            }
        }

        // Pattern filters
        if (filters.triState.patterns) {
            const patternPick = partitionEmptySelection(filters.triState.patterns);

            if (patternPick.checked.length > 0 || patternPick.includeEmpty) {
                questions = questions.filter(q => {
                    if (patternPick.includeEmpty && isModalFieldEmpty(q, 'patterns')) return true;
                    if (!patternPick.checked.length) return false;
                    if (!q.patterns || !Array.isArray(q.patterns)) return false;
                    return patternPick.checked.some(p => q.patterns.includes(p));
                });
            }

            if (patternPick.excluded.length > 0 || patternPick.excludeEmpty) {
                questions = questions.filter(q => {
                    if (patternPick.excludeEmpty && isModalFieldEmpty(q, 'patterns')) return false;
                    if (!q.patterns || !Array.isArray(q.patterns)) return true;
                    return !patternPick.excluded.some(p => q.patterns.includes(p));
                });
            }
        }

        // Stem pattern filters
        if (filters.triState.stemPatterns) {
            const stemPick = partitionEmptySelection(filters.triState.stemPatterns);

            if (stemPick.checked.length > 0 || stemPick.includeEmpty) {
                questions = questions.filter(q => {
                    if (stemPick.includeEmpty && isModalFieldEmpty(q, 'stemPatterns')) return true;
                    if (!stemPick.checked.length) return false;
                    if (!q.stemPatterns || !Array.isArray(q.stemPatterns)) return false;
                    return stemPick.checked.some(p => q.stemPatterns.includes(p));
                });
            }

            if (stemPick.excluded.length > 0 || stemPick.excludeEmpty) {
                questions = questions.filter(q => {
                    if (stemPick.excludeEmpty && isModalFieldEmpty(q, 'stemPatterns')) return false;
                    if (!q.stemPatterns || !Array.isArray(q.stemPatterns)) return true;
                    return !stemPick.excluded.some(p => q.stemPatterns.includes(p));
                });
            }
        }

        // Paper (卷一 / 卷二). Values are stored as "1" / "2".
        if (filters.triState.paper) {
            const checkedPapers = Object.keys(filters.triState.paper).filter(k => filters.triState.paper[k] === 'checked');
            const excludedPapers = Object.keys(filters.triState.paper).filter(k => filters.triState.paper[k] === 'excluded');

            if (checkedPapers.length > 0) {
                questions = questions.filter(q => checkedPapers.includes(String(q.paper)));
            }

            if (excludedPapers.length > 0) {
                questions = questions.filter(q => !excludedPapers.includes(String(q.paper)));
            }
        }

        // Section filters
        if (filters.triState.section) {
            const checkedSections = Object.keys(filters.triState.section).filter(k => filters.triState.section[k] === 'checked');
            const excludedSections = Object.keys(filters.triState.section).filter(k => filters.triState.section[k] === 'excluded');
            
            if (checkedSections.length > 0) {
                questions = questions.filter(q => checkedSections.includes(q.section));
            }
            
            if (excludedSections.length > 0) {
                questions = questions.filter(q => !excludedSections.includes(q.section));
            }
        }

        // AI解釋 filter (side-file index; legacy AIExplanation URL ignored)
        if (filters.triState.ai) {
            const aiMap = filters.triState.ai;
            const hasSelection = Object.keys(aiMap).some(k => aiMap[k] === 'checked' || aiMap[k] === 'excluded');
            if (hasSelection) {
                if (typeof questionMatchesAiFilter === 'function') {
                    questions = questions.filter(q => questionMatchesAiFilter(q, aiMap));
                } else if (window.AiExplanation && typeof AiExplanation.questionMatchesAiFilter === 'function') {
                    questions = questions.filter(q => AiExplanation.questionMatchesAiFilter(q, aiMap));
                }
            }
        }

        // Multiple Selection Filter
        if (filters.triState.multipleSelection) {
            const pick = partitionEmptySelection(filters.triState.multipleSelection);

            if (pick.checked.length > 0 || pick.includeEmpty) {
                questions = questions.filter(q => {
                    if (pick.includeEmpty && isModalFieldEmpty(q, 'multipleSelection')) return true;
                    return pick.checked.includes(q.multipleSelectionType);
                });
            }
            if (pick.excluded.length > 0 || pick.excludeEmpty) {
                questions = questions.filter(q => {
                    if (pick.excludeEmpty && isModalFieldEmpty(q, 'multipleSelection')) return false;
                    return !pick.excluded.includes(q.multipleSelectionType);
                });
            }
        }

        // Graph Filter
        if (filters.triState.graph) {
            const pick = partitionEmptySelection(filters.triState.graph);

            if (pick.checked.length > 0 || pick.includeEmpty) {
                questions = questions.filter(q => {
                    if (pick.includeEmpty && isModalFieldEmpty(q, 'graph')) return true;
                    return pick.checked.includes(q.graphType);
                });
            }
            if (pick.excluded.length > 0 || pick.excludeEmpty) {
                questions = questions.filter(q => {
                    if (pick.excludeEmpty && isModalFieldEmpty(q, 'graph')) return false;
                    return !pick.excluded.includes(q.graphType);
                });
            }
        }

        // Table Filter
        if (filters.triState.table) {
            const pick = partitionEmptySelection(filters.triState.table);

            if (pick.checked.length > 0 || pick.includeEmpty) {
                questions = questions.filter(q => {
                    if (pick.includeEmpty && isModalFieldEmpty(q, 'table')) return true;
                    return pick.checked.includes(q.tableType);
                });
            }
            if (pick.excluded.length > 0 || pick.excludeEmpty) {
                questions = questions.filter(q => {
                    if (pick.excludeEmpty && isModalFieldEmpty(q, 'table')) return false;
                    return !pick.excluded.includes(q.tableType);
                });
            }
        }

        // Calculation Filter
        if (filters.triState.calculation) {
            const pick = partitionEmptySelection(filters.triState.calculation);

            if (pick.checked.length > 0 || pick.includeEmpty) {
                questions = questions.filter(q => {
                    if (pick.includeEmpty && isModalFieldEmpty(q, 'calculation')) return true;
                    return pick.checked.includes(q.calculationType);
                });
            }
            if (pick.excluded.length > 0 || pick.excludeEmpty) {
                questions = questions.filter(q => {
                    if (pick.excludeEmpty && isModalFieldEmpty(q, 'calculation')) return false;
                    return !pick.excluded.includes(q.calculationType);
                });
            }
        }

        // Feature filters
        if (filters.triState.feature) {
            const features = filters.triState.feature;
            const adminOk = !!(typeof window !== 'undefined' && window.accessRights && window.accessRights.admin === true);
            
            Object.entries(features).forEach(([value, state]) => {
                if (typeof isAdminBlankFeature === 'function' && isAdminBlankFeature(value) && !adminOk) {
                    return;
                }
                if (state === 'checked' || state === 'excluded') {
                    const wantOn = state === 'checked';
                    questions = questions.filter(q => {
                        if (typeof questionFeatureOn === 'function') {
                            const on = questionFeatureOn(q, value);
                            return wantOn ? on : !on;
                        }
                        return true;
                    });
                }
            });
        }

        if (filters.triState.partPerformance) {
            Object.entries(filters.triState.partPerformance).forEach(([value, state]) => {
                if (state === 'checked') {
                    questions = questions.filter(q => {
                        return typeof questionHasPartPerformance === 'function'
                            ? questionHasPartPerformance(q, value)
                            : false;
                    });
                } else if (state === 'excluded') {
                    questions = questions.filter(q => {
                        return typeof questionHasPartPerformance === 'function'
                            ? !questionHasPartPerformance(q, value)
                            : true;
                    });
                }
            });
        }
    }

    // Exact ID-set layer (資料檢查 bulk pending / 進階「篩選全部待處理」).
    var idSet = filters.idSetFilter || (typeof window !== 'undefined' ? window.idSetFilter : null);
    if (idSet && idSet.active && idSet.ids) {
        questions = questions.filter(function (q) {
            var id = q && q.id != null ? String(q.id) : '';
            return !!(id && idSet.ids[id]);
        });
    }

    // Advanced condition layer (local-only; ConditionMatch AND).
    var advanced = filters.advancedFilter || (typeof window !== 'undefined' ? window.advancedFilter : null);
    if (advanced && advanced.active && Array.isArray(advanced.conditions) && advanced.conditions.length) {
        var Match = typeof window !== 'undefined' ? window.ConditionMatch : null;
        if (Match && typeof Match.matchesAllConditions === 'function') {
            questions = questions.filter(function (q) {
                return Match.matchesAllConditions(q, advanced.conditions);
            });
        }
    }
    
    return questions;
};