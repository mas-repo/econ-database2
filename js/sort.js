// Sort questions helper function
function sortQuestions(questions, sortBy = 'default') {
    const sorted = [...questions];
    
    // Helper to extract number and letter from question number
    function parseQuestionNumber(qNum) {
        if (!qNum) return { num: 0, letter: '' };
        const match = qNum.match(/^(\d+)([a-z]*)$/i);
        if (!match) return { num: 0, letter: qNum };
        return {
            num: parseInt(match[1]),
            letter: match[2].toLowerCase()
        };
    }

    // Helper to compare Papers (handles "Paper 1", "1", "Paper 2", "2")
    function comparePapers(a, b) {
        const paperA = a.paper ? String(a.paper) : '';
        const paperB = b.paper ? String(b.paper) : '';
        // Use numeric sort so "Paper 2" comes before "Paper 10" if that ever happens
        return paperA.localeCompare(paperB, undefined, { numeric: true });
    }

    // Helper to compare Sections (handles "A", "B", "-")
    function compareSections(a, b) {
        const secA = (a.section && a.section !== '-') ? String(a.section) : '';
        const secB = (b.section && b.section !== '-') ? String(b.section) : '';
        return secA.localeCompare(secB, undefined, { numeric: true });
    }
    
    // Safe year comparison
    function compareYears(a, b) {
        const yA = parseInt(a.year);
        const yB = parseInt(b.year);
        // If both are numbers, compare them
        if (!isNaN(yA) && !isNaN(yB)) return yA - yB;
        // If one is NaN (e.g. "Sample Paper"), handle it
        if (isNaN(yA) && !isNaN(yB)) return -1; // Non-numbers
        if (!isNaN(yA) && isNaN(yB)) return 1;
        // Both strings
        return String(a.year).localeCompare(String(b.year));
    }
    
    sorted.sort((a, b) => {
        switch(sortBy) {
            case 'default':
                // 1. Year DESC (newest first)
                if (a.year !== b.year) {
                    return compareYears(b, a); // DESC
                }
                
                // 2. Paper ASC (Paper 1 before Paper 2)
                const paperDiff = comparePapers(a, b);
                if (paperDiff !== 0) return paperDiff;

                // 3. Section ASC (Section A before Section B)
                const secDiff = compareSections(a, b);
                if (secDiff !== 0) return secDiff;

                // 4. Question Number ASC
                const aQ = parseQuestionNumber(a.questionNumber);
                const bQ = parseQuestionNumber(b.questionNumber);
                if (aQ.num !== bQ.num) {
                    return aQ.num - bQ.num; // Smaller numbers first
                }
                return aQ.letter.localeCompare(bQ.letter); // Then by letter
                
            case 'year-asc':
                // 1. Year ASC (oldest first)
                if (a.year !== b.year) {
                    return compareYears(a, b); // ASC
                }
                // 2. Paper ASC
                const paperDiffAsc = comparePapers(a, b);
                if (paperDiffAsc !== 0) return paperDiffAsc;

                // 3. Section ASC
                const secDiffAsc = compareSections(a, b);
                if (secDiffAsc !== 0) return secDiffAsc;

                // 4. Question Number ASC
                const aQ1 = parseQuestionNumber(a.questionNumber);
                const bQ1 = parseQuestionNumber(b.questionNumber);
                if (aQ1.num !== bQ1.num) {
                    return aQ1.num - bQ1.num;
                }
                return aQ1.letter.localeCompare(bQ1.letter);
                
            case 'year-desc':
                // 1. Year DESC (newest first)
                if (a.year !== b.year) {
                    return compareYears(b, a); // DESC
                }
                // 2. Paper ASC
                const paperDiffDesc = comparePapers(a, b);
                if (paperDiffDesc !== 0) return paperDiffDesc;

                // 3. Section ASC
                const secDiffDesc = compareSections(a, b);
                if (secDiffDesc !== 0) return secDiffDesc;

                // 4. Question Number ASC
                const aQ2 = parseQuestionNumber(a.questionNumber);
                const bQ2 = parseQuestionNumber(b.questionNumber);
                if (aQ2.num !== bQ2.num) {
                    return aQ2.num - bQ2.num;
                }
                return aQ2.letter.localeCompare(bQ2.letter);
                
            case 'question-asc':
                // Question Number ASC, then Year DESC
                const aQ3 = parseQuestionNumber(a.questionNumber);
                const bQ3 = parseQuestionNumber(b.questionNumber);
                if (aQ3.num !== bQ3.num) {
                    return aQ3.num - bQ3.num;
                }
                if (aQ3.letter !== bQ3.letter) {
                    return aQ3.letter.localeCompare(bQ3.letter);
                }
                return compareYears(b, a);
                
            case 'question-desc':
                // Question Number DESC, then Year DESC
                const aQ4 = parseQuestionNumber(a.questionNumber);
                const bQ4 = parseQuestionNumber(b.questionNumber);
                if (aQ4.num !== bQ4.num) {
                    return bQ4.num - aQ4.num;
                }
                if (aQ4.letter !== bQ4.letter) {
                    return bQ4.letter.localeCompare(aQ4.letter);
                }
                return compareYears(b, a);
                
            case 'marks-asc':
                // Marks ASC, then Year DESC
                if (a.marks !== b.marks) {
                    return (a.marks || 0) - (b.marks || 0);
                }
                return compareYears(b, a);
                
            case 'marks-desc':
                // Marks DESC, then Year DESC
                if (a.marks !== b.marks) {
                    return (b.marks || 0) - (a.marks || 0);
                }
                return compareYears(b, a);

            case 'percentage-asc':
                // Correct Percentage ASC (Hardest first), then Year DESC
                const pA1 = (a.correctPercentage !== undefined && a.correctPercentage !== null && a.correctPercentage !== '') ? parseFloat(a.correctPercentage) : -1;
                const pB1 = (b.correctPercentage !== undefined && b.correctPercentage !== null && b.correctPercentage !== '') ? parseFloat(b.correctPercentage) : -1;
                
                if (pA1 !== pB1) {
                    if (pA1 === -1) return 1;
                    if (pB1 === -1) return -1;
                    return pA1 - pB1;
                }
                return compareYears(b, a);

            case 'percentage-desc':
                // Correct Percentage DESC (Easiest first), then Year DESC
                const pA2 = (a.correctPercentage !== undefined && a.correctPercentage !== null && a.correctPercentage !== '') ? parseFloat(a.correctPercentage) : -1;
                const pB2 = (b.correctPercentage !== undefined && b.correctPercentage !== null && b.correctPercentage !== '') ? parseFloat(b.correctPercentage) : -1;
                
                if (pA2 !== pB2) {
                    if (pA2 === -1) return 1;
                    if (pB2 === -1) return -1;
                    return pB2 - pA2;
                }
                return compareYears(b, a);
                
            default:
                return 0;
        }
    });
    
    return sorted;
}