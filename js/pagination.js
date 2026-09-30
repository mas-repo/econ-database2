// Pagination
// Dependencies: globals.js (paginationState), render.js (renderQuestions)

// Dependencies: None
function updatePaginationInfo(currentPage, totalItems, itemsPerPage) {
    const infoElement = document.getElementById('pagination-info-text');
    if (itemsPerPage === -1) {
        infoElement.textContent = `顯示全部 ${totalItems} 題`;
    } else {
        const startItem = totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
        const endItem = Math.min(currentPage * itemsPerPage, totalItems);
        infoElement.textContent = `顯示 ${startItem}-${endItem} 共 ${totalItems} 題`;
    }
}

// Dependencies: None
function generatePagination(currentPage, totalPages) {
    // Target both the original bottom container and a new top container
    const containers = [
        document.getElementById('pagination-buttons'),
        document.getElementById('pagination-buttons-top') // New top container
    ].filter(Boolean); // Ignore if the element doesn't exist in HTML
    
    let html = '';
    
    if (totalPages <= 1) {
        html = '<button class="pagination-btn active">1</button>';
    } else {
        if (currentPage > 1) {
            html += `<button class="pagination-btn" onclick="goToPage(${currentPage - 1})">&laquo;</button>`;
        }
        
        const startPage = Math.max(1, currentPage - 2);
        const endPage = Math.min(totalPages, currentPage + 2);
        
        if (startPage > 1) {
            html += `<button class="pagination-btn" onclick="goToPage(1)">1</button>`;
            if (startPage > 2) html += '<span style="padding: 8px;">...</span>';
        }
        
        for (let i = startPage; i <= endPage; i++) {
            const activeClass = i === currentPage ? ' active' : '';
            html += `<button class="pagination-btn${activeClass}" onclick="goToPage(${i})">${i}</button>`;
        }
        
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) html += '<span style="padding: 8px;">...</span>';
            html += `<button class="pagination-btn" onclick="goToPage(${totalPages})">${totalPages}</button>`;
        }
        
        if (currentPage < totalPages) {
            html += `<button class="pagination-btn" onclick="goToPage(${currentPage + 1})">&raquo;</button>`;
        }
    }
    
    // Apply the generated HTML to all valid containers
    containers.forEach(container => {
        container.innerHTML = html;
    });
}

// Dependencies: globals.js (paginationState), render.js (renderQuestions)
function goToPage(page) {
    paginationState.questions.page = page;
    renderQuestions();
    
    // Modification: Scroll to top smoothly after changing page
    if (typeof scrollToTop === 'function') {
        scrollToTop();
    } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// Dependencies: globals.js (paginationState), render.js (renderQuestions)
function changeItemsPerPage(tab) {
    const select = document.getElementById('items-per-page');
    paginationState.questions.itemsPerPage = parseInt(select.value);
    paginationState.questions.page = 1;
    renderQuestions();
}