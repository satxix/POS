// --- Villacart Expenses module ---
// v8.1.4: Extracted from app.js. Uses existing queueTransaction/business day sync path unchanged.

    function openExpenseModal() { document.getElementById('exp-desc').value = ''; document.getElementById('exp-amt').value = ''; document.getElementById('exp-category').value = 'Utilities'; document.getElementById('expense-modal').classList.replace('hidden', 'flex'); }
    function saveExpense() {
        const desc = document.getElementById('exp-desc').value; const amt = parseFloat(document.getElementById('exp-amt').value); const category = document.getElementById('exp-category').value;
        if (!desc || isNaN(amt)) { showToast("Required fields missing", "error"); return; }
        const expenseTrans = { id: nextTransactionId('EX'), type: 'EX', desc, category, total: amt, timestamp: new Date().toISOString(), notes: "" };
        if (typeof attachBusinessDayToTransaction === 'function') attachBusinessDayToTransaction(expenseTrans);
        queueTransaction(expenseTrans); closeModal('expense-modal'); showToast('Expense Saved', 'success'); if (activeLedgerTab === 'expense') renderLedger(); renderInsights();
    }
