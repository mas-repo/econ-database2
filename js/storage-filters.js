// Dependencies: storage-core.js (extends IndexedDBStorage)

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
    // Hard permission gate: Colleagues such as Vicky/Sarah never see Mock Tests.
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
            const checkedYears = Object.keys(filters.triState.year).filter(k => filters.triState.year[k] === 'checked');
            const excludedYears = Object.keys(filters.triState.year).filter(k => filters.triState.year[k] === 'excluded');
            
            if (checkedYears.length > 0) {
                // OR Logic: Question matches any of the checked years
                questions = questions.filter(q => checkedYears.includes(String(q.year)));
            }
            
            if (excludedYears.length > 0) {
                // Exclude if matches any of the excluded years
                questions = questions.filter(q => !excludedYears.includes(String(q.year)));
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
                        
                        // Get current logic (Default to OR)
                        const logic = (window.filterLogic && window.filterLogic.curriculum) || 'OR';

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
            
            // Get current logic (Default to OR)
            const logic = (window.filterLogic && window.filterLogic.chapter) || 'OR';

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
            const checkedConcepts = Object.keys(filters.triState.concepts).filter(k => filters.triState.concepts[k] === 'checked');
            const excludedConcepts = Object.keys(filters.triState.concepts).filter(k => filters.triState.concepts[k] === 'excluded');

            if (checkedConcepts.length > 0) {
                questions = questions.filter(q => {
                    if (!q.concepts || !Array.isArray(q.concepts)) return false;
                    return checkedConcepts.some(c => q.concepts.includes(c));
                });
            }

            if (excludedConcepts.length > 0) {
                questions = questions.filter(q => {
                    if (!q.concepts || !Array.isArray(q.concepts)) return true;
                    return !excludedConcepts.some(c => q.concepts.includes(c));
                });
            }
        }

        // Pattern filters
        if (filters.triState.patterns) {
            const checkedPatterns = Object.keys(filters.triState.patterns).filter(k => filters.triState.patterns[k] === 'checked');
            const excludedPatterns = Object.keys(filters.triState.patterns).filter(k => filters.triState.patterns[k] === 'excluded');

            if (checkedPatterns.length > 0) {
                questions = questions.filter(q => {
                    if (!q.patterns || !Array.isArray(q.patterns)) return false;
                    return checkedPatterns.some(p => q.patterns.includes(p));
                });
            }

            if (excludedPatterns.length > 0) {
                questions = questions.filter(q => {
                    if (!q.patterns || !Array.isArray(q.patterns)) return true;
                    return !excludedPatterns.some(p => q.patterns.includes(p));
                });
            }
        }

        // Stem pattern filters
        if (filters.triState.stemPatterns) {
            const checkedStemPatterns = Object.keys(filters.triState.stemPatterns).filter(k => filters.triState.stemPatterns[k] === 'checked');
            const excludedStemPatterns = Object.keys(filters.triState.stemPatterns).filter(k => filters.triState.stemPatterns[k] === 'excluded');

            if (checkedStemPatterns.length > 0) {
                questions = questions.filter(q => {
                    if (!q.stemPatterns || !Array.isArray(q.stemPatterns)) return false;
                    return checkedStemPatterns.some(p => q.stemPatterns.includes(p));
                });
            }

            if (excludedStemPatterns.length > 0) {
                questions = questions.filter(q => {
                    if (!q.stemPatterns || !Array.isArray(q.stemPatterns)) return true;
                    return !excludedStemPatterns.some(p => q.stemPatterns.includes(p));
                });
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

        // AI Explanation Filter
        if (filters.triState.ai) {
            const checked = Object.keys(filters.triState.ai).filter(k => filters.triState.ai[k] === 'checked');
            const excluded = Object.keys(filters.triState.ai).filter(k => filters.triState.ai[k] === 'excluded');

            if (checked.length > 0 && checked.includes('AI 詳解')) {
                questions = questions.filter(q => q.AIExplanation && q.AIExplanation.trim() !== '');
            }
            if (excluded.length > 0 && excluded.includes('AI 詳解')) {
                questions = questions.filter(q => !q.AIExplanation || q.AIExplanation.trim() === '');
            }
        }

        // Multiple Selection Filter
        if (filters.triState.multipleSelection) {
            const checked = Object.keys(filters.triState.multipleSelection).filter(k => filters.triState.multipleSelection[k] === 'checked');
            const excluded = Object.keys(filters.triState.multipleSelection).filter(k => filters.triState.multipleSelection[k] === 'excluded');

            if (checked.length > 0) {
                questions = questions.filter(q => checked.includes(q.multipleSelectionType));
            }
            if (excluded.length > 0) {
                questions = questions.filter(q => !excluded.includes(q.multipleSelectionType));
            }
        }

        // Graph Filter
        if (filters.triState.graph) {
            const checked = Object.keys(filters.triState.graph).filter(k => filters.triState.graph[k] === 'checked');
            const excluded = Object.keys(filters.triState.graph).filter(k => filters.triState.graph[k] === 'excluded');

            if (checked.length > 0) {
                questions = questions.filter(q => checked.includes(q.graphType));
            }
            if (excluded.length > 0) {
                questions = questions.filter(q => !excluded.includes(q.graphType));
            }
        }

        // Table Filter
        if (filters.triState.table) {
            const checked = Object.keys(filters.triState.table).filter(k => filters.triState.table[k] === 'checked');
            const excluded = Object.keys(filters.triState.table).filter(k => filters.triState.table[k] === 'excluded');

            if (checked.length > 0) {
                questions = questions.filter(q => checked.includes(q.tableType));
            }
            if (excluded.length > 0) {
                questions = questions.filter(q => !excluded.includes(q.tableType));
            }
        }

        // Calculation Filter
        if (filters.triState.calculation) {
            const checked = Object.keys(filters.triState.calculation).filter(k => filters.triState.calculation[k] === 'checked');
            const excluded = Object.keys(filters.triState.calculation).filter(k => filters.triState.calculation[k] === 'excluded');

            if (checked.length > 0) {
                questions = questions.filter(q => checked.includes(q.calculationType));
            }
            if (excluded.length > 0) {
                questions = questions.filter(q => !excluded.includes(q.calculationType));
            }
        }

        // Feature filters
        if (filters.triState.feature) {
            const features = filters.triState.feature;
            
            Object.entries(features).forEach(([value, state]) => {
                if (state === 'checked') {
                    questions = questions.filter(q => {
                        if (value === '含圖表') {
                            return q.graphType && 
                                q.graphType !== '' && 
                                q.graphType !== '-' && 
                                q.graphType !== '沒有圖';
                        } else if (value === '有內嵌圖') {
                            return !!(q.inlineDiagrams && String(q.inlineDiagrams).trim());
                        } else if (value === '含表格') {
                            return q.tableType && 
                                q.tableType !== '' && 
                                q.tableType !== '-' && 
                                q.tableType !== '沒有表格';
                        } else if (value === '複選') {
                            return q.multipleSelectionType && 
                                q.multipleSelectionType !== '' && 
                                q.multipleSelectionType !== '-' && 
                                q.multipleSelectionType !== '並非複選型' && 
                                q.multipleSelectionType !== '不適用';
                        } else if (value === '含計算') {
                            return q.calculationType && 
                                q.calculationType !== '' && 
                                q.calculationType !== '-' && 
                                q.calculationType !== '沒有計算';
                        } else if (value === '跨課題') {
                            return q.curriculumClassification && 
                                Array.isArray(q.curriculumClassification) && 
                                q.curriculumClassification.length > 1;
                        } else if (value === '跨章節') {
                            return q.AristochapterClassification && 
                                Array.isArray(q.AristochapterClassification) && 
                                q.AristochapterClassification.length > 1;
                        } else if (value === '已刪除') {
                            return q.answerMC && q.answerMC.trim() === '*';
                        } else if (value === 'Out syl') {
                            // Show ONLY if it has 'Y'
                            return q.outSyl && q.outSyl.trim().toUpperCase() === 'Y';
                        }
                        return true;
                    });
                } else if (state === 'excluded') {
                    questions = questions.filter(q => {
                        if (value === '含圖表') {
                            return !q.graphType || 
                                q.graphType === '' || 
                                q.graphType === '-' || 
                                q.graphType === '沒有圖';
                        } else if (value === '有內嵌圖') {
                            return !(q.inlineDiagrams && String(q.inlineDiagrams).trim());
                        } else if (value === '含表格') {
                            return !q.tableType || 
                                q.tableType === '' || 
                                q.tableType === '-' || 
                                q.tableType === '沒有表格';
                        } else if (value === '複選') {
                            return !q.multipleSelectionType || 
                                q.multipleSelectionType === '' || 
                                q.multipleSelectionType === '-' || 
                                q.multipleSelectionType === '並非複選型' || 
                                q.multipleSelectionType === '不適用';
                        } else if (value === '含計算') {
                            return !q.calculationType || 
                                q.calculationType === '' || 
                                q.calculationType === '-' || 
                                q.calculationType === '沒有計算';
                        } else if (value === '跨課題') {
                            return !q.curriculumClassification || 
                                !Array.isArray(q.curriculumClassification) || 
                                q.curriculumClassification.length <= 1;
                        } else if (value === '跨章節') {
                            return !q.AristochapterClassification || 
                                !Array.isArray(q.AristochapterClassification) || 
                                q.AristochapterClassification.length <= 1;
                        } else if (value === '已刪除') {
                            return !q.answerMC || q.answerMC.trim() !== '*';
                        } else if (value === 'Out syl') {
                            // Hide if it has 'Y'
                            return !q.outSyl || q.outSyl.trim().toUpperCase() !== 'Y';
                        }                          
                        return true;
                    });
                }
            });
        }
    }
    
    return questions;
};